import { z } from "zod";

/**
 * User-defined extraction fields beyond the fixed nine. Lives in localStorage
 * client-side; sent to /api/extract per request as a multipart form field
 * (JSON-stringified). The server validates the array shape, builds a dynamic
 * Zod schema by extending InvoiceExtractionSchema with these fields, and
 * appends the descriptions to the user message so Claude knows what to look
 * for.
 *
 * The `id` (UUID) is the JSON key for the value in the response; the `name`
 * is purely for client-side display. Using id-as-key keeps user-supplied
 * names out of the JSON-key surface, which avoids prompt-injection vectors
 * around weird characters or unicode in field names.
 */

export type CustomFieldType = "string" | "number" | "date";

export interface CustomField {
  id: string;
  name: string;
  type: CustomFieldType;
  description: string;
}

export const CUSTOM_FIELD_LIMITS = {
  /** Hard cap on number of custom fields per extraction (token cost control). */
  maxFields: 10,
  nameMin: 1,
  nameMax: 30,
  descriptionMin: 5,
  descriptionMax: 200,
} as const;

export const CustomFieldSchema = z.object({
  id: z.string().min(1).max(64),
  name: z
    .string()
    .min(CUSTOM_FIELD_LIMITS.nameMin)
    .max(CUSTOM_FIELD_LIMITS.nameMax),
  type: z.enum(["string", "number", "date"]),
  description: z
    .string()
    .min(CUSTOM_FIELD_LIMITS.descriptionMin)
    .max(CUSTOM_FIELD_LIMITS.descriptionMax),
});

export const CustomFieldsArraySchema = z
  .array(CustomFieldSchema)
  .max(CUSTOM_FIELD_LIMITS.maxFields);

const STORAGE_KEY = "invoiceflow:custom-fields";

/**
 * Read custom fields from localStorage. Returns [] if missing, malformed,
 * or storage is unavailable (SSR, private mode, quota exceeded). The Zod
 * parse step throws away anything that doesn't match the schema, so a
 * legacy payload from a previous app version can't crash the load.
 */
export function loadCustomFields(): CustomField[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    const result = CustomFieldsArraySchema.safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

export function saveCustomFields(fields: CustomField[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fields));
  } catch {
    // localStorage can throw on quota exceeded or permission denied.
    // Silent fail; the user's in-memory list still works for this session.
  }
}
