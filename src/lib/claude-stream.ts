/**
 * Streaming extraction pipeline.
 *
 * Uses `client.messages.stream()` instead of `messages.parse()` so text
 * deltas arrive as Claude generates them. The tradeoff vs the non-streaming
 * path: `messages.parse()` uses `output_config` + `zodOutputFormat` for a
 * structured-output guarantee; streaming relies on the system prompt and
 * validates the final JSON with Zod after accumulation.
 */

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
