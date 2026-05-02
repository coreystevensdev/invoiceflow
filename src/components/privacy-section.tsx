const REPO_BASE = "https://github.com/coreystevensdev/invoiceflow/blob/main";
const TELLSIGHT_URL = "https://github.com/coreystevensdev/tellsight";

export function PrivacySection() {
  return (
    <section
      aria-labelledby="privacy-heading"
      className="mt-12 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900 sm:p-8"
    >
      <h2
        id="privacy-heading"
        className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100"
      >
        Your invoice never lives anywhere.
      </h2>

      <p className="mt-4 text-zinc-700 dark:text-zinc-300">
        The PDF you drop disappears the moment your CSV downloads. No disk
        write. No queue. No log line that contains your vendor name, your line
        items, or your totals.
      </p>

      <p className="mt-3 text-zinc-700 dark:text-zinc-300">
        The structured logger doesn&apos;t promise not to leak. It
        can&apos;t. The allowed log keys are enumerated in TypeScript, so trying
        to log invoice content is a compile error, not a code-review catch.
      </p>

      <p className="mt-3 text-zinc-700 dark:text-zinc-300">
        Built on the same principle as{" "}
        <a
          href={TELLSIGHT_URL}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-zinc-900 underline underline-offset-2 transition-colors hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded dark:text-zinc-100 dark:hover:text-indigo-400"
        >
          Tellsight
        </a>
        , the analytics tool I made for the same audience: the privacy promise
        lives in the code, not in a policy.
      </p>

      <details className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
        <summary className="cursor-pointer select-none font-medium text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded dark:text-zinc-200">
          For engineers: how it&apos;s enforced
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
            text) before forwarding. Verbose mode is opt-in.
          </p>
          <p>
            No PDF bytes, no extracted fields, no invoice content is written to
            disk, queued, or persisted anywhere. The architecture has no
            persistence layer because there&apos;s nothing to keep.
          </p>
        </div>
      </details>
    </section>
  );
}
