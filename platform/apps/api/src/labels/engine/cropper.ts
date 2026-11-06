import type { CropRect, PageGeometry } from "./types";

export interface PdfSpaceBox {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

/**
 * Converts a crop rectangle expressed in the normalized top-down detection
 * space (see PageGeometry docs) back into the PDF's native coordinate
 * space (bottom-left origin, y-up, pre-rotation), so it can be used as an
 * embedPage bounding box. Because rotation is always a multiple of 90°,
 * projecting the rectangle's four corners through the inverse viewport
 * transform and taking their axis-aligned bounding box is exact.
 */
export function cropRectToPdfSpace(rect: CropRect, page: PageGeometry): PdfSpaceBox {
  const inverse = invertAffine(page.viewportTransform);
  const corners: Array<[number, number]> = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height],
    [rect.x + rect.width, rect.y + rect.height],
  ];
  const transformed = corners.map(([x, y]) => applyAffine(inverse, x, y));
  const xs = transformed.map((p) => p[0]);
  const ys = transformed.map((p) => p[1]);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    bottom: Math.min(...ys),
    top: Math.max(...ys),
  };
}

function applyAffine(m: number[], x: number, y: number): [number, number] {
  const [a, b, c, d, e, f] = m;
  return [a * x + c * y + e, b * x + d * y + f];
}

function invertAffine(m: number[]): number[] {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-10) {
    throw new Error("Non-invertible page transform encountered during cropping.");
  }
  const ia = d / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;
  const ie = -(ia * e + ic * f);
  const iff = -(ib * e + id * f);
  return [ia, ib, ic, id, ie, iff];
}
