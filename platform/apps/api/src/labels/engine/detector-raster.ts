import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { DetectionCandidate, PageGeometry } from "./types";

// Detection-only render resolution. This is deliberately modest — it is
// NEVER used as the final print output, only to locate the separator on
// pages that are entirely a raster image (e.g. a scanned label).
const DETECTION_RENDER_DPI = 100;

/**
 * Strategy E — raster fallback.
 *
 * For pages that PDF.js reports as essentially "one big image" (no usable
 * vector lines or text), rasterize the page at a moderate DPI and look
 * for a horizontal band with a sharp change in ink density — the visual
 * seam between the shipping label and the invoice section.
 */
export async function detectByRaster(
  doc: PDFDocumentProxy,
  page: PageGeometry,
): Promise<DetectionCandidate[]> {
  if (!page.isRasterOnly) return [];

  try {
    const pdfPage = await doc.getPage(page.pageNumber);
    const scale = DETECTION_RENDER_DPI / 72;
    const viewport = pdfPage.getViewport({ scale, rotation: page.rotation });
    // Optional native dependency: without it the raster strategy is skipped, never fatal.
    const { createCanvas } = require("@napi-rs/canvas") as typeof import("@napi-rs/canvas");
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");

    // @napi-rs/canvas's context is API-compatible with the subset PDF.js
    // needs for rendering (2D drawing + ImageData).
    await pdfPage.render({
      // @napi-rs/canvas implements the same 2D rendering API pdf.js needs
      // but isn't a DOM HTMLCanvasElement, so both values are cast for
      // this Node-side render path.
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const rowDarkness = computeRowDarkness(imageData.data, canvas.width, canvas.height);

    const candidate = findDensityTransition(rowDarkness, canvas.height, page.height, page.width);
    return candidate ? [candidate] : [];
  } catch {
    // Rendering failures on the raster fallback should never crash the
    // batch — just report no candidate from this strategy.
    return [];
  }
}

function computeRowDarkness(data: Uint8ClampedArray, w: number, h: number): number[] {
  const rows = new Array(h).fill(0);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    const rowStart = y * w * 4;
    for (let x = 0; x < w; x += 2) {
      // sample every other pixel for speed
      const idx = rowStart + x * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const luminance = (r + g + b) / 3;
      sum += 255 - luminance; // darker = higher "ink" value
    }
    rows[y] = sum / (w / 2);
  }
  return rows;
}

function findDensityTransition(
  rowDarkness: number[],
  renderHeight: number,
  pageHeightPt: number,
  pageWidthPt: number,
): DetectionCandidate | null {
  const windowSize = Math.max(3, Math.round(renderHeight * 0.01));
  // Smooth with a simple moving average.
  const smoothed = rowDarkness.map((_, i) => {
    const start = Math.max(0, i - windowSize);
    const end = Math.min(rowDarkness.length, i + windowSize);
    const slice = rowDarkness.slice(start, end);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });

  let bestIdx = -1;
  let bestDrop = 0;
  const searchStart = Math.floor(renderHeight * 0.2);
  const searchEnd = Math.floor(renderHeight * 0.9);
  for (let i = searchStart; i < searchEnd; i++) {
    const before = smoothed[Math.max(0, i - windowSize * 3)];
    const after = smoothed[Math.min(smoothed.length - 1, i + windowSize * 3)];
    const drop = Math.abs(before - after);
    if (drop > bestDrop) {
      bestDrop = drop;
      bestIdx = i;
    }
  }

  if (bestIdx === -1 || bestDrop < 5) return null;

  const relativeY = bestIdx / renderHeight;
  const cropHeightPt = relativeY * pageHeightPt;
  const confidence = Math.min(0.75, 0.4 + bestDrop / 100);

  return {
    method: "raster",
    confidence,
    cropRect: { x: 0, y: 0, width: pageWidthPt, height: cropHeightPt },
    reason: `Raster density transition at ${(relativeY * 100).toFixed(0)}% of page height`,
  };
}
