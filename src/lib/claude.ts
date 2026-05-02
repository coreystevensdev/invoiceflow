import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ExtractionError } from "./errors";
import {
  computeCost,
  exceedsBudget,
  recordCost,
  recordMonthlyCost,
} from "./cost";
import type { Logger } from "./log";

const ConfidenceEnum = z.enum(["high", "medium", "low"]);

const SourceBbox = z
  .array(z.number())
  .min(4)
  .max(4)
  .describe(
    "Normalized [x, y, width, height] coordinates (0..1) of the visual region in the source image, only populated when the input is an image.",
  );

const FieldWithReasoning = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: valueSchema.nullable(),
    confidence: ConfidenceEnum,
    reasoning: z.string(),
    source_bbox: SourceBbox.nullable().optional(),
  });

const VendorField = z.object({
  name: z.string().nullable(),
  address: z.string().nullable(),
  confidence: ConfidenceEnum,
  reasoning: z.string(),
  source_bbox: SourceBbox.nullable().optional(),
});

const LineItem = z.object({
  description: z.string().nullable(),
  quantity: z.number().nullable(),
  unit_price: z.number().nullable(),
  amount: z.number().nullable(),
  reasoning: z.string().optional(),
});

const Flag = z.object({
  severity: z.enum(["info", "warning", "error"]),
  message: z.string(),
});

export const InvoiceExtractionSchema = z.object({
  invoice_number: FieldWithReasoning(z.string()),
  vendor: VendorField,
  bill_date: FieldWithReasoning(z.string()),
  due_date: FieldWithReasoning(z.string()),
  po_number: FieldWithReasoning(z.string()),
  subtotal: FieldWithReasoning(z.number()),
  tax: FieldWithReasoning(z.number()),
  total: FieldWithReasoning(z.number()),
  currency: FieldWithReasoning(z.string()),
  line_items: z.array(LineItem),
  flags: z.array(Flag),
});

export type InvoiceExtraction = z.infer<typeof InvoiceExtractionSchema>;
export type ExtractionConfidence = z.infer<typeof ConfidenceEnum>;
export type ExtractionFlag = z.infer<typeof Flag>;

export const EXTRACTION_SYSTEM_PROMPT = `You are an expert accounts payable clerk with 15 years of experience reading invoices across industries and languages. Your job is to extract structured data from raw invoice text with maximum accuracy and transparency.

CRITICAL RULES:
1. Return ONLY valid JSON matching the provided schema. No preamble, no markdown, no explanation outside the JSON.
2. For every extracted field, include a "reasoning" string citing the specific text from the document that supports the value (e.g., "Extracted '$1,247.89' from line 'Total: $1,247.89' on page 1, following 'Subtotal' and 'Tax' rows").
3. If a field cannot be extracted confidently, set its value to null and explain in "reasoning" why (e.g., "No due date found; document shows only 'Net 30' terms without a bill date").
4. Confidence levels:
   - "high": Value is explicitly labeled in the document (e.g., "Total: $1,247.89").
   - "medium": Value is inferred from context but clear (e.g., last number in the totals section).
   - "low": Value is ambiguous or reconstructed (e.g., OCR-garbled digit).
5. All dates must be ISO 8601 (YYYY-MM-DD). Convert from any source format.
6. All monetary values must be numeric (no currency symbols). Use the "currency" field to specify ISO 4217 (USD, EUR, JPY, etc.).
7. Never guess. Null with reasoning beats a hallucinated value.
8. The user message includes a <today> tag with today's date in ISO format (YYYY-MM-DD). Use that as the reference for any "past" or "future" date reasoning. Do not rely on training-time knowledge of the current date.

CROSS-FIELD VALIDATION (populate the "flags" array when you detect any of these):
- "subtotal + tax ≠ total" (within $0.02 tolerance) → severity: error
- Line items sum does not match subtotal → severity: warning
- Bill date is after the <today> date → severity: warning
- Due date is before bill date → severity: error
- Total is 0 or negative → severity: warning
- Vendor name missing → severity: warning
- Currency could not be determined → severity: info

Return the JSON object only.`;

export const DEFAULT_EXTRACTION_MODEL = "claude-sonnet-4-6";
export const EXTRACTION_MAX_TOKENS = 4096;
export const EXTRACTION_TIMEOUT_MS = 90_000;
export const EXTRACTION_MAX_RETRIES = 2;

export function getExtractionModel(): string {
  const fromEnv = process.env.CLAUDE_MODEL;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return DEFAULT_EXTRACTION_MODEL;
}

export interface UsageSummary {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
}

export interface ExtractionResult {
  invoice: InvoiceExtraction;
  usage: UsageSummary;
  duration_ms: number;
  model: string;
  cost_usd: number | null;
  retry_count: number;
}

export interface ExtractInvoiceOptions {
  apiKey?: string;
  model?: string;
  logger?: Logger;
  signal?: AbortSignal;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof APIError) {
    if (err.status === 429) return true;
    if (err.status && err.status >= 500 && err.status < 600) return true;
    return false;
  }
  if (err instanceof Error) {
    if (err.name === "AbortError") return false;
    return /network|timeout|ECONN|fetch failed/i.test(err.message);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type SupportedImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

export type ExtractionInput =
  | { kind: "text"; text: string }
  | { kind: "image"; data: Buffer; mediaType: SupportedImageMediaType };

/**
 * Extract structured invoice data using Claude. Accepts either parsed PDF
 * text (input.kind === 'text') or a raw image buffer (input.kind === 'image').
 * The image path uses Claude vision; the schema, system prompt, and output
 * shape are identical so downstream consumers don't branch.
 *
 * Retries transient API failures up to EXTRACTION_MAX_RETRIES times.
 * Aborts after EXTRACTION_TIMEOUT_MS. Applies a per-request cost cap.
 */
export async function extractInvoice(
  input: ExtractionInput,
  options: ExtractInvoiceOptions = {},
): Promise<ExtractionResult> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ExtractionError(
      "model-API-failure",
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env.local and add your key.",
    );
  }

  const model = options.model ?? getExtractionModel();
  const logger = options.logger;
  const client = new Anthropic({ apiKey });
  const timeoutSignal = AbortSignal.timeout(EXTRACTION_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;

  const start = Date.now();
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= EXTRACTION_MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.parse(
        {
          model,
          max_tokens: EXTRACTION_MAX_TOKENS,
          temperature: 0,
          system: [
            {
              type: "text",
              text: EXTRACTION_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [
            {
              role: "user",
              content:
                input.kind === "text"
                  ? `<today>${new Date().toISOString().slice(0, 10)}</today>\n<invoice_text>\n${input.text}\n</invoice_text>\n\nExtract the invoice data per the schema.`
                  : [
                      {
                        type: "image",
                        source: {
                          type: "base64",
                          media_type: input.mediaType,
                          data: input.data.toString("base64"),
                        },
                      },
                      {
                        type: "text",
                        text: `<today>${new Date().toISOString().slice(0, 10)}</today>\n\nThe image above is an invoice. Extract the invoice data per the schema. Use what you see in the image as the source content for the reasoning strings. For each field, also populate source_bbox as [x, y, width, height] using normalized 0..1 coordinates relative to the full image (e.g., a value in the top-right quadrant might have bbox [0.7, 0.05, 0.25, 0.06]). If you cannot localize a field visually, omit source_bbox or set it to null.`,
                      },
                    ],
            },
          ],
          output_config: {
            format: zodOutputFormat(InvoiceExtractionSchema),
          },
        },
        { signal },
      );

      if (!response.parsed_output) {
        throw new ExtractionError(
          "model-API-failure",
          "Claude returned an unparseable response.",
        );
      }

      const duration_ms = Date.now() - start;
      const usage: UsageSummary = {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_creation_input_tokens:
          response.usage.cache_creation_input_tokens ?? null,
        cache_read_input_tokens:
          response.usage.cache_read_input_tokens ?? null,
      };

      const cost_usd = computeCost(usage, model);
      if (cost_usd !== null) {
        // Anthropic bills tokens regardless of which path we throw on,
        // so the monthly aggregate must include over-cap requests too.
        // Otherwise an attacker spamming just-over-cap requests burns
        // the budget invisibly to the monthly tracker.
        recordMonthlyCost(cost_usd);
        const budget = exceedsBudget(cost_usd);
        if (budget.exceeded) {
          logger?.warn({
            category: "cost-budget-exceeded",
            cost_usd,
            budget_cap_usd: budget.cap ?? undefined,
            retry_count: attempt,
          });
          throw new ExtractionError(
            "cost-budget-exceeded",
            `Cost ${cost_usd.toFixed(4)} exceeded cap ${budget.cap?.toFixed(4) ?? "unknown"}.`,
            { observed_usd: cost_usd, cap_usd: budget.cap ?? null },
          );
        }
        recordCost(cost_usd);
      }

      return {
        invoice: response.parsed_output,
        usage,
        duration_ms,
        model,
        cost_usd,
        retry_count: attempt,
      };
    } catch (err) {
      lastError = err;
      if (err instanceof ExtractionError) throw err;

      const isAbort =
        (err instanceof Error && err.name === "AbortError") ||
        (err instanceof DOMException && err.name === "TimeoutError");
      if (isAbort) {
        throw new ExtractionError(
          "extraction-timeout",
          `Extraction exceeded ${EXTRACTION_TIMEOUT_MS} ms.`,
          { duration_ms: Date.now() - start },
        );
      }

      if (attempt < EXTRACTION_MAX_RETRIES && isRetryable(err)) {
        const backoffMs = 400 * Math.pow(2, attempt);
        logger?.warn({
          category: "model-API-failure",
          retry_count: attempt,
          note: "transient, retrying",
          duration_ms: Date.now() - start,
        });
        await sleep(backoffMs);
        continue;
      }

      break;
    }
  }

  const message =
    lastError instanceof Error ? lastError.message : "Unknown extraction failure.";
  throw new ExtractionError("model-API-failure", message, {
    duration_ms: Date.now() - start,
  });
}
