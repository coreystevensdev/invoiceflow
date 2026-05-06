import { LOOM_EMBED_URL, isLoomEmbedConfigured } from "@/lib/site";

function loomShareUrlFromEmbed(embedUrl: string): string {
  return embedUrl.replace("/embed/", "/share/");
}

export function LoomEmbed() {
  if (!isLoomEmbedConfigured()) return null;
  return (
    <section
      aria-label="Demo video"
      className="mt-8 rounded-xl border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="motion-reduce:hidden">
        <div className="aspect-video overflow-hidden rounded-lg">
          {/* Sandbox tokens accept the HTML-spec trade-off: allow-same-origin
              + allow-scripts effectively disables sandboxing for the Loom
              origin. Loom is a trusted vendor on the CSP frame-src allowlist
              and its player needs same-origin storage for player state. */}
          <iframe
            src={`${LOOM_EMBED_URL}?autoplay=1&muted=1&hideEmbedTopBar=true&hide_owner=true&hide_share=true&hide_title=true`}
            title="InvoiceFlow demo: 60-second walkthrough of the worst-PDF gauntlet and CSV export"
            loading="lazy"
            width={1280}
            height={720}
            allow="autoplay; fullscreen"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            className="h-full w-full"
          />
        </div>
      </div>
      <div className="hidden motion-reduce:block">
        <a
          href={loomShareUrlFromEmbed(LOOM_EMBED_URL)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="InvoiceFlow demo on Loom (opens in a new tab)"
          className="block px-4 py-3 text-sm underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Watch the demo (opens on Loom)
        </a>
      </div>
    </section>
  );
}
