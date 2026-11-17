import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

export type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

/** Electron 41 lacks Math.sumPrecise; use PDF.js's matching polyfilled main and worker builds. */
export async function loadPdfJs(): Promise<PdfJsModule> {
  const module = await import("pdfjs-dist/legacy/build/pdf.mjs");
  module.GlobalWorkerOptions.workerSrc = workerUrl;
  return module;
}
