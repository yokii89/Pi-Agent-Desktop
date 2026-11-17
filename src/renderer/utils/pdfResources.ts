import type { DocumentInitParameters } from "pdfjs-dist/types/src/display/api";

/** Local resources shared by canvas rendering and text extraction, including offline builds. */
export function getPdfResourceOptions(): Pick<
  DocumentInitParameters,
  "cMapUrl" | "cMapPacked" | "standardFontDataUrl" | "wasmUrl" | "iccUrl" | "useWorkerFetch"
> {
  const base = new URL(`${import.meta.env.BASE_URL}${__PIDESK_PDF_ASSET_BASE__}`, document.baseURI)
    .href;
  return {
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`,
    // The DOM factory uses XHR for file://; worker fetch cannot read packaged local resources.
    useWorkerFetch: false,
  };
}
