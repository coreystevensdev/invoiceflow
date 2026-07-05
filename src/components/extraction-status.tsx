"use client";

import { PdfPreview } from "@/components/pdf-preview";

const FIELD_LABELS: Record<string, string> = {
  invoice_number: "Invoice #",
  vendor: "Vendor",
  bill_date: "Bill date",
  due_date: "Due date",
  po_number: "PO #",
  subtotal: "Subtotal",
  tax: "Tax",
  total: "Total",
  currency: "Currency",
};

const STREAMING_FIELDS = [
  "invoice_number",
  "vendor",
  "bill_date",
  "due_date",
  "po_number",
  "subtotal",
  "tax",
  "total",
  "currency",
] as const;

// Pulse-animated placeholder rendered while extraction is in flight.
// Mirrors the real ResultsView grid (9 fields, 2 columns on sm+) at fixed
// sizes so layout shift on first paint is minimal. motion-reduce disables
// the pulse per the global accessibility floor.
export function ResultsSkeleton() {
  return (
    <section
      aria-label="Extraction in progress"
      aria-busy="true"
      className="mt-8 space-y-6 animate-pulse motion-reduce:animate-none"
      data-results-section
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="inline-block h-4 w-40 rounded bg-zinc-200 dark:bg-zinc-800" />
        <span className="inline-block h-3 w-20 rounded bg-zinc-200 dark:bg-zinc-800" />
        <span className="inline-block h-3 w-16 rounded bg-zinc-200 dark:bg-zinc-800" />
      </div>
      <div className="grid border-t border-l border-zinc-200 dark:border-zinc-800 sm:grid-cols-2">
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className="border-b border-r border-zinc-200 p-5 dark:border-zinc-800">
            <div className="h-3 w-16 rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="mt-2 h-6 w-32 rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        <span className="inline-block h-9 w-44 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        <span className="inline-block h-9 w-44 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        <span className="inline-block h-9 w-32 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      </div>
    </section>
  );
}

interface StreamingResultsViewProps {
  filename: string;
  pdfUrl: string;
  phase: string;
  partialFields: Record<string, unknown>;
}

export function StreamingResultsView({
  filename,
  pdfUrl,
  phase,
  partialFields,
}: StreamingResultsViewProps) {
  const isImage = /\.(jpe?g|png|gif|webp)$/i.test(filename);

  const getFieldValue = (key: string): string | null => {
    const raw = partialFields[key];
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    if (key === "vendor") {
      return typeof obj["name"] === "string" ? obj["name"] : null;
    }
    const v = obj["value"];
    if (v === null || v === undefined) return null;
    if (typeof v === "number")
      return v.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    return String(v);
  };

  return (
    <section
      className="mt-8 space-y-6"
      aria-label="Extraction in progress"
      aria-busy="true"
      aria-live="polite"
      data-results-section
    >
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-500"
        role="status"
      >
        <span className="font-medium text-zinc-700 dark:text-zinc-300">
          {filename}
        </span>
        <span>{phase}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pdfUrl}
              alt={`Invoice: ${filename}`}
              className="w-full rounded-xl border border-zinc-200 bg-white dark:border-zinc-800"
            />
          ) : (
            <PdfPreview
              key={pdfUrl}
              pdfUrl={pdfUrl}
              filename={filename}
              invoice={null}
              activeBbox={null}
              onBboxesComputed={() => {}}
            />
          )}
        </div>

        <div className="min-w-0">
          <dl className="grid border-t border-l border-zinc-200 dark:border-zinc-800 sm:grid-cols-2">
            {STREAMING_FIELDS.map((key) => {
              const value = getFieldValue(key);
              const hasValue = value !== null;
              return (
                <div
                  key={key}
                  className="border-b border-r border-zinc-200 p-5 dark:border-zinc-800"
                >
                  <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                    {FIELD_LABELS[key] ?? key}
                  </dt>
                  <dd className="mt-1 font-mono text-base font-medium">
                    {hasValue ? (
                      <span className="transition-opacity opacity-100">
                        {value}
                      </span>
                    ) : (
                      <span
                        aria-hidden="true"
                        className="inline-block h-5 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800 motion-reduce:animate-none"
                      />
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </div>
    </section>
  );
}
