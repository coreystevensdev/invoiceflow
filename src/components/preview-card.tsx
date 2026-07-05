const PREVIEW_FIELDS: ReadonlyArray<{ label: string; value: string }> = [
  { label: "Invoice #", value: "INV-2026-0042" },
  { label: "Vendor", value: "Acme Office Supplies, LLC" },
  { label: "Bill date", value: "2026-04-15" },
  { label: "Due date", value: "2026-05-15" },
  { label: "Subtotal", value: "2,007.00" },
  { label: "Total", value: "2,167.56" },
];

export function PreviewCard() {
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
            <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              {f.label}
            </dt>
            <dd className="mt-1 font-mono text-base font-medium text-zinc-900 dark:text-zinc-100">
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
