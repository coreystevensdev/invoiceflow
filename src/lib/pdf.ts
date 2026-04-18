import { PDFParse } from "pdf-parse";

export interface PdfTextResult {
  text: string;
  num_pages: number;
}

/**
 * Parse raw PDF bytes into text. Surfaces a specific error shape so the route
 * handler can return a clean "this isn't a parseable PDF" response to the UI
 * (brainstorm idea #9 — graceful corrupt-PDF handling).
 */
export async function parsePdf(bytes: Buffer): Promise<PdfTextResult> {
  if (bytes.length === 0) {
    throw new PdfParseError(
      "Empty file. Please upload a PDF with content.",
      "empty_file",
      { size: 0 },
    );
  }

  const header = bytes.subarray(0, 5).toString("utf-8");
  if (header !== "%PDF-") {
    throw new PdfParseError(
      "This doesn't appear to be a PDF file. Detected header: " +
        JSON.stringify(header),
      "not_a_pdf",
      { size: bytes.length, header },
    );
  }

  const data = new Uint8Array(bytes);
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    const text = result.text;
    if (!text || text.trim().length === 0) {
      throw new PdfParseError(
        "This PDF contains no extractable text. It may be an image-only scan — try OCR first, or use a PDF with selectable text.",
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
