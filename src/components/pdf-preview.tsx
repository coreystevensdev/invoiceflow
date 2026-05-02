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

/**
 * Lazy-loads PDF.js (pdfjs-dist) to render the uploaded PDF onto a <canvas>,
 * extracts text-with-positions via getTextContent, and best-effort matches
 * each extracted invoice field's value against the PDF text items to derive
 * normalized [0..1] bbox coordinates. The activeBbox prop drives the
 * highlight overlay positioned over the canvas.
 *
 * Trade-offs (documented in the README): adds ~600KB to the bundle on first
 * PDF view; matches by case-insensitive substring against the field's value;
 * money values are formatted with thousand-separators to match typical
 * invoice rendering. Fields whose values can't be located in the PDF text
 * (numeric-only, OCR'd glyph splits, paraphrased reasoning) silently skip
 * highlighting rather than emitting a wrong-region overlay.
 */
export function PdfPreview({
  pdfUrl,
  filename,
  invoice,
  activeBbox,
  onBboxesComputed,
}: PdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
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
        const items = textContent.items as PdfTextItem[];
        const map: Record<string, Bbox> = {};

        const recordBbox = (label: string, item: PdfTextItem) => {
          const tx = pdfjs.Util.transform(viewport.transform, item.transform);
          const w = Math.max(item.width * viewport.scale, 4);
          const h = Math.max(item.height * viewport.scale, Math.hypot(tx[2], tx[3]));
          const x = tx[4];
          const y = tx[5] - h;
          map[label] = [
            Math.max(0, x / viewport.width),
            Math.max(0, y / viewport.height),
            Math.min(1, w / viewport.width),
            Math.min(1, h / viewport.height),
          ];
        };

        const search = (label: string, query: string | null | undefined) => {
          if (!query) return;
          const trimmed = String(query).trim();
          if (trimmed.length < 2) return;
          const lower = trimmed.toLowerCase();
          const item = items.find(
            (it) => it.str && it.str.toLowerCase().includes(lower),
          );
          if (item) recordBbox(label, item);
        };

        search("Invoice #", invoice.invoice_number.value);
        search("Vendor", invoice.vendor.name);
        search("Bill date", invoice.bill_date.value);
        search("Due date", invoice.due_date.value);
        search("PO #", invoice.po_number.value);
        const formatMoney = (n: number | null) =>
          n != null
            ? n.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            : null;
        search("Subtotal", formatMoney(invoice.subtotal.value));
        search("Tax", formatMoney(invoice.tax.value));
        search("Total", formatMoney(invoice.total.value));
        search("Currency", invoice.currency.value);

        if (!cancelled) {
          setLoaded(true);
          onBboxesComputed?.(map);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "PDF render failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl, invoice, onBboxesComputed]);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        aria-label={`Original PDF: ${filename}`}
        role="img"
        className="w-full rounded-xl border border-zinc-200 bg-white dark:border-zinc-800"
      />
      {!loaded && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-zinc-500">
          Rendering PDF…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-50/90 p-4 text-center text-xs text-red-700 dark:bg-zinc-950/90 dark:text-red-300">
          PDF render failed: {error}
        </div>
      )}
      {activeBbox && loaded && (
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
