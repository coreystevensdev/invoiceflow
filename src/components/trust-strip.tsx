interface TrustTile {
  label: string;
  value: string;
}

const TILES: readonly TrustTile[] = [
  { label: "Setup", value: "No signup needed" },
  { label: "Pricing", value: "Free, always" },
  { label: "Privacy", value: "Zero-retention by design" },
  { label: "Powered by", value: "Claude Sonnet 4.6" },
];

export function TrustStrip() {
  return (
    <section
      aria-label="At a glance"
      className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-800 sm:grid-cols-4"
    >
      {TILES.map((tile) => (
        <div
          key={tile.label}
          className="bg-zinc-50 px-4 py-5 text-center dark:bg-zinc-950"
        >
          <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {tile.value}
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
            {tile.label}
          </div>
        </div>
      ))}
    </section>
  );
}
