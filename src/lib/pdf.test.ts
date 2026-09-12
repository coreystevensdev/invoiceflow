import { describe, it, expect, vi } from "vitest";
import { parsePdf, PdfParseError } from "./pdf";

async function codeOf(bytes: Buffer): Promise<string> {
  try {
    await parsePdf(bytes);
    throw new Error("expected parsePdf to throw");
  } catch (err) {
    if (err instanceof PdfParseError) return err.code;
    throw err;
  }
}

describe("parsePdf header sniff", () => {
  it("rejects a plain non-PDF text file as not_a_pdf", async () => {
    expect(await codeOf(Buffer.from("hello world", "utf-8"))).toBe("not_a_pdf");
  });

  it("rejects a buffer shorter than the header as not_a_pdf", async () => {
    expect(await codeOf(Buffer.from([0x25, 0x50]))).toBe("not_a_pdf");
  });

  it("does not reject a valid %PDF- header on not-UTF8-decodable binary input", async () => {
    // Bytes after the header include 0xFF/0xFE, which are not valid UTF-8
    // continuation bytes. The old string-decode check risked misclassifying
    // this as not_a_pdf; the byte compare only looks at the first 5 bytes
    // and should let this reach pdf-parse instead.
    const bytes = Buffer.from([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0xff, 0xfe, 0x00, 0x01,
    ]);
    const code = await codeOf(bytes);
    expect(code).not.toBe("not_a_pdf");
    expect(code).toBe("parse_failed");
  });

  it("passes header validation for a real PDF and fails later at parse time only if content is otherwise malformed", async () => {
    const bytes = Buffer.from("%PDF-1.4\n%garbage, not a real xref table\n%%EOF");
    const code = await codeOf(bytes);
    expect(code).not.toBe("not_a_pdf");
  });
});


// The real failures these strings come from: a deployment that traced neither
// the pdfjs worker nor the native canvas binding, which built and deployed green
// and then answered every upload with a 500. Before this, all three arrived as
// parse_failed and surfaced as corrupt-PDF, telling the user to re-save a file
// that was never the problem.
describe("parser unavailable vs corrupt file", () => {
  const header = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);

  async function codeForThrow(message: string): Promise<string> {
    const { PDFParse } = await import("pdf-parse");
    const spy = vi
      .spyOn(PDFParse.prototype, "getText")
      .mockRejectedValue(new Error(message));
    try {
      return await codeOf(header);
    } finally {
      spy.mockRestore();
    }
  }

  it.each([
    "Setting up fake worker failed: \"Cannot find module '/var/task/.../pdf.worker.mjs'\"",
    "Cannot load \"@napi-rs/canvas\" package: Error: Failed to load native binding",
    "DOMMatrix is not defined",
  ])("reports a loader failure as parser_unavailable: %s", async (message) => {
    expect(await codeForThrow(message)).toBe("parser_unavailable");
  });

  it("still reports a genuinely bad document as parse_failed", async () => {
    expect(await codeForThrow("Invalid PDF structure.")).toBe("parse_failed");
  });
});
