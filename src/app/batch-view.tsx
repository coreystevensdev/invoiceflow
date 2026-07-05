"use client";

import { useCallback } from "react";
import type { ExtractResponse } from "./api/extract/route";
import type { ExtractionErrorCode } from "@/lib/errors";
import { TellsightCta } from "@/components/tellsight-cta";

export type BatchFile =
  | { kind: "queued"; id: string; filename: string; size: number }
  | { kind: "loading"; id: string; filename: string; size: number }
  | { kind: "success"; id: string; filename: string; result: ExtractResponse }
  | {
      kind: "error";
      id: string;
      filename: string;
      code: ExtractionErrorCode;
      correlation_id?: string;
    };

function BatchRowIcon({ kind }: { kind: BatchFile["kind"] }) {
  if (kind === "success") {
    return (
      <span
        aria-label="Success"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400"
      >
        ✓
      </span>
    );
  }
  if (kind === "error") {
    return (
      <span
        aria-label="Failed"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400"
      >
        ✕
      </span>
    );
  }
  if (kind === "loading") {
    return (
      <span
        aria-label="Extracting"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center"
      >
        <svg
          className="h-4 w-4 animate-spin text-indigo-600 motion-reduce:animate-none dark:text-indigo-400"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth="3"
          />
          <path
            d="M22 12a10 10 0 0 1-10 10"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span
      aria-label="Queued"
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-xs text-zinc-500 dark:border-zinc-700"
    >
      ⋯
    </span>
  );
}

interface BatchViewProps {
  files: BatchFile[];
  inProgress: boolean;
  onReset: () => void;
}

export function BatchView({ files, inProgress, onReset }: BatchViewProps) {
  const successes = files.filter(
    (f): f is Extract<BatchFile, { kind: "success" }> => f.kind === "success",
  );
  const failures = files.filter(
    (f): f is Extract<BatchFile, { kind: "error" }> => f.kind === "error",
  );
  const pending = files.length - successes.length - failures.length;

  const downloadBulkCsv = useCallback(
    async (format: "summary" | "line_items") => {
      if (successes.length === 0) return;
      try {
        const res = await fetch("/api/csv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            format,
            invoices: successes.map((s) => s.result.invoice),
          }),
        });
        if (!res.ok) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `invoiceflow-batch-${format}-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error("[downloadBulkCsv] export failed:", err);
      }
    },
    [successes],
  );

  const formatBytes = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  const totalCostUsd = successes.reduce(
    (sum, s) => sum + (s.result.cost_usd ?? 0),
    0,
  );
  const anyCostKnown = successes.some((s) => s.result.cost_usd != null);

  return (
    <section aria-label="Batch extraction results" className="mt-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            Batch:
          </span>{" "}
          <span className="text-green-700 dark:text-green-400">
            {successes.length} succeeded
          </span>
          {failures.length > 0 && (
            <>
              {", "}
              <span className="text-red-700 dark:text-red-400">
                {failures.length} failed
              </span>
            </>
          )}
          {pending > 0 && (
            <>
              {", "}
              <span className="text-zinc-600 dark:text-zinc-400">
                {pending} in progress
              </span>
            </>
          )}
          {" of "}
          {files.length}
          {inProgress && " (running...)"}
          {anyCostKnown && (
            <>
              {" · "}
              <span className="text-zinc-600 dark:text-zinc-400">
                ${totalCostUsd.toFixed(3)} total
              </span>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => downloadBulkCsv("summary")}
            disabled={successes.length === 0}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Download summary CSV
          </button>
          <button
            type="button"
            onClick={() => downloadBulkCsv("line_items")}
            disabled={successes.length === 0}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          >
            Download line-items CSV
          </button>
          <button
            type="button"
            onClick={onReset}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          >
            Reset
          </button>
        </div>
      </div>

      <ul className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {files.map((f) => (
          <li
            key={f.id}
            className="flex flex-wrap items-center gap-3 border-b border-zinc-100 px-4 py-3 last:border-0 dark:border-zinc-800"
          >
            <BatchRowIcon kind={f.kind} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {f.filename}
              </div>
              <div className="text-xs text-zinc-500">
                {f.kind === "success" ? (
                  <>
                    {f.result.invoice.vendor.name ?? "Unknown vendor"}
                    {" · "}
                    {f.result.invoice.total.value != null
                      ? `${f.result.invoice.currency.value ?? ""} ${f.result.invoice.total.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim()
                      : "no total"}
                    {" · "}
                    {f.result.duration_ms.total
                      ? `${(f.result.duration_ms.total / 1000).toFixed(1)}s`
                      : ""}
                    {f.result.cost_usd != null && (
                      <>
                        {" · "}
                        {`$${f.result.cost_usd.toFixed(3)}`}
                      </>
                    )}
                  </>
                ) : f.kind === "error" ? (
                  <>
                    {f.code}
                    {f.correlation_id && ` · ${f.correlation_id.slice(0, 8)}`}
                  </>
                ) : f.kind === "loading" ? (
                  "extracting..."
                ) : (
                  `${formatBytes(f.size)} · queued`
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {successes.length > 0 && !inProgress && <TellsightCta variant="bulk" />}
    </section>
  );
}
