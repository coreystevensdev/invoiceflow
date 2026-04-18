import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

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

CROSS-FIELD VALIDATION (populate the "flags" array when you detect any of these):
- "subtotal + tax ≠ total" (within $0.02 tolerance) → severity: error
- Line items sum does not match subtotal → severity: warning
- Bill date is in the future → severity: warning
- Due date is before bill date → severity: error
- Total is 0 or negative → severity: warning
- Vendor name missing → severity: warning
- Currency could not be determined → severity: info

Return the JSON object only.`;

export const EXTRACTION_MODEL = "claude-sonnet-4-5-20250929";
export const EXTRACTION_MAX_TOKENS = 4096;

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
}

/**
 * Extract structured invoice data from raw PDF text using Claude.
 * Uses prompt caching on the system prompt to reduce cost on repeat calls.
 */
export async function extractInvoice(
  rawPdfText: string,
  options: { apiKey?: string; model?: string } = {},
): Promise<ExtractionResult> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env.local and add your key.",
    );
  }

  const client = new Anthropic({ apiKey });
  const start = Date.now();

  const response = await client.messages.parse({
    model: options.model ?? EXTRACTION_MODEL,
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
        content: `<invoice_text>\n${rawPdfText}\n</invoice_text>\n\nExtract the invoice data per the schema.`,
      },
    ],
    output_config: {
      format: zodOutputFormat(InvoiceExtractionSchema),
    },
  });

  const duration_ms = Date.now() - start;

  if (!response.parsed_output) {
    throw new Error(
      "Claude returned an unparseable response. Check logs for the raw output.",
    );
  }

  return {
    invoice: response.parsed_output,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_creation_input_tokens:
        response.usage.cache_creation_input_tokens ?? null,
      cache_read_input_tokens:
        response.usage.cache_read_input_tokens ?? null,
    },
    duration_ms,
  };
}
