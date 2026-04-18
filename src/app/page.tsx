"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ExtractResponse } from "./api/extract/route";
import type { InvoiceExtraction, ExtractionFlag } from "@/lib/claude";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; filename: string }
  | { kind: "success"; result: ExtractResponse; filename: string }
  | { kind: "error"; message: string; code?: string };

export default function Home() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [isDragging, setIsDragging] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookStatus, setWebhookStatus] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setStatus({ kind: "loading", filename: file.name });
    setWebhookStatus(null);
    const form = new FormData();
    form.append("pdf", file);
    const res = await fetch("/api/extract", { method: "POST", body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Unknown error." }));
      setStatus({
        kind: "error",
        message: err.error ?? "Extraction failed.",
        code: err.code,
      });
      return;
    }
    const data = (await res.json()) as ExtractResponse;
    setStatus({ kind: "success", result: data, filename: file.name });
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const downloadCsv = useCallback(
    async (format: "summary" | "line_items") => {
      if (status.kind !== "success") return;
      const res = await fetch("/api/csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, invoices: [status.result.invoice] }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoiceflow-${format}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [status],
  );

  const fireWebhook = useCallback(async () => {
    if (status.kind !== "success" || !webhookUrl) return;
    setWebhookStatus("firing…");
    const res = await fetch("/api/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        webhook_url: webhookUrl,
        invoice: status.result.invoice,
      }),
    });
    const data = await res.json();
    setWebhookStatus(
      res.ok
        ? `✓ ${data.status} (${data.duration_ms}ms)`
        : `✗ ${data.error ?? "failed"}`,
    );
  }, [status, webhookUrl]);

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-4xl px-6 py-16">
        <header className="mb-10">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Stop typing invoices into QuickBooks.
          </h1>
          <p className="mt-3 text-lg text-zinc-600 dark:text-zinc-400">
            Drop a PDF. Get structured data in under 5 seconds.
            <span className="mx-2 text-zinc-400">·</span>
            3 hours manual → 45 seconds with Claude.
          </p>
        </header>

        <label
          htmlFor="pdf-input"
          onDragEnter={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          className={`block cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition ${
            isDragging
              ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30"
              : "border-zinc-300 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-500"
          }`}
        >
          <input
            id="pdf-input"
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={onChange}
            className="sr-only"
          />
          <p className="text-lg font-medium">
            {status.kind === "loading"
              ? `Extracting ${status.filename}…`
              : "Drop a PDF invoice here, or click to upload"}
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            Max 25 MB. Typed or scanned-with-OCR PDFs.
          </p>
        </label>

        {status.kind === "error" && (
          <div className="mt-6 rounded-lg border border-red-300 bg-red-50 p-4 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            <p className="font-medium">We couldn&apos;t process that file.</p>
            <p className="mt-1 text-sm">{status.message}</p>
            {status.code && (
              <p className="mt-1 text-xs text-red-700 dark:text-red-300">
                code: {status.code}
              </p>
            )}
          </div>
        )}

        {status.kind === "success" && (
          <ResultsView
            result={status.result}
            filename={status.filename}
            downloadCsv={downloadCsv}
            webhookUrl={webhookUrl}
            setWebhookUrl={setWebhookUrl}
            fireWebhook={fireWebhook}
            webhookStatus={webhookStatus}
          />
        )}
      </div>

      <footer className="border-t border-zinc-200 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 px-6">
          <span>
            Powered by{" "}
            <a
              className="underline"
              href="https://www.anthropic.com/claude"
              target="_blank"
              rel="noreferrer"
            >
              Claude
            </a>
          </span>
          <span>
            Need one for your business?{" "}
            <a
              className="font-medium text-indigo-600 underline dark:text-indigo-400"
              href="#"
            >
              Hire me on Upwork →
            </a>
          </span>
        </div>
      </footer>
    </main>
  );
}

interface ResultsViewProps {
  result: ExtractResponse;
  filename: string;
  downloadCsv: (format: "summary" | "line_items") => void;
  webhookUrl: string;
  setWebhookUrl: (v: string) => void;
  fireWebhook: () => void;
  webhookStatus: string | null;
}

function ResultsView({
  result,
  filename,
  downloadCsv,
  webhookUrl,
  setWebhookUrl,
  fireWebhook,
  webhookStatus,
}: ResultsViewProps) {
  const inv = result.invoice;
  const summary = result.confidence_summary;

  const fields = useMemo(
    () => [
      { label: "Invoice #", field: inv.invoice_number },
      {
        label: "Vendor",
        field: {
          value: inv.vendor.name,
          confidence: inv.vendor.confidence,
          reasoning: inv.vendor.reasoning,
        },
      },
      { label: "Bill date", field: inv.bill_date },
      { label: "Due date", field: inv.due_date },
      { label: "PO #", field: inv.po_number },
      { label: "Subtotal", field: inv.subtotal, money: true },
      { label: "Tax", field: inv.tax, money: true },
      { label: "Total", field: inv.total, money: true },
      { label: "Currency", field: inv.currency },
    ],
    [inv],
  );

  return (
    <section className="mt-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-500">
        <span>
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {filename}
          </span>
          <span className="mx-2">·</span>
          {result.pdf.num_pages} page{result.pdf.num_pages === 1 ? "" : "s"}
          <span className="mx-2">·</span>
          {(result.duration_ms.total / 1000).toFixed(1)}s total
          <span className="mx-2">·</span>
          {result.usage.input_tokens + result.usage.output_tokens} tokens
        </span>
        <span>
          Confidence:{" "}
          <b className="text-green-700 dark:text-green-400">
            {summary.high} high
          </b>
          <span className="mx-2">·</span>
          <b className="text-amber-700 dark:text-amber-400">
            {summary.medium} medium
          </b>
          <span className="mx-2">·</span>
          <b className="text-red-700 dark:text-red-400">{summary.low} low</b>
        </span>
      </div>

      {inv.flags.length > 0 && <FlagsList flags={inv.flags} />}

      <div className="grid gap-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-2">
        {fields.map((f) => (
          <FieldRow
            key={f.label}
            label={f.label}
            field={f.field}
            money={f.money}
          />
        ))}
      </div>

      {inv.line_items.length > 0 && <LineItemsTable items={inv.line_items} />}

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => downloadCsv("summary")}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Download summary CSV
        </button>
        <button
          onClick={() => downloadCsv("line_items")}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
        >
          Download line-items CSV
        </button>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-sm font-medium">Fire webhook</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://your-webhook-url"
            className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
          <button
            onClick={fireWebhook}
            disabled={!webhookUrl}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Fire
          </button>
        </div>
        {webhookStatus && (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {webhookStatus}
          </p>
        )}
      </div>
    </section>
  );
}

interface FieldLike {
  value: unknown;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

function FieldRow({
  label,
  field,
  money,
}: {
  label: string;
  field: FieldLike;
  money?: boolean;
}) {
  const value =
    field.value === null || field.value === undefined
      ? "—"
      : money && typeof field.value === "number"
        ? field.value.toFixed(2)
        : String(field.value);
  const dotColor =
    field.confidence === "high"
      ? "bg-green-500"
      : field.confidence === "medium"
        ? "bg-amber-500"
        : "bg-red-500";
  return (
    <div className="group relative">
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-1 flex items-center gap-2 text-lg font-medium">
        <span>{value}</span>
        <span
          aria-label={`${field.confidence} confidence`}
          className={`h-2 w-2 rounded-full ${dotColor}`}
        />
      </dd>
      {field.reasoning && (
        <div className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden w-80 rounded-lg bg-zinc-900 p-3 text-xs text-white shadow-lg group-hover:block dark:bg-zinc-100 dark:text-zinc-900">
          {field.reasoning}
        </div>
      )}
    </div>
  );
}

function FlagsList({ flags }: { flags: ExtractionFlag[] }) {
  const colors: Record<ExtractionFlag["severity"], string> = {
    info: "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200",
    warning:
      "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
    error:
      "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200",
  };
  return (
    <ul className="space-y-2">
      {flags.map((flag, i) => (
        <li
          key={i}
          className={`rounded-lg border px-3 py-2 text-sm ${colors[flag.severity]}`}
        >
          <span className="mr-2 text-xs font-semibold uppercase">
            {flag.severity}
          </span>
          {flag.message}
        </li>
      ))}
    </ul>
  );
}

function LineItemsTable({
  items,
}: {
  items: InvoiceExtraction["line_items"];
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full text-sm">
        <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
          <tr>
            <th className="px-4 py-3">Description</th>
            <th className="px-4 py-3 text-right">Qty</th>
            <th className="px-4 py-3 text-right">Unit price</th>
            <th className="px-4 py-3 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((li, i) => (
            <tr
              key={i}
              className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
            >
              <td className="px-4 py-3">{li.description ?? "—"}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {li.quantity ?? "—"}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {li.unit_price?.toFixed(2) ?? "—"}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {li.amount?.toFixed(2) ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
