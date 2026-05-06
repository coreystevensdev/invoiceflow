"use client";

import { useEffect, useState } from "react";
import { describeError, type ExtractionErrorCode } from "@/lib/errors";
import { TELLSIGHT_DEMO_URL, isTellsightDemoUrlConfigured } from "@/lib/site";

interface ErrorStateProps {
  code: ExtractionErrorCode;
  correlationId?: string;
  retryAfterSeconds?: number;
  detected?: Record<string, unknown>;
  onRetry?: () => void;
}

const ICON_BY_CODE: Record<ExtractionErrorCode, string> = {
  "corrupt-PDF": "✕",
  "oversized-PDF": "✕",
  "non-PDF": "✕",
  "not-an-invoice": "⚠",
  "model-API-failure": "⚠",
  "rate-limited": "⏱",
  "extraction-timeout": "⏱",
  "cost-budget-exceeded": "⚠",
  "monthly-budget-exhausted": "⚠",
};

// Transient codes where retrying the same file is meaningful. Permanent codes
// (corrupt-PDF, non-PDF, not-an-invoice, oversized-PDF, cost-budget-exceeded,
// monthly-budget-exhausted) need a different file or operator action; offering
// retry would just produce the same error again.
const RETRYABLE_CODES: ReadonlySet<ExtractionErrorCode> = new Set([
  "model-API-failure",
  "rate-limited",
  "extraction-timeout",
]);

const MONTHLY_BUDGET_NEXT_STEP_NO_LINK =
  "The free tier resets on the 1st of next month. If you need extraction sooner, contact the operator to raise the cap.";

export function ErrorState({
  code,
  correlationId,
  retryAfterSeconds,
  detected,
  onRetry,
}: ErrorStateProps) {
  const description = describeError(code);
  const icon = ICON_BY_CODE[code];
  const showTellsightCta =
    code === "monthly-budget-exhausted" && isTellsightDemoUrlConfigured();
  const nextStepText =
    code === "monthly-budget-exhausted" && !showTellsightCta
      ? MONTHLY_BUDGET_NEXT_STEP_NO_LINK
      : description.nextStep;
  // Retry is gated on three things: the parent provided an onRetry handler
  // (i.e. there's a file to retry against), the code is transient, and any
  // server-issued retry-after window has elapsed. ErrorState is reconciled
  // (not remounted) when status.kind toggles error -> loading -> error, so
  // we sync retryReady to the current prop via an effect rather than relying
  // on the useState initializer (which only fires on first mount). The
  // react-hooks/set-state-in-effect rule fires for both branches; the timer-
  // driven flip is the whole point here, so the rule is locally disabled.
  const showRetry = Boolean(onRetry) && RETRYABLE_CODES.has(code);
  const [retryReady, setRetryReady] = useState(
    !retryAfterSeconds || retryAfterSeconds <= 0,
  );
  useEffect(() => {
    if (!retryAfterSeconds || retryAfterSeconds <= 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRetryReady(true);
      return;
    }
    setRetryReady(false);
    const timer = setTimeout(
      () => setRetryReady(true),
      retryAfterSeconds * 1000,
    );
    return () => clearTimeout(timer);
  }, [retryAfterSeconds]);
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="mt-6 rounded-lg border border-red-300 bg-red-50 p-4 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
    >
      <p className="flex items-center gap-2 text-base font-medium">
        <span aria-hidden="true" className="text-lg leading-none">
          {icon}
        </span>
        <span>{description.title}</span>
      </p>
      <p className="mt-2 text-sm">{description.message}</p>
      <p className="mt-2 text-sm font-medium">
        What to try:{" "}
        <span className="font-normal">
          {nextStepText}
          {showTellsightCta && (
            <>
              {" "}
              <a
                href={TELLSIGHT_DEMO_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Try Tellsight (opens in a new tab)"
                className="underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Try Tellsight
              </a>
            </>
          )}
        </span>
      </p>
      {typeof retryAfterSeconds === "number" && retryAfterSeconds > 0 && (
        <p className="mt-2 text-xs">
          You can try again in {retryAfterSeconds}s.
        </p>
      )}
      {showRetry && (
        <div className="mt-3">
          <button
            type="button"
            onClick={onRetry}
            disabled={!retryReady}
            className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-900 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 dark:border-red-800 dark:bg-red-950/60 dark:text-red-100 dark:hover:bg-red-900/40 dark:focus-visible:ring-offset-red-950"
            aria-label={
              retryReady
                ? "Retry extraction with the same file"
                : "Retry, available shortly"
            }
          >
            Retry extraction
          </button>
        </div>
      )}
      {detected && Object.keys(detected).length > 0 && (
        <details className="mt-3 text-xs text-red-700 dark:text-red-300">
          <summary className="cursor-pointer select-none">
            Technical details
          </summary>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all">
            {JSON.stringify(detected, null, 2)}
          </pre>
        </details>
      )}
      <p className="mt-3 text-xs text-red-700 dark:text-red-300">
        code: <code className="font-mono">{code}</code>
        {correlationId && (
          <>
            {", "}request:{" "}
            <code className="font-mono">{correlationId}</code>
          </>
        )}
      </p>
    </div>
  );
}
