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
  outputFileTracingIncludes: {
    "/api/extract": ["./node_modules/@napi-rs/canvas/**"],
    "/api/extract-stream": ["./node_modules/@napi-rs/canvas/**"],
  },
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
};

export default nextConfig;
