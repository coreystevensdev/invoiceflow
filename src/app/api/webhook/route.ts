import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { InvoiceExtractionSchema } from "@/lib/claude";
import { confidenceSummary } from "@/lib/validate";
import { toErrorResponse } from "@/lib/errors";
import { createLogger } from "@/lib/log";
import { clientIpFrom, inquiryLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const RequestSchema = z.object({
  webhook_url: z.string().url(),
  invoice: InvoiceExtractionSchema,
  verbose: z.boolean().default(false),
});

function stripReasoning(invoice: z.infer<typeof InvoiceExtractionSchema>) {
  const drop = <T extends { reasoning?: unknown }>(
    obj: T,
  ): Omit<T, "reasoning"> => {
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
  const correlationId = crypto.randomUUID();
  const logger = createLogger(correlationId);
  const start = Date.now();

  const ip = clientIpFrom(request.headers);
  const limit = inquiryLimit(ip);
  if (!limit.ok) {
    const { body, status, headers } = toErrorResponse({
      code: "rate-limited",
      correlationId,
      retryAfterSeconds: limit.retryAfterSeconds,
    });
    logger.warn({
      route: "webhook",
      category: "rate-limited",
      http_status: status,
      rate_limit_remaining: 0,
      duration_ms: Date.now() - start,
    });
    return NextResponse.json(body, { status, headers });
  }

  const bodyJson = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(bodyJson);
  if (!parsed.success) {
    logger.warn({
      route: "webhook",
      category: "invalid-request",
      http_status: 400,
      duration_ms: Date.now() - start,
    });
    return NextResponse.json(
      {
        error: "Invalid request body.",
        code: "invalid-request",
        correlation_id: correlationId,
        details: parsed.error.format(),
      },
      {
        status: 400,
        headers: { "X-Correlation-Id": correlationId },
      },
    );
  }

  const { webhook_url, invoice, verbose } = parsed.data;
  const payload = {
    event: "invoice.extracted",
    timestamp: new Date().toISOString(),
    correlation_id: correlationId,
    invoice: verbose ? invoice : stripReasoning(invoice),
    confidence_summary: confidenceSummary(invoice),
  };

  let status: number;
  let responseText: string;
  const fetchStart = Date.now();
  try {
    const res = await fetch(webhook_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Correlation-Id": correlationId,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    status = res.status;
    responseText = await res.text().catch(() => "");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({
      route: "webhook",
      category: "webhook-failed",
      http_status: 502,
      duration_ms: Date.now() - fetchStart,
      note: "outbound fetch failed",
    });
    return NextResponse.json(
      {
        error: `Webhook request failed: ${message}`,
        code: "webhook-failed",
        correlation_id: correlationId,
        duration_ms: Date.now() - fetchStart,
      },
      {
        status: 502,
        headers: { "X-Correlation-Id": correlationId },
      },
    );
  }

  logger.info({
    route: "webhook",
    category: "ok",
    http_status: 200,
    duration_ms: Date.now() - fetchStart,
    rate_limit_remaining: limit.remaining,
  });

  return NextResponse.json(
    {
      correlation_id: correlationId,
      webhook_url,
      status,
      response_preview: responseText.slice(0, 500),
      duration_ms: Date.now() - fetchStart,
    },
    {
      headers: { "X-Correlation-Id": correlationId },
    },
  );
}
