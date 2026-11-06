/**
 * Shared types for the PDF processing engine.
 * Coordinates are in PDF points, using PDF's native bottom-left origin
 * unless a function explicitly documents otherwise.
 */

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DetectionMethod =
  | "dashed-line"
  | "text"
  | "whitespace"
  | "border"
  | "raster"
  | "hybrid"
  | "fallback-full-page";

export interface DetectionCandidate {
  method: DetectionMethod;
  confidence: number;
  cropRect: CropRect;
  /** Human-readable explanation, useful for debugging/preview UI. */
  reason?: string;
}

export interface PageGeometry {
  pageNumber: number; // 1-indexed
  /** Page size as reported by the PDF, in points, already normalized for rotation. */
  width: number;
  height: number;
  /** Raw /Rotate value (0, 90, 180, 270). */
  rotation: number;
  /** True if the page appears to contain a full-page raster image with little/no vector or text content. */
  isRasterOnly: boolean;
  /**
   * Coordinate space for all geometry below: origin at TOP-LEFT of the
   * page, x right, y DOWN, in points, after rotation has been applied
   * (i.e. "reading order" space — y=0 is the visual top of the page as a
   * human viewer would see it, regardless of the PDF's /Rotate value).
   */
  textItems: TextItem[];
  horizontalLines: LineSegment[];
  verticalLines: LineSegment[];
  /**
   * The affine transform (PDF.js viewport.transform: [a,b,c,d,e,f]) that
   * was used to convert raw PDF user-space coordinates into the
   * normalized top-down space above. Needed to map a crop rectangle back
   * into the original page's native coordinate space for embedding.
   */
  viewportTransform: number[];
}

export interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DetectionResult {
  pageNumber: number;
  cropRect: CropRect;
  method: DetectionMethod;
  confidence: number;
  candidates: DetectionCandidate[];
  needsReview: boolean;
  failed: boolean;
  warnings: string[];
}

export interface PageProcessingError {
  pageNumber: number;
  message: string;
  recoverable: boolean;
}

export interface CompositionResult {
  pdfBytes: Uint8Array;
  outputPageCount: number;
  labelCount: number;
}

export interface CompressionResult {
  pdfBytes: Uint8Array;
  originalBytes: number;
  compressedBytes: number;
  usedFallback: boolean;
  toolUsed: "ghostscript" | "qpdf" | "none";
}

export interface ValidationResult {
  valid: boolean;
  pageCount: number;
  errors: string[];
}

export interface ProcessingSummary {
  inputPageCount: number;
  labelCount: number;
  outputPageCount: number;
  originalBytes: number;
  finalBytes: number;
  reductionPercent: number;
  durationMs: number;
  lowConfidencePages: Array<{ pageNumber: number; confidence: number }>;
  failedPages: PageProcessingError[];
  downloadId: string;
  fileName: string;
  /** Base64-encoded final PDF — attached by the API route after processing
   *  so the client can download without a second cross-instance request. */
  pdfBase64?: string;
}

export class ProcessingError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_FILE"
      | "TOO_LARGE"
      | "PASSWORD_PROTECTED"
      | "CORRUPT"
      | "TOO_MANY_PAGES"
      | "DETECTION_FAILED"
      | "PROCESSING_FAILED"
      | "TIMEOUT",
  ) {
    super(message);
    this.name = "ProcessingError";
  }
}
