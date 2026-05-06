import { TELLSIGHT_DEMO_URL, isTellsightDemoUrlConfigured } from "@/lib/site";

interface TellsightCtaProps {
  variant: "single" | "bulk";
}

export function TellsightCta({ variant }: TellsightCtaProps) {
  if (!isTellsightDemoUrlConfigured()) return null;
  const margin = variant === "bulk" ? "mt-3" : "mt-4";
  return (
    <aside
      className={`${margin} rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300`}
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
          className="font-medium underline underline-offset-2 text-zinc-900 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-zinc-100"
        >
          Try Tellsight
        </a>
      </p>
    </aside>
  );
}
