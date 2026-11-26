import type { ToolRegistration } from "@earendil-works/pi-durable";
import {
  type RuntimeBuiltinToolsConfig,
  SEARCH_PROVIDERS,
  type SearchProviderId,
} from "../../../shared/builtinTools.js";
import { boundedWebText, toolArgs } from "../output.js";
import { createSearchProvider } from "./providers/factory.js";
import { fetchViaGenericHtml } from "./providers/fetchHelpers.js";

export function assertWebUrl(raw: string): URL {
  const url = new URL(raw);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw new Error("web_fetch requires an HTTP(S) URL without embedded credentials.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::" ||
    host === "::1" ||
    /^f[cd][0-9a-f]{2}:/.test(host) ||
    /^fe[89ab][0-9a-f]:/.test(host) ||
    host.startsWith("::ffff:") ||
    /^(?:0|10|127)\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
  )
    throw new Error("web_fetch cannot read a private or loopback address.");
  return url;
}
function searchBackend(config: RuntimeBuiltinToolsConfig, override?: string) {
  const name = override ?? config.web.provider;
  if (!SEARCH_PROVIDERS.includes(name as SearchProviderId))
    throw new Error("Unknown search provider.");
  const credentials = config.web.providers[name as SearchProviderId];
  const selfHosted = name === "searxng" || name === "ollama";
  if (selfHosted ? !credentials?.baseUrl : !credentials?.apiKey)
    throw new Error(`Configure ${name} in Settings → Models → Built-in tools before searching.`);
  return createSearchProvider(name, credentials ?? {});
}

/** Native tools are always installed so saved tool tasks resolve after a restart. */
export function webTools(getConfig: () => RuntimeBuiltinToolsConfig): ToolRegistration[] {
  return [
    {
      name: "web_search",
      description:
        "Search the web for current information. Returns source titles, URLs and snippets. Configure providers in desktop Settings → Models → Built-in tools. Cite sources using Markdown links in the answer.",
      replay: "safe",
      outputLimits: { maxBytes: 60 * 1024, maxLines: 2010 },
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1, maxLength: 8000 },
          max_results: { type: "integer", minimum: 1, maximum: 10, default: 5 },
          provider: { type: "string", enum: SEARCH_PROVIDERS },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async (args, api, context) => {
        const input = toolArgs(args);
        const provider = searchBackend(getConfig(), input.provider as string | undefined);
        api.output(`Searching ${provider.label}…\n`);
        const signal = context.abortSignal
          ? AbortSignal.any([context.abortSignal, AbortSignal.timeout(60000)])
          : AbortSignal.timeout(60000);
        const response = await provider.search(
          String(input.query),
          Number(input.max_results ?? 5),
          signal,
        );
        const results = response.results.slice(0, Number(input.max_results ?? 5));
        const body = results
          .map((item, index) => `${index + 1}. ${item.title}\n${item.url}\n${item.snippet}`)
          .join("\n\n");
        const output = await boundedWebText(body || `No results for: ${String(input.query)}`);
        return {
          output: [{ type: "text", text: output.text }],
          details: {
            provider: provider.name,
            resultCount: results.length,
            ...(output.fullOutputPath ? { fullOutputPath: output.fullOutputPath } : {}),
          },
        };
      },
    },
    {
      name: "web_fetch",
      description:
        "Read an HTTP(S) page as text or raw HTML. Large responses are truncated with a path to the complete text. This direct reader works without a search API key. Cite the fetched URL in the answer.",
      replay: "safe",
      outputLimits: { maxBytes: 60 * 1024, maxLines: 2010 },
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", minLength: 1, maxLength: 8192 },
          raw: { type: "boolean", default: false },
        },
        required: ["url"],
        additionalProperties: false,
      },
      execute: async (args, api, context) => {
        const input = toolArgs(args);
        let url = assertWebUrl(String(input.url));
        api.output(`Fetching ${url.href}…\n`);
        const signal = context.abortSignal
          ? AbortSignal.any([context.abortSignal, AbortSignal.timeout(60000)])
          : AbortSignal.timeout(60000);
        // Validate every redirect before issuing its request.
        const result = await fetchViaGenericHtml(url.href, input.raw === true, signal, (target) => {
          url = assertWebUrl(target);
        });
        const output = await boundedWebText(result.text);
        return {
          output: [
            {
              type: "text",
              text: `Fetched: ${url.href}\n${result.title ? `Title: ${result.title}\n` : ""}\n${output.text}`,
            },
          ],
          details: {
            url: url.href,
            ...(output.fullOutputPath ? { fullOutputPath: output.fullOutputPath } : {}),
          },
        };
      },
    },
  ];
}
