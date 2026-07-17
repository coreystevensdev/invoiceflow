"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { ExtractResponse } from "./api/extract/route";
import type { InvoiceExtraction } from "@/lib/claude";
import type { ExtractionErrorCode } from "@/lib/errors";
import {
  loadCustomFields,
  saveCustomFields,
  type CustomField,
} from "@/lib/custom-fields";
import { ErrorState } from "@/components/error-state";
import { LoomEmbed } from "@/components/loom-embed";
import { PrivacySection } from "@/components/privacy-section";
import { PreviewCard } from "@/components/preview-card";
import { CustomFieldsManager } from "@/components/custom-fields-manager";
import { ResultsSkeleton, StreamingResultsView } from "@/components/extraction-status";
import { ResultsView, type WebhookStatus } from "./results-view";
import { BatchView, type BatchFile } from "./batch-view";

// Parses raw SSE text into {event, data} pairs. Each SSE message ends with
// a blank line (\n\n). Returns complete events from the buffer and the
// remaining incomplete fragment.
function parseSseChunk(
  buffer: string,
): { events: Array<{ event: string; data: string }>; remainder: string } {
  const events: Array<{ event: string; data: string }> = [];
  const messages = buffer.split("\n\n");
  // The last element is an incomplete message (or empty if buffer ends with \n\n).
  const remainder = messages.pop() ?? "";
  for (const message of messages) {
    if (!message.trim()) continue;
    let event = "message";
    let data = "";
    for (const line of message.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) data = line.slice(6);
    }
    if (data) events.push({ event, data });
  }
  return { events, remainder };
}

type Status =
  | { kind: "idle" }
  | { kind: "loading"; filename: string }
  | {
      kind: "streaming";
      filename: string;
      pdfUrl: string;
      phase: string;
      partialFields: Record<string, unknown>;
    }
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
  const [webhookStatus, setWebhookStatus] = useState<WebhookStatus | null>(
    null,
  );
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  // Last attempted file, kept so the ErrorState retry button can re-run the
  // same extraction without forcing the user to re-pick the file. This is
  // in-memory only and lives no longer than the React component, consistent
  // with the zero-retention posture (no disk write, no network re-emit).
  const [lastFile, setLastFile] = useState<File | null>(null);
  // Webhook persistence is opt-in (default off) because webhook URLs may
  // carry secrets in path or query (`?token=...`). Saving without consent
  // is a real privacy footgun. When the box is checked, the URL persists
  // across sessions via localStorage; when unchecked, the saved URL is
  // cleared. Custom fields use the same pattern but always-on (they hold
  // user-defined config, not credentials).
  const [rememberWebhookUrl, setRememberWebhookUrl] = useState(false);
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

  // Hydrate the webhook URL + remember-flag from localStorage on mount. The
  // hydration is keyed on the remember-flag so users who never opted in
  // never see a stale URL on a fresh device. Same SSR-safe pattern as
  // custom-fields hydration above.
  useEffect(() => {
    const remembered = window.localStorage.getItem("invoiceflow:webhook-remember");
    if (remembered !== "1") return;
    const stored = window.localStorage.getItem("invoiceflow:webhook-url");
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWebhookUrl(stored);
      setRememberWebhookUrl(true);
    }
  }, []);

  // Mirror the remember-flag and URL to localStorage. When the user
  // unchecks the box, both keys are cleared so a stale URL does not
  // linger. Writes only fire when state changes, not on every keystroke.
  useEffect(() => {
    if (rememberWebhookUrl) {
      window.localStorage.setItem("invoiceflow:webhook-remember", "1");
      window.localStorage.setItem("invoiceflow:webhook-url", webhookUrl);
    } else {
      window.localStorage.removeItem("invoiceflow:webhook-remember");
      window.localStorage.removeItem("invoiceflow:webhook-url");
    }
  }, [rememberWebhookUrl, webhookUrl]);

  const streamExtraction = useCallback(
    async (file: File) => {
      // Create the blob URL immediately so the PDF preview renders while
      // fields stream in, rather than waiting for extraction to complete.
      const pdfUrl = URL.createObjectURL(file);
      setStatus((prev) => {
        if (prev.kind === "success") URL.revokeObjectURL(prev.pdfUrl);
        if (prev.kind === "streaming") URL.revokeObjectURL(prev.pdfUrl);
        return {
          kind: "streaming",
          filename: file.name,
          pdfUrl,
          phase: "Reading PDF...",
          partialFields: {},
        };
      });
      setLastFile(file);
      setWebhookStatus(null);

      const form = new FormData();
      form.append("pdf", file);
      if (customFields.length > 0) form.append("custom_fields", JSON.stringify(customFields));

      let res: Response;
      try {
        res = await fetch("/api/extract-stream", { method: "POST", body: form });
      } catch {
        URL.revokeObjectURL(pdfUrl);
        setStatus({ kind: "error", code: "model-API-failure" });
        return;
      }

      // Pre-stream errors arrive as JSON (rate limit, monthly budget, etc.).
      if (!res.ok) {
        URL.revokeObjectURL(pdfUrl);
        const body: ErrorBody = await res.json().catch(() => ({}));
        setStatus({
          kind: "error",
          code: body.code ?? "model-API-failure",
          correlation_id: body.correlation_id,
          retry_after_seconds: body.retry_after_seconds,
        });
        return;
      }

      if (!res.body) {
        URL.revokeObjectURL(pdfUrl);
        setStatus({ kind: "error", code: "model-API-failure" });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const { events, remainder } = parseSseChunk(sseBuffer);
          sseBuffer = remainder;

          for (const { event, data } of events) {
            let parsed: unknown;
            try {
              parsed = JSON.parse(data);
            } catch {
              continue;
            }
            const p = parsed as Record<string, unknown>;

            if (event === "progress") {
              setStatus((prev) => {
                if (prev.kind !== "streaming") return prev;
                return {
                  ...prev,
                  phase:
                    typeof p["message"] === "string" ? p["message"] : prev.phase,
                };
              });
            } else if (event === "field") {
              setStatus((prev) => {
                if (prev.kind !== "streaming") return prev;
                return {
                  ...prev,
                  partialFields: {
                    ...prev.partialFields,
                    [p["field"] as string]: p["value"],
                  },
                };
              });
            } else if (event === "error") {
              URL.revokeObjectURL(pdfUrl);
              setStatus({
                kind: "error",
                code: (p["code"] as ExtractionErrorCode) ?? "model-API-failure",
                correlation_id: p["correlation_id"] as string | undefined,
              });
              return;
            } else if (event === "complete") {
              const result = p as unknown as ExtractResponse;
              setStatus({
                kind: "success",
                result,
                filename: file.name,
                pdfUrl,
              });
            }
          }
        }
      } catch {
        URL.revokeObjectURL(pdfUrl);
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
      } catch {
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
      if (files.length === 1) streamExtraction(files[0]);
      else runBatch(files);
    },
    [streamExtraction, runBatch],
  );

  useEffect(() => {
    return () => {
      if (status.kind === "success") URL.revokeObjectURL(status.pdfUrl);
      if (status.kind === "streaming") URL.revokeObjectURL(status.pdfUrl);
    };
  }, [status]);

  useEffect(() => {
    if (status.kind !== "success" && status.kind !== "streaming") return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    document
      .querySelector('[data-results-section]')
      ?.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start",
      });
  }, [status.kind]);

  // Window-level drag-and-drop. The dropzone itself already accepts drops,
  // but a window-level listener lets the user drop a file anywhere on the
  // page and still kick off extraction. Only fires for actual file drags
  // (dataTransfer.types.includes("Files")) so editing text or dragging a
  // link doesn't trip the dropzone visual. The dragleave handler resets
  // the highlight only when the cursor leaves the window entirely
  // (relatedTarget === null), otherwise moving between elements would
  // flicker the dropzone state.
  useEffect(() => {
    const isFileDrag = (e: DragEvent) =>
      Boolean(e.dataTransfer?.types && e.dataTransfer.types.includes("Files"));
    const onDragEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      setIsDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      setIsDragging(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      if (e.relatedTarget === null) setIsDragging(false);
    };
    const onWindowDrop = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      setIsDragging(false);
      const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
      if (files.length > 0) dispatchFiles(files);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onWindowDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onWindowDrop);
    };
  }, [dispatchFiles]);

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
      await streamExtraction(file);
    } catch {
      // Network failure fetching the sample PDF. No status UI for this surface.
    }
  }, [streamExtraction]);

  // Retry the last attempted extraction. handleFile saves the File reference
  // on every attempt (manual upload or sample), so retry covers both paths
  // without separate sample-vs-file branching. ErrorState gates the visible
  // button on the error code, so this only fires for transient codes.
  const onRetry = useCallback(() => {
    if (lastFile) streamExtraction(lastFile);
  }, [lastFile, streamExtraction]);

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
      } catch {
        // Network failure during CSV export. No status UI exists for this
        // surface; the catch prevents an unhandled promise rejection.
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
      } catch {
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
    status.kind === "streaming" ||
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
      <div className="mx-auto max-w-4xl px-6 py-10 sm:py-16">
        <header className="mb-10 border-b border-zinc-200 pb-7 dark:border-zinc-800">
          <h1 className="text-4xl font-extrabold tracking-tight leading-none sm:text-5xl">
            InvoiceFlow
          </h1>
          <p className="mt-3 text-[11px] font-semibold tracking-[0.2em] uppercase text-zinc-400 dark:text-zinc-500">
            PDF invoices → structured JSON
          </p>
        </header>

        <div
          data-print-hide
          className={`grid overflow-hidden border transition-colors sm:grid-cols-[2fr_1fr] ${
            isDragging && !dropzoneBusy
              ? "border-ink-navy"
              : "border-zinc-200 dark:border-zinc-800"
          }`}
        >
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
            className={`flex min-h-[200px] flex-col justify-between p-10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink-navy ${
              dropzoneBusy
                ? "cursor-wait opacity-70"
                : isDragging
                  ? "cursor-pointer bg-ink-navy/10 dark:bg-ink-navy/20"
                  : "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
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
            {status.kind === "loading" || status.kind === "streaming" || batchInProgress ? (
              <div
                className="flex items-center gap-3 text-base font-semibold"
                aria-live="polite"
              >
                <svg
                  className="h-4 w-4 animate-spin text-ink-navy motion-reduce:animate-none dark:text-ink-navy-hover"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                  <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                <span>
                  {status.kind === "loading"
                    ? `Extracting ${status.filename}`
                    : status.kind === "streaming"
                      ? `Extracting ${status.filename}`
                      : `Extracting batch (${batchSummary?.done ?? 0} of ${batchSummary?.total ?? 0})`}
                </span>
              </div>
            ) : (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500">
                  Upload
                </p>
                <p
                  className="mt-4 text-2xl font-bold leading-snug tracking-tight text-zinc-900 dark:text-zinc-100"
                  aria-live="polite"
                >
                  Drop a PDF<br />or image here
                </p>
              </div>
            )}
            <p id={dropzoneHintId} className="mt-6 text-xs text-zinc-400 dark:text-zinc-500">
              {status.kind === "loading"
                ? `Typically 4-8 seconds. Reading the ${
                    /\.(jpe?g|png|gif|webp)$/i.test(status.filename)
                      ? "image"
                      : "PDF"
                  }, sending to Claude, validating fields.`
                : status.kind === "streaming"
                  ? `Streaming results from Claude. Fields appear as they arrive.`
                  : batchInProgress
                    ? `Up to 3 in parallel. Failed files don't stop the batch.`
                    : "PDF up to 25 MB · JPG/PNG/GIF/WebP up to 3.5 MB. Drop multiple to batch-extract."}
            </p>
          </label>

          <div className="flex flex-col gap-3 border-t border-zinc-200 bg-zinc-50 p-8 dark:border-zinc-800 dark:bg-zinc-900/50 sm:border-t-0 sm:border-l">
            <button
              type="button"
              disabled={dropzoneBusy}
              onClick={() => { if (!dropzoneBusy) inputRef.current?.click(); }}
              className="w-full bg-zinc-900 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-white transition-opacity disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Select file
            </button>
            <button
              type="button"
              disabled={dropzoneBusy}
              onClick={() => { if (!dropzoneBusy) onSampleClick(); }}
              className="w-full border border-zinc-300 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Use sample
            </button>
            <p className="mt-auto text-[11px] leading-relaxed text-zinc-400 dark:text-zinc-500">
              No account required.<br />
              Nothing is stored.
            </p>
          </div>
        </div>


        {status.kind === "idle" && (
          <div data-print-hide>
            <LoomEmbed />
            <PreviewCard />
            <CustomFieldsManager
              fields={customFields}
              onChange={setCustomFields}
            />
          </div>
        )}

        {status.kind === "error" && (
          <div data-print-hide>
            <ErrorState
              code={status.code}
              correlationId={status.correlation_id}
              retryAfterSeconds={status.retry_after_seconds}
              detected={status.detected}
              onRetry={lastFile ? onRetry : undefined}
            />
          </div>
        )}

        {status.kind === "loading" && (
          <div data-print-hide>
            <ResultsSkeleton />
          </div>
        )}

        {status.kind === "streaming" && (
          <div data-print-hide>
            <StreamingResultsView
              filename={status.filename}
              pdfUrl={status.pdfUrl}
              phase={status.phase}
              partialFields={status.partialFields}
            />
          </div>
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
            rememberWebhookUrl={rememberWebhookUrl}
            setRememberWebhookUrl={setRememberWebhookUrl}
            fireWebhook={fireWebhook}
            webhookStatus={webhookStatus}
            webhookFiring={webhookFiring}
            onReset={() => setStatus({ kind: "idle" })}
          />
        )}

        {status.kind === "batch" && (
          <div data-print-hide>
            <BatchView
              files={status.files}
              inProgress={batchInProgress}
              onReset={() => setStatus({ kind: "idle" })}
            />
          </div>
        )}

        <div data-print-hide>
          <PrivacySection />
        </div>
      </div>

      <footer className="mt-auto border-t border-zinc-200 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-y-2 px-6">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <span>
              Powered by{" "}
              <a
                className="underline underline-offset-2 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-navy focus-visible:ring-offset-2 rounded dark:hover:text-zinc-300"
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
              className="underline underline-offset-2 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-navy focus-visible:ring-offset-2 rounded dark:hover:text-zinc-300"
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
                className="underline underline-offset-2 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-navy focus-visible:ring-offset-2 rounded dark:hover:text-zinc-300"
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
              Related project:{" "}
              <a
                className="underline underline-offset-2 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-navy focus-visible:ring-offset-2 rounded dark:hover:text-zinc-300"
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
