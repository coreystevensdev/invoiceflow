import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { InvoiceExtractionSchema } from "@/lib/claude";
import { confidenceSummary } from "@/lib/validate";

export const runtime = "nodejs";
export const maxDuration = 60;

const RequestSchema = z.object({
  webhook_url: z.string().url(),
  invoice: InvoiceExtractionSchema,
  verbose: z.boolean().default(false),
});

function stripReasoning(invoice: z.infer<typeof InvoiceExtractionSchema>) {
  const drop = <T extends { reasoning?: unknown }>(obj: T): Omit<T, "reasoning"> => {
    const copy = { ...obj };
    delete (copy as { reasoning?: unknown }).reasoning;
    return copy;
  };

  return {
    invoice_number: drop(invoice.invoice_number),
    vendor: drop(invoice.vendor),
    bill_date: drop(invoice.bill_date),
    due_date: drop(invoice.due_date),
    po_number: drop(invoice.po_number),
    subtotal: drop(invoice.subtotal),
    tax: drop(invoice.tax),
    total: drop(invoice.total),
    currency: drop(invoice.currency),
    line_items: invoice.line_items.map((li) => drop(li)),
    flags: invoice.flags,
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body.", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const { webhook_url, invoice, verbose } = parsed.data;
  const payload = {
    event: "invoice.extracted",
    timestamp: new Date().toISOString(),
    invoice: verbose ? invoice : stripReasoning(invoice),
    confidence_summary: confidenceSummary(invoice),
  };

  let status: number;
  let responseText: string;
  const start = Date.now();
  try {
    const res = await fetch(webhook_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    status = res.status;
    responseText = await res.text().catch(() => "");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: `Webhook request failed: ${message}`,
        duration_ms: Date.now() - start,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    webhook_url,
    status,
    response_preview: responseText.slice(0, 500),
    duration_ms: Date.now() - start,
  });
}
