// pdfjs-dist v5 ships browser-friendly subpath entries (webpack.mjs, etc.) but
// only types its main module. Re-export the main package's types under the
// subpath so TS resolves the dynamic import.
declare module "pdfjs-dist/webpack.mjs" {
  export * from "pdfjs-dist";
}

declare module "pdfjs-dist/legacy/webpack.mjs" {
  export * from "pdfjs-dist";
}
