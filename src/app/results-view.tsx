"use client";

import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  useEffect,
  type KeyboardEvent,
} from "react";
import type { ExtractResponse } from "./api/extract/route";
import type { InvoiceExtraction, ExtractionFlag } from "@/lib/claude";
import { deterministicFlags, mergeFlags } from "@/lib/validate";
import type { CustomField } from "@/lib/custom-fields";
import { PdfPreview } from "@/components/pdf-preview";
import { TellsightCta } from "@/components/tellsight-cta";

export type WebhookStatus = {
  kind: "ok" | "upstream-error" | "api-error";
  message: string;
};

type ResultView = "fields" | "json";

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
  originalValue: unknown;
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
  // small tolerance for model imprecision.
  if (bbox.some((n) => n < -0.1 || n > 1.1)) {
    return { bbox: null, text };
  }
  return { bbox, text };
}

function formatMoney(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function FieldRow({
  label,
  field,
  money,
  originalValue,
  onSave,
  onActivate,
  onDeactivate,
}: {
  label: string;
  field: FieldLike;
  money?: boolean;
  originalValue?: unknown;
  onSave: (value: string | number | null) => void;
  onActivate?: () => void;
  onDeactivate?: () => void;
}) {
  // True when the visible value diverges from what Claude returned. Strict
  // equality is sufficient since extraction values are always primitives or null.
  const isEdited = originalValue !== undefined && field.value !== originalValue;
  const reasoningId = useId();
  const inputId = useId();
  const [escapeDismissed, setEscapeDismissed] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  // Touch-only tap toggles the reasoning tooltip. Hover and keyboard focus
  // already drive it via group-hover and group-focus-within.
  const [manuallyShown, setManuallyShown] = useState(false);
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
    setManuallyShown(false);
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
      setManuallyShown(false);
    }
  };

  const resetDismissal = () => {
    if (escapeDismissed) setEscapeDismissed(false);
  };

  const tooltipVisibility =
    escapeDismissed || isEditing
      ? "hidden"
      : manuallyShown
        ? "block"
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
      <dt className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        <label htmlFor={inputId}>{label}</label>
        {isEdited && (
          <span
            className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
            aria-label="Edited from original extraction"
          >
            Edited
          </span>
        )}
      </dt>
      {isEditing ? (
        <dd className="mt-1 font-mono text-base font-medium">
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
            className="w-full rounded-md border border-indigo-400 bg-white px-2 py-1 font-mono text-base font-medium text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-indigo-500 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </dd>
      ) : (
        <dd className="mt-1 flex items-center gap-2 font-mono text-base font-medium">
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
          {field.reasoning && (
            <button
              type="button"
              onClick={() => setManuallyShown((v) => !v)}
              aria-expanded={manuallyShown}
              aria-controls={reasoningId}
              aria-label={
                manuallyShown ? "Hide reasoning" : "Show reasoning"
              }
              className="hidden h-5 w-5 items-center justify-center rounded-full border border-zinc-300 text-[10px] font-semibold leading-none text-zinc-600 hover:border-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-zinc-500 pointer-coarse:inline-flex"
            >
              i
            </button>
          )}
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
            <th scope="col" className="px-4 py-3">Description</th>
            <th scope="col" className="px-4 py-3 text-right">Qty</th>
            <th scope="col" className="px-4 py-3 text-right">Unit price</th>
            <th scope="col" className="px-4 py-3 text-right">Amount</th>
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
              the button's accessible name (stays stable as "Copy JSON to
              clipboard"). aria-live on the button itself re-announces the
              new label every state flip, which is jarring mid-click. */}
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

export interface ResultsViewProps {
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
  rememberWebhookUrl: boolean;
  setRememberWebhookUrl: (v: boolean) => void;
  fireWebhook: (invoice: InvoiceExtraction) => void;
  webhookStatus: WebhookStatus | null;
  webhookFiring: boolean;
  onReset: () => void;
}

export function ResultsView({
  result,
  filename,
  pdfUrl,
  customFields,
  downloadCsv,
  webhookUrl,
  setWebhookUrl,
  rememberWebhookUrl,
  setRememberWebhookUrl,
  fireWebhook,
  webhookStatus,
  webhookFiring,
  onReset,
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
  // The parent passes key={pdfUrl} so a new extraction remounts with fresh
  // useState initializers, resetting FieldRow.isEditing and EditableCell.isEditing.
  const [view, setView] = useState<ResultView>("fields");
  const [edited, setEdited] = useState<InvoiceExtraction>(result.invoice);
  const [activeBbox, setActiveBbox] = useState<number[] | null>(null);
  const [pdfBboxMap, setPdfBboxMap] = useState<Record<string, number[]>>({});
  const handlePdfBboxes = useCallback((map: Record<string, number[]>) => {
    setPdfBboxMap(map);
  }, []);
  const isImage = result.input_type === "image";
  // True when extraction used Claude vision (image input or scanned-PDF fallback).
  // Determines bbox source: vision-derived vs text-derived (PdfPreview matching).
  const useVisionBboxes = result.vision_used;
  const inv = edited;
  const summary = result.confidence_summary;
  const fieldsTabId = useId();
  const jsonTabId = useId();
  const fieldsPanelId = useId();
  const jsonPanelId = useId();
  const webhookHelpId = useId();
  const webhookUrlError = webhookUrl !== "" && !webhookUrlValid;

  // Re-run the deterministic flag pass on inline edits so flags stay
  // accurate after the user changes a value (e.g. fixing an amount).
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

  const displayInvoice = useMemo<InvoiceExtraction>(
    () => ({ ...edited, flags: displayFlags }),
    [edited, displayFlags],
  );

  const downloadJson = useCallback(() => {
    const payload = JSON.stringify(
      { ...result, invoice: displayInvoice },
      null,
      2,
    );
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const base = filename.replace(/\.[^.]+$/, "") || "invoice";
    a.download = `${base}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result, displayInvoice, filename]);

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
    const orig = result.invoice;
    const wrap = <T extends FieldLike>(curr: T, origValue: unknown) => {
      const { bbox, text } = parseBboxFromReasoning(curr.reasoning);
      return {
        field: { ...curr, reasoning: text },
        bbox,
        originalValue: origValue,
      };
    };
    const inv_num = wrap(inv.invoice_number, orig.invoice_number.value);
    const vendor = wrap(
      {
        value: inv.vendor.name,
        confidence: inv.vendor.confidence,
        reasoning: inv.vendor.reasoning,
      },
      orig.vendor.name,
    );
    const bill_date = wrap(inv.bill_date, orig.bill_date.value);
    const due_date = wrap(inv.due_date, orig.due_date.value);
    const po_number = wrap(inv.po_number, orig.po_number.value);
    const subtotal = wrap(inv.subtotal, orig.subtotal.value);
    const tax = wrap(inv.tax, orig.tax.value);
    const total = wrap(inv.total, orig.total.value);
    const currency = wrap(inv.currency, orig.currency.value);
    return [
      {
        label: "Invoice #",
        ...inv_num,
        onSave: (v) =>
          setEdited((prev) => ({
            ...prev,
            invoice_number: { ...prev.invoice_number, value: v as string | null },
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
            subtotal: { ...prev.subtotal, value: typeof v === "number" ? v : null },
          })),
      },
      {
        label: "Tax",
        ...tax,
        money: true,
        onSave: (v) =>
          setEdited((prev) => ({
            ...prev,
            tax: { ...prev.tax, value: typeof v === "number" ? v : null },
          })),
      },
      {
        label: "Total",
        ...total,
        money: true,
        onSave: (v) =>
          setEdited((prev) => ({
            ...prev,
            total: { ...prev.total, value: typeof v === "number" ? v : null },
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
      ...customFields.flatMap<FieldDef>((cf) => {
        const ext = inv.custom_fields?.[cf.id];
        if (!ext) return [];
        const { bbox, text } = parseBboxFromReasoning(ext.reasoning);
        const origExt = orig.custom_fields?.[cf.id];
        return [
          {
            label: cf.name.trim() || cf.id,
            field: {
              value: ext.value,
              confidence: ext.confidence,
              reasoning: text,
            },
            bbox,
            money: false,
            originalValue: origExt?.value,
            onSave: (v) =>
              setEdited((prev) => ({
                ...prev,
                custom_fields: {
                  ...(prev.custom_fields ?? {}),
                  [cf.id]: {
                    value: v,
                    confidence: prev.custom_fields?.[cf.id]?.confidence ?? ext.confidence,
                    reasoning: prev.custom_fields?.[cf.id]?.reasoning ?? ext.reasoning,
                  },
                },
              })),
          },
        ];
      }),
    ];
  }, [inv, customFields, result.invoice]);

  return (
    <section className="mt-8 space-y-6" aria-label="Extraction results" data-results-section>
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
            data-print-hide
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
              <dl className="grid border-t border-l border-zinc-200 dark:border-zinc-800 sm:grid-cols-2">
                {fields.map((f) => {
                  const bboxForField = useVisionBboxes
                    ? f.bbox
                    : (pdfBboxMap[f.label] ?? null);
                  return (
                    <div key={f.label} className="border-b border-r border-zinc-200 p-5 dark:border-zinc-800">
                      <FieldRow
                        label={f.label}
                        field={f.field}
                        money={f.money}
                        originalValue={f.originalValue}
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
                    </div>
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

      <div data-print-hide>
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
          <button
            type="button"
            onClick={downloadJson}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          >
            Download JSON
          </button>
          <button
            type="button"
            onClick={onReset}
            className="ml-auto rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
          >
            Upload another
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Summary is one row per invoice (vendor, dates, totals). Line-items is
          one row per item. Both import into QuickBooks Online and Xero. JSON
          gives the full extraction response for custom integrations.
        </p>
        <TellsightCta variant="single" />
      </div>

      <div
        data-print-hide
        className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
      >
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
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={rememberWebhookUrl}
            onChange={(e) => setRememberWebhookUrl(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-950"
          />
          <span>
            Remember this URL on this device.{" "}
            <span className="text-zinc-500 dark:text-zinc-500">
              Stored locally only, never sent anywhere; clears when unchecked.
            </span>
          </span>
        </label>
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
