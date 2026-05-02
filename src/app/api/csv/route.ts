import { NextRequest, NextResponse } from "next/server";
import { InvoiceExtractionSchema } from "@/lib/claude";
import { toCsv } from "@/lib/csv";
import { createLogger } from "@/lib/log";
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
  const correlationId = crypto.randomUUID();
  const logger = createLogger(correlationId);
  const start = Date.now();

  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    logger.warn({
      route: "csv",
      category: "invalid-request",
      http_status: 400,
      duration_ms: Date.now() - start,
    });
    return NextResponse.json(
      {
        error: "Invalid request body.",
        details: parsed.error.format(),
        correlation_id: correlationId,
      },
      {
        status: 400,
        headers: { "X-Correlation-Id": correlationId },
      },
    );
  }

  const { format, invoices } = parsed.data;
  const csv = toCsv(invoices, format);
  const filename = `invoiceflow-${format}-${new Date().toISOString().slice(0, 10)}.csv`;

  logger.info({
    route: "csv",
    category: "ok",
    http_status: 200,
    duration_ms: Date.now() - start,
  });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Correlation-Id": correlationId,
    },
  });
}
