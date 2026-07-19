import { describe, it, expect } from "vitest";
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
