import type { DetectionCandidate, PageGeometry } from "./types";

const ALIGN_TOLERANCE_PT = 3;

/**
 * Strategy D — border / enclosing rectangle detection.
 *
 * Some label templates draw an explicit rectangular border around the
 * shipping-label block. This looks for a horizontal top edge and a
 * horizontal bottom edge that share matching vertical edges (a closed or
 * near-closed rectangle), which directly gives the label's bounding box.
 */
export function detectByBorder(page: PageGeometry): DetectionCandidate[] {
  const { horizontalLines, verticalLines, width, height } = page;
  if (horizontalLines.length < 2 || verticalLines.length < 2) return [];

  // Only look at wide horizontal lines (potential top/bottom edges of a label box)
  const wideHorizontals = horizontalLines.filter((l) => Math.abs(l.x2 - l.x1) > width * 0.5);
  const tallVerticals = verticalLines.filter((l) => Math.abs(l.y2 - l.y1) > height * 0.15);

  if (wideHorizontals.length < 2) return [];

  // --- Cluster wide horizontals by Y to avoid O(N²) explosion ---
  // Sort by Y ascending
  wideHorizontals.sort((a, b) => (a.y1 + a.y2) / 2 - (b.y1 + b.y2) / 2);

  const Y_CLUSTER_PT = 4;
  const yGroups: { y: number; lines: typeof wideHorizontals }[] = [];
  for (const l of wideHorizontals) {
    const ly = (l.y1 + l.y2) / 2;
    const last = yGroups[yGroups.length - 1];
    if (!last || Math.abs(last.y - ly) > Y_CLUSTER_PT) {
      yGroups.push({ y: ly, lines: [l] });
    } else {
      last.lines.push(l);
      last.y = (last.y * (last.lines.length - 1) + ly) / last.lines.length;
    }
  }

  if (yGroups.length < 2) return [];

  // Cap to at most 30 distinct Y-clusters to bound the O(K²) pair check
  const groups = yGroups.slice(0, 30);

  const candidates: DetectionCandidate[] = [];

  for (let i = 0; i < groups.length && candidates.length < 20; i++) {
    for (let j = i + 1; j < groups.length && candidates.length < 20; j++) {
      const topGroup = groups[i];
      const bottomGroup = groups[j];
      const topY = topGroup.y;
      const bottomY = bottomGroup.y;
      const boxHeight = bottomY - topY;
      if (boxHeight < height * 0.15) continue; // too thin to be the label box

      // Require at least one vertical line roughly connecting the two.
      const connecting = tallVerticals.filter(
        (v) =>
          Math.min(v.y1, v.y2) <= topY + ALIGN_TOLERANCE_PT * 4 &&
          Math.max(v.y1, v.y2) >= bottomY - ALIGN_TOLERANCE_PT * 4,
      );
      if (connecting.length === 0) continue;

      // Use the representative line from each cluster for X bounds
      const topLine = topGroup.lines[0];
      const bottomLine = bottomGroup.lines[0];
      const leftX = Math.min(topLine.x1, topLine.x2, bottomLine.x1, bottomLine.x2);
      const rightX = Math.max(topLine.x1, topLine.x2, bottomLine.x1, bottomLine.x2);

      const coverage = (rightX - leftX) / width;
      const confidence = clamp(0.4 + coverage * 0.3 + Math.min(0.2, connecting.length * 0.1), 0, 0.9);

      candidates.push({
        method: "border",
        confidence,
        cropRect: { x: Math.max(0, leftX), y: 0, width: Math.min(width, rightX - leftX), height: bottomY },
        reason: `Bordered box from y=${topY.toFixed(1)} to y=${bottomY.toFixed(1)}`,
      });
    }
  }

  return candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
