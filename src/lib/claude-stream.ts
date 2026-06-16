/**
 * Streaming extraction pipeline.
 *
 * Uses `client.messages.stream()` instead of `messages.parse()` so text
 * deltas arrive as Claude generates them. The tradeoff vs the non-streaming
 * path: `messages.parse()` uses `output_config` + `zodOutputFormat` for a
 * structured-output guarantee; streaming relies on the system prompt and
 * validates the final JSON with Zod after accumulation.
 */

import Anthropic, { APIError } from "@anthropic-ai/sdk";
import {
  InvoiceExtractionSchema,
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_MAX_TOKENS,
  EXTRACTION_TIMEOUT_MS,
  EXTRACTION_MAX_RETRIES,
  getExtractionModel,
  buildUserContent,
  type ExtractionInput,
  type UsageSummary,
} from "./claude";
import type { CustomField } from "./custom-fields";
import {
  computeCost,
  exceedsBudget,
  recordCost,
  recordMonthlyCost,
} from "./cost";
import type { Logger } from "./log";

// Top-level keys the InvoiceExtractionSchema expects, in the order Claude
// typically generates them. Used by the partial-JSON parser to know which
// keys to watch for.
export const STREAMING_FIELD_KEYS = [
  "invoice_number",
  "vendor",
  "bill_date",
  "due_date",
  "po_number",
  "subtotal",
  "tax",
  "total",
  "currency",
  "line_items",
  "flags",
] as const;

export type StreamingFieldKey = (typeof STREAMING_FIELD_KEYS)[number];

export type ParsedField = {
  field: StreamingFieldKey;
  value: unknown;
};

/**
 * Feeds text chunks and emits completed top-level field objects as they
 * close. Works by tracking bracket/brace depth per field key.
 *
 * Limitations:
 * - Only handles one level of nesting per field (value is an object or array,
 *   not a primitive) -- matches the InvoiceExtractionSchema structure.
 * - Parsing is text-based (not a full JSON parser) and relies on the model
 *   faithfully using { } / [ ] without interleaving keys from different fields
 *   at the same depth. This assumption holds for the Anthropic model with the
 *   existing system prompt.
 */
export class PartialJsonFieldParser {
  private accumulated = "";
  private emitted = new Set<StreamingFieldKey>();

  feed(chunk: string): ParsedField[] {
    this.accumulated += chunk;
    const results: ParsedField[] = [];

    for (const key of STREAMING_FIELD_KEYS) {
      if (this.emitted.has(key)) continue;
      const value = this.tryExtract(key);
      if (value !== undefined) {
        this.emitted.add(key);
        results.push({ field: key, value });
      }
    }

    return results;
  }

  private tryExtract(key: string): unknown {
    const keyPattern = `"${key}":`;
    const idx = this.accumulated.indexOf(keyPattern);
    if (idx === -1) return undefined;

    let start = idx + keyPattern.length;
    // Skip whitespace between the colon and the value.
    while (start < this.accumulated.length && /\s/.test(this.accumulated[start])) start++;
    if (start >= this.accumulated.length) return undefined;

    const openChar = this.accumulated[start];
    if (openChar !== "{" && openChar !== "[") return undefined;
    const closeChar = openChar === "{" ? "}" : "]";

    let depth = 0;
    let i = start;
    while (i < this.accumulated.length) {
      const ch = this.accumulated[i];
      if (ch === '"') {
        // Skip over string content, respecting escape sequences.
        i++;
        while (i < this.accumulated.length) {
          if (this.accumulated[i] === "\\") {
            i += 2;
            continue;
          }
          if (this.accumulated[i] === '"') break;
          i++;
        }
      } else if (ch === openChar) {
        depth++;
      } else if (ch === closeChar) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(this.accumulated.slice(start, i + 1));
          } catch {
            return undefined;
          }
        }
      }
      i++;
    }
    return undefined;
  }
}

export type StreamEvent =
  | { type: "progress"; phase: string; message: string; elapsed_ms: number }
  | { type: "field"; field: StreamingFieldKey; value: unknown }
  | {
      type: "complete";
      invoice: unknown;
      usage: UsageSummary;
      duration_ms: number;
      model: string;
      cost_usd: number | null;
      retry_count: number;
    }
  | { type: "error"; code: string; message: string };

export interface ExtractInvoiceStreamOptions {
  apiKey?: string;
  model?: string;
  logger?: Logger;
  signal?: AbortSignal;
  customFields?: CustomField[];
}

/**
 * Streaming variant of extractInvoice. Yields StreamEvents as Claude
 * generates text. Emits "field" events for each completed top-level key
 * and a final "complete" event with the validated invoice.
 *
 * Unlike extractInvoice(), this function does NOT use output_config /
 * zodOutputFormat. It accumulates raw text and validates with Zod at the
 * end. If validation fails, yields an "error" event instead of "complete".
 *
 * Retry logic: on a retryable API error, restart the stream from scratch
 * (resetting accumulated text and the parser).
 */
export async function* extractInvoiceStream(
  input: ExtractionInput,
  options: ExtractInvoiceStreamOptions = {},
): AsyncGenerator<StreamEvent> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    yield {
      type: "error",
      code: "model-API-failure",
      message: "ANTHROPIC_API_KEY is not set.",
    };
    return;
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

  yield {
    type: "progress",
    phase: "extracting",
    message: "Sending to Claude...",
    elapsed_ms: Date.now() - start,
  };

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= EXTRACTION_MAX_RETRIES; attempt++) {
    const parser = new PartialJsonFieldParser();
    let accumulated = "";

    try {
      const stream = client.messages.stream(
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
        },
        { signal },
      );

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          const chunk = event.delta.text;
          accumulated += chunk;
          const fields = parser.feed(chunk);
          for (const f of fields) {
            yield { type: "field", field: f.field, value: f.value };
          }
        }
      }

      // Stream complete: validate the accumulated JSON with Zod.
      let rawParsed: unknown;
      try {
        rawParsed = JSON.parse(accumulated);
      } catch {
        yield {
          type: "error",
          code: "model-API-failure",
          message: "Claude returned non-JSON output.",
        };
        return;
      }

      const validated = InvoiceExtractionSchema.safeParse(rawParsed);
      if (!validated.success) {
        yield {
          type: "error",
          code: "model-API-failure",
          message: "Claude output did not match expected schema.",
        };
        return;
      }

      const finalMessage = await stream.finalMessage();
      const rawUsage = finalMessage.usage as unknown as Record<string, unknown>;
      const usage: UsageSummary = {
        input_tokens: finalMessage.usage.input_tokens,
        output_tokens: finalMessage.usage.output_tokens,
        cache_creation_input_tokens:
          typeof rawUsage.cache_creation_input_tokens === "number"
            ? rawUsage.cache_creation_input_tokens
            : null,
        cache_read_input_tokens:
          typeof rawUsage.cache_read_input_tokens === "number"
            ? rawUsage.cache_read_input_tokens
            : null,
      };

      const cost_usd = computeCost(usage, model);
      if (cost_usd !== null) {
        recordMonthlyCost(cost_usd);
        const budget = exceedsBudget(cost_usd);
        if (budget.exceeded) {
          logger?.warn({ category: "cost-budget-exceeded", cost_usd });
          yield {
            type: "error",
            code: "cost-budget-exceeded",
            message: "Cost exceeded cap.",
          };
          return;
        }
        recordCost(cost_usd);
      }

      yield {
        type: "complete",
        invoice: validated.data,
        usage,
        duration_ms: Date.now() - start,
        model,
        cost_usd,
        retry_count: attempt,
      };
      return;
    } catch (err) {
      lastError = err;

      const isAbort =
        (err instanceof Error && err.name === "AbortError") ||
        (err instanceof DOMException && err.name === "TimeoutError");
      if (isAbort) {
        yield {
          type: "error",
          code: "extraction-timeout",
          message: "Extraction timed out.",
        };
        return;
      }

      const isRetryable =
        err instanceof APIError &&
        (err.status === 429 || (err.status ?? 0) >= 500);
      if (attempt < EXTRACTION_MAX_RETRIES && isRetryable) {
        const backoffMs = 400 * Math.pow(2, attempt);
        yield {
          type: "progress",
          phase: "retry",
          message: `Transient error, retrying (${attempt + 1})...`,
          elapsed_ms: Date.now() - start,
        };
        await new Promise<void>((r) => setTimeout(r, backoffMs));
        continue;
      }

      break;
    }
  }

  const message =
    lastError instanceof Error ? lastError.message : "Unknown extraction failure.";
  yield { type: "error", code: "model-API-failure", message };
}
