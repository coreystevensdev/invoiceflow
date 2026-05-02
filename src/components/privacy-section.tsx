const REPO_BASE = "https://github.com/coreystevensdev/invoiceflow/blob/main";

export function PrivacySection() {
  return (
    <section
      aria-labelledby="privacy-heading"
      className="mt-10 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <h2
        id="privacy-heading"
        className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
      >
        Zero retention
      </h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        No database, no PDF persistence, no log line containing invoice
        content. The promise lives in the code, not a policy.
      </p>

      <details className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
        <summary className="cursor-pointer select-none font-medium text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded dark:text-zinc-200">
          How it&apos;s enforced
        </summary>
        <div className="mt-3 space-y-2 text-zinc-700 dark:text-zinc-400">
          <p>
            The structured logger in{" "}
            <a
              href={`${REPO_BASE}/src/lib/log.ts`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs underline underline-offset-2 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded dark:hover:text-indigo-400"
            >
              src/lib/log.ts
            </a>{" "}
            allows only this set of fields:{" "}
            <code className="rounded bg-zinc-200 px-1 py-0.5 text-[0.7rem] font-mono dark:bg-zinc-800">
              correlation_id
            </code>
            ,{" "}
            <code className="rounded bg-zinc-200 px-1 py-0.5 text-[0.7rem] font-mono dark:bg-zinc-800">
              pdf_size_bytes
            </code>
            ,{" "}
            <code className="rounded bg-zinc-200 px-1 py-0.5 text-[0.7rem] font-mono dark:bg-zinc-800">
              pdf_num_pages
            </code>
            ,{" "}
            <code className="rounded bg-zinc-200 px-1 py-0.5 text-[0.7rem] font-mono dark:bg-zinc-800">
              error_code
            </code>
            ,{" "}
            <code className="rounded bg-zinc-200 px-1 py-0.5 text-[0.7rem] font-mono dark:bg-zinc-800">
              cost_usd
            </code>
            ,{" "}
            <code className="rounded bg-zinc-200 px-1 py-0.5 text-[0.7rem] font-mono dark:bg-zinc-800">
              retry_count
            </code>
            . Anything else is a compile-time type error.
          </p>
          <p>
            The webhook endpoint in{" "}
            <a
              href={`${REPO_BASE}/src/app/api/webhook/route.ts`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs underline underline-offset-2 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded dark:hover:text-indigo-400"
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
