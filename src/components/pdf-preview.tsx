"use client";

import { useEffect, useRef, useState } from "react";
import type { InvoiceExtraction } from "@/lib/claude";

const PDF_PREVIEW_BUILD = "v4-legacy-static-worker";

type Bbox = number[];

interface PdfPreviewProps {
  pdfUrl: string;
  filename: string;
  invoice: InvoiceExtraction;
  activeBbox: Bbox | null;
  onBboxesComputed?: (map: Record<string, Bbox>) => void;
}

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

interface RenderedPdf {
  items: PdfTextItem[];
  viewportWidth: number;
  viewportHeight: number;
  viewportScale: number;
  viewportTransform: number[];
  // Imported once on first render to keep Util.transform around for bbox math.
  Util: { transform: (a: number[], b: number[]) => number[] };
}

interface RenderError {
  name: string;
  message: string;
  stack: string;
}

/**
 * Lazy-loads PDF.js (pdfjs-dist) to render the uploaded PDF onto a <canvas>,
 * extracts text-with-positions via getTextContent, and best-effort matches
 * each extracted invoice field's value against the PDF text items to derive
 * normalized [0..1] bbox coordinates. The activeBbox prop drives the
 * highlight overlay positioned over the canvas.
 *
 * Two effects:
 *   1. Render PDF to canvas (depends on pdfUrl only). Runs once per upload.
 *   2. Compute bbox map (depends on invoice values + cached render data).
 *      Runs every time the user edits a field value, but does no I/O.
 *
 * If the canvas pipeline fails (typically on older iOS Safari versions that
 * pdfjs-dist v5 doesn't fully support), the component falls back to the
 * browser's native PDF viewer in an <iframe>. The bbox highlight overlay is
 * canvas-only, so the fallback view loses it; the source PDF is still shown.
 *
 * Trade-offs (documented in the README): adds ~1.2MB pdf.worker plus a
 * ~600KB main-thread chunk on first PDF view; matches by case-insensitive
 * substring against the field's value plus date-format and word-fallback
 * variants. Fields whose values can't be located silently skip highlighting
 * rather than emitting a wrong-region overlay.
 */
export function PdfPreview({
  pdfUrl,
  filename,
  invoice,
  activeBbox,
  onBboxesComputed,
}: PdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = useState<RenderedPdf | null>(null);
  const [error, setError] = useState<RenderError | null>(null);

  // Effect 1: render PDF once per pdfUrl. No invoice dep, so editing fields
  // doesn't trigger a re-fetch + re-render of the canvas (which would flicker
  // visibly on every keystroke). The parent passes a key={pdfUrl} so a new
  // upload remounts this component fresh; no need to reset state at the top
  // of the effect (which would trip react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Direct legacy/build/pdf.mjs import + manual workerSrc keeps the
        // wiring identical across Turbopack / webpack / vite. The legacy
        // build polyfills modern APIs (Promise.withResolvers, iterator
        // helpers, Uint8Array.fromBase64) that pdfjs-dist v5 assumes but
        // older iOS Safari doesn't ship. The worker file at the static
        // /pdf.worker.min.mjs URL is copied from the package in postinstall.
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const data = await fetch(pdfUrl).then((r) => r.arrayBuffer());
        if (cancelled) return;

        const pdf = await pdfjs.getDocument({ data }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 2.0 });

        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await page.render({ canvasContext: ctx, canvas, viewport }).promise;
        if (cancelled) return;

        const textContent = await page.getTextContent();
        if (cancelled) return;

        setRendered({
          items: textContent.items as PdfTextItem[],
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
          viewportScale: viewport.scale,
          viewportTransform: viewport.transform,
          Util: pdfjs.Util,
        });
      } catch (err) {
        if (!cancelled) {
          console.error("[PdfPreview] render failed:", err);
          const e = err instanceof Error ? err : new Error(String(err));
          setError({
            name: e.name,
            message: e.message,
            stack: e.stack ?? "(no stack)",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  // Effect 2: compute bbox map whenever the invoice or rendered data changes.
  // Pure CPU work against cached items; no PDF re-render.
  useEffect(() => {
    if (!rendered || !onBboxesComputed) return;
    const {
      items,
      viewportWidth,
      viewportHeight,
      viewportScale,
      viewportTransform,
      Util,
    } = rendered;
    const map: Record<string, Bbox> = {};

    const recordBbox = (label: string, item: PdfTextItem) => {
      const tx = Util.transform(viewportTransform, item.transform);
      const w = Math.max(item.width * viewportScale, 4);
      const h = Math.max(
        item.height * viewportScale,
        Math.hypot(tx[2], tx[3]),
      );
      const x = tx[4];
      const y = tx[5] - h;
      map[label] = [
        Math.max(0, x / viewportWidth),
        Math.max(0, y / viewportHeight),
        Math.min(1, w / viewportWidth),
        Math.min(1, h / viewportHeight),
      ];
    };

    const findItem = (queries: string[]): PdfTextItem | undefined => {
      for (const q of queries) {
        const trimmed = q.trim();
        if (trimmed.length < 2) continue;
        const lower = trimmed.toLowerCase();
        const item = items.find(
          (it) => it.str && it.str.toLowerCase().includes(lower),
        );
        if (item) return item;
      }
      return undefined;
    };

    const search = (
      label: string,
      queries: (string | null | undefined)[],
    ) => {
      const usable = queries.filter((q): q is string => !!q);
      const item = findItem(usable);
      if (item) recordBbox(label, item);
    };

    const dateVariants = (iso: string | null): string[] => {
      if (!iso) return [];
      const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return [iso];
      const [, y, mm, dd] = m;
      const monthIdx = Number.parseInt(mm, 10) - 1;
      const day = Number.parseInt(dd, 10);
      const monthLong = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
      ][monthIdx];
      const monthShort = monthLong?.slice(0, 3);
      return [
        iso,
        `${monthLong} ${day}, ${y}`,
        `${monthShort} ${day}, ${y}`,
        `${mm}/${dd}/${y}`,
        `${dd}/${mm}/${y}`,
        `${monthLong} ${day}`,
      ].filter(Boolean) as string[];
    };

    const wordFallbacks = (s: string | null): string[] => {
      if (!s) return [];
      return [s, ...s.split(/\s+/).filter((w) => w.length > 3)];
    };

    // Money fields: try the en-US formatted string first ("1,234.56"), then
    // the raw decimal ("1234.56") in case the PDF omits the thousands
    // separator. Substring match means "$1,234.56" still hits the formatted
    // variant; "1234.56" only hits if the formatted variant misses.
    const moneyVariants = (n: number | null): string[] => {
      if (n == null) return [];
      return [
        n.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
        n.toFixed(2),
      ];
    };

    search("Invoice #", [invoice.invoice_number.value]);
    search("Vendor", wordFallbacks(invoice.vendor.name));
    search("Bill date", dateVariants(invoice.bill_date.value));
    search("Due date", dateVariants(invoice.due_date.value));
    search("PO #", [invoice.po_number.value]);
    search("Subtotal", moneyVariants(invoice.subtotal.value));
    search("Tax", moneyVariants(invoice.tax.value));
    search("Total", moneyVariants(invoice.total.value));
    search("Currency", [invoice.currency.value]);

    onBboxesComputed(map);
  }, [rendered, invoice, onBboxesComputed]);

  if (error) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800">
        <iframe
          src={pdfUrl}
          title={`Original PDF: ${filename}`}
          className="h-[600px] w-full rounded-t-xl"
        />
        <details className="border-t border-zinc-200 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          <summary className="cursor-pointer select-none">
            Showing native PDF preview, source-region highlight unavailable on this browser
          </summary>
          <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-snug text-zinc-500 dark:text-zinc-500">
            build: {PDF_PREVIEW_BUILD}
            {"\n"}
            error: {error.name}: {error.message}
            {"\n\n"}
            {error.stack}
          </pre>
        </details>
      </div>
    );
  }

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        aria-label={`Original PDF: ${filename}`}
        role="img"
        className="w-full rounded-xl border border-zinc-200 bg-white dark:border-zinc-800"
      />
      {!rendered && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-zinc-500">
          Rendering PDF…
        </div>
      )}
      {activeBbox && rendered && (
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
  );
}
