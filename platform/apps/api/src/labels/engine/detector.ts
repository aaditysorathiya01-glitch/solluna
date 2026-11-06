import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { config } from "./config";
import { detectDashedLine } from "./detector-dashed-line";
import { detectByText } from "./detector-text";
import { detectByWhitespace } from "./detector-whitespace";
import { detectByBorder } from "./detector-border";
import { detectByRaster } from "./detector-raster";
import type { DetectionCandidate, DetectionResult, PageGeometry } from "./types";

const AGREEMENT_TOLERANCE_PT = 25;

/**
 * Runs every detection strategy for a page, combines their evidence into a
 * single best crop rectangle, and validates the result against basic
 * sanity checks before returning it.
 */
export async function detectLabelRegion(
  doc: PDFDocumentProxy,
  page: PageGeometry,
): Promise<DetectionResult> {
  const warnings: string[] = [];
  let candidates: DetectionCandidate[] = [
    ...detectDashedLine(page),
    ...detectByText(page),
    ...detectByWhitespace(page),
    ...detectByBorder(page),
  ];

  // The raster fallback is comparatively expensive (it rasterizes the
  // page), so only run it when the page actually looks like a scanned
  // image, or when nothing else produced a usable candidate.
  if (page.isRasterOnly || candidates.every((c) => c.confidence < config.detection.reviewThreshold)) {
    candidates = candidates.concat(await detectByRaster(doc, page));
  }

  if (candidates.length === 0) {
    warnings.push("No separator, invoice text, whitespace gap, or border was detected on this page.");
    return fallbackResult(page, warnings, "No detection strategy produced a candidate.");
  }

  const combined = combineEvidence(candidates);
  const best = combined[0];

  const validation = validateCropRect(best.cropRect, page);
  if (!validation.ok) {
    warnings.push(validation.reason);
    return fallbackResult(page, warnings, validation.reason, combined);
  }

  const confidence = best.confidence;
  const needsReview = confidence < config.detection.highConfidence;
  const failed = confidence < config.detection.failThreshold;

  if (needsReview && !failed) {
    warnings.push(`Confidence ${(confidence * 100).toFixed(0)}% is below the high-confidence threshold; please review this page.`);
  }
  if (failed) {
    warnings.push(`Confidence ${(confidence * 100).toFixed(0)}% is too low to trust automatically.`);
  }

  return {
    pageNumber: page.pageNumber,
    cropRect: applySafetyMargin(best.cropRect, page),
    method: best.method,
    confidence,
    candidates: combined,
    needsReview,
    failed,
    warnings,
  };
}

/**
 * Combines candidates from independent strategies. When two or more
 * strategies agree on roughly the same Y boundary, that agreement is
 * strong corroborating evidence and boosts combined confidence above what
 * any single strategy reported alone.
 */
function combineEvidence(candidates: DetectionCandidate[]): DetectionCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const groups: { boundaryY: number; members: DetectionCandidate[] }[] = [];

  for (const c of sorted) {
    const boundaryY = c.cropRect.y + c.cropRect.height;
    let group = groups.find((g) => Math.abs(g.boundaryY - boundaryY) <= AGREEMENT_TOLERANCE_PT);
    if (!group) {
      group = { boundaryY, members: [] };
      groups.push(group);
    }
    group.members.push(c);
  }

  const hybridCandidates: DetectionCandidate[] = groups.map((g) => {
    if (g.members.length === 1) return g.members[0];

    // Weighted combination: agreement across N independent strategies
    // multiplies confidence toward 1, capped at 0.99 (never claim total
    // certainty).
    const avgConfidence = g.members.reduce((s, m) => s + m.confidence, 0) / g.members.length;
    const agreementBonus = Math.min(0.25, (g.members.length - 1) * 0.12);
    const combinedConfidence = Math.min(0.99, avgConfidence + agreementBonus);

    // Use the geometric detectors' rectangle as the representative crop
    // when available — a dashed-line or border position is the actual
    // drawn boundary, which is more precise than a buffer inferred from
    // where invoice text happens to start. Text/whitespace candidates are
    // used to corroborate confidence but text/whitespace's own inferred
    // rectangle is a fallback, not the preferred source of truth.
    const methodPriority: Record<string, number> = { "dashed-line": 0, border: 1, text: 2, whitespace: 3, raster: 4 };
    const best = [...g.members].sort((a, b) => {
      const pa = methodPriority[a.method] ?? 5;
      const pb = methodPriority[b.method] ?? 5;
      if (pa !== pb) return pa - pb;
      return b.confidence - a.confidence;
    })[0];

    return {
      method: "hybrid" as const,
      confidence: combinedConfidence,
      cropRect: best.cropRect,
      reason: `Agreement across ${g.members.length} strategies: ${g.members.map((m) => m.method).join(", ")}`,
      candidateMembers: g.members,
    };
  });

  return hybridCandidates.sort((a, b) => b.confidence - a.confidence);
}

function validateCropRect(rect: { x: number; y: number; width: number; height: number }, page: PageGeometry): { ok: true } | { ok: false; reason: string } {
  if (rect.height <= 0 || rect.width <= 0) {
    return { ok: false, reason: "Detected crop rectangle has zero or negative size." };
  }
  if (rect.height > page.height || rect.width > page.width + 1) {
    return { ok: false, reason: "Detected crop rectangle exceeds page boundaries." };
  }
  const heightRatio = rect.height / page.height;
  if (heightRatio < 0.15) {
    return { ok: false, reason: "Detected label region is suspiciously small relative to the page." };
  }
  if (heightRatio > 0.97) {
    return { ok: false, reason: "Detected label region covers almost the entire page — invoice may not have been separated." };
  }
  const aspectRatio = rect.width / rect.height;
  if (aspectRatio < 0.2 || aspectRatio > 6) {
    return { ok: false, reason: "Detected label region has an implausible aspect ratio." };
  }
  return { ok: true };
}

function applySafetyMargin(
  rect: { x: number; y: number; width: number; height: number },
  page: PageGeometry,
): { x: number; y: number; width: number; height: number } {
  const margin = config.safetyMarginPt;
  // The safety margin exists to protect label content (barcode, QR, text,
  // border) from being clipped at the EDGES of the crop — but the bottom
  // edge is a special case: it borders the invoice section we're
  // deliberately removing, not blank page margin. Extending the crop
  // downward there would silently pull invoice content back in and
  // undermine any buffer the detectors already built into their boundary
  // (e.g. the text detector already backs off a few points above the
  // "Tax Invoice" heading). So the margin is only applied outward on the
  // left, right, and top edges; the bottom boundary is trusted exactly as
  // detected.
  const x = Math.max(0, rect.x - margin);
  const y = Math.max(0, rect.y - margin);
  return {
    x,
    y,
    width: Math.min(page.width - x, rect.width + margin * 2),
    height: Math.min(page.height - y, rect.height + (rect.y - y)),
  };
}

function fallbackResult(
  page: PageGeometry,
  warnings: string[],
  reason: string,
  candidates: DetectionCandidate[] = [],
): DetectionResult {
  // When nothing trustworthy is found, fall back to the full page rather
  // than guessing — this is flagged as failed/needs-review so the user is
  // told explicitly instead of silently getting a bad crop.
  return {
    pageNumber: page.pageNumber,
    cropRect: { x: 0, y: 0, width: page.width, height: page.height },
    method: "fallback-full-page",
    confidence: 0,
    candidates,
    needsReview: true,
    failed: true,
    warnings: [...warnings, reason],
  };
}
