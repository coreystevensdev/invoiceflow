"use client";

import {
  useCallback,
  useEffect,
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
import { PrivacySection } from "@/components/privacy-section";

type Status =
  | { kind: "idle" }
  | { kind: "loading"; filename: string }
  | {
      kind: "success";
      result: ExtractResponse;
      filename: string;
      pdfUrl: string;
    }
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
    setStatus((prev) => {
      if (prev.kind === "success") URL.revokeObjectURL(prev.pdfUrl);
      return { kind: "loading", filename: file.name };
    });
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
    const pdfUrl = URL.createObjectURL(file);
    setStatus({ kind: "success", result: data, filename: file.name, pdfUrl });
  }, []);

  useEffect(() => {
    return () => {
      if (status.kind === "success") URL.revokeObjectURL(status.pdfUrl);
    };
  }, [status]);

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

  const onSampleClick = useCallback(async () => {
    const res = await fetch("/sample-invoice.pdf");
    if (!res.ok) return;
    const blob = await res.blob();
    const file = new File([blob], "sample-invoice.pdf", {
      type: "application/pdf",
    });
    await handleFile(file);
  }, [handleFile]);

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

  const [webhookFiring, setWebhookFiring] = useState(false);

  const fireWebhook = useCallback(async () => {
    if (status.kind !== "success" || webhookFiring) return;
    setWebhookFiring(true);
    setWebhookStatus("Firing…");
    try {
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
          ? `Sent, upstream responded ${data.status} in ${data.duration_ms}ms.`
          : `Failed, ${data.error ?? "unknown reason"}.`,
      );
    } finally {
      setWebhookFiring(false);
    }
  }, [status, webhookUrl, webhookFiring]);

  return (
    <main
      id="main-content"
      className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
    >
      <div className="mx-auto max-w-4xl px-6 py-16">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Stop typing invoices into QuickBooks.
          </h1>
          <p className="mt-3 text-base text-zinc-600 dark:text-zinc-400 sm:text-lg">
            Drop a PDF, get vendor, line items, tax, total, and due date as
            structured data. Typically under 5 seconds. No login, no database,
            no logging of invoice content.
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
          {status.kind === "loading" ? (
            <div
              className="flex items-center justify-center gap-3 text-lg font-medium"
              aria-live="polite"
            >
              <svg
                className="h-5 w-5 animate-spin text-indigo-600 motion-reduce:animate-none dark:text-indigo-400"
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
              <span>Extracting {status.filename}</span>
            </div>
          ) : (
            <p className="text-lg font-medium" aria-live="polite">
              Drop a PDF invoice here, or click to upload
            </p>
          )}
          <p id={dropzoneHintId} className="mt-2 text-sm text-zinc-500">
            {status.kind === "loading"
              ? "Typically 4-8 seconds. Reading the PDF, sending to Claude, validating fields."
              : "Max 25 MB. Typed or scanned-with-OCR PDFs."}
          </p>
        </label>

        {status.kind === "idle" && (
          <p className="mt-3 text-center text-sm text-zinc-500">
            Don&apos;t have a PDF handy?{" "}
            <button
              type="button"
              onClick={onSampleClick}
              className="font-medium text-indigo-700 underline underline-offset-2 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              Try with a sample invoice
            </button>
            .
          </p>
        )}

        {status.kind === "idle" && <PreviewCard />}

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
            pdfUrl={status.pdfUrl}
            downloadCsv={downloadCsv}
            webhookUrl={webhookUrl}
            setWebhookUrl={setWebhookUrl}
            fireWebhook={fireWebhook}
            webhookStatus={webhookStatus}
            webhookFiring={webhookFiring}
          />
        )}

        <PrivacySection />
      </div>

      <footer className="mt-auto border-t border-zinc-200 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-x-4 gap-y-2 px-6">
          <span>
            Powered by{" "}
            <a
              className="underline underline-offset-2 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded dark:hover:text-zinc-300"
              href="https://www.anthropic.com/claude"
              target="_blank"
              rel="noreferrer"
            >
              Claude Sonnet 4.6
            </a>
          </span>
          <span aria-hidden="true">·</span>
          <a
            className="underline underline-offset-2 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded dark:hover:text-zinc-300"
            href="https://github.com/coreystevensdev/invoiceflow"
            target="_blank"
            rel="noreferrer"
          >
            Source on GitHub
          </a>
        </div>
      </footer>
    </main>
  );
}

interface ResultsViewProps {
  result: ExtractResponse;
  filename: string;
  pdfUrl: string;
  downloadCsv: (format: "summary" | "line_items") => void;
  webhookUrl: string;
  setWebhookUrl: (v: string) => void;
  fireWebhook: () => void;
  webhookStatus: string | null;
  webhookFiring: boolean;
}

type ResultView = "fields" | "json";

function ResultsView({
  result,
  filename,
  pdfUrl,
  downloadCsv,
  webhookUrl,
  setWebhookUrl,
  fireWebhook,
  webhookStatus,
  webhookFiring,
}: ResultsViewProps) {
  const webhookUrlValid = useMemo(() => {
    if (!webhookUrl) return false;
    try {
      const u = new URL(webhookUrl);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, [webhookUrl]);
  const [view, setView] = useState<ResultView>("fields");
  const inv = result.invoice;
  const summary = result.confidence_summary;
  const fieldsTabId = useId();
  const jsonTabId = useId();
  const fieldsPanelId = useId();
  const jsonPanelId = useId();

  const onTabKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      const order: ResultView[] = ["fields", "json"];
      const idIndex: Record<ResultView, string> = {
        fields: fieldsTabId,
        json: jsonTabId,
      };
      const current = order.indexOf(view);
      let next: ResultView | null = null;
      if (e.key === "ArrowRight") next = order[(current + 1) % order.length];
      else if (e.key === "ArrowLeft")
        next = order[(current - 1 + order.length) % order.length];
      else if (e.key === "Home") next = order[0];
      else if (e.key === "End") next = order[order.length - 1];
      if (next) {
        e.preventDefault();
        setView(next);
        document.getElementById(idIndex[next])?.focus();
      }
    },
    [view, fieldsTabId, jsonTabId],
  );

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
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-zinc-500">
        <span>
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {filename}
          </span>
          {", "}
          {result.pdf.num_pages} page{result.pdf.num_pages === 1 ? "" : "s"},{" "}
          {(result.duration_ms.total / 1000).toFixed(1)}s,{" "}
          {result.usage.input_tokens + result.usage.output_tokens} tokens
        </span>
        <span>
          <b className="text-green-700 dark:text-green-400">
            {summary.high} high
          </b>
          {", "}
          <b className="text-amber-700 dark:text-amber-400">
            {summary.medium} med
          </b>
          {", "}
          <b className="text-red-700 dark:text-red-400">{summary.low} low</b>
          <span className="ml-1">confidence</span>
        </span>
      </div>

      {inv.flags.length > 0 && <FlagsList flags={inv.flags} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          <iframe
            src={pdfUrl}
            title={`Original PDF: ${filename}`}
            className="h-[600px] w-full rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 lg:h-[820px]"
          />
        </div>

        <div className="min-w-0 space-y-6">
          <div
            role="tablist"
            aria-label="Extraction view"
            className="inline-flex rounded-lg border border-zinc-200 bg-white p-1 text-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <button
              type="button"
              role="tab"
              id={fieldsTabId}
              aria-selected={view === "fields"}
              aria-controls={fieldsPanelId}
              tabIndex={view === "fields" ? 0 : -1}
              onClick={() => setView("fields")}
              onKeyDown={onTabKeyDown}
              className={`rounded-md px-3 py-1.5 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                view === "fields"
                  ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              Fields
            </button>
            <button
              type="button"
              role="tab"
              id={jsonTabId}
              aria-selected={view === "json"}
              aria-controls={jsonPanelId}
              tabIndex={view === "json" ? 0 : -1}
              onClick={() => setView("json")}
              onKeyDown={onTabKeyDown}
              className={`rounded-md px-3 py-1.5 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                view === "json"
                  ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              JSON
            </button>
          </div>

          {view === "fields" ? (
            <div
              role="tabpanel"
              id={fieldsPanelId}
              aria-labelledby={fieldsTabId}
              className="space-y-6"
            >
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
              {inv.line_items.length > 0 && (
                <LineItemsTable items={inv.line_items} />
              )}
            </div>
          ) : (
            <JsonPanel
              panelId={jsonPanelId}
              tabId={jsonTabId}
              result={result}
            />
          )}
        </div>
      </div>

      <div>
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
        <p className="mt-2 text-xs text-zinc-500">
          Summary is one row per invoice (vendor, dates, totals). Line-items is
          one row per item. Both import into QuickBooks Online and Xero.
        </p>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-base font-semibold">Fire webhook</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          POST the extracted invoice JSON to your URL. Useful for testing
          downstream integrations.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
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
            disabled={!webhookUrlValid || webhookFiring}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            {webhookFiring && (
              <svg
                className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeOpacity="0.3"
                  strokeWidth="3"
                />
                <path
                  d="M22 12a10 10 0 0 1-10 10"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            )}
            <span>{webhookFiring ? "Sending" : "Send POST"}</span>
          </button>
        </div>
        {webhookUrl && !webhookUrlValid && !webhookFiring && (
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
            Enter a valid http or https URL to enable sending.
          </p>
        )}
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
      ? "-"
      : money && typeof field.value === "number"
        ? field.value.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
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
      className={`group relative ${field.reasoning ? "cursor-pointer" : ""}`}
      tabIndex={field.reasoning ? 0 : undefined}
      onKeyDown={handleKeyDown}
      onFocus={resetDismissal}
      onMouseEnter={resetDismissal}
      onClick={(e) => {
        if (field.reasoning) {
          (e.currentTarget as HTMLDivElement).focus();
        }
      }}
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
          className={`pointer-events-none absolute inset-x-0 top-full z-10 mt-1 rounded-lg bg-zinc-900 p-3 text-xs text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900 ${tooltipVisibility}`}
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
      <table className="w-full min-w-[28rem] text-sm">
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
              <td className="px-4 py-3">{li.description ?? "-"}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {li.quantity ?? "-"}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {li.unit_price != null
                  ? li.unit_price.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })
                  : "-"}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {li.amount != null
                  ? li.amount.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })
                  : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JsonPanel({
  panelId,
  tabId,
  result,
}: {
  panelId: string;
  tabId: string;
  result: ExtractResponse;
}) {
  const [copied, setCopied] = useState(false);
  const json = useMemo(() => JSON.stringify(result, null, 2), [result]);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [json]);

  return (
    <div
      role="tabpanel"
      id={panelId}
      aria-labelledby={tabId}
      className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-950 dark:border-zinc-800"
    >
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2 text-xs">
        <span className="font-mono text-zinc-400">api/extract response</span>
        <button
          type="button"
          onClick={onCopy}
          className="rounded-md border border-zinc-700 px-2 py-1 font-medium text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-live="polite"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-[820px] overflow-auto p-4 text-xs leading-relaxed text-zinc-100">
        <code>{json}</code>
      </pre>
    </div>
  );
}

const PREVIEW_FIELDS: ReadonlyArray<{ label: string; value: string }> = [
  { label: "Invoice #", value: "INV-2026-0042" },
  { label: "Vendor", value: "Acme Office Supplies, LLC" },
  { label: "Bill date", value: "2026-04-15" },
  { label: "Due date", value: "2026-05-15" },
  { label: "Subtotal", value: "2,007.00" },
  { label: "Total", value: "2,167.56" },
];

function PreviewCard() {
  return (
    <section
      aria-label="Example extraction output"
      className="mt-8 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <p className="text-xs uppercase tracking-wide text-zinc-500">
        What comes back
      </p>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        {PREVIEW_FIELDS.map((f) => (
          <div key={f.label}>
            <dt className="text-xs uppercase tracking-wide text-zinc-500">
              {f.label}
            </dt>
            <dd className="mt-1 text-lg font-medium text-zinc-900 dark:text-zinc-100">
              {f.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-5 text-xs text-zinc-500">
        Plus line items, currency, confidence flags, and reasoning per field.
      </p>
    </section>
  );
}
