"use client";

import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { ExtractResponse } from "./api/extract/route";
import type { InvoiceExtraction, ExtractionFlag } from "@/lib/claude";
import type { ExtractionErrorCode } from "@/lib/errors";
import { ErrorState } from "@/components/error-state";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; filename: string }
  | { kind: "success"; result: ExtractResponse; filename: string }
  | {
      kind: "error";
      code: ExtractionErrorCode;
      correlation_id?: string;
      retry_after_seconds?: number;
      detected?: Record<string, unknown>;
    };

interface ErrorBody {
  error?: string;
  code?: ExtractionErrorCode;
  correlation_id?: string;
  retry_after_seconds?: number;
  detected?: Record<string, unknown>;
}

export default function Home() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [isDragging, setIsDragging] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookStatus, setWebhookStatus] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropzoneHintId = useId();

  const handleFile = useCallback(async (file: File) => {
    setStatus({ kind: "loading", filename: file.name });
    setWebhookStatus(null);
    const form = new FormData();
    form.append("pdf", file);
    const res = await fetch("/api/extract", { method: "POST", body: form });
    if (!res.ok) {
      const body: ErrorBody = await res.json().catch(() => ({}));
      setStatus({
        kind: "error",
        code: body.code ?? "model-API-failure",
        correlation_id: body.correlation_id,
        retry_after_seconds: body.retry_after_seconds,
        detected: body.detected,
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

  const onDropzoneKey = useCallback(
    (e: KeyboardEvent<HTMLLabelElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        inputRef.current?.click();
      }
    },
    [],
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
    setWebhookStatus("Firing…");
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
        ? `Sent — upstream responded ${data.status} in ${data.duration_ms}ms.`
        : `Failed — ${data.error ?? "unknown reason"}.`,
    );
  }, [status, webhookUrl]);

  return (
    <main
      id="main-content"
      className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
    >
      <div className="mx-auto max-w-4xl px-6 py-16">
        <header className="mb-10">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Stop typing invoices into QuickBooks.
          </h1>
          <p className="mt-3 text-lg text-zinc-600 dark:text-zinc-400">
            Drop a PDF. Get structured data in under 5 seconds.
            <span
              aria-hidden="true"
              className="mx-2 text-zinc-400"
            >
              ·
            </span>
            3 hours manual → 45 seconds with Claude.
          </p>
        </header>

        <label
          htmlFor="pdf-input"
          role="button"
          tabIndex={0}
          aria-label="Upload a PDF invoice. Press Enter or Space to open the file picker, or drop a file onto this area."
          aria-describedby={dropzoneHintId}
          onKeyDown={onDropzoneKey}
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
          className={`block cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 dark:focus-visible:ring-offset-zinc-950 ${
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
            aria-describedby={dropzoneHintId}
          />
          <p className="text-lg font-medium" aria-live="polite">
            {status.kind === "loading"
              ? `Extracting ${status.filename}…`
              : "Drop a PDF invoice here, or click to upload"}
          </p>
          <p
            id={dropzoneHintId}
            className="mt-2 text-sm text-zinc-500"
          >
            Max 25 MB. Typed or scanned-with-OCR PDFs.
          </p>
        </label>

        {status.kind === "error" && (
          <ErrorState
            code={status.code}
            correlationId={status.correlation_id}
            retryAfterSeconds={status.retry_after_seconds}
            detected={status.detected}
          />
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

      <footer className="mt-auto border-t border-zinc-200 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-4 px-6">
          <span>
            Powered by{" "}
            <a
              className="underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded"
              href="https://www.anthropic.com/claude"
              target="_blank"
              rel="noreferrer"
            >
              Claude
            </a>
            .
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
    <section className="mt-8 space-y-6" aria-label="Extraction results">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-500">
        <span>
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {filename}
          </span>
          <span aria-hidden="true" className="mx-2">
            ·
          </span>
          {result.pdf.num_pages} page{result.pdf.num_pages === 1 ? "" : "s"}
          <span aria-hidden="true" className="mx-2">
            ·
          </span>
          {(result.duration_ms.total / 1000).toFixed(1)}s total
          <span aria-hidden="true" className="mx-2">
            ·
          </span>
          {result.usage.input_tokens + result.usage.output_tokens} tokens
        </span>
        <span>
          Confidence:{" "}
          <b className="text-green-700 dark:text-green-400">
            {summary.high} high
          </b>
          <span aria-hidden="true" className="mx-2">
            ·
          </span>
          <b className="text-amber-700 dark:text-amber-400">
            {summary.medium} medium
          </b>
          <span aria-hidden="true" className="mx-2">
            ·
          </span>
          <b className="text-red-700 dark:text-red-400">{summary.low} low</b>
        </span>
      </div>

      {inv.flags.length > 0 && <FlagsList flags={inv.flags} />}

      <dl className="grid gap-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-2">
        {fields.map((f) => (
          <FieldRow
            key={f.label}
            label={f.label}
            field={f.field}
            money={f.money}
          />
        ))}
      </dl>

      {inv.line_items.length > 0 && <LineItemsTable items={inv.line_items} />}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => downloadCsv("summary")}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Download summary CSV
        </button>
        <button
          type="button"
          onClick={() => downloadCsv("line_items")}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
        >
          Download line-items CSV
        </button>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-medium">Fire webhook</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <label htmlFor="webhook-url" className="sr-only">
            Webhook URL
          </label>
          <input
            id="webhook-url"
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://your-webhook-url"
            className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-950"
          />
          <button
            type="button"
            onClick={fireWebhook}
            disabled={!webhookUrl}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            Fire
          </button>
        </div>
        {webhookStatus && (
          <p
            className="mt-2 text-sm text-zinc-600 dark:text-zinc-400"
            role="status"
            aria-live="polite"
          >
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
  const reasoningId = useId();
  const [escapeDismissed, setEscapeDismissed] = useState(false);
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
  const confidenceGlyph =
    field.confidence === "high"
      ? "●"
      : field.confidence === "medium"
        ? "◐"
        : "○";
  const confidenceWord =
    field.confidence === "high"
      ? "High"
      : field.confidence === "medium"
        ? "Medium"
        : "Low";

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && field.reasoning && !escapeDismissed) {
      event.stopPropagation();
      setEscapeDismissed(true);
    }
  };

  const resetDismissal = () => {
    if (escapeDismissed) setEscapeDismissed(false);
  };

  const tooltipVisibility = escapeDismissed
    ? "hidden"
    : "hidden group-hover:block group-focus-within:block";

  return (
    <div
      className="group relative"
      tabIndex={field.reasoning ? 0 : undefined}
      onKeyDown={handleKeyDown}
      onFocus={resetDismissal}
      onMouseEnter={resetDismissal}
    >
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd
        className="mt-1 flex items-center gap-2 text-lg font-medium"
        aria-describedby={field.reasoning ? reasoningId : undefined}
      >
        <span>{value}</span>
        <span
          aria-hidden="true"
          className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] leading-none text-white ${dotColor}`}
        >
          {confidenceGlyph}
        </span>
        <span className="sr-only">{confidenceWord} confidence.</span>
      </dd>
      {field.reasoning && (
        <div
          id={reasoningId}
          role="tooltip"
          className={`pointer-events-none absolute left-0 top-full z-10 mt-1 w-80 rounded-lg bg-zinc-900 p-3 text-xs text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900 ${tooltipVisibility}`}
        >
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
  const icons: Record<ExtractionFlag["severity"], string> = {
    info: "ℹ",
    warning: "⚠",
    error: "✕",
  };
  const labels: Record<ExtractionFlag["severity"], string> = {
    info: "Info",
    warning: "Warning",
    error: "Error",
  };
  return (
    <ul className="space-y-2" aria-label="Validation flags">
      {flags.map((flag, i) => (
        <li
          key={i}
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${colors[flag.severity]}`}
        >
          <span aria-hidden="true" className="text-base leading-none">
            {icons[flag.severity]}
          </span>
          <span>
            <span className="mr-2 text-xs font-semibold uppercase">
              {labels[flag.severity]}
            </span>
            <span className="sr-only">severity:</span>
            {flag.message}
          </span>
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
        <caption className="sr-only">Extracted line items</caption>
        <thead className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
          <tr>
            <th scope="col" className="px-4 py-3">
              Description
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Qty
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Unit price
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Amount
            </th>
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
