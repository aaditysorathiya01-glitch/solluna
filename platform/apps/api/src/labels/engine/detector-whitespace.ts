import type { DetectionCandidate, PageGeometry } from "./types";

const BAND_HEIGHT_PT = 8;

/**
 * Strategy C — content-density / whitespace-gap fallback.
 *
 * Buckets all text-item and line geometry into horizontal bands and
 * measures content density per band. A wide, isolated horizontal gap
 * between two dense regions (label content above, invoice content below)
 * is a plausible separator even without an explicit line or keyword.
 * This is intentionally the weakest signal and is used mainly to support
 * (or contradict) the other strategies in the hybrid combiner.
 */
export function detectByWhitespace(page: PageGeometry): DetectionCandidate[] {
  const { textItems, horizontalLines, verticalLines, width, height } = page;
  const bandCount = Math.ceil(height / BAND_HEIGHT_PT);
  const density = new Array(bandCount).fill(0);

  const mark = (y: number, weight: number) => {
    const band = Math.min(bandCount - 1, Math.max(0, Math.floor(y / BAND_HEIGHT_PT)));
    density[band] += weight;
  };

  for (const t of textItems) mark(t.y, 1);
  for (const l of [...horizontalLines, ...verticalLines]) mark((l.y1 + l.y2) / 2, 0.5);

  // Find gaps: runs of near-zero density bands.
  const candidates: DetectionCandidate[] = [];
  let gapStart = -1;
  for (let i = 0; i < bandCount; i++) {
    const isEmpty = density[i] === 0;
    if (isEmpty && gapStart === -1) gapStart = i;
    if ((!isEmpty || i === bandCount - 1) && gapStart !== -1) {
      const gapEnd = isEmpty ? i : i - 1;
      const gapHeightPt = (gapEnd - gapStart + 1) * BAND_HEIGHT_PT;
      const gapCenterY = ((gapStart + gapEnd) / 2) * BAND_HEIGHT_PT;

      const hasContentAbove = density.slice(0, gapStart).some((d) => d > 0);
      const hasContentBelow = density.slice(gapEnd + 1).some((d) => d > 0);
      const relativePosition = gapCenterY / height;

      if (
        hasContentAbove &&
        hasContentBelow &&
        gapHeightPt >= 10 &&
        relativePosition > 0.2 &&
        relativePosition < 0.9
      ) {
        // Wider, more central-ish gaps score higher, but this stays capped
        // below the more reliable strategies.
        const sizeScore = Math.min(1, gapHeightPt / 40);
        const confidence = clamp(0.35 + sizeScore * 0.3, 0, 0.7);
        candidates.push({
          method: "whitespace",
          confidence,
          cropRect: { x: 0, y: 0, width, height: gapStart * BAND_HEIGHT_PT },
          reason: `Whitespace gap of ${gapHeightPt.toFixed(0)}pt starting at y=${(gapStart * BAND_HEIGHT_PT).toFixed(0)}pt`,
        });
      }
      gapStart = -1;
    }
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
