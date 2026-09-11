import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main id="main-content" className="min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col items-start justify-center px-6 py-16">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-foreground/50">
          404
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          That page isn&apos;t here.
        </h1>
        <p className="mt-3 text-base text-foreground/70 sm:text-lg">
          The URL you followed doesn&apos;t match anything InvoiceFlow serves.
          Head back to the dropzone and extract an invoice instead.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center bg-ink-navy px-4 py-2 text-sm font-medium text-background hover:bg-ink-navy-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-navy focus-visible:ring-offset-2"
        >
          Back to InvoiceFlow
        </Link>
      </div>
    </main>
  );
}
