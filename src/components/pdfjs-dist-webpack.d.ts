// pdfjs-dist v5 ships browser-friendly subpath entries (legacy/build, etc.)
// but only types its main module. Re-export the main package's types under
// the subpath so TS resolves the dynamic import.
declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export * from "pdfjs-dist";
}
