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

// TODO: Update once Tellsight no-account demo deploys (target 2026-05-04).
// Reused by Story 2.2 (CSV success CTA) and Story 2.0 (`monthly-budget-exhausted` error CTA).
export const TELLSIGHT_DEMO_URL = "https://tellsight.example.com/demo";

const TELLSIGHT_DEMO_URL_PLACEHOLDER = "https://tellsight.example.com/demo";

/**
 * True only when `TELLSIGHT_DEMO_URL` has been overridden away from the
 * literal placeholder *and* parses as an HTTPS URL. Any other shape
 * placeholder substring match, `javascript:` scheme, malformed URL
 * reports false so the UI suppresses the link rather than rendering an
 * unsafe or broken anchor target. The HTTPS check matters because the
 * strict CSP does **not** block `javascript:` href on a user-clicked
 * anchor; the guard is a defense-in-depth.
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
