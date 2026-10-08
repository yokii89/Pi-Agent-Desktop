import fs from "node:fs";
import path from "node:path";
import type { PiApiKeyProviderOption, PiGatewayApiType } from "../../shared/ipc";
import { getPiAgentDir } from "./piInfo";

/**
 * pi / pi-ai 鉴权文件（~/.pi/agent/auth.json）底层读写 + provider 目录。
 * 多凭据命名注册表在 `piCredentials.ts`；激活时由那边写入本文件的标准 provider 键。
 */

/** 常见可粘贴 API Key 的 provider（对齐 pi providers 文档表格）。 */
const API_KEY_PROVIDERS: PiApiKeyProviderOption[] = [
  { id: "anthropic", label: "Anthropic", envVar: "ANTHROPIC_API_KEY" },
  { id: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY" },
  { id: "google", label: "Google Gemini", envVar: "GEMINI_API_KEY" },
  { id: "deepseek", label: "DeepSeek", envVar: "DEEPSEEK_API_KEY" },
  { id: "openrouter", label: "OpenRouter", envVar: "OPENROUTER_API_KEY" },
  { id: "xai", label: "xAI", envVar: "XAI_API_KEY" },
  { id: "groq", label: "Groq", envVar: "GROQ_API_KEY" },
  { id: "mistral", label: "Mistral", envVar: "MISTRAL_API_KEY" },
  { id: "openai-codex", label: "OpenAI Codex", envVar: "OPENAI_API_KEY" },
  { id: "github-copilot", label: "GitHub Copilot", envVar: "" },
  { id: "zai", label: "ZAI Coding Plan (Global)", envVar: "ZAI_API_KEY" },
  { id: "zai-coding-cn", label: "ZAI Coding Plan (China)", envVar: "ZAI_CODING_CN_API_KEY" },
  { id: "xiaomi", label: "Xiaomi MiMo", envVar: "XIAOMI_API_KEY" },
  { id: "kimi-coding", label: "Kimi For Coding", envVar: "KIMI_API_KEY" },
  { id: "qwen-token-plan", label: "Qwen Token Plan", envVar: "QWEN_TOKEN_PLAN_API_KEY" },
  { id: "together", label: "Together AI", envVar: "TOGETHER_API_KEY" },
  { id: "fireworks", label: "Fireworks", envVar: "FIREWORKS_API_KEY" },
  { id: "nvidia", label: "NVIDIA NIM", envVar: "NVIDIA_API_KEY" },
  { id: "amazon-bedrock", label: "Amazon Bedrock", envVar: "AWS_BEARER_TOKEN_BEDROCK" },
  { id: "opencode", label: "OpenCode Zen", envVar: "OPENCODE_API_KEY" },
  // 网关：允许自定义 baseUrl / api；写入 oauth(access) 以对齐 pi-provider-newapi
  { id: "newapi", label: "New API", envVar: "NEWAPI_API_KEY", gateway: true },
];

/** 网关 provider 集合：只有这些允许自定义 baseUrl / api。 */
const GATEWAY_PROVIDER_IDS = new Set(API_KEY_PROVIDERS.filter((p) => p.gateway).map((p) => p.id));

export function isGatewayProvider(id: string): boolean {
  return GATEWAY_PROVIDER_IDS.has(id);
}

export function providerLabel(id: string): string {
  return API_KEY_PROVIDERS.find((p) => p.id === id)?.label ?? id;
}

export function normalizeGatewayApi(value: string | null | undefined): PiGatewayApiType {
  const raw = value?.trim().toLowerCase();
  return raw === "openai-responses" ? "openai-responses" : "openai-completions";
}

export function authFile(): string {
  return path.join(getPiAgentDir(), "auth.json");
}

function stripBom(raw: string): string {
  return raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
}

export function readAuthLenient(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(authFile(), "utf8");
    const parsed = JSON.parse(stripBom(raw)) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readAuthStrict(): Record<string, unknown> {
  let raw: string;
  try {
    raw = fs.readFileSync(authFile(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(raw));
  } catch {
    throw new Error(`pi 鉴权文件损坏（${authFile()}），请手动修复后再试`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`pi 鉴权文件损坏（${authFile()}），请手动修复后再试`);
  }
  return parsed as Record<string, unknown>;
}

export function writeAuth(next: Record<string, unknown>): void {
  const file = authFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // 0600：仅当前用户可读写（与 pi 自身写 auth.json 的约定一致）
  fs.writeFileSync(file, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
}

/**
 * 清掉 newapi 扩展的本地模型缓存。
 * 缓存键是 baseUrl + key 指纹、TTL 24h：服务端改 token 分组不会变指纹，
 * 不主动删除就会一直返回旧分组的模型列表。
 */
export function invalidateGatewayModelCache(): void {
  try {
    fs.unlinkSync(path.join(getPiAgentDir(), "newapi-models.json"));
  } catch {
    // 文件不存在时忽略
  }
}

export function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return "********";
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export function listApiKeyProviders(): PiApiKeyProviderOption[] {
  return API_KEY_PROVIDERS;
}

/** 从 auth.json 条目提取明文密钥（api_key.key 或 oauth.access）。 */
export function extractSecret(record: Record<string, unknown>): string | null {
  if (typeof record.key === "string" && record.key) return record.key;
  if (typeof record.access === "string" && record.access) return record.access;
  return null;
}

/**
 * 把一条凭据记录写入 auth.json 的标准 provider 键（覆盖该键）。
 * pi 只认标准 provider id，因此多凭据切换 = 换写同一把锁。
 */
export function writeProviderAuth(
  provider: string,
  fields: {
    kind: "api_key" | "oauth" | "unknown";
    secret: string | null;
    baseUrl: string | null;
    api: string | null;
    preferredModel: string | null;
    expiresAt: number | null;
  },
): void {
  const next = readAuthStrict();
  const gateway = isGatewayProvider(provider);
  const merged: Record<string, unknown> = {};

  if (gateway) {
    merged.type = "oauth";
    merged.access = fields.secret ?? "";
    merged.refresh = "";
    merged.expires =
      fields.expiresAt !== null && Number.isFinite(fields.expiresAt)
        ? fields.expiresAt
        : Number.MAX_SAFE_INTEGER;
    const baseUrl = fields.baseUrl?.trim() ?? "";
    if (baseUrl) {
      merged.baseUrl = baseUrl.replace(/\/+$/, "").replace(/\/v1\/?$/i, "");
    }
    merged.api = normalizeGatewayApi(fields.api);
  } else if (fields.kind === "oauth" && fields.secret) {
    merged.type = "oauth";
    merged.access = fields.secret;
    merged.refresh = "";
    merged.expires =
      fields.expiresAt !== null && Number.isFinite(fields.expiresAt)
        ? fields.expiresAt
        : Number.MAX_SAFE_INTEGER;
    if (fields.baseUrl?.trim()) merged.baseUrl = fields.baseUrl.trim();
  } else {
    merged.type = "api_key";
    if (fields.secret) merged.key = fields.secret;
  }

  if (fields.preferredModel?.trim()) merged.preferredModel = fields.preferredModel.trim();

  next[provider] = merged;
  writeAuth(next);
  if (gateway) invalidateGatewayModelCache();
}

/** 删除 auth.json 中某 provider 键。 */
export function removeProviderAuth(provider: string): void {
  const next = readAuthStrict();
  if (!(provider in next)) return;
  delete next[provider];
  writeAuth(next);
  if (isGatewayProvider(provider)) invalidateGatewayModelCache();
}

/**
 * 把 auth.json 收敛为「只保留 keepProvider」：
 * 删除注册表中其它厂商的键，避免 get_available_models 混出 A+B 全量模型。
 * 不在注册表里的键（用户手写 / pi /login）不动。
 */
export function pruneAuthToSingleProvider(
  keepProvider: string,
  registryProviders: readonly string[],
): void {
  const next = readAuthStrict();
  let changed = false;
  for (const provider of registryProviders) {
    if (provider === keepProvider) continue;
    if (provider in next) {
      delete next[provider];
      changed = true;
      if (isGatewayProvider(provider)) invalidateGatewayModelCache();
    }
  }
  if (changed) writeAuth(next);
}
