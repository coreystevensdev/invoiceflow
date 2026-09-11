const REPO_BASE = "https://github.com/coreystevensdev/invoiceflow/blob/main";

export function PrivacySection() {
  return (
    <section
      aria-labelledby="privacy-heading"
      className="mt-10 border border-rule-warm p-5"
    >
      <h2 id="privacy-heading" className="text-base font-semibold text-foreground">
        Zero retention
      </h2>
      <p className="mt-1 text-sm text-foreground/70">
        No database, no PDF persistence, no log line containing invoice
        content. The promise lives in the code, not a policy.
      </p>

      <details className="mt-3 border border-rule-warm p-3 text-sm">
        <summary className="cursor-pointer select-none font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-navy focus-visible:ring-offset-2 rounded">
          How it&apos;s enforced
        </summary>
        <div className="mt-3 space-y-2 text-foreground/70">
          <p>
            The structured logger in{" "}
            <a
              href={`${REPO_BASE}/src/lib/log.ts`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="src/lib/log.ts on GitHub (opens in a new tab)"
              className="font-mono text-xs underline underline-offset-2 hover:text-ink-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-navy focus-visible:ring-offset-2 rounded"
            >
              src/lib/log.ts
            </a>{" "}
            allows only this set of fields:{" "}
            <code className="bg-ink-navy/10 px-1 py-0.5 text-[0.7rem] font-mono">
              correlation_id
            </code>
            ,{" "}
            <code className="bg-ink-navy/10 px-1 py-0.5 text-[0.7rem] font-mono">
              pdf_size_bytes
            </code>
            ,{" "}
            <code className="bg-ink-navy/10 px-1 py-0.5 text-[0.7rem] font-mono">
              pdf_num_pages
            </code>
            ,{" "}
            <code className="bg-ink-navy/10 px-1 py-0.5 text-[0.7rem] font-mono">
              error_code
            </code>
            ,{" "}
            <code className="bg-ink-navy/10 px-1 py-0.5 text-[0.7rem] font-mono">
              cost_usd
            </code>
            ,{" "}
            <code className="bg-ink-navy/10 px-1 py-0.5 text-[0.7rem] font-mono">
              retry_count
            </code>
            . Anything else is a compile-time type error.
          </p>
          <p>
            The webhook endpoint in{" "}
            <a
              href={`${REPO_BASE}/src/app/api/webhook/route.ts`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="src/app/api/webhook/route.ts on GitHub (opens in a new tab)"
              className="font-mono text-xs underline underline-offset-2 hover:text-ink-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-navy focus-visible:ring-offset-2 rounded"
            >
              src/app/api/webhook/route.ts
            </a>{" "}
            strips the model&apos;s reasoning strings (which contain extracted
            text) before forwarding to the user&apos;s URL.
          </p>
          <p>
            No PDF bytes, no extracted fields, no invoice content is written
            to disk, queued, or persisted anywhere. There&apos;s no
            persistence layer to leak from.
          </p>
        </div>
      </details>
    </section>
  );
}
