import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  serverExternalPackages: ["pdf-parse"],
  // pdf-parse 2.x reaches pdfjs, which requires the native @napi-rs/canvas to
  // polyfill DOMMatrix in Node. Tracing does not follow that optional native
  // require, so the function deploys without it and the import throws
  // "DOMMatrix is not defined" at request time. The build is green either way.
  //
  // The glob has to cover all of @napi-rs, not just canvas: the loader is in
  // @napi-rs/canvas and the binding is a sibling optional package chosen per
  // platform (@napi-rs/canvas-linux-x64-gnu on the builder). Tracing only the
  // loader swaps "Cannot find module" for "Failed to load native binding".
  //
  // pdf.worker.mjs is a third thing tracing misses: pdfjs resolves it by path
  // at run time rather than importing it, so nothing static points at it. Its
  // absence surfaces as "Setting up fake worker failed", which the wrapper maps
  // to corrupt-PDF, telling the user their file is broken when the deployment
  // is. Named explicitly rather than globbing pdfjs-dist, which is 36MB.
  outputFileTracingIncludes: {
    "/api/extract": [
      "./node_modules/@napi-rs/**",
      "./node_modules/pdf-parse/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
    "/api/extract-stream": [
      "./node_modules/@napi-rs/**",
      "./node_modules/pdf-parse/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
  },
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
};

export default nextConfig;
