import type { DetectionCandidate, PageGeometry } from "./types";

const Y_CLUSTER_TOLERANCE_PT = 3;

/**
 * Strategy A — vector dashed/solid line detection.
 *
 * Courier PDFs typically draw the shipping-label / invoice separator as
 * either one long horizontal rule or a dashed line made of many short
 * collinear segments. This groups horizontal line segments by their Y
 * coordinate, then scores each cluster on: how much of the page width it
 * spans, how many segments it's made of (dash repetition), how far it sits
 * from the very top/bottom edges (a real separator is rarely in the
 * margin), and how tightly the segments align on Y.
 */
export function detectDashedLine(page: PageGeometry): DetectionCandidate[] {
  const { horizontalLines, width, height } = page;
  if (horizontalLines.length === 0) return [];

  // Filter lines within reasonable margins first
  const validLines: typeof horizontalLines = [];
  for (const seg of horizontalLines) {
    const y = (seg.y1 + seg.y2) / 2;
    const marginFromTop = y;
    const marginFromBottom = height - y;
    if (marginFromTop >= height * 0.15 && marginFromBottom >= height * 0.05) {
      validLines.push(seg);
    }
  }
  if (validLines.length === 0) return [];

  // Sort by Y for O(N log N) clustering instead of O(N^2)
  validLines.sort((a, b) => (a.y1 + a.y2) / 2 - (b.y1 + b.y2) / 2);

  const clusters: { y: number; segments: typeof horizontalLines }[] = [];
  let currentCluster: { y: number; sumY: number; segments: typeof horizontalLines } | null = null;

  for (const seg of validLines) {
    const y = (seg.y1 + seg.y2) / 2;
    if (!currentCluster || Math.abs(currentCluster.y - y) > Y_CLUSTER_TOLERANCE_PT) {
      currentCluster = { y, sumY: y, segments: [seg] };
      clusters.push(currentCluster);
    } else {
      currentCluster.segments.push(seg);
      currentCluster.sumY += y;
      currentCluster.y = currentCluster.sumY / currentCluster.segments.length;
    }
  }

  const candidates: DetectionCandidate[] = [];

  for (const cluster of clusters) {
    let minX = Infinity;
    let maxX = -Infinity;
    let totalLength = 0;
    for (const s of cluster.segments) {
      if (s.x1 < minX) minX = s.x1;
      if (s.x2 < minX) minX = s.x2;
      if (s.x1 > maxX) maxX = s.x1;
      if (s.x2 > maxX) maxX = s.x2;
      totalLength += Math.abs(s.x2 - s.x1);
    }

    const coverage = Math.min(1, Math.max(0, (maxX - minX) / width));
    // A real separator must have at least some minimal span
    if (coverage < 0.15 && totalLength < width * 0.15) {
      continue;
    }

    const segmentCount = cluster.segments.length;
    const marginFromTop = cluster.y;

    const dashRepetitionScore = segmentCount >= 4 ? 1 : segmentCount >= 2 ? 0.7 : 0.4;
    const solidLineBonus = segmentCount <= 2 && coverage > 0.5 ? 0.15 : 0;
    const positionScore = 1 - Math.abs(marginFromTop / height - 0.5) * 0.6;

    const confidence = clamp(
      coverage * 0.5 + dashRepetitionScore * 0.3 + positionScore * 0.2 + solidLineBonus,
      0,
      1,
    );

    if (confidence < 0.3) continue;

    candidates.push({
      method: "dashed-line",
      confidence,
      cropRect: { x: 0, y: 0, width, height: cluster.y },
      reason: `Horizontal separator at y=${cluster.y.toFixed(1)}pt, ${segmentCount} segment(s), ${(coverage * 100).toFixed(0)}% width coverage`,
    });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 10);
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
