import { describeError, type ExtractionErrorCode } from "@/lib/errors";
import { TELLSIGHT_DEMO_URL, isTellSightDemoUrlConfigured } from "@/lib/site";

interface ErrorStateProps {
  code: ExtractionErrorCode;
  correlationId?: string;
  retryAfterSeconds?: number;
  detected?: Record<string, unknown>;
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

export function ErrorState({
  code,
  correlationId,
  retryAfterSeconds,
  detected,
}: ErrorStateProps) {
  const description = describeError(code);
  const icon = ICON_BY_CODE[code];
  const showTellSightCta =
    code === "monthly-budget-exhausted" && isTellSightDemoUrlConfigured();
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
          {description.nextStep}
          {showTellSightCta && (
            <>
              {" "}
              <a
                href={TELLSIGHT_DEMO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Try TellSight →
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
            <span className="mx-2" aria-hidden="true">
              ·
            </span>
            request: <code className="font-mono">{correlationId}</code>
          </>
        )}
      </p>
    </div>
  );
}
