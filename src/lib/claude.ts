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
import type { CustomField } from "./custom-fields";

const ConfidenceEnum = z.enum(["high", "medium", "low"]);

const FieldWithReasoning = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: valueSchema.nullable(),
    confidence: ConfidenceEnum,
    reasoning: z.string(),
  });

const VendorField = z.object({
  name: z.string().nullable(),
  address: z.string().nullable(),
  confidence: ConfidenceEnum,
  reasoning: z.string(),
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

type BaseInvoiceExtraction = z.infer<typeof InvoiceExtractionSchema>;
export type ExtractionConfidence = z.infer<typeof ConfidenceEnum>;
export type ExtractionFlag = z.infer<typeof Flag>;

/**
 * A user-defined custom field's extraction result. Same {value, confidence,
 * reasoning} shape as the standard fields but with a wider value type since
 * custom fields can be string-, number-, or date-typed (date stays a string
 * at the schema level).
 */
export interface CustomFieldExtraction {
  value: string | number | null;
  confidence: ExtractionConfidence;
  reasoning: string;
}

/**
 * Invoice extraction with optional user-defined custom fields. The base
 * shape comes from InvoiceExtractionSchema; custom_fields is added at the
 * type level (the runtime schema is built per-request when custom fields
 * are supplied) so consumers that don't care can ignore the optional key.
 */
export type InvoiceExtraction = BaseInvoiceExtraction & {
  custom_fields?: Record<string, CustomFieldExtraction>;
};

/**
 * Build a Zod schema for the response when custom fields are in play.
 * Falls through to the base schema when there are none, so the cache_key
 * (which depends on the JSON Schema sent to Anthropic) stays stable for
 * the common no-custom-fields case.
 */
function buildExtractionSchema(customFields: CustomField[] | undefined) {
  if (!customFields || customFields.length === 0) {
    return InvoiceExtractionSchema;
  }
  const customShape: Record<string, z.ZodTypeAny> = {};
  for (const f of customFields) {
    const valueSchema = f.type === "number" ? z.number() : z.string();
    customShape[f.id] = FieldWithReasoning(valueSchema);
  }
  return InvoiceExtractionSchema.extend({
    custom_fields: z.object(customShape),
  });
}

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
  /**
   * User-defined custom fields. When non-empty, the response schema is
   * extended with a `custom_fields` object and the prompt instructs Claude
   * to populate it. Defaults to no custom fields.
   */
  customFields?: CustomField[];
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
  | { kind: "image"; data: Buffer; mediaType: SupportedImageMediaType }
  | { kind: "pdf"; data: Buffer };

/**
 * Build the custom-fields instruction block. Empty string when no fields
 * are defined so the prompt stays cache-friendly for the common case.
 * Uses each field's id (UUID) as the JSON key so user-supplied names
 * never become schema keys (avoids name-based prompt-injection vectors).
 */
function buildCustomFieldsBlock(customFields: CustomField[] = []): string {
  if (customFields.length === 0) return "";
  const lines = customFields
    .map(
      (f) =>
        `- ID "${f.id}" (${f.type}, displayed as "${f.name.trim()}"): ${f.description.trim()}`,
    )
    .join("\n");
  return `\n\nAdditionally, extract these user-defined custom fields. Place them under "custom_fields" in the response, keyed exactly by the IDs below. Each value uses the same {value, confidence, reasoning} shape as the standard fields:\n${lines}`;
}

/**
 * Build the user-message content for the Claude call. Three shapes:
 *   - text input → a single string with <today> tag and <invoice_text> wrapper.
 *   - image input → [image block, text block with bbox-prefix instruction].
 *   - pdf input  → [document block (application/pdf), text block with the
 *                   same bbox-prefix instruction scoped to page 1, since
 *                   PdfPreview only renders page 1].
 *
 * The custom-fields instruction block is appended to whichever text portion
 * exists in each shape.
 */
function buildUserContent(
  input: ExtractionInput,
  today: string,
  customFields: CustomField[] = [],
) {
  const customBlock = buildCustomFieldsBlock(customFields);
  if (input.kind === "text") {
    return `<today>${today}</today>\n<invoice_text>\n${input.text}\n</invoice_text>\n\nExtract the invoice data per the schema.${customBlock}`;
  }
  if (input.kind === "image") {
    return [
      {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: input.mediaType,
          data: input.data.toString("base64"),
        },
      },
      {
        type: "text" as const,
        text: `<today>${today}</today>\n\nThe image above is an invoice. Extract the invoice data per the schema. For every reasoning string, prefix it with "[bbox: x, y, w, h] " where x, y, w, h are normalized 0..1 coordinates of the region in the image (e.g., "[bbox: 0.7, 0.05, 0.25, 0.06] Invoice number labeled at top-right..."). If you can't localize visually, prefix with "[bbox: none] ".${customBlock}`,
      },
    ];
  }
  // input.kind === "pdf" — scanned/image-only PDF routed through vision.
  return [
    {
      type: "document" as const,
      source: {
        type: "base64" as const,
        media_type: "application/pdf" as const,
        data: input.data.toString("base64"),
      },
    },
    {
      type: "text" as const,
      text: `<today>${today}</today>\n\nThe document above is a scanned (image-only) invoice PDF. Extract the invoice data per the schema. For every reasoning string, prefix it with "[bbox: x, y, w, h] " where x, y, w, h are normalized 0..1 coordinates of the region on the FIRST page of the document (the rendered preview shows page 1 only). If the value doesn't appear on page 1, or you can't localize visually, prefix with "[bbox: none] ".${customBlock}`,
    },
  ];
}

/**
 * Extract structured invoice data using Claude. Three input modes:
 *   - 'text': parsed PDF text (digital PDFs).
 *   - 'image': a raw image buffer (JPG/PNG/GIF/WebP via vision).
 *   - 'pdf':   a raw PDF buffer routed through Claude vision via document
 *              content blocks. Used when pdf-parse returned empty text
 *              (image-only / scanned PDFs).
 *
 * The schema, system prompt, and output shape are identical across all
 * three so downstream consumers don't branch on input type.
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
  const today = new Date().toISOString().slice(0, 10);
  const customFields = options.customFields ?? [];
  const schema = buildExtractionSchema(customFields);
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
              content: buildUserContent(input, today, customFields),
            },
          ],
          output_config: {
            format: zodOutputFormat(schema),
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
        // Include the error class and (if APIError) the HTTP status so
        // log triage can distinguish rate-limit pressure from upstream 5xx
        // from network blips. The retry policy treats them all the same,
        // but operator response differs.
        const errorTag =
          err instanceof APIError
            ? `APIError${err.status ? ` ${err.status}` : ""}`
            : err instanceof Error
              ? err.name
              : "unknown";
        logger?.warn({
          category: "model-API-failure",
          retry_count: attempt,
          note: `transient (${errorTag}), retrying`,
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
