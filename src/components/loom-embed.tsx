"use client";

import { useEffect, useRef, useState } from "react";
import { LOOM_EMBED_URL, isLoomEmbedConfigured } from "@/lib/site";

function loomShareUrlFromEmbed(embedUrl: string): string {
  return embedUrl.replace("/embed/", "/share/");
}

export function LoomEmbed() {
  const [shouldMount, setShouldMount] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Defer iframe mount until the embed scrolls into view (or close to it).
  // The native loading="lazy" attribute on iframes is a browser hint that
  // varies across user agents; this gives deterministic above-fold defer
  // without depending on the hint surviving an intersection-observer
  // threshold heuristic. Reduced-motion users skip this branch entirely
  // (display:none elements never intersect) and get the fallback link.
  useEffect(() => {
    if (!isLoomEmbedConfigured()) return;
    const node = containerRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setShouldMount(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (!isLoomEmbedConfigured()) return null;

  const shareUrl = loomShareUrlFromEmbed(LOOM_EMBED_URL);

  return (
    <section
      aria-label="Demo video"
      className="mt-8 rounded-xl border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div ref={containerRef} className="motion-reduce:hidden">
        <div className="aspect-video overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
          {shouldMount ? (
            // Sandbox tokens accept the HTML-spec trade-off: allow-same-origin
            // + allow-scripts effectively disables sandboxing for the Loom
            // origin. Loom is a trusted vendor on the CSP frame-src allowlist
            // and its player needs same-origin storage for player state.
            // Autoplay deliberately omitted: iOS Safari's autoplay heuristics
            // can render a black frame until tap, and Loom's poster + play
            // button is the universally-supported entry point. One extra
            // click trades for cross-platform reliability and a quieter
            // hero-section default.
            <iframe
              src={`${LOOM_EMBED_URL}?hideEmbedTopBar=true&hide_owner=true&hide_share=true&hide_title=true`}
              title="InvoiceFlow demo: 60-second walkthrough"
              loading="lazy"
              width={1280}
              height={720}
              allow="fullscreen"
              sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              className="h-full w-full"
            />
          ) : null}
        </div>
        {/* Adjacent fallback for the rare case where the iframe loads but
            renders a Loom 404 (deleted share) or is blocked by an extension.
            iframe `onerror` does not fire on embedded 404 pages (they reach
            the embedder as 200 OK), so the only reliable recourse is a
            visible click-out. */}
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
          Trouble loading?{" "}
          <a
            href={shareUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2"
            aria-label="Watch the InvoiceFlow demo on Loom (opens in a new tab)"
          >
            Watch on Loom
          </a>
        </p>
      </div>
      <div className="hidden motion-reduce:block">
        <a
          href={shareUrl}
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
