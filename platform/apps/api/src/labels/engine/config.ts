/** Detection settings from the original SOLLUNA label-cropper project (defaults kept). */
export const A4 = { width: 595.28, height: 841.89 } as const;
export const config = {
  safetyMarginPt: 8,
  detection: { highConfidence: 0.85, reviewThreshold: 0.7, failThreshold: 0.55 },
} as const;
