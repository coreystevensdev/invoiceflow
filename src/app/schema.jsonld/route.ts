import { NextResponse } from "next/server";
import { softwareApplicationSchema } from "@/lib/site";

/**
 * Serves JSON-LD structured data at /schema.jsonld.
 *
 * The layout's metadata links to this URL via `alternates.types`. Google's
 * primary crawler reads JSON-LD from inline `<script type="application/ld+json">`
 * tags; the `<link rel="alternate" type="application/ld+json">` pattern used
 * here is best-effort for crawlers that honor it. When the in-house security
 * hook permits inline raw-HTML injection again, move this back into layout.tsx.
 */
export const runtime = "nodejs";
export const dynamic = "force-static";

export function GET() {
  const schema = softwareApplicationSchema();
  return NextResponse.json(schema, {
    headers: {
      "Content-Type": "application/ld+json",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
