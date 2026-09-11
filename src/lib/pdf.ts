import { PDFParse } from "pdf-parse";

export interface PdfTextResult {
  text: string;
  num_pages: number;
}

// ASCII bytes for "%PDF-". Compared byte-for-byte rather than decoding the
// header to a string first: a UTF-8 decode of arbitrary binary input can
// produce replacement characters instead of throwing, which would make a
// string comparison an unreliable gate for non-PDF uploads.
const PDF_HEADER_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d];

function hasPdfHeader(bytes: Buffer): boolean {
  if (bytes.length < PDF_HEADER_BYTES.length) return false;
  return PDF_HEADER_BYTES.every((expected, i) => bytes[i] === expected);
}

/**
 * Parse raw PDF bytes into text. Throws PdfParseError with a typed code so
 * the route handler can map each failure mode to a typed user-facing
 * response (mapPdfError in api/extract/route.ts) without parsing free-form
 * messages.
 */
export async function parsePdf(bytes: Buffer): Promise<PdfTextResult> {
  if (bytes.length === 0) {
    throw new PdfParseError(
      "Empty file. Please upload a PDF with content.",
      "empty_file",
      { size: 0 },
    );
  }

  if (!hasPdfHeader(bytes)) {
    const header = bytes.subarray(0, 5).toString("utf-8");
    throw new PdfParseError(
      "This doesn't appear to be a PDF file. Detected header: " +
        JSON.stringify(header),
      "not_a_pdf",
      { size: bytes.length, header },
    );
  }

  // v2 owns a pdfjs worker, so it has to be torn down on every path. Leaking
  // one keeps the serverless invocation alive until it times out.
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    const text = result.text;
    if (!text || text.trim().length === 0) {
      throw new PdfParseError(
        "This PDF contains no extractable text. It may be an image-only scan, try OCR first, or use a PDF with selectable text.",
        "image_only",
        { size: bytes.length, num_pages: result.total },
      );
    }
    return { text, num_pages: result.total };
  } catch (err) {
    if (err instanceof PdfParseError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new PdfParseError(
      `Unable to parse PDF: ${message}. Common causes: password-protected, corrupted, or an unsupported PDF variant.`,
      "parse_failed",
      { size: bytes.length, underlying: message },
    );
  } finally {
    // A parser that never loaded throws again here; that must not replace the
    // real failure the caller is about to see.
    await parser.destroy().catch(() => {});
  }
}

export type PdfParseErrorCode =
  | "empty_file"
  | "not_a_pdf"
  | "image_only"
  | "parse_failed";

export class PdfParseError extends Error {
  readonly code: PdfParseErrorCode;
  readonly detected: Record<string, unknown>;

  constructor(
    message: string,
    code: PdfParseErrorCode,
    detected: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PdfParseError";
    this.code = code;
    this.detected = detected;
  }
}
