import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

import { proxy } from "./proxy";

function csp(pathname = "/"): string {
  const header = proxy(
    new NextRequest(new URL(pathname, "https://invoiceflow.test")),
  ).headers.get("content-security-policy");
  if (!header) throw new Error("no CSP header on the response");
  return header;
}

function directive(name: string): string {
  const found = csp()
    .split(";")
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
  if (!found) throw new Error(`no ${name} directive in: ${csp()}`);
  return found;
}

describe("content security policy", () => {
  // PdfPreview's fallback renders <object data={blobUrl}> when the canvas
  // pipeline fails. object-src does not usefully inherit from default-src
  // here: 'self' rejects blob: because a blob URL's origin is opaque. So the
  // scheme has to be named, and object-src 'none' blocks the element outright
  // while logging a violation on every fallback. It shipped that way once.
  it("allows object-src blob: so the PDF fallback can render", () => {
    expect(directive("object-src")).toContain("blob:");
  });

  it("keeps the <object> fallback and the directive in agreement", () => {
    const component = readFileSync(
      new URL("./components/pdf-preview.tsx", import.meta.url),
      "utf8",
    );
    if (!/<object\b/.test(component)) return;
    expect(directive("object-src")).toContain("blob:");
  });

  it("does not let object-src widen past blob:", () => {
    expect(directive("object-src")).toBe("object-src 'self' blob:");
  });

  it("still blocks framing and base-tag rewrites", () => {
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive("base-uri")).toBe("base-uri 'self'");
  });
});
