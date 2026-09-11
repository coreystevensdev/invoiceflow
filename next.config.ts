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
  outputFileTracingIncludes: {
    "/api/extract": ["./node_modules/@napi-rs/**"],
    "/api/extract-stream": ["./node_modules/@napi-rs/**"],
  },
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
};

export default nextConfig;
