import type { Box, LabelPiece } from '../../../../packages/labels/src';
import { cropRectToPdfSpace } from './engine/cropper';
import { detectLabelRegion } from './engine/detector';
import { inspectPage, loadPdf } from './engine/inspect';

export interface HybridResult { labels: LabelPiece[]; review: number[]; failed: number[] }

/**
 * Fallback for pages the marketplace parsers do not recognise (other courier formats, label-only PDFs):
 * the original SOLLUNA label-cropper hybrid detector (dashed line + text + whitespace + border + raster),
 * which scores each candidate. Failed pages are reported for Manual crop instead of being guessed.
 */
export async function hybridDetect(data: Uint8Array, pageIndexes: number[]): Promise<HybridResult> {
  const out: HybridResult = { labels: [], review: [], failed: [] };
  if (!pageIndexes.length) return out;
  const doc = await loadPdf(data);
  try {
    for (const idx of pageIndexes) {
      try {
        const geometry = await inspectPage(doc, idx + 1);
        const det = await detectLabelRegion(doc, geometry);
        if (det.failed) { out.failed.push(idx); continue; }
        const b = cropRectToPdfSpace(det.cropRect, geometry);
        const box: Box = { x: b.left, y: b.bottom, w: b.right - b.left, h: b.top - b.bottom };
        out.labels.push({ page: idx, box, marketplace: 'UNKNOWN', orderId: null, items: [] });
        if (det.needsReview) out.review.push(idx);
      } catch { out.failed.push(idx); }
    }
  } finally { await doc.loadingTask.destroy().catch(() => undefined); }
  return out;
}
