/**
 * Key order in this schema is load-bearing, and nothing enforced it until now.
 *
 * Structured output generates keys in declaration order, so a field object that
 * declares `value` before `reasoning` makes the model emit a number and then
 * write a justification for whatever it already emitted. That is rationalisation
 * rather than reasoning, and it was measured: on the one fixture whose printed
 * subtotal disagrees with its line items, value-first returned 593.60 while the
 * same response's reasoning text concluded "Printed subtotal is 641.60".
 * Reversing the order took that fixture from 4 of 10 to 10 of 10, Fisher
 * p = 0.0108.
 *
 * `Flag` carries the same rule for the same reason, documented beside it: with
 * `severity` first the model picked "error" and then wrote a message stating the
 * condition was satisfied.
 *
 * Both findings cost live API calls to discover and the eval that found them is
 * a release-time check that costs about $1.40 a run. These assertions cost
 * nothing and fail the build, so a refactor that tidies the schema cannot
 * silently undo either one.
 */

import { describe, expect, it } from "vitest";

import { InvoiceExtractionSchema } from "./claude";

/** Every object in the schema tree, as [path, declared key order]. */
function objectShapes(
  schema: unknown,
  path = "",
  out: Array<{ path: string; keys: string[] }> = [],
): Array<{ path: string; keys: string[] }> {
  const node = schema as Record<string, unknown> | undefined;
  if (!node || typeof node !== "object") return out;

  const shape = (node as { shape?: Record<string, unknown> }).shape;
  if (shape && typeof shape === "object") {
    out.push({ path: path || "(root)", keys: Object.keys(shape) });
    for (const [key, child] of Object.entries(shape)) {
      objectShapes(child, path ? `${path}.${key}` : key, out);
    }
    return out;
  }

  // Unwrap arrays, nullables and optionals to reach the object inside.
  const def = (node as { def?: Record<string, unknown>; _def?: Record<string, unknown> }).def
    ?? (node as { _def?: Record<string, unknown> })._def;
  const inner = (def?.element ?? def?.innerType ?? def?.type) as unknown;
  if (inner && inner !== node) objectShapes(inner, path, out);
  return out;
}

const shapes = objectShapes(InvoiceExtractionSchema);

describe("schema key order is the one the eval measured", () => {
  it("finds the schema tree, so a failure below is a real ordering problem", () => {
    // Guards the walker itself: if introspection silently returns nothing,
    // every ordering assertion would vacuously pass.
    expect(shapes.length).toBeGreaterThan(5);
    expect(shapes.map((s) => s.path)).toContain("(root)");
  });

  it("declares reasoning before value in every field that has both", () => {
    const withBoth = shapes.filter(
      (s) => s.keys.includes("reasoning") && s.keys.includes("value"),
    );
    expect(withBoth.length).toBeGreaterThan(0);

    const wrong = withBoth.filter(
      (s) => s.keys.indexOf("reasoning") > s.keys.indexOf("value"),
    );
    expect(
      wrong.map((s) => `${s.path}: ${s.keys.join(", ")}`),
      "value before reasoning makes the model justify a number it already wrote",
    ).toEqual([]);
  });

  it("declares message before severity on flags", () => {
    const flags = shapes.filter(
      (s) => s.keys.includes("message") && s.keys.includes("severity"),
    );
    expect(flags.length).toBeGreaterThan(0);
    for (const flag of flags) {
      expect(
        flag.keys.indexOf("message"),
        "severity first makes the model classify before it describes",
      ).toBeLessThan(flag.keys.indexOf("severity"));
    }
  });

  it("still covers all nine scored fields", () => {
    const root = shapes.find((s) => s.path === "(root)");
    expect(root?.keys).toEqual([
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
    ]);
  });
});
