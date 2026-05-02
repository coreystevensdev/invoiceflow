import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Not found",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main
      id="main-content"
      className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
    >
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col items-start justify-center px-6 py-16">
        <p className="text-xs uppercase tracking-wide text-zinc-500">
          404
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          That page isn&apos;t here.
        </h1>
        <p className="mt-3 text-base text-zinc-600 dark:text-zinc-400 sm:text-lg">
          The URL you followed doesn&apos;t match anything InvoiceFlow serves.
          Head back to the dropzone and extract an invoice instead.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Back to InvoiceFlow
        </Link>
      </div>
    </main>
  );
}
