/** Desktop-owned tool configuration. Secrets travel only over the private runtime port. */
export const SEARCH_PROVIDERS = [
  "brave",
  "tavily",
  "serper",
  "exa",
  "youcom",
  "jina",
  "firecrawl",
  "perplexity",
  "searxng",
  "ollama",
] as const;
export type SearchProviderId = (typeof SEARCH_PROVIDERS)[number];
export interface ToolCredential {
  baseUrl: string;
  apiKey: string;
}
export interface RuntimeBuiltinToolsConfig {
  web: { provider: SearchProviderId; providers: Partial<Record<SearchProviderId, ToolCredential>> };
  image: ToolCredential & { provider: "openai" | "openrouter"; model: string };
}
export interface BuiltinToolsConfig {
  web: {
    provider: SearchProviderId;
    providers: Partial<Record<SearchProviderId, { baseUrl: string; hasKey: boolean }>>;
  };
  image: { provider: "openai" | "openrouter"; baseUrl: string; model: string; hasKey: boolean };
}
export interface SaveBuiltinToolsConfig {
  web: { provider: SearchProviderId; providers: Partial<Record<SearchProviderId, ToolCredential>> };
  image: ToolCredential & { provider: "openai" | "openrouter"; model: string };
}
export function defaultBuiltinToolsConfig(): RuntimeBuiltinToolsConfig {
  return {
    web: { provider: "brave", providers: {} },
    image: {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-image-1",
    },
  };
}
export function publicBuiltinToolsConfig(config: RuntimeBuiltinToolsConfig): BuiltinToolsConfig {
  const providers: BuiltinToolsConfig["web"]["providers"] = {};
  for (const provider of SEARCH_PROVIDERS) {
    const credential = config.web.providers[provider];
    if (credential)
      providers[provider] = { baseUrl: credential.baseUrl, hasKey: !!credential.apiKey };
  }
  const { apiKey, ...image } = config.image;
  return {
    web: { provider: config.web.provider, providers },
    image: { ...image, hasKey: !!apiKey },
  };
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && !value.includes("\0");
}
function credential(value: unknown): value is ToolCredential {
  if (
    !object(value) ||
    !text(value.apiKey, 16384) ||
    /[\r\n]/.test(value.apiKey) ||
    !text(value.baseUrl, 4096)
  )
    return false;
  if (!value.baseUrl) return true;
  try {
    const url = new URL(value.baseUrl);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}
/** Validate and project only supported fields before storage or private-port admission. */
export function parseBuiltinToolsConfig(value: unknown): RuntimeBuiltinToolsConfig | null {
  if (
    !object(value) ||
    !object(value.web) ||
    !object(value.image) ||
    !SEARCH_PROVIDERS.includes(value.web.provider as SearchProviderId) ||
    !object(value.web.providers) ||
    !["openai", "openrouter"].includes(String(value.image.provider)) ||
    !credential(value.image) ||
    !text(value.image.model, 256) ||
    !value.image.model.trim() ||
    !value.image.baseUrl
  )
    return null;
  const providers: RuntimeBuiltinToolsConfig["web"]["providers"] = {};
  for (const [id, config] of Object.entries(value.web.providers)) {
    if (!SEARCH_PROVIDERS.includes(id as SearchProviderId) || !credential(config)) return null;
    providers[id as SearchProviderId] = {
      apiKey: config.apiKey.trim(),
      baseUrl: config.baseUrl.trim().replace(/\/+$/, ""),
    };
  }
  return {
    web: { provider: value.web.provider as SearchProviderId, providers },
    image: {
      provider: value.image.provider as "openai" | "openrouter",
      model: value.image.model.trim(),
      baseUrl: value.image.baseUrl.trim().replace(/\/+$/, ""),
      apiKey: value.image.apiKey.trim(),
    },
  };
}
/** Blank keys preserve saved credentials only when the destination is unchanged. */
export function mergeBuiltinToolsConfig(
  value: unknown,
  previous: RuntimeBuiltinToolsConfig,
): RuntimeBuiltinToolsConfig {
  const config = parseBuiltinToolsConfig(value);
  if (!config)
    throw new Error("Invalid built-in tool configuration. Use HTTPS or a local HTTP endpoint.");
  for (const provider of SEARCH_PROVIDERS) {
    const next = config.web.providers[provider];
    const saved = previous.web.providers[provider];
    if (!next && saved) config.web.providers[provider] = { ...saved };
    else if (next && !next.apiKey && saved?.apiKey) {
      if (next.baseUrl !== saved.baseUrl)
        throw new Error("Enter an API key for the new search endpoint.");
      next.apiKey = saved.apiKey;
    }
  }
  if (!config.image.apiKey && previous.image.apiKey) {
    if (
      config.image.baseUrl !== previous.image.baseUrl ||
      config.image.provider !== previous.image.provider
    )
      throw new Error("Enter an API key for the new image provider or endpoint.");
    config.image.apiKey = previous.image.apiKey;
  }
  return config;
}
