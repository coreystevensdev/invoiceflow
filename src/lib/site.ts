/**
 * Canonical site-URL and metadata source. Every layer that needs the
 * origin (metadata, sitemap, robots, JSON-LD, canonical alternates)
 * reads from here so there is exactly one place to change it.
 */

export const SITE_NAME = "InvoiceFlow";
export const SITE_TAGLINE = "PDF invoices structured by Claude in seconds";
export const SITE_DESCRIPTION =
  "PDF invoice extraction with per-field reasoning, confidence flags, and CSV export for QuickBooks or Xero. Typically under 5 seconds. Zero retention by design.";

export function getSiteUrl(): string {
  const explicit = process.env.SITE_URL;
  if (explicit && explicit.length > 0) {
    return explicit.replace(/\/+$/, "");
  }
  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelUrl && vercelUrl.length > 0) {
    return `https://${vercelUrl.replace(/\/+$/, "")}`;
  }
  return "http://localhost:3000";
}

// Placeholder discipline: cross-product CTAs (Tellsight demo, Loom hero embed)
// stay suppressed in the UI until an env override away from the literal
// placeholder is in place. NEXT_PUBLIC_ prefix is required because each value
// is consumed in Client Components and must be inlined into the client bundle.
// Both values are build-time-pinned for client consumers; setting them only at
// runtime on Vercel without a rebuild diverges server vs client values, so a
// redeploy is required after changing either override.
const TELLSIGHT_DEMO_URL_PLACEHOLDER = "https://tellsight.example.com/demo";
const LOOM_EMBED_URL_PLACEHOLDER =
  "https://www.loom.com/embed/00000000000000000000000000000000";

export const TELLSIGHT_DEMO_URL =
  process.env.NEXT_PUBLIC_TELLSIGHT_DEMO_URL ?? TELLSIGHT_DEMO_URL_PLACEHOLDER;

/**
 * Build-time-pinned Loom embed URL. The override channel is the
 * `NEXT_PUBLIC_LOOM_EMBED_URL` env var, inlined into the client bundle at
 * build time. Server runtime reads the same env var at process start;
 * setting it only at runtime on Vercel without a rebuild diverges server
 * vs client values. Always rebuild after changing the override. Format
 * expectation enforced by `isLoomEmbedConfigured()`:
 * `https://www.loom.com/embed/{32-char-hex-share-id}` with no query or
 * hash. Anything else gets suppressed in the UI rather than rendered as
 * a broken iframe.
 */
export const LOOM_EMBED_URL =
  process.env.NEXT_PUBLIC_LOOM_EMBED_URL ?? LOOM_EMBED_URL_PLACEHOLDER;

/**
 * True only when `TELLSIGHT_DEMO_URL` has been overridden away from the
 * literal placeholder *and* parses as an HTTPS URL. The override channel
 * is the `NEXT_PUBLIC_TELLSIGHT_DEMO_URL` env var, inlined into the
 * client bundle at build time. Any other shape placeholder substring
 * match, `javascript:` scheme, malformed URL reports false so the UI
 * suppresses the link rather than rendering an unsafe or broken anchor
 * target. The HTTPS check matters because the strict CSP does **not**
 * block `javascript:` href on a user-clicked anchor; the guard is a
 * defense-in-depth.
 */
export function isTellsightDemoUrlConfigured(): boolean {
  if (TELLSIGHT_DEMO_URL === TELLSIGHT_DEMO_URL_PLACEHOLDER) return false;
  try {
    const url = new URL(TELLSIGHT_DEMO_URL);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Stricter validator than `isTellsightDemoUrlConfigured()` because the embed
 * URL is concatenated into an iframe `src` downstream
 * (`${LOOM_EMBED_URL}?autoplay=1...`) and the CSP allows only
 * `frame-src https://www.loom.com`. Returns true only when:
 *   1. The value is not the literal placeholder.
 *   2. It parses as a URL with `https:` scheme.
 *   3. Hostname is exactly `www.loom.com`, no userinfo, no non-default port.
 *      The userinfo guard prevents `https://user:pass@www.loom.com/embed/...`
 *      from leaking credentials into the iframe `src`. The port guard keeps
 *      the URL exactly aligned with the CSP `frame-src https://www.loom.com`
 *      directive, which has no port and may not match port-specified URLs.
 *   4. Pathname matches `/embed/{32-char-hex-id}` (Loom share IDs are
 *      32-character hex strings).
 *   5. `url.search === ""` and `url.hash === ""` so the downstream concat
 *      does not produce `??sid=foo&autoplay=1` malformed URLs.
 * Any other shape suppresses the embed in the UI rather than rendering a
 * CSP-blocked or malformed iframe.
 */
export function isLoomEmbedConfigured(): boolean {
  if (LOOM_EMBED_URL === LOOM_EMBED_URL_PLACEHOLDER) return false;
  try {
    const url = new URL(LOOM_EMBED_URL);
    if (url.protocol !== "https:") return false;
    if (url.hostname !== "www.loom.com") return false;
    if (url.username !== "" || url.password !== "") return false;
    if (url.port !== "") return false;
    if (url.search !== "" || url.hash !== "") return false;
    return /^\/embed\/[a-f0-9]{32}$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export interface SoftwareApplicationSchema {
  "@context": "https://schema.org";
  "@type": "SoftwareApplication";
  name: string;
  description: string;
  url: string;
  applicationCategory: string;
  operatingSystem: string;
  offers: {
    "@type": "Offer";
    price: string;
    priceCurrency: string;
    availability: string;
  };
}

export function softwareApplicationSchema(): SoftwareApplicationSchema {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: getSiteUrl(),
    applicationCategory: "BusinessApplication",
    operatingSystem: "Any",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
  };
}
