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
import { deterministicFlags, mergeFlags } from "@/lib/validate";
import {
  CUSTOM_FIELD_LIMITS,
  loadCustomFields,
  saveCustomFields,
  type CustomField,
  type CustomFieldType,
} from "@/lib/custom-fields";
import { ErrorState } from "@/components/error-state";
import { PdfPreview } from "@/components/pdf-preview";
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
    }
  | { kind: "batch"; files: BatchFile[] };

type BatchFile =
  | { kind: "queued"; id: string; filename: string; size: number }
  | { kind: "loading"; id: string; filename: string; size: number }
  | {
      kind: "success";
      id: string;
      filename: string;
      result: ExtractResponse;
    }
  | {
      kind: "error";
      id: string;
      filename: string;
      code: ExtractionErrorCode;
      correlation_id?: string;
    };

interface ErrorBody {
  error?: string;
  code?: ExtractionErrorCode;
  correlation_id?: string;
  retry_after_seconds?: number;
  detected?: Record<string, unknown>;
}

type WebhookStatus = {
  kind: "ok" | "upstream-error" | "api-error";
  message: string;
};

export default function Home() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [isDragging, setIsDragging] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookStatus, setWebhookStatus] = useState<WebhookStatus | null>(
    null,
  );
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropzoneHintId = useId();

  // Load custom fields from localStorage after mount. Doing this in an
  // effect (not the useState initializer) keeps SSR consistent: the server
  // and first client render both see [], then the client hydrates from
  // localStorage on the next paint. The react-hooks/set-state-in-effect
  // rule fires here, but this is the documented hydration-from-external-
  // store pattern; the alternative (useSyncExternalStore with a custom
  // subscribe layer) is overkill for a localStorage list.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCustomFields(loadCustomFields());
  }, []);

  // Persist on every change. Bypasses the initial mount (length === 0)
  // unless the user had something previously saved and is now clearing it.
  // Tracking that edge case isn't worth the ref-based "is-this-the-first-
  // run" dance; writing [] on first mount is harmless.
  useEffect(() => {
    saveCustomFields(customFields);
  }, [customFields]);

  const handleFile = useCallback(
    async (file: File) => {
      setStatus((prev) => {
        if (prev.kind === "success") URL.revokeObjectURL(prev.pdfUrl);
        return { kind: "loading", filename: file.name };
      });
      setWebhookStatus(null);
      const form = new FormData();
      form.append("pdf", file);
      if (customFields.length > 0) {
        form.append("custom_fields", JSON.stringify(customFields));
      }
      try {
        const res = await fetch("/api/extract", {
          method: "POST",
          body: form,
        });
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
        setStatus({
          kind: "success",
          result: data,
          filename: file.name,
          pdfUrl,
        });
      } catch (err) {
        // Network failure (offline, DNS, CORS, function cold-start timeout)
        // or response-body parse failure. Without this catch, the promise
        // rejects unhandled and status stays in "loading" indefinitely. Map
        // all such failures to model-API-failure so the same ErrorState
        // handles them and the user gets a retry path instead of a frozen
        // spinner.
        console.error("[handleFile] extraction request failed:", err);
        setStatus({ kind: "error", code: "model-API-failure" });
      }
    },
    [customFields],
  );

  // Bulk-upload runner. Drains the file queue with bounded concurrency so we
  // don't saturate Anthropic's per-IP rate limits or the per-instance extract
  // quota. Each file's lifecycle (queued → loading → success/error) is
  // tracked independently in the batch state, so partial failures don't kill
  // the rest of the batch. The CONCURRENCY constant trades total wall-clock
  // (lower = serial, slow) against rate-limit pressure (higher = burst, may
  // trip 429s on large batches).
  const runBatch = useCallback(async (files: File[]) => {
    const initial: BatchFile[] = files.map((f) => ({
      kind: "queued",
      id: crypto.randomUUID(),
      filename: f.name,
      size: f.size,
    }));
    setStatus((prev) => {
      if (prev.kind === "success") URL.revokeObjectURL(prev.pdfUrl);
      return { kind: "batch", files: initial };
    });
    setWebhookStatus(null);

    const updateFile = (id: string, next: BatchFile) => {
      setStatus((prev) => {
        if (prev.kind !== "batch") return prev;
        return {
          kind: "batch",
          files: prev.files.map((f) => (f.id === id ? next : f)),
        };
      });
    };

    const fileById = new Map(initial.map((f, i) => [f.id, files[i]]));
    const queue = [...initial];
    const CONCURRENCY = 3;

    const processOne = async (entry: BatchFile) => {
      const file = fileById.get(entry.id);
      if (!file) return;
      updateFile(entry.id, {
        kind: "loading",
        id: entry.id,
        filename: entry.filename,
        size: file.size,
      });
      try {
        const form = new FormData();
        form.append("pdf", file);
        if (customFields.length > 0) {
          form.append("custom_fields", JSON.stringify(customFields));
        }
        const res = await fetch("/api/extract", {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const body: ErrorBody = await res.json().catch(() => ({}));
          updateFile(entry.id, {
            kind: "error",
            id: entry.id,
            filename: entry.filename,
            code: body.code ?? "model-API-failure",
            correlation_id: body.correlation_id,
          });
          return;
        }
        const data = (await res.json()) as ExtractResponse;
        updateFile(entry.id, {
          kind: "success",
          id: entry.id,
          filename: entry.filename,
          result: data,
        });
      } catch (err) {
        console.error(`[runBatch] ${entry.filename} failed:`, err);
        updateFile(entry.id, {
          kind: "error",
          id: entry.id,
          filename: entry.filename,
          code: "model-API-failure",
        });
      }
    };

    const worker = async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next) await processOne(next);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker),
    );
  }, [customFields]);

  // Route file selection: 1 file → rich single-file flow with inline edits,
  // PDF preview, JSON view, webhook test. >1 → batch flow with summary
  // table and bulk CSV. Same dropzone, two destinations.
  const dispatchFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      if (files.length === 1) handleFile(files[0]);
      else runBatch(files);
    },
    [handleFile, runBatch],
  );

  useEffect(() => {
    return () => {
      if (status.kind === "success") URL.revokeObjectURL(status.pdfUrl);
    };
  }, [status]);

  useEffect(() => {
    if (status.kind !== "success") return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    document
      .querySelector('section[aria-label="Extraction results"]')
      ?.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start",
      });
  }, [status.kind]);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      setIsDragging(false);
      dispatchFiles(Array.from(e.dataTransfer.files));
    },
    [dispatchFiles],
  );

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      dispatchFiles(Array.from(e.target.files ?? []));
      // Clear the input value so picking the same file again still fires
      // onChange. Without this, browsers skip the event when input.files
      // doesn't change, blocking 'upload the same file again' flows.
      e.target.value = "";
    },
    [dispatchFiles],
  );

  const onSampleClick = useCallback(async () => {
    try {
      const res = await fetch("/sample-invoice.pdf");
      if (!res.ok) return;
      const blob = await res.blob();
      const file = new File([blob], "sample-invoice.pdf", {
        type: "application/pdf",
      });
      await handleFile(file);
    } catch (err) {
      console.error("[onSampleClick] fetch failed:", err);
    }
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
    async (
      format: "summary" | "line_items",
      invoice: InvoiceExtraction,
    ) => {
      try {
        const res = await fetch("/api/csv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ format, invoices: [invoice] }),
        });
        if (!res.ok) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `invoiceflow-${format}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        // Network failure during CSV export. No status UI exists for this
        // surface, so log and let the user retry. Without the catch this
        // would surface as an unhandled promise rejection.
        console.error("[downloadCsv] export failed:", err);
      }
    },
    [],
  );

  const [webhookFiring, setWebhookFiring] = useState(false);

  const fireWebhook = useCallback(
    async (invoice: InvoiceExtraction) => {
      if (webhookFiring) return;
      setWebhookFiring(true);
      setWebhookStatus(null);
      try {
        const res = await fetch("/api/webhook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            webhook_url: webhookUrl,
            invoice,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          status?: number;
          duration_ms?: number;
          error?: string;
        };
        if (res.ok && typeof data.status === "number") {
          const upstreamOk = data.status >= 200 && data.status < 300;
          const ms = data.duration_ms ?? 0;
          setWebhookStatus({
            kind: upstreamOk ? "ok" : "upstream-error",
            message: upstreamOk
              ? `Sent, upstream responded ${data.status} in ${ms}ms.`
              : `Sent, but upstream responded ${data.status} in ${ms}ms.`,
          });
        } else {
          setWebhookStatus({
            kind: "api-error",
            message: `Failed, ${data.error ?? "unknown reason"}.`,
          });
        }
      } catch (err) {
        console.error("[fireWebhook] request failed:", err);
        setWebhookStatus({
          kind: "api-error",
          message: "Network error: could not reach the server.",
        });
      } finally {
        setWebhookFiring(false);
      }
    },
    [webhookUrl, webhookFiring],
  );

  // Dropzone is "busy" during single-file extraction OR while a batch still
  // has queued/loading files. Once every batch file is success-or-error,
  // the dropzone becomes interactive again so the user can run another batch.
  const dropzoneBusy =
    status.kind === "loading" ||
    (status.kind === "batch" &&
      status.files.some(
        (f) => f.kind === "queued" || f.kind === "loading",
      ));
  const batchInProgress = status.kind === "batch" && dropzoneBusy;
  const batchSummary =
    status.kind === "batch"
      ? {
          total: status.files.length,
          done: status.files.filter(
            (f) => f.kind === "success" || f.kind === "error",
          ).length,
          succeeded: status.files.filter((f) => f.kind === "success").length,
          failed: status.files.filter((f) => f.kind === "error").length,
        }
      : null;

  return (
    <main
      id="main-content"
      className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
    >
      <div className="mx-auto max-w-4xl px-6 py-16">
        <header className="mb-8">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <svg
              width="20"
              height="20"
              viewBox="0 0 40 40"
              fill="none"
              aria-hidden="true"
              className="shrink-0"
            >
              <rect
                x="11"
                y="7"
                width="18"
                height="26"
                rx="2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
              <line
                x1="14"
                y1="13"
                x2="26"
                y2="13"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <line
                x1="14"
                y1="18"
                x2="26"
                y2="18"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <line
                x1="14"
                y1="23"
                x2="22"
                y2="23"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <circle cx="26" cy="27" r="2.5" fill="currentColor" />
            </svg>
            InvoiceFlow
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            PDF invoices, structured by Claude. About five seconds, no login,
            no retention.
          </p>
        </header>

        <label
          htmlFor="pdf-input"
          role="button"
          tabIndex={dropzoneBusy ? -1 : 0}
          aria-label="Upload a PDF or image of an invoice. Press Enter or Space to open the file picker, or drop a file onto this area."
          aria-describedby={dropzoneHintId}
          aria-disabled={dropzoneBusy}
          onKeyDown={(e) => {
            if (dropzoneBusy) return;
            onDropzoneKey(e);
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            if (dropzoneBusy) return;
            setIsDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (dropzoneBusy) return;
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            if (dropzoneBusy) {
              e.preventDefault();
              return;
            }
            onDrop(e);
          }}
          onClick={(e) => {
            if (dropzoneBusy) e.preventDefault();
          }}
          className={`block rounded-xl border-2 border-dashed p-12 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 dark:focus-visible:ring-offset-zinc-950 ${
            dropzoneBusy
              ? "cursor-wait border-zinc-300 bg-white opacity-90 dark:border-zinc-700 dark:bg-zinc-900"
              : isDragging
                ? "cursor-pointer border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30"
                : "cursor-pointer border-zinc-300 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-500"
          }`}
        >
          <input
            id="pdf-input"
            ref={inputRef}
            type="file"
            multiple
            accept="application/pdf,.pdf,image/jpeg,image/png,image/gif,image/webp,.jpg,.jpeg,.png,.gif,.webp"
            onChange={onChange}
            className="sr-only"
            tabIndex={-1}
            aria-describedby={dropzoneHintId}
          />
          {status.kind === "loading" || batchInProgress ? (
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
              <span>
                {status.kind === "loading"
                  ? `Extracting ${status.filename}`
                  : `Extracting batch (${batchSummary?.done ?? 0} of ${batchSummary?.total ?? 0})`}
              </span>
            </div>
          ) : (
            <p className="text-lg font-medium" aria-live="polite">
              Drop one or more PDFs or images here, or click to upload
            </p>
          )}
          <p id={dropzoneHintId} className="mt-2 text-sm text-zinc-500">
            {status.kind === "loading"
              ? `Typically 4-8 seconds. Reading the ${
                  /\.(jpe?g|png|gif|webp)$/i.test(status.filename)
                    ? "image"
                    : "PDF"
                }, sending to Claude, validating fields.`
              : batchInProgress
                ? `Up to 3 in parallel. Failed files don't stop the batch.`
                : "PDF (up to 25 MB) or image (JPG, PNG, GIF, WebP, up to 3.5 MB). Drop multiple to batch-extract."}
          </p>
        </label>

        {(status.kind === "idle" || status.kind === "error") && (
          <p className="mt-3 text-center text-sm text-zinc-500">
            {status.kind === "error"
              ? "Or try with a known-good sample: "
              : "Don't have a PDF handy? "}
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

        {status.kind === "idle" && (
          <>
            <PreviewCard />
            <CustomFieldsManager
              fields={customFields}
              onChange={setCustomFields}
            />
          </>
        )}

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
            key={status.pdfUrl}
            result={status.result}
            filename={status.filename}
            pdfUrl={status.pdfUrl}
            customFields={customFields}
            downloadCsv={downloadCsv}
            webhookUrl={webhookUrl}
            setWebhookUrl={setWebhookUrl}
            fireWebhook={fireWebhook}
            webhookStatus={webhookStatus}
            webhookFiring={webhookFiring}
          />
        )}

        {status.kind === "batch" && (
          <BatchView
            files={status.files}
            inProgress={batchInProgress}
            onReset={() => setStatus({ kind: "idle" })}
          />
        )}

        <PrivacySection />
      </div>

      <footer className="mt-auto border-t border-zinc-200 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-y-2 px-6">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <span>
              Powered by{" "}
              <a
                className="underline underline-offset-2 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded dark:hover:text-zinc-300"
                href="https://www.anthropic.com/claude"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Claude Sonnet 4.6 (opens in a new tab)"
              >
                Claude Sonnet 4.6
              </a>
            </span>
            <span aria-hidden="true">·</span>
            <a
              className="underline underline-offset-2 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded dark:hover:text-zinc-300"
              href="https://github.com/coreystevensdev/invoiceflow"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Source on GitHub (opens in a new tab)"
            >
              Source on GitHub
            </a>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <span>
              By{" "}
              <a
                className="underline underline-offset-2 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded dark:hover:text-zinc-300"
                href="https://github.com/coreystevensdev"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Corey Stevens on GitHub (opens in a new tab)"
              >
                Corey Stevens
              </a>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Sister project:{" "}
              <a
                className="underline underline-offset-2 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded dark:hover:text-zinc-300"
                href="https://github.com/coreystevensdev/tellsight"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Tellsight on GitHub (opens in a new tab)"
              >
                Tellsight
              </a>
            </span>
          </div>
        </div>
      </footer>
    </main>
  );
}

interface ResultsViewProps {
  result: ExtractResponse;
  filename: string;
  pdfUrl: string;
  customFields: CustomField[];
  downloadCsv: (
    format: "summary" | "line_items",
    invoice: InvoiceExtraction,
  ) => void;
  webhookUrl: string;
  setWebhookUrl: (v: string) => void;
  fireWebhook: (invoice: InvoiceExtraction) => void;
  webhookStatus: WebhookStatus | null;
  webhookFiring: boolean;
}

type ResultView = "fields" | "json";

function ResultsView({
  result,
  filename,
  pdfUrl,
  customFields,
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
  // The parent passes key={pdfUrl} so a new extraction remounts this
  // component with fresh useState initializers. That resets not just the
  // local state below but every descendant's state too (FieldRow.isEditing,
  // EditableCell.isEditing); a prev-props sentinel here couldn't reach
  // those.
  const [view, setView] = useState<ResultView>("fields");
  const [edited, setEdited] = useState<InvoiceExtraction>(result.invoice);
  const [activeBbox, setActiveBbox] = useState<number[] | null>(null);
  const [pdfBboxMap, setPdfBboxMap] = useState<Record<string, number[]>>({});
  const handlePdfBboxes = useCallback((map: Record<string, number[]>) => {
    setPdfBboxMap(map);
  }, []);
  const isImage = result.input_type === "image";
  // True when extraction used Claude vision (image input or scanned-PDF
  // fallback). Determines bbox source: vision-derived (parsed from each
  // field's reasoning prefix) vs text-derived (PdfPreview's text-item
  // matching, only valid when the PDF has an extractable text layer).
  const useVisionBboxes = result.vision_used;
  const inv = edited;
  const summary = result.confidence_summary;
  const fieldsTabId = useId();
  const jsonTabId = useId();
  const fieldsPanelId = useId();
  const jsonPanelId = useId();
  const webhookHelpId = useId();
  const webhookUrlError = webhookUrl !== "" && !webhookUrlValid;

  // Flags are merged server-side from the model's flags + a deterministic pass
  // (math, dates, vendor presence). Inline edits change those fundamentals, so
  // re-run the deterministic pass on the edited invoice and merge with the
  // model-only subset of the original flag list. Without this, fixing a bad
  // amount in the line items leaves a stale "line items don't match subtotal"
  // warning until the next upload.
  const displayFlags = useMemo(() => {
    const originalDet = deterministicFlags(result.invoice);
    const detKeys = new Set(
      originalDet.map((f) => `${f.severity}:${f.message}`),
    );
    const modelOnly = result.invoice.flags.filter(
      (f) => !detKeys.has(`${f.severity}:${f.message}`),
    );
    return mergeFlags(modelOnly, deterministicFlags(edited));
  }, [result.invoice, edited]);

  // Single source of truth for downstream consumers (JSON panel, CSV export,
  // webhook payload): edited values plus live-recomputed flags. Keep `edited`
  // separate so the "edited" sentinel and field rendering stay ref-stable.
  const displayInvoice = useMemo<InvoiceExtraction>(
    () => ({ ...edited, flags: displayFlags }),
    [edited, displayFlags],
  );

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

  const fields = useMemo<FieldDef[]>(() => {
    const wrap = <T extends FieldLike>(f: T) => {
      const { bbox, text } = parseBboxFromReasoning(f.reasoning);
      return { field: { ...f, reasoning: text }, bbox };
    };
    const inv_num = wrap(inv.invoice_number);
    const vendor = wrap({
      value: inv.vendor.name,
      confidence: inv.vendor.confidence,
      reasoning: inv.vendor.reasoning,
    });
    const bill_date = wrap(inv.bill_date);
    const due_date = wrap(inv.due_date);
    const po_number = wrap(inv.po_number);
    const subtotal = wrap(inv.subtotal);
    const tax = wrap(inv.tax);
    const total = wrap(inv.total);
    const currency = wrap(inv.currency);
    return [
      {
        label: "Invoice #",
        ...inv_num,
        onSave: (v) =>
          setEdited((prev) => ({
            ...prev,
            invoice_number: {
              ...prev.invoice_number,
              value: v as string | null,
            },
          })),
      },
      {
        label: "Vendor",
        ...vendor,
        onSave: (v) =>
          setEdited((prev) => ({
            ...prev,
            vendor: { ...prev.vendor, name: v as string | null },
          })),
      },
      {
        label: "Bill date",
        ...bill_date,
        onSave: (v) =>
          setEdited((prev) => ({
            ...prev,
            bill_date: { ...prev.bill_date, value: v as string | null },
          })),
      },
      {
        label: "Due date",
        ...due_date,
        onSave: (v) =>
          setEdited((prev) => ({
            ...prev,
            due_date: { ...prev.due_date, value: v as string | null },
          })),
      },
      {
        label: "PO #",
        ...po_number,
        onSave: (v) =>
          setEdited((prev) => ({
            ...prev,
            po_number: { ...prev.po_number, value: v as string | null },
          })),
      },
      {
        label: "Subtotal",
        ...subtotal,
        money: true,
        onSave: (v) =>
          setEdited((prev) => ({
            ...prev,
            subtotal: {
              ...prev.subtotal,
              value: typeof v === "number" ? v : null,
            },
          })),
      },
      {
        label: "Tax",
        ...tax,
        money: true,
        onSave: (v) =>
          setEdited((prev) => ({
            ...prev,
            tax: {
              ...prev.tax,
              value: typeof v === "number" ? v : null,
            },
          })),
      },
      {
        label: "Total",
        ...total,
        money: true,
        onSave: (v) =>
          setEdited((prev) => ({
            ...prev,
            total: {
              ...prev.total,
              value: typeof v === "number" ? v : null,
            },
          })),
      },
      {
        label: "Currency",
        ...currency,
        onSave: (v) =>
          setEdited((prev) => ({
            ...prev,
            currency: { ...prev.currency, value: v as string | null },
          })),
      },
      // User-defined custom fields, appended after the standard nine. Skip
      // any whose definition was deleted from localStorage but whose value
      // still lives in the result, and any whose value the model didn't
      // populate (extracted: false / undefined). The label uses the user's
      // current display name from localStorage; the response key is the
      // stable id so name changes don't lose data.
      ...customFields.flatMap<FieldDef>((cf) => {
        const ext = inv.custom_fields?.[cf.id];
        if (!ext) return [];
        const { bbox, text } = parseBboxFromReasoning(ext.reasoning);
        const isMoney = false;
        return [
          {
            label: cf.name.trim() || cf.id,
            field: {
              value: ext.value,
              confidence: ext.confidence,
              reasoning: text,
            },
            bbox,
            money: isMoney,
            onSave: (v) =>
              setEdited((prev) => ({
                ...prev,
                custom_fields: {
                  ...(prev.custom_fields ?? {}),
                  [cf.id]: {
                    value: v,
                    confidence:
                      prev.custom_fields?.[cf.id]?.confidence ??
                      ext.confidence,
                    reasoning:
                      prev.custom_fields?.[cf.id]?.reasoning ??
                      ext.reasoning,
                  },
                },
              })),
          },
        ];
      }),
    ];
  }, [inv, customFields]);

  return (
    <section className="mt-8 space-y-6" aria-label="Extraction results">
      <div
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-zinc-500"
        role="status"
        aria-live="polite"
      >
        <span>
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {filename}
          </span>
          {", "}
          {result.pdf.num_pages} page{result.pdf.num_pages === 1 ? "" : "s"},{" "}
          {(result.duration_ms.total / 1000).toFixed(1)}s
          {result.cost_usd != null && (
            <>
              {", "}
              {`$${result.cost_usd.toFixed(3)}`}
            </>
          )}
          {edited !== result.invoice && (
            <>
              {" · "}
              <span className="text-amber-700 dark:text-amber-400">edited</span>
              {" · "}
              <button
                type="button"
                onClick={() => {
                  setEdited(result.invoice);
                  setActiveBbox(null);
                }}
                className="underline underline-offset-2 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded dark:hover:text-zinc-300"
              >
                Reset
              </button>
            </>
          )}
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

      {displayFlags.length > 0 && <FlagsList flags={displayFlags} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          {isImage ? (
            <div className="relative">
              {/* Disable Next/Image lint rule - blob URLs don't go through next/image. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pdfUrl}
                alt={`Original invoice: ${filename}`}
                className="w-full rounded-xl border border-zinc-200 bg-white dark:border-zinc-800"
              />
              {activeBbox && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute rounded border-2 border-indigo-500 bg-indigo-500/15 shadow-[0_0_0_3px_rgba(99,102,241,0.2)] transition-all duration-150 motion-reduce:transition-none"
                  style={{
                    left: `${activeBbox[0] * 100}%`,
                    top: `${activeBbox[1] * 100}%`,
                    width: `${activeBbox[2] * 100}%`,
                    height: `${activeBbox[3] * 100}%`,
                  }}
                />
              )}
            </div>
          ) : (
            <PdfPreview
              key={pdfUrl}
              pdfUrl={pdfUrl}
              filename={filename}
              invoice={inv}
              activeBbox={activeBbox}
              onBboxesComputed={handlePdfBboxes}
            />
          )}
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
            >
              <dl className="grid gap-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-2">
                {fields.map((f) => {
                  const bboxForField = useVisionBboxes
                    ? f.bbox
                    : (pdfBboxMap[f.label] ?? null);
                  return (
                    <FieldRow
                      key={f.label}
                      label={f.label}
                      field={f.field}
                      money={f.money}
                      onSave={f.onSave}
                      onActivate={
                        bboxForField
                          ? () => setActiveBbox(bboxForField)
                          : undefined
                      }
                      onDeactivate={
                        bboxForField ? () => setActiveBbox(null) : undefined
                      }
                    />
                  );
                })}
              </dl>
            </div>
          ) : (
            <JsonPanel
              panelId={jsonPanelId}
              tabId={jsonTabId}
              result={{ ...result, invoice: displayInvoice }}
            />
          )}
        </div>
      </div>

      {view === "fields" && inv.line_items.length > 0 && (
        <LineItemsTable
          items={inv.line_items}
          onChange={(index, field, value) => {
            setEdited((prev) => {
              const next = prev.line_items.map((li, i) => {
                if (i !== index) return li;
                if (field === "description") {
                  return { ...li, description: value as string | null };
                }
                return {
                  ...li,
                  [field]: typeof value === "number" ? value : null,
                };
              });
              return { ...prev, line_items: next };
            });
          }}
        />
      )}

      <div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => downloadCsv("summary", displayInvoice)}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Download summary CSV
          </button>
          <button
            type="button"
            onClick={() => downloadCsv("line_items", displayInvoice)}
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
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://api.example.com/webhooks/invoiceflow"
            aria-invalid={webhookUrlError ? true : undefined}
            aria-describedby={webhookUrlError ? webhookHelpId : undefined}
            className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-950"
          />
          <button
            type="button"
            onClick={() => fireWebhook(displayInvoice)}
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
        {webhookUrlError && !webhookFiring && (
          <p
            id={webhookHelpId}
            className="mt-2 text-sm text-amber-700 dark:text-amber-400"
          >
            Enter a valid http or https URL to enable sending.
          </p>
        )}
        {webhookStatus && (
          <p
            className={`mt-2 text-sm ${
              webhookStatus.kind === "ok"
                ? "text-green-700 dark:text-green-400"
                : webhookStatus.kind === "upstream-error"
                  ? "text-amber-700 dark:text-amber-400"
                  : "text-red-700 dark:text-red-400"
            }`}
            role="status"
            aria-live="polite"
          >
            {webhookStatus.message}
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

type Bbox = number[];

type FieldDef = {
  label: string;
  field: FieldLike;
  money?: boolean;
  bbox: Bbox | null;
  onSave: (value: string | number | null) => void;
};

const BBOX_PATTERN = /^\[bbox:\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\]\s*/;
const BBOX_NONE_PATTERN = /^\[bbox:\s*none\s*\]\s*/i;

function parseBboxFromReasoning(reasoning: string): {
  bbox: Bbox | null;
  text: string;
} {
  if (BBOX_NONE_PATTERN.test(reasoning)) {
    return { bbox: null, text: reasoning.replace(BBOX_NONE_PATTERN, "") };
  }
  const m = reasoning.match(BBOX_PATTERN);
  if (!m) return { bbox: null, text: reasoning };
  const bbox = [
    Number.parseFloat(m[1]),
    Number.parseFloat(m[2]),
    Number.parseFloat(m[3]),
    Number.parseFloat(m[4]),
  ];
  const text = reasoning.replace(BBOX_PATTERN, "");
  if (bbox.some((n) => !Number.isFinite(n))) {
    return { bbox: null, text };
  }
  // Coordinates are normalized to [0, 1] per the prompt contract. Allow a
  // small tolerance for model imprecision; reject values that are wildly
  // out of range (would render the overlay far outside the image bounds).
  if (bbox.some((n) => n < -0.1 || n > 1.1)) {
    return { bbox: null, text };
  }
  return { bbox, text };
}

function FieldRow({
  label,
  field,
  money,
  onSave,
  onActivate,
  onDeactivate,
}: {
  label: string;
  field: FieldLike;
  money?: boolean;
  onSave: (value: string | number | null) => void;
  onActivate?: () => void;
  onDeactivate?: () => void;
}) {
  const reasoningId = useId();
  const inputId = useId();
  const [escapeDismissed, setEscapeDismissed] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const display =
    field.value === null || field.value === undefined
      ? "-"
      : money && typeof field.value === "number"
        ? field.value.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : String(field.value);

  const draftFromField = () => {
    if (field.value === null || field.value === undefined) return "";
    if (money && typeof field.value === "number") {
      return field.value.toFixed(2);
    }
    return String(field.value);
  };

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

  const startEditing = () => {
    setDraft(draftFromField());
    setIsEditing(true);
  };

  useEffect(() => {
    if (isEditing) inputRef.current?.select();
  }, [isEditing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (money) {
      if (trimmed === "") {
        onSave(null);
      } else {
        const cleaned = trimmed.replace(/,/g, "");
        const parsed = Number.parseFloat(cleaned);
        if (Number.isFinite(parsed)) onSave(parsed);
      }
    } else {
      onSave(trimmed === "" ? null : trimmed);
    }
    setIsEditing(false);
  };

  const cancel = () => setIsEditing(false);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && field.reasoning && !escapeDismissed) {
      event.stopPropagation();
      setEscapeDismissed(true);
    }
  };

  const resetDismissal = () => {
    if (escapeDismissed) setEscapeDismissed(false);
  };

  const tooltipVisibility =
    escapeDismissed || isEditing
      ? "hidden"
      : "hidden group-hover:block group-focus-within:block";

  return (
    <div
      className="group relative"
      onKeyDown={handleKeyDown}
      onFocus={() => {
        resetDismissal();
        onActivate?.();
      }}
      onBlur={() => onDeactivate?.()}
      onMouseEnter={() => {
        resetDismissal();
        onActivate?.();
      }}
      onMouseLeave={() => onDeactivate?.()}
    >
      <dt className="text-xs uppercase tracking-wide text-zinc-500">
        <label htmlFor={inputId}>{label}</label>
      </dt>
      {isEditing ? (
        <dd className="mt-1 text-lg font-medium">
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancel();
              }
            }}
            inputMode={money ? "decimal" : "text"}
            spellCheck={false}
            className="w-full rounded-md border border-indigo-400 bg-white px-2 py-1 text-lg font-medium text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-indigo-500 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </dd>
      ) : (
        <dd className="mt-1 flex items-center gap-2 text-lg font-medium">
          <button
            id={inputId}
            type="button"
            onClick={startEditing}
            className="rounded text-left hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            aria-label={`${label}, ${display}. Click to edit.`}
            aria-describedby={field.reasoning ? reasoningId : undefined}
          >
            {display}
          </button>
          <span
            aria-hidden="true"
            className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] leading-none text-white ${dotColor}`}
          >
            {confidenceGlyph}
          </span>
          <span className="sr-only">{confidenceWord} confidence.</span>
        </dd>
      )}
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

type LineItem = InvoiceExtraction["line_items"][number];
type LineItemKey = "description" | "quantity" | "unit_price" | "amount";

function formatMoney(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function LineItemsTable({
  items,
  onChange,
}: {
  items: LineItem[];
  onChange: (
    index: number,
    field: LineItemKey,
    value: string | number | null,
  ) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="w-full text-sm sm:min-w-[28rem]">
        <caption className="sr-only">
          Extracted line items. Click any cell to edit.
        </caption>
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
              <EditableCell
                value={li.description ?? null}
                kind="text"
                ariaLabel={`Description, row ${i + 1}`}
                onSave={(v) => onChange(i, "description", v)}
              />
              <EditableCell
                value={li.quantity ?? null}
                kind="number"
                align="right"
                ariaLabel={`Quantity, row ${i + 1}`}
                onSave={(v) => onChange(i, "quantity", v)}
              />
              <EditableCell
                value={li.unit_price ?? null}
                kind="money"
                align="right"
                ariaLabel={`Unit price, row ${i + 1}`}
                onSave={(v) => onChange(i, "unit_price", v)}
              />
              <EditableCell
                value={li.amount ?? null}
                kind="money"
                align="right"
                ariaLabel={`Amount, row ${i + 1}`}
                onSave={(v) => onChange(i, "amount", v)}
              />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EditableCell({
  value,
  kind,
  align,
  ariaLabel,
  onSave,
}: {
  value: string | number | null;
  kind: "text" | "number" | "money";
  align?: "right";
  ariaLabel: string;
  onSave: (value: string | number | null) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const display =
    value === null || value === undefined
      ? "-"
      : kind === "money" && typeof value === "number"
        ? formatMoney(value)
        : String(value);

  const draftFromValue = () => {
    if (value === null || value === undefined) return "";
    if (kind === "money" && typeof value === "number") return value.toFixed(2);
    return String(value);
  };

  const startEditing = () => {
    setDraft(draftFromValue());
    setIsEditing(true);
  };

  useEffect(() => {
    if (isEditing) inputRef.current?.select();
  }, [isEditing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (kind === "text") {
      onSave(trimmed === "" ? null : trimmed);
    } else {
      if (trimmed === "") {
        onSave(null);
      } else {
        const cleaned = trimmed.replace(/,/g, "");
        const parsed = Number.parseFloat(cleaned);
        if (Number.isFinite(parsed)) onSave(parsed);
      }
    }
    setIsEditing(false);
  };

  const alignClass = align === "right" ? "text-right" : "text-left";

  return (
    <td className={`px-4 py-3 ${alignClass}`}>
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          inputMode={kind === "text" ? "text" : "decimal"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setIsEditing(false);
            }
          }}
          spellCheck={false}
          aria-label={ariaLabel}
          className={`w-full rounded-md border border-indigo-400 bg-white px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-indigo-500 dark:bg-zinc-950 dark:text-zinc-100 ${
            kind === "text" ? "text-left" : "text-right tabular-nums"
          }`}
        />
      ) : (
        <button
          type="button"
          onClick={startEditing}
          aria-label={`${ariaLabel}, ${display}. Click to edit.`}
          className={`rounded text-inherit hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
            kind === "text" ? "text-left" : "tabular-nums"
          }`}
        >
          {display}
        </button>
      )}
    </td>
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
        <div className="flex items-center gap-2">
          {/* Visually-hidden live region announces success without changing
              the button's accessible name (which stays stable as "Copy JSON
              to clipboard"). aria-live on the button itself would re-announce
              the new label every state flip, which is jarring mid-click. */}
          <span role="status" className="sr-only">
            {copied ? "JSON copied to clipboard" : ""}
          </span>
          <button
            type="button"
            onClick={onCopy}
            aria-label="Copy JSON to clipboard"
            className="rounded-md border border-zinc-700 px-2 py-1 font-medium text-zinc-200 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
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

function CustomFieldsManager({
  fields,
  onChange,
}: {
  fields: CustomField[];
  onChange: (next: CustomField[]) => void;
}) {
  const summaryId = useId();
  const atLimit = fields.length >= CUSTOM_FIELD_LIMITS.maxFields;

  const addField = () => {
    if (atLimit) return;
    onChange([
      ...fields,
      {
        id: crypto.randomUUID(),
        name: "",
        type: "string",
        description: "",
      },
    ]);
  };

  const updateField = (id: string, patch: Partial<CustomField>) => {
    onChange(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const removeField = (id: string) => {
    onChange(fields.filter((f) => f.id !== id));
  };

  const validateField = (f: CustomField) => {
    const issues: string[] = [];
    const trimmedName = f.name.trim();
    const trimmedDesc = f.description.trim();
    if (trimmedName.length < CUSTOM_FIELD_LIMITS.nameMin) {
      issues.push("name required");
    } else if (trimmedName.length > CUSTOM_FIELD_LIMITS.nameMax) {
      issues.push(`name ≤ ${CUSTOM_FIELD_LIMITS.nameMax} chars`);
    }
    if (trimmedDesc.length < CUSTOM_FIELD_LIMITS.descriptionMin) {
      issues.push(
        `description ≥ ${CUSTOM_FIELD_LIMITS.descriptionMin} chars`,
      );
    } else if (trimmedDesc.length > CUSTOM_FIELD_LIMITS.descriptionMax) {
      issues.push(
        `description ≤ ${CUSTOM_FIELD_LIMITS.descriptionMax} chars`,
      );
    }
    return issues;
  };

  return (
    <details className="mt-4 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <summary
        id={summaryId}
        className="cursor-pointer select-none px-6 py-4 text-sm font-medium text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded-xl dark:text-zinc-100"
      >
        Custom fields{" "}
        <span className="text-zinc-500 dark:text-zinc-400">
          ({fields.length}
          {fields.length > 0 ? ` defined` : " — add fields beyond the standard 9"}
          )
        </span>
      </summary>
      <div className="border-t border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <p className="mb-3 text-xs text-zinc-600 dark:text-zinc-400">
          Tell Claude to extract additional fields beyond the standard nine
          (cost center, GL code, project number, anything domain-specific).
          Definitions are stored in your browser only and sent with each
          extraction request. Up to {CUSTOM_FIELD_LIMITS.maxFields} fields.
        </p>

        {fields.length === 0 && (
          <p className="mb-3 text-xs italic text-zinc-500">
            No custom fields yet.
          </p>
        )}

        <ul className="space-y-3">
          {fields.map((f) => {
            const issues = validateField(f);
            return (
              <li
                key={f.id}
                className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <CustomFieldRow
                  field={f}
                  issues={issues}
                  onUpdate={(patch) => updateField(f.id, patch)}
                  onRemove={() => removeField(f.id)}
                />
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={addField}
          disabled={atLimit}
          className="mt-3 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          aria-label={
            atLimit
              ? `Maximum ${CUSTOM_FIELD_LIMITS.maxFields} custom fields reached`
              : "Add a custom field"
          }
        >
          + Add field
        </button>
      </div>
    </details>
  );
}

function CustomFieldRow({
  field,
  issues,
  onUpdate,
  onRemove,
}: {
  field: CustomField;
  issues: string[];
  onUpdate: (patch: Partial<CustomField>) => void;
  onRemove: () => void;
}) {
  const nameId = useId();
  const typeId = useId();
  const descId = useId();
  const errorId = useId();
  const hasIssues = issues.length > 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[120px]">
          <label
            htmlFor={nameId}
            className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
          >
            Name
          </label>
          <input
            id={nameId}
            type="text"
            value={field.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            maxLength={CUSTOM_FIELD_LIMITS.nameMax}
            placeholder="Cost Center"
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div className="w-28">
          <label
            htmlFor={typeId}
            className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
          >
            Type
          </label>
          <select
            id={typeId}
            value={field.type}
            onChange={(e) =>
              onUpdate({ type: e.target.value as CustomFieldType })
            }
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="string">text</option>
            <option value="number">number</option>
            <option value="date">date</option>
          </select>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove field ${field.name || "(unnamed)"}`}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs hover:bg-red-50 hover:border-red-300 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-red-950/30 dark:hover:text-red-300"
        >
          Remove
        </button>
      </div>
      <div>
        <label
          htmlFor={descId}
          className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
        >
          Description (told to Claude)
        </label>
        <textarea
          id={descId}
          value={field.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          maxLength={CUSTOM_FIELD_LIMITS.descriptionMax}
          rows={2}
          placeholder="Extract the GL cost center code. Usually 4 digits, sometimes prefixed with 'CC-'."
          aria-invalid={hasIssues ? true : undefined}
          aria-describedby={hasIssues ? errorId : undefined}
          className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>
      {hasIssues && (
        <p id={errorId} className="text-xs text-amber-700 dark:text-amber-400">
          {issues.join("; ")}
        </p>
      )}
    </div>
  );
}

function BatchView({
  files,
  inProgress,
  onReset,
}: {
  files: BatchFile[];
  inProgress: boolean;
  onReset: () => void;
}) {
  const successes = files.filter(
    (f): f is Extract<BatchFile, { kind: "success" }> => f.kind === "success",
  );
  const failures = files.filter(
    (f): f is Extract<BatchFile, { kind: "error" }> => f.kind === "error",
  );
  const pending = files.length - successes.length - failures.length;

  // Use the same /api/csv route as single-file flow; it already accepts
  // arrays up to 100 invoices, so the bulk path is just "swap one for many"
  // with no new endpoint. Skipped failures aren't included.
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

  return (
    <section
      aria-label="Batch extraction results"
      className="mt-8 space-y-4"
    >
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
          {inProgress && " (running…)"}
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
                  </>
                ) : f.kind === "error" ? (
                  <>
                    {f.code}
                    {f.correlation_id && ` · ${f.correlation_id.slice(0, 8)}`}
                  </>
                ) : f.kind === "loading" ? (
                  "extracting…"
                ) : (
                  `${formatBytes(f.size)} · queued`
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

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
