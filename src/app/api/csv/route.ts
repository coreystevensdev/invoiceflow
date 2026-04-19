import { NextRequest, NextResponse } from "next/server";
import {
  InvoiceExtractionSchema,
  type InvoiceExtraction,
} from "@/lib/claude";
import { toCsv, type CsvFormat } from "@/lib/csv";
import { z } from "zod";

export const runtime = "nodejs";

const MAX_INVOICES_PER_CSV = 100;

const RequestSchema = z.object({
  format: z.enum(["summary", "line_items"]).default("summary"),
  invoices: z
    .array(InvoiceExtractionSchema)
    .min(1)
    .max(MAX_INVOICES_PER_CSV),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body.", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { format, invoices } = parsed.data;
  const csv = toCsv(invoices as InvoiceExtraction[], format as CsvFormat);
  const filename = `invoiceflow-${format}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
