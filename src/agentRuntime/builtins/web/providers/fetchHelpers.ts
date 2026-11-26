/**
 * Shared fetch helpers — HTTP client, content-type guards, and HTML-to-text
 * extraction used by providers that wrap the built-in pipeline (Brave, Serper,
 * SearXNG). `fetchViaGenericHtml` is the one-stop entry point those providers
 * delegate their `fetch()` method to.
 */

import { readResponseText } from "../../http.js";
import type { FetchResponse } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USER_AGENT = "Mozilla/5.0 (compatible; PiDesk/1.0)";
const FETCH_ACCEPT_HEADER =
  "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5";
const HTML_CONTENT_TYPE_TOKEN = "text/html";

// ---------------------------------------------------------------------------
// HTML-to-text extraction
// ---------------------------------------------------------------------------

const SCRIPT_BLOCK_REGEX = /<script[\s\S]*?<\/script>/gi;
const STYLE_BLOCK_REGEX = /<style[\s\S]*?<\/style>/gi;
const NOSCRIPT_BLOCK_REGEX = /<noscript[\s\S]*?<\/noscript>/gi;
const BLOCK_CLOSER_REGEX =
  /<\/(p|div|h[1-6]|li|tr|br|blockquote|pre|section|article|header|footer|nav|details|summary)>/gi;
const SELF_CLOSING_BR_REGEX = /<br\s*\/?>/gi;
const ANY_REMAINING_TAG_REGEX = /<[^>]+>/g;
const TITLE_TAG_REGEX = /<title[^>]*>([\s\S]*?)<\/title>/i;
const NUMERIC_HTML_ENTITY_REGEX = /&#(x[\da-f]+|\d+);/gi;
const HORIZONTAL_WHITESPACE_RUN = /[ \t]+/g;
const BLANK_LINE_RUN = /\n{3,}/g;

function stripNonContentBlocks(html: string): string {
  return html
    .replace(SCRIPT_BLOCK_REGEX, "")
    .replace(STYLE_BLOCK_REGEX, "")
    .replace(NOSCRIPT_BLOCK_REGEX, "");
}

function convertBlockTagsToNewlines(text: string): string {
  return text.replace(BLOCK_CLOSER_REGEX, "\n").replace(SELF_CLOSING_BR_REGEX, "\n");
}

function stripRemainingTags(text: string): string {
  return text.replace(ANY_REMAINING_TAG_REGEX, " ");
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(NUMERIC_HTML_ENTITY_REGEX, (entity: string, code: string) => {
      const point = /^x/i.test(code) ? Number.parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff && (point < 0xd800 || point > 0xdfff)
        ? String.fromCodePoint(point)
        : entity;
    });
}

function collapseWhitespace(text: string): string {
  return text.replace(HORIZONTAL_WHITESPACE_RUN, " ").replace(BLANK_LINE_RUN, "\n\n");
}

export function htmlToText(html: string): string {
  let text = stripNonContentBlocks(html);
  text = convertBlockTagsToNewlines(text);
  text = stripRemainingTags(text);
  text = decodeHtmlEntities(text);
  text = collapseWhitespace(text);
  return text.trim();
}

export function extractTitle(html: string): string | undefined {
  const match = html.match(TITLE_TAG_REGEX);
  if (!match) return undefined;
  return match[1].replace(ANY_REMAINING_TAG_REGEX, "").trim() || undefined;
}

// ---------------------------------------------------------------------------
// URL + content-type guards
// ---------------------------------------------------------------------------

export function isHtmlContentType(contentType: string): boolean {
  const type = contentType.split(";")[0].trim().toLowerCase();
  return type === HTML_CONTENT_TYPE_TOKEN || type === "application/xhtml+xml";
}

export function assertTextContentType(contentType: string): void {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (
    type &&
    !type.startsWith("text/") &&
    !/^application\/(?:json|xml|[\w.+-]+\+(?:json|xml))$/.test(type)
  ) {
    throw new Error(
      `Unsupported content type: ${contentType}. web_fetch supports text pages only.`,
    );
  }
}

// ---------------------------------------------------------------------------
// HTTP fetch
// ---------------------------------------------------------------------------

export function buildFetchRequestInit(signal: AbortSignal | undefined): RequestInit {
  return {
    signal,
    redirect: "manual",
    headers: { "User-Agent": USER_AGENT, Accept: FETCH_ACCEPT_HEADER },
  };
}

export async function fetchUrlOrThrow(
  url: string,
  signal: AbortSignal | undefined,
  validateUrl?: (url: string) => void,
): Promise<Response> {
  let target = url;
  for (let redirects = 0; redirects <= 5; redirects++) {
    validateUrl?.(target);
    const res = await fetch(target, buildFetchRequestInit(signal));
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location || redirects === 5) throw new Error("Invalid or excessive web redirects.");
      target = new URL(location, target).href;
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${target}`);
    }
    return res;
  }
  throw new Error("Too many web redirects.");
}

export async function extractBodyAsText(
  res: Response,
  contentType: string,
  raw: boolean,
): Promise<{ text: string; title?: string }> {
  const body = await readResponseText(res);
  if (!raw && isHtmlContentType(contentType)) {
    return { text: htmlToText(body), title: extractTitle(body) };
  }
  return { text: body };
}

// One-stop fetch helper for providers that have no native fetch endpoint
// (Brave/Serper/SearXNG). Bundles the quartet — fetchUrlOrThrow →
// content-type assertion → body extraction → FetchResponse envelope — so
// providers collapse to a single delegating call.
export async function fetchViaGenericHtml(
  url: string,
  raw: boolean,
  signal?: AbortSignal,
  validateUrl?: (url: string) => void,
): Promise<FetchResponse> {
  const res = await fetchUrlOrThrow(url, signal, validateUrl);
  const contentType = res.headers.get("content-type") ?? "";
  try {
    assertTextContentType(contentType);
  } catch (error) {
    await res.body?.cancel();
    throw error;
  }
  const { text, title } = await extractBodyAsText(res, contentType, raw);
  const contentLengthHeader = res.headers.get("content-length");
  return {
    text,
    title,
    contentType: contentType || undefined,
    contentLength: contentLengthHeader ? Number(contentLengthHeader) : undefined,
  };
}
