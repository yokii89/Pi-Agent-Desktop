import type { HElement } from "docx-preview";
import {
  OFFICE_DOCX_PAGE_ELEMENTS,
  OFFICE_MAX_PAGES,
  OFFICE_PAGE_CACHE_SIZE,
  OFFICE_SEARCH_MAX_TEXT,
} from "../../shared/officePreview";
import { checkOfficeArchive, OfficePreviewError } from "./officeArchive";
import type { OfficePageText } from "./officeSearchTypes";

export interface OfficePageSource {
  length: number;
  getPage(index: number, signal: AbortSignal): Promise<HTMLElement>;
  getText(index: number, signal: AbortSignal): Promise<OfficePageText>;
  dispose(): void;
}

/** Create nodes in the sandbox document so file styles and resources cannot reach the application. */
function frameElement(doc: Document, input: HElement | Node | string): Node {
  if (typeof input === "string") return doc.createTextNode(input);
  if ("nodeType" in input) return doc.adoptNode(input as Node);
  const { ns, tagName, className, style, children, ...props } = input as HElement;
  if (tagName === "#comment") return doc.createComment("");
  if (tagName === "#fragment") {
    const fragment = doc.createDocumentFragment();
    for (const child of children ?? []) fragment.appendChild(frameElement(doc, child));
    return fragment;
  }
  const element = ns ? doc.createElementNS(ns, tagName) : doc.createElement(tagName);
  if (className) element.setAttribute("class", className);
  if (style) {
    if (typeof style === "string") element.setAttribute("style", style);
    else if ("style" in element) Object.assign((element as HTMLElement).style, style);
  }
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || /^on/i.test(key) || /^(innerHTML|outerHTML|srcdoc)$/i.test(key))
      continue;
    if (/^(src|href|xlink:href)$/i.test(key) && !/^(data:image\/|#)/i.test(String(value))) continue;
    if (key in element) Reflect.set(element, key, value);
    else element.setAttribute(key, String(value));
  }
  for (const child of children ?? []) element.appendChild(frameElement(doc, child));
  return element;
}

function slideElement(doc: Document, html: string): HTMLElement {
  const template = doc.createElement("template");
  template.innerHTML = html;
  template.content
    .querySelectorAll("script,iframe,object,embed,link,meta,base,form,foreignObject")
    .forEach((node) => {
      node.remove();
    });
  for (const node of template.content.querySelectorAll("*")) {
    for (const attr of Array.from(node.attributes)) {
      if (/^on/i.test(attr.name) || /^(href|xlink:href|srcdoc|action)$/i.test(attr.name))
        node.removeAttribute(attr.name);
    }
  }
  const page = template.content.firstElementChild as HTMLElement | null;
  if (!page) throw new OfficePreviewError("invalid");
  return page;
}

/** Parse the file index once; page DOM and image decoding are bounded by the small LRU cache. */
export async function renderOfficePages(
  data: Uint8Array,
  format: "docx" | "pptx",
  doc: Document,
  signal: AbortSignal,
): Promise<OfficePageSource> {
  checkOfficeArchive(data, format);
  signal.throwIfAborted();
  const styles = doc.getElementById("office-styles");
  if (!styles) throw new OfficePreviewError("failed");
  let render: ((index: number) => Promise<HTMLElement>) | null;
  let readText: ((index: number) => OfficePageText | Promise<OfficePageText>) | null;
  let length: number;
  if (format === "docx") {
    const { createPageRenderer } = await import("docx-preview");
    signal.throwIfAborted();
    const reader = await createPageRenderer(data, {
      signal,
      pageElementLimit: OFFICE_DOCX_PAGE_ELEMENTS,
      useBase64URL: true,
      ignoreFonts: true,
      renderAltChunks: false,
      ignoreLastRenderedPageBreak: false,
      h: (element) => {
        signal.throwIfAborted();
        return frameElement(doc, element);
      },
    });
    signal.throwIfAborted();
    styles.replaceChildren(...reader.styles);
    length = reader.length;
    render = (index) => reader.get(index);
    readText = (index) => reader.getText(index);
  } else {
    const { openPresentation } = await import("@jvmr/pptx-to-html");
    signal.throwIfAborted();
    const reader = await openPresentation(data.slice().buffer, signal);
    length = reader.length;
    readText = async (index) => ({
      text: await reader.getText(index),
      headingPath: [],
      headings: [],
    });
    render = async (index) => {
      const html = await reader.get(index);
      signal.throwIfAborted();
      return slideElement(doc, html);
    };
  }
  signal.throwIfAborted();
  if (!length) throw new OfficePreviewError("invalid");
  if (length > OFFICE_MAX_PAGES) throw new OfficePreviewError("tooLarge");
  const cache = new Map<number, HTMLElement>();
  const textCache = new Map<number, OfficePageText>();
  let cachedCharacters = 0;
  const getText = async (index: number, requestSignal: AbortSignal): Promise<OfficePageText> => {
    signal.throwIfAborted();
    requestSignal.throwIfAborted();
    if (!readText) throw new DOMException("Disposed", "AbortError");
    const cached = textCache.get(index);
    if (cached) return cached;
    const value = await readText(index);
    signal.throwIfAborted();
    requestSignal.throwIfAborted();
    if (cachedCharacters + value.text.length <= OFFICE_SEARCH_MAX_TEXT) {
      textCache.set(index, value);
      cachedCharacters += value.text.length;
    }
    return value;
  };
  let pending: Promise<unknown> = Promise.resolve();
  return {
    length,
    getText,
    getPage(index, requestSignal) {
      // DOCX renderers carry numbering/header state; serialize requests, skipping superseded pages before work.
      const next = pending.then(async () => {
        signal.throwIfAborted();
        requestSignal.throwIfAborted();
        if (!render) throw new DOMException("Disposed", "AbortError");
        const page = cache.get(index) ?? (await render(index));
        signal.throwIfAborted();
        requestSignal.throwIfAborted();
        page.dataset.officePage = String(index + 1);
        page.dataset.officeKind = format;
        if (format === "docx")
          page.dataset.officeHeadingPath = JSON.stringify(
            (await getText(index, requestSignal)).headingPath,
          );
        cache.delete(index);
        cache.set(index, page);
        while (cache.size > OFFICE_PAGE_CACHE_SIZE)
          cache.delete(cache.keys().next().value as number);
        return page;
      });
      pending = next.catch(() => {});
      return next;
    },
    dispose() {
      cache.clear();
      textCache.clear();
      render = null;
      readText = null;
      styles.replaceChildren();
    },
  };
}
