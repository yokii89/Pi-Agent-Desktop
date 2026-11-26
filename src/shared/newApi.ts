/** Desktop-owned New API catalog DTOs; no credential is exposed by these types. */
export type GatewayApi = "openai-completions" | "openai-responses";
export type GatewayThinking = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type GatewayInput = "text" | "image";
export const NEWAPI_MODEL_LIMIT = 2048;
export const NEWAPI_CACHE_TTL = 24 * 60 * 60 * 1000;
export const NEWAPI_FAILURE_TTL = 10 * 60 * 1000;

export interface GatewayModel {
  id: string;
  name: string;
  supportedEndpointTypes?: string[];
}

export interface GatewayModelInfo extends GatewayModel {
  api: GatewayApi;
  reasoning: boolean;
  input: GatewayInput[];
  contextWindow: number;
  maxTokens: number;
}

export interface GatewayCatalog<T = GatewayModel> {
  models: T[];
  fetchedAt: number | null;
  stale: boolean;
  error: string | null;
}

/** Keep path prefixes, normalize a single /v1 suffix, and reject credentials in URLs. */
export function gatewayBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  )
    throw new Error("Use an HTTPS API endpoint or a local HTTP endpoint.");
  return `${url.href.replace(/\/+$/, "").replace(/\/v1$/i, "")}/v1`;
}

/** A gateway list is advisory; non-OpenAI upstreams often cannot convert Responses requests. */
export function gatewayModelApi(
  types: readonly string[] | undefined,
  fallback: GatewayApi,
): GatewayApi {
  if (!types?.length) return fallback;
  if (types.includes("openai-response")) return "openai-responses";
  return types.some((type) => type !== "openai") ? "openai-completions" : fallback;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, max = 256): value is string {
  return (
    typeof value === "string" && !!value.trim() && value.length <= max && !value.includes("\0")
  );
}

/** Validate both network and cached model rows; malformed rows never reach the runtime. */
export function gatewayModelRows(value: unknown, cached = false): GatewayModel[] {
  if (!Array.isArray(value) || value.length > NEWAPI_MODEL_LIMIT)
    throw new Error("Invalid or oversized gateway model list.");
  const rows = new Map<string, GatewayModel>();
  for (const entry of value) {
    if (!object(entry) || !text(entry.id)) continue;
    const id = entry.id.trim();
    const source = cached ? entry.supportedEndpointTypes : entry.supported_endpoint_types;
    const types = Array.isArray(source)
      ? [
          ...new Set(
            source
              .filter((item): item is string => text(item, 64))
              .map((item) => item.trim().toLowerCase()),
          ),
        ].slice(0, 32)
      : [];
    rows.set(id, {
      id,
      name: text(entry.name) ? entry.name.trim() : id,
      ...(types.length ? { supportedEndpointTypes: types } : {}),
    });
  }
  return [...rows.values()];
}

/** Validate capability metadata returned by the private runtime port. */
export function isGatewayModelInfo(value: unknown): value is GatewayModelInfo {
  return (
    object(value) &&
    text(value.id) &&
    text(value.name) &&
    ["openai-completions", "openai-responses"].includes(String(value.api)) &&
    typeof value.reasoning === "boolean" &&
    Array.isArray(value.input) &&
    value.input.length > 0 &&
    value.input.length <= 2 &&
    value.input.every((item) => item === "text" || item === "image") &&
    typeof value.contextWindow === "number" &&
    Number.isSafeInteger(value.contextWindow) &&
    value.contextWindow > 0 &&
    value.contextWindow <= 10_000_000 &&
    typeof value.maxTokens === "number" &&
    Number.isSafeInteger(value.maxTokens) &&
    value.maxTokens > 0 &&
    value.maxTokens <= value.contextWindow &&
    (value.supportedEndpointTypes === undefined ||
      (Array.isArray(value.supportedEndpointTypes) &&
        value.supportedEndpointTypes.length <= 32 &&
        value.supportedEndpointTypes.every((item) => text(item, 64))))
  );
}

/** A real text, thinking or tool result must never be mistaken for an empty gateway response. */
export function isDegenerateGatewayResponse(message: {
  stopReason?: string;
  rawStopReason?: unknown;
  usage?: { output?: number };
  content?: unknown;
}): boolean {
  if (message.stopReason !== "length" || (message.usage?.output ?? 0) > 1) return false;
  if (!Array.isArray(message.content)) return false;
  if (
    message.content.some(
      (block: unknown) =>
        !object(block) ||
        (block.type !== "text" && block.type !== "thinking") ||
        (block.type === "text" && (typeof block.text !== "string" || !!block.text.trim())) ||
        (block.type === "thinking" &&
          (typeof block.thinking !== "string" || !!block.thinking.trim())),
    )
  )
    return false;
  return true;
}

/** Read the string subset used by Codex, with section boundaries, quotes and inline comments. */
export function codexTomlStrings(toml: string): Map<string, Map<string, string>> {
  const result = new Map<string, Map<string, string>>([["", new Map()]]);
  let section = "";
  for (const line of toml.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/.exec(line);
    if (header) {
      section = header[1]
        .split(/\.(?=(?:[^"']|"[^"]*"|'[^']*')*$)/)
        .map((part) => part.trim().replace(/^(["'])(.*)\1$/, "$2"))
        .join(".");
      if (!result.has(section)) result.set(section, new Map());
      continue;
    }
    if (/^\s*\[/.test(line)) throw new Error("Unsupported Codex configuration section.");
    const assignment = /^\s*([\w-]+)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/.exec(line);
    if (!assignment) continue;
    const raw = assignment[2];
    let value: string;
    try {
      value = raw.startsWith('"') ? (JSON.parse(raw) as string) : raw.slice(1, -1);
    } catch {
      throw new Error("Invalid string in Codex configuration.");
    }
    const target = result.get(section);
    if (target?.has(assignment[1])) throw new Error("Duplicate Codex configuration field.");
    target?.set(assignment[1], value);
  }
  return result;
}

/** Pure Codex import; only the explicit main-process import action reads files. */
export function parseCodexModel(
  auth: unknown,
  toml: string,
): {
  apiKey: string;
  baseUrl: string;
  api: GatewayApi;
  modelId?: string;
  preferredThinking?: GatewayThinking;
} {
  if (!object(auth)) throw new Error("Invalid Codex auth file.");
  const tokens = object(auth.tokens) ? auth.tokens : {};
  const apiKey = [
    auth.OPENAI_API_KEY,
    auth.openai_api_key,
    auth.api_key,
    auth.apiKey,
    auth.access_token,
    tokens.access_token,
    tokens.api_key,
    tokens.apiKey,
    tokens.token,
  ].find((value) => text(value, 16384));
  if (typeof apiKey !== "string") throw new Error("No API key found in Codex auth.");
  const sections = codexTomlStrings(toml);
  const root = sections.get("");
  const providerId = root?.get("model_provider");
  const candidates = [...sections].filter(
    ([key, fields]) => key.startsWith("model_providers.") && fields.has("base_url"),
  );
  const provider = providerId
    ? sections.get(`model_providers.${providerId}`)
    : candidates.length === 1
      ? candidates[0][1]
      : root;
  const baseUrl = provider?.get("base_url");
  if (!baseUrl?.trim()) throw new Error("No unambiguous base_url for the selected Codex provider.");
  const wire = provider?.get("wire_api")?.trim().toLowerCase();
  if (wire && !["responses", "chat", "completions"].includes(wire))
    throw new Error("Unsupported Codex wire_api.");
  const effort = root?.get("model_reasoning_effort")?.trim().toLowerCase();
  const preferredThinking =
    effort === "max"
      ? "xhigh"
      : ["off", "minimal", "low", "medium", "high", "xhigh"].includes(effort ?? "")
        ? (effort as GatewayThinking)
        : undefined;
  const modelId = root?.get("model")?.trim();
  if (modelId && !text(modelId)) throw new Error("Invalid Codex model ID.");
  return {
    apiKey: apiKey.trim(),
    baseUrl: gatewayBaseUrl(baseUrl),
    api: wire === "responses" ? "openai-responses" : "openai-completions",
    ...(modelId ? { modelId } : {}),
    ...(preferredThinking ? { preferredThinking } : {}),
  };
}
