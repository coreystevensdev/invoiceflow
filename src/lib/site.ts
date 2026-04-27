/**
 * Canonical site-URL and metadata source. Every layer that needs the
 * origin (metadata, sitemap, robots, JSON-LD, canonical alternates)
 * reads from here so there is exactly one place to change it.
 */

export const SITE_NAME = "InvoiceFlow";
export const SITE_TAGLINE = "PDF invoices to QuickBooks-ready CSV in seconds";
export const SITE_DESCRIPTION =
  "Drop a PDF invoice, get structured data plus a QuickBooks-ready CSV in under 5 seconds. Per-field reasoning, confidence flags, and cross-field validation.";

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

// TODO: Update once TellSight no-account demo deploys (target 2026-05-04).
// Reused by Story 2.2 (CSV success CTA) and Story 2.0 (`monthly-budget-exhausted` error CTA).
export const TELLSIGHT_DEMO_URL = "https://tellsight.example.com/demo";

export function isTellSightDemoUrlConfigured(): boolean {
  return !TELLSIGHT_DEMO_URL.includes("example.com");
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
