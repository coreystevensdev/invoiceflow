"use client";

import { useEffect, useRef, useState } from "react";
import type { InvoiceExtraction } from "@/lib/claude";

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
  const [error, setError] = useState<string | null>(null);

  // Effect 1: render PDF once per pdfUrl. No invoice dep, so editing fields
  // doesn't trigger a re-fetch + re-render of the canvas (which would flicker
  // visibly on every keystroke). The parent passes a key={pdfUrl} so a new
  // upload remounts this component fresh; no need to reset state at the top
  // of the effect (which would trip react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // pdfjs-dist v5 ships a Node entry (build/pdf.mjs) that hits
        // process.getBuiltinModule from CanvasFactory paths and breaks in
        // browsers. webpack.mjs is the documented browser entry and also
        // wires the worker via new URL(..., import.meta.url) so Turbopack
        // emits it as a chunk, no /public copy needed.
        const pdfjs = await import("pdfjs-dist/webpack.mjs");

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
          setError(err instanceof Error ? err.message : "PDF render failed");
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

    search("Invoice #", [invoice.invoice_number.value]);
    search("Vendor", wordFallbacks(invoice.vendor.name));
    search("Bill date", dateVariants(invoice.bill_date.value));
    search("Due date", dateVariants(invoice.due_date.value));
    search("PO #", [invoice.po_number.value]);
    const formatMoney = (n: number | null) =>
      n != null
        ? n.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : null;
    search("Subtotal", [formatMoney(invoice.subtotal.value)]);
    search("Tax", [formatMoney(invoice.tax.value)]);
    search("Total", [formatMoney(invoice.total.value)]);
    search("Currency", [invoice.currency.value]);

    onBboxesComputed(map);
  }, [rendered, invoice, onBboxesComputed]);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        aria-label={`Original PDF: ${filename}`}
        role="img"
        className="w-full rounded-xl border border-zinc-200 bg-white dark:border-zinc-800"
      />
      {!rendered && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-zinc-500">
          Rendering PDF…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-50/90 p-4 text-center text-xs text-red-700 dark:bg-zinc-950/90 dark:text-red-300">
          PDF render failed: {error}
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
