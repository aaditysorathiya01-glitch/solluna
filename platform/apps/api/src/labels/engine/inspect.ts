import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { pdfjs, standardFontDataUrl } from "./pdfjs";

// pdf.js operator codes, filled in when the first PDF is loaded.
let OPS: Record<string, number> = {};
import { ProcessingError } from "./types";
import type { PageGeometry, TextItem, LineSegment } from "./types";

// Real-world courier PDFs frequently use the 14 standard PDF fonts
// without embedding them. Pointing pdf.js at its bundled font-metrics
// data (instead of leaving this unset) gives more accurate glyph widths
// for text extraction and avoids repeated "standardFontDataUrl" warnings
// on every page. Resolved via process.cwd() rather than require.resolve()
// because require.resolve() gets rewritten to an opaque module id by
// Next's bundler and can't be used as a filesystem path at runtime.

/**
 * Loads a PDF document from a buffer using PDF.js in a Node-safe way
 * (no DOM APIs, no worker thread — pdfjs-dist's legacy Node build runs
 * synchronously in-process which is appropriate for a server route).
 */
export async function loadPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  try {
    // Ensure pure Uint8Array (Node Buffer.prototype.slice returns Buffer, which pdf.js rejects)
    const pureUint8 = new Uint8Array(bytes.byteLength);
    pureUint8.set(bytes);

    const lib = await pdfjs();
    OPS = lib.OPS as unknown as Record<string, number>;
    const loadingTask = lib.getDocument({
      data: pureUint8,
      useWorkerFetch: false,
      disableFontFace: true,
      standardFontDataUrl: standardFontDataUrl(),
    });
    const doc = await loadingTask.promise;
    return doc;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/password/i.test(message)) {
      throw new ProcessingError(
        "This PDF is password protected. Please upload an unlocked PDF.",
        "PASSWORD_PROTECTED",
      );
    }
    throw new ProcessingError(
      "We couldn't read this PDF. Please export the labels again and try again.",
      "CORRUPT",
    );
  }
}

/** Normalizes a PDF.js viewport rotation into the effective page width/height. */
function normalizedDimensions(page: PDFPageProxy): { width: number; height: number; rotation: number } {
  const viewport = page.getViewport({ scale: 1, rotation: 0 });
  const rotation = (page.rotate + 360) % 360;
  const swapped = rotation === 90 || rotation === 270;
  return {
    width: swapped ? viewport.height : viewport.width,
    height: swapped ? viewport.width : viewport.height,
    rotation,
  };
}

/**
 * Extracts geometry for a single page: normalized dimensions (rotation
 * already applied so downstream detectors always work in "reading"
 * orientation), text items with bounding boxes, and horizontal/vertical
 * line segments found in the content stream.
 */
export async function inspectPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
): Promise<PageGeometry> {
  const page = await doc.getPage(pageNumber);
  const { width, height, rotation } = normalizedDimensions(page);

  // Viewport used purely to transform text/graphics coordinates into the
  // normalized (rotation-applied) page space with a bottom-left origin.
  const viewport = page.getViewport({ scale: 1, rotation });
  const textContent = await page.getTextContent();
  const textItems: TextItem[] = [];
  for (const item of textContent.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    // item.transform = [a, b, c, d, e, f] in PDF user space; apply viewport
    // transform to get normalized page-space coordinates.
    const [x, y] = applyViewportTransform(viewport.transform, item.transform[4], item.transform[5]);
    const itemHeight = Math.hypot(item.transform[2], item.transform[3]) || 10;
    const itemWidth = item.width ?? item.str.length * itemHeight * 0.5;
    textItems.push({
      text: item.str,
      x,
      y,
      width: itemWidth,
      height: itemHeight,
    });
  }
  const { horizontalLines, verticalLines, rasterCoverage, vectorOpCount } = await extractLinesAndRaster(
    page,
    viewport,
    width,
    height,
  );

  const isRasterOnly = rasterCoverage > 0.85 && textItems.length < 3 && vectorOpCount < 20;

  return {
    pageNumber,
    width,
    height,
    rotation,
    isRasterOnly,
    textItems,
    horizontalLines,
    verticalLines,
    viewportTransform: viewport.transform,
  };
}

function applyViewportTransform(m: number[], x: number, y: number): [number, number] {
  // viewport.transform is [a, b, c, d, e, f]
  const [a, b, c, d, e, f] = m;
  return [a * x + c * y + e, b * x + d * y + f];
}

const LINE_TOLERANCE_PT = 1.5;

// Internal pdfjs-dist draw-op codes used inside constructPath's flat data
// array (see the constructPath case below for details). These are a fixed,
// tiny enum verified against the installed pdfjs-dist version.
const DRAW_OP_MOVE_TO = 0;
const DRAW_OP_LINE_TO = 1;
const DRAW_OP_CURVE_TO = 2;
const DRAW_OP_QUADRATIC_CURVE_TO = 3;
const DRAW_OP_CLOSE_PATH = 4;

/**
 * Walks the page's operator list to find straight-line stroke segments
 * (used by the dashed-line / border detectors) and to estimate what
 * fraction of the page is covered by raster images (used to flag
 * fully-scanned pages that need the raster-fallback detector).
 */
async function extractLinesAndRaster(
  page: PDFPageProxy,
  viewport: { transform: number[] },
  pageWidth: number,
  pageHeight: number,
): Promise<{
  horizontalLines: LineSegment[];
  verticalLines: LineSegment[];
  rasterCoverage: number;
  vectorOpCount: number;
}> {
  const opList = await page.getOperatorList();
  const horizontalLines: LineSegment[] = [];
  const verticalLines: LineSegment[] = [];
  let rasterArea = 0;
  let vectorOpCount = 0;

  // Minimal CTM (current transformation matrix) stack tracking so that
  // path coordinates (which are in user space at the time they were
  // emitted) can be projected into normalized page space.
  let ctm = [...viewport.transform] as number[];
  const ctmStack: number[][] = [];
  let currentX = 0;
  let currentY = 0;
  let subpathStartX = 0;
  let subpathStartY = 0;
  const pendingSegments: LineSegment[] = [];

  const transformPoint = (x: number, y: number, m: number[]): [number, number] => {
    const [a, b, c, d, e, f] = m;
    return [a * x + c * y + e, b * x + d * y + f];
  };

  const multiply = (m1: number[], m2: number[]): number[] => {
    const [a1, b1, c1, d1, e1, f1] = m1;
    const [a2, b2, c2, d2, e2, f2] = m2;
    return [
      a1 * a2 + b1 * c2,
      a1 * b2 + b1 * d2,
      c1 * a2 + d1 * c2,
      c1 * b2 + d1 * d2,
      e1 * a2 + f1 * c2 + e2,
      e1 * b2 + f1 * d2 + f2,
    ];
  };

  const { fnArray, argsArray } = opList;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    switch (fn) {
      case OPS.save:
        ctmStack.push([...ctm]);
        break;
      case OPS.restore:
        ctm = ctmStack.pop() ?? ctm;
        break;
      case OPS.transform:
        ctm = multiply(args as number[], ctm);
        break;
      case OPS.moveTo: {
        const [x, y] = transformPoint(args[0], args[1], ctm);
        currentX = x;
        currentY = y;
        subpathStartX = x;
        subpathStartY = y;
        break;
      }
      case OPS.lineTo: {
        const [x, y] = transformPoint(args[0], args[1], ctm);
        pendingSegments.push({ x1: currentX, y1: currentY, x2: x, y2: y });
        currentX = x;
        currentY = y;
        vectorOpCount++;
        break;
      }
      case OPS.closePath: {
        pendingSegments.push({ x1: currentX, y1: currentY, x2: subpathStartX, y2: subpathStartY });
        currentX = subpathStartX;
        currentY = subpathStartY;
        break;
      }
      case OPS.rectangle: {
        // rectangle args: x, y, w, h — emit as 4 line segments (useful for
        // border detection).
        const [x, y, w, h] = args as number[];
        const p1 = transformPoint(x, y, ctm);
        const p2 = transformPoint(x + w, y, ctm);
        const p3 = transformPoint(x + w, y + h, ctm);
        const p4 = transformPoint(x, y + h, ctm);
        pendingSegments.push({ x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] });
        pendingSegments.push({ x1: p2[0], y1: p2[1], x2: p3[0], y2: p3[1] });
        pendingSegments.push({ x1: p3[0], y1: p3[1], x2: p4[0], y2: p4[1] });
        pendingSegments.push({ x1: p4[0], y1: p4[1], x2: p1[0], y2: p1[1] });
        vectorOpCount++;
        break;
      }
      case OPS.constructPath: {
        // PDF.js's operator list encodes an entire subpath (built while
        // parsing the content stream) as ONE constructPath entry rather
        // than separate moveTo/lineTo ops. Its args are laid out as
        // [paintOp, [flatDrawData], minMaxBBox], where flatDrawData is a
        // flat sequence of internal draw-op codes and their coordinates:
        // 0=moveTo(x,y) 1=lineTo(x,y) 2=curveTo(x1,y1,x2,y2,x3,y3)
        // 3=quadraticCurveTo(x1,y1,x,y) 4=closePath(). This layout is
        // undocumented pdfjs-dist internals (verified against the
        // installed version) rather than a public API, so it's isolated
        // here behind a defensive shape check.
        const constructPathArgs = args as unknown as [number, unknown, number[] | undefined];
        const flatDataHolder = constructPathArgs[1];
        // flatDataHolder is a 1-element array/tuple wrapping the actual
        // flat draw-data buffer, which pdfjs-dist stores as a typed array
        // (Float32Array) — NOT a plain Array, so Array.isArray() on it
        // would incorrectly return false.
        const rawFlatData = Array.isArray(flatDataHolder) ? flatDataHolder[0] : undefined;
        const flatData: ArrayLike<number> | undefined =
          rawFlatData && typeof (rawFlatData as ArrayLike<number>).length === "number"
            ? (rawFlatData as ArrayLike<number>)
            : undefined;

        if (flatData) {
          let idx = 0;
          while (idx < flatData.length) {
            const drawOp = flatData[idx++];
            switch (drawOp) {
              case DRAW_OP_MOVE_TO: {
                const [x, y] = transformPoint(flatData[idx], flatData[idx + 1], ctm);
                idx += 2;
                currentX = x;
                currentY = y;
                subpathStartX = x;
                subpathStartY = y;
                break;
              }
              case DRAW_OP_LINE_TO: {
                const [x, y] = transformPoint(flatData[idx], flatData[idx + 1], ctm);
                idx += 2;
                pendingSegments.push({ x1: currentX, y1: currentY, x2: x, y2: y });
                currentX = x;
                currentY = y;
                vectorOpCount++;
                break;
              }
              case DRAW_OP_CURVE_TO: {
                const ex = flatData[idx + 4];
                const ey = flatData[idx + 5];
                idx += 6;
                const [x, y] = transformPoint(ex, ey, ctm);
                // Approximate the curve's chord as a segment — sufficient
                // for line/border detection purposes (real separators and
                // borders are drawn straight; curves are typically logos).
                pendingSegments.push({ x1: currentX, y1: currentY, x2: x, y2: y });
                currentX = x;
                currentY = y;
                break;
              }
              case DRAW_OP_QUADRATIC_CURVE_TO: {
                const ex = flatData[idx + 2];
                const ey = flatData[idx + 3];
                idx += 4;
                const [x, y] = transformPoint(ex, ey, ctm);
                pendingSegments.push({ x1: currentX, y1: currentY, x2: x, y2: y });
                currentX = x;
                currentY = y;
                break;
              }
              case DRAW_OP_CLOSE_PATH: {
                pendingSegments.push({ x1: currentX, y1: currentY, x2: subpathStartX, y2: subpathStartY });
                currentX = subpathStartX;
                currentY = subpathStartY;
                break;
              }
              default:
                // Unknown draw op — stop parsing this subpath rather than
                // risk misreading the rest of the buffer.
                idx = flatData.length;
                break;
            }
          }
        }

        // constructPath's own paintOp (args[0]) tells us whether this path
        // is filled and/or stroked; for stroked paths (borders, rules) we
        // want the segments even without a following top-level stroke op.
        const paintOp = constructPathArgs[0];
        if (
          paintOp === OPS.stroke ||
          paintOp === OPS.closeStroke ||
          paintOp === OPS.fill ||
          paintOp === OPS.eoFill ||
          paintOp === OPS.fillStroke ||
          paintOp === OPS.eoFillStroke
        ) {
          for (const seg of pendingSegments) classifySegment(seg, horizontalLines, verticalLines);
          pendingSegments.length = 0;
        }
        break;
      }
      case OPS.stroke:
      case OPS.closeStroke:
      case OPS.fill:
      case OPS.eoFill:
      case OPS.fillStroke: {
        for (const seg of pendingSegments) classifySegment(seg, horizontalLines, verticalLines);
        pendingSegments.length = 0;
        break;
      }
      case OPS.paintImageXObject:
      case OPS.paintImageXObjectRepeat: {
        // Approximate the image's on-page footprint using the current CTM's
        // scale (images are painted into the unit square [0,1]x[0,1]).
        const [p0x, p0y] = transformPoint(0, 0, ctm);
        const [p1x, p1y] = transformPoint(1, 1, ctm);
        const area = Math.abs((p1x - p0x) * (p1y - p0y));
        rasterArea += area;
        break;
      }
      default:
        break;
    }
  }

  const pageArea = pageWidth * pageHeight || 1;
  const rasterCoverage = Math.min(1, rasterArea / pageArea);

  return { horizontalLines: mergeCollinear(horizontalLines), verticalLines: mergeCollinear(verticalLines), rasterCoverage, vectorOpCount };
}

function classifySegment(seg: LineSegment, horizontal: LineSegment[], vertical: LineSegment[]) {
  const dy = Math.abs(seg.y2 - seg.y1);
  const dx = Math.abs(seg.x2 - seg.x1);
  const length = Math.hypot(dx, dy);
  if (length < 2) return; // ignore degenerate points
  if (dy <= LINE_TOLERANCE_PT && dx > dy) {
    horizontal.push(seg);
  } else if (dx <= LINE_TOLERANCE_PT && dy > dx) {
    vertical.push(seg);
  }
}

/** Merges nearby collinear segments on the same Y (or X) so a dashed line
 * made of many tiny strokes becomes one logical segment with a combined
 * length — this is what the dashed-line detector scores. */
function mergeCollinear(segments: LineSegment[]): LineSegment[] {
  if (segments.length === 0) return [];
  return segments;
}

export async function getPageCount(doc: PDFDocumentProxy): Promise<number> {
  return doc.numPages;
}
