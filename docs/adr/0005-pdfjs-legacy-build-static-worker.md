# 5. pdfjs-dist legacy build with a static worker file

Date: 2026-05-02
Status: Accepted

## Context

The click-to-highlight feature on PDF inputs renders the source PDF to a `<canvas>` via PDF.js, extracts text positions via `getTextContent()`, and overlays a highlight box on the source region when a field is hovered. This requires `pdfjs-dist` v5 in the browser bundle.

`pdfjs-dist` v5 ships several build targets and worker setup patterns:

- `pdfjs-dist` (default `main` field): resolves to `build/pdf.mjs`, the Node.js entry. Calls `process.getBuiltinModule(...)` from CanvasFactory paths. Breaks at runtime in browsers with "undefined is not a function".
- `pdfjs-dist/webpack.mjs`: the documented bundler entry. Uses `new URL("./build/pdf.worker.mjs", import.meta.url)` to wire the worker, which Webpack rewrites at build time. Turbopack handles this pattern inconsistently across versions.
- `pdfjs-dist/legacy/build/pdf.mjs`: the polyfilled build. Includes `core-js` polyfills for modern APIs (`Promise.withResolvers`, iterator helpers, `Uint8Array.fromBase64`) that pdfjs-dist v5 assumes but older iOS Safari versions don't ship.

The "obvious" path (default import + bundler magic worker) failed in production on user-reported iOS Safari (iPad). The actual stack trace pointed to `getTextContent()` throwing `TypeError: undefined is not a function (near '...t of e...')`, which is iterator-helper polyfill failure on older WebKit.

## Decision

```ts
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
```

The legacy worker file is copied from `node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs` to `/public/pdf.worker.min.mjs` via a `postinstall` hook (`scripts/copy-pdf-worker.mjs`). The worker file is gitignored as a build artifact, not source.

`page.render()` is called with `{ canvas, viewport }` only, not also `canvasContext` (passing both leaves the canvas blank on iOS Safari without throwing). `getTextContent()` is wrapped in its own try-catch separate from the render path, so iterator-helper failures degrade gracefully (canvas stays visible, bbox highlight is silently disabled) instead of falling all the way back to the iframe fallback.

If even canvas rendering fails (older WebKit, locked-down browsers), the component falls back to an `<object data={pdfUrl} type="application/pdf">` plus an "Open PDF in new tab" link. Source PDF is always visible; only the bbox highlight is conditional on the canvas pipeline working.

## Consequences

Positive:
- Works across the full browser matrix the project targets, including older iOS Safari that pdfjs-dist v5's modern build doesn't.
- Worker wiring is identical across Turbopack, Webpack, Vite, and any other bundler. No bundler-specific magic to maintain.
- Easy to swap workers (bug fix, version bump) without touching bundler config.
- Graceful degradation: at worst, the user sees the PDF in the browser's native viewer with no highlight; the extraction itself never blocks on PDF preview state.

Negative:
- The legacy build is larger (~1.2MB worker file).
- Requires a `postinstall` hook, which adds a step that has to work in CI and on every fresh `npm install`.
- The worker file is gitignored, which means cloning the repo without running `npm install` first leaves the static `/pdf.worker.min.mjs` URL returning 404. Documented in the README's Run-locally section.

## Alternatives considered

**Modern build (`pdfjs-dist/build/pdf.mjs`).** First attempt. Broke immediately in browsers because the Node entry calls `process.getBuiltinModule(...)`. Even if that's fixed, the build assumes `Promise.withResolvers` and iterator helpers that aren't available on older iOS Safari.

**`pdfjs-dist/webpack.mjs` entry.** Documented for Webpack. Worked in Turbopack briefly but the worker chunk emission path differs across Turbopack versions; broke in production.

**`pdfjs-dist/legacy/webpack.mjs`.** Same iterator-helper failures as the modern webpack entry; the legacy polyfills are in the build, not the entry shim.

**CDN-hosted worker** (`unpkg.com/pdfjs-dist@<v>/legacy/build/pdf.worker.min.mjs`). Adds a third-party network dependency on every PDF preview, requires loosening CSP `worker-src` to allow the CDN origin, and breaks if the CDN goes down. Rejected as worse than self-hosting.

**Server-side PDF rendering.** Skip PDF.js entirely and rasterize PDFs to PNGs server-side via `pdf-lib` + `node-canvas`. Would simplify the client but inflates per-extraction cost and latency, and `node-canvas` is heavy enough to bloat the Vercel Function bundle.
