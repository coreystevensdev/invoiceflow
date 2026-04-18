import { NextRequest, NextResponse } from "next/server";
import {
  extractInvoice,
  type InvoiceExtraction,
  type UsageSummary,
} from "@/lib/claude";
import { parsePdf, PdfParseError } from "@/lib/pdf";
import {
  confidenceSummary,
  deterministicFlags,
  mergeFlags,
} from "@/lib/validate";

export const runtime = "nodejs";
export const maxDuration = 300;

export interface ExtractResponse {
  invoice: InvoiceExtraction;
  confidence_summary: ReturnType<typeof confidenceSummary>;
  pdf: {
    num_pages: number;
    size_bytes: number;
  };
  usage: UsageSummary;
  duration_ms: {
    pdf_parse: number;
    claude: number;
    total: number;
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json(
      { error: "Invalid multipart/form-data body." },
      { status: 400 },
    );
  }

  const file = formData.get("pdf");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing 'pdf' file field." },
      { status: 400 },
    );
  }

  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json(
      { error: "PDF is larger than 25 MB. Please upload a smaller file." },
      { status: 413 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  const pdfStart = Date.now();
  let pdfResult;
  try {
    pdfResult = await parsePdf(bytes);
  } catch (err) {
    if (err instanceof PdfParseError) {
      return NextResponse.json(
        {
          error: err.message,
          code: err.code,
          detected: err.detected,
        },
        { status: 422 },
      );
    }
    throw err;
  }
  const pdfMs = Date.now() - pdfStart;

  const extraction = await extractInvoice(pdfResult.text);
  const modelFlags = extraction.invoice.flags;
  const detFlags = deterministicFlags(extraction.invoice);
  const flags = mergeFlags(modelFlags, detFlags);
  const invoice: InvoiceExtraction = { ...extraction.invoice, flags };

  const response: ExtractResponse = {
    invoice,
    confidence_summary: confidenceSummary(invoice),
    pdf: { num_pages: pdfResult.num_pages, size_bytes: bytes.length },
    usage: extraction.usage,
    duration_ms: {
      pdf_parse: pdfMs,
      claude: extraction.duration_ms,
      total: Date.now() - start,
    },
  };

  return NextResponse.json(response);
}
