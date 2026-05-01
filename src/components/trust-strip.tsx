interface TrustFact {
  label: string;
  value: string;
}

const FACTS: readonly TrustFact[] = [
  { label: "Setup", value: "No signup" },
  { label: "Pricing", value: "Free" },
  { label: "Privacy", value: "Zero retention" },
  { label: "Model", value: "Claude Sonnet 4.6" },
];

export function TrustStrip() {
  return (
    <section
      aria-label="At a glance"
      className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-600 dark:text-zinc-400"
    >
      {FACTS.map((fact) => (
        <span key={fact.label} className="inline-flex items-baseline gap-1.5">
          <span className="text-xs uppercase tracking-wide text-zinc-500">
            {fact.label}
          </span>
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {fact.value}
          </span>
        </span>
      ))}
    </section>
  );
}
