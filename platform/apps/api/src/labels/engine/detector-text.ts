import type { DetectionCandidate, PageGeometry, TextItem } from "./types";

const INVOICE_KEYWORDS = [
  "tax invoice",
  "invoice no",
  "invoice number",
  "invoice",
  "bill of supply",
  "billing address",
  "bill to",
];

/**
 * Strategy B — text-keyword detection.
 *
 * Looks for invoice-related keywords and uses the topmost matching text
 * item as the boundary between the shipping label (above) and the
 * invoice (below). A match very close to the top of the page is
 * suspicious (the label itself may mention "invoice" in fine print) and
 * is scored lower.
 */
export function detectByText(page: PageGeometry): DetectionCandidate[] {
  const { textItems, width, height } = page;
  const matches = findKeywordMatches(textItems);
  if (matches.length === 0) return [];

  // Use the topmost (smallest y, since our space is top-down) match as the
  // boundary — that's the first mention of invoice-related content.
  const topMatch = matches.reduce((a, b) => (a.y < b.y ? a : b));

  const relativePosition = topMatch.y / height;
  // A boundary in the top 20% of the page is unlikely to be the real
  // separator (the label itself hasn't had room to render yet).
  const positionScore = relativePosition < 0.2 ? relativePosition / 0.2 : 1;

  // Exact "tax invoice" phrase is a much stronger signal than a bare
  // "invoice" substring appearing inside other text.
  const specificityScore = topMatch.matchedKeyword === "tax invoice" ? 1 : topMatch.matchedKeyword.includes("invoice") ? 0.85 : 0.6;

  const confidence = clamp(positionScore * 0.5 + specificityScore * 0.5, 0, 1);

  // Text is positioned by its baseline; the buffer needs to clear the
  // full glyph height (ascenders sit above the baseline), not just a
  // fixed few points, or the top sliver of the heading itself can end up
  // inside the crop. topMatch.height approximates the font's em-size, so
  // scaling off it (rather than a flat constant) adapts to differently
  // sized invoice headings.
  const buffer = Math.max(4, topMatch.height * 1.1);

  return [
    {
      method: "text",
      confidence,
      cropRect: { x: 0, y: 0, width, height: Math.max(0, topMatch.y - buffer) },
      reason: `Found "${topMatch.matchedKeyword}" at y=${topMatch.y.toFixed(1)}pt`,
    },
  ];
}

interface KeywordMatch extends TextItem {
  matchedKeyword: string;
}

function findKeywordMatches(items: TextItem[]): KeywordMatch[] {
  const matches: KeywordMatch[] = [];
  for (const item of items) {
    const lower = item.text.toLowerCase();
    for (const keyword of INVOICE_KEYWORDS) {
      if (lower.includes(keyword)) {
        matches.push({ ...item, matchedKeyword: keyword });
        break;
      }
    }
  }
  return matches;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
