import { TELLSIGHT_DEMO_URL, isTellsightDemoUrlConfigured } from "@/lib/site";

interface TellsightCtaProps {
  variant: "single" | "bulk";
}

export function TellsightCta({ variant }: TellsightCtaProps) {
  if (!isTellsightDemoUrlConfigured()) return null;
  // Single follows a tight mt-2 caption; bulk follows a ul whose rows already supply vertical rhythm.
  const margin = variant === "bulk" ? "mt-3" : "mt-4";
  return (
    <aside
      className={`${margin} border border-rule-warm bg-ink-navy/[0.03] p-4 text-sm text-foreground/80`}
    >
      <p>
        Want this data interpreted? Tellsight explains spreadsheet patterns in
        plain English. Same privacy posture, no-account demo.
      </p>
      <p className="mt-2">
        <a
          href={TELLSIGHT_DEMO_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Try Tellsight (opens in a new tab)"
          className="font-medium text-ink-navy underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Try Tellsight
        </a>
      </p>
    </aside>
  );
}
