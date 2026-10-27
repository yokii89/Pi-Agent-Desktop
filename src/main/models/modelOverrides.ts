/**
 * 用户级 models.json（~/.pi/agent/models.json）的 per-model 覆盖读写与校验（docs/design/49）。
 *
 * pi 对该文件是"整个拒收"语义：schema 非法会让全部覆盖失效（model-config.js:275），
 * 因此这里只动目标字段、未知键原样保留、原子写；解析失败一律抛错，绝不静默重置。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  PiModelInputModality,
  PiModelOverridePatch,
  PiModelOverridesSnapshot,
} from "../../shared/ipc";
import { resolvePiAgentDir } from "../mcp/mcpConfig";

export function getUserModelsConfigPath(): string {
  return join(resolvePiAgentDir(), "models.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isModality(value: unknown): value is PiModelInputModality {
  return value === "text" || value === "image";
}

/** 读取原始全文；文件缺失返回空骨架，JSON/顶层非法时抛错（让上层提示用户手修）。 */
function readRawConfig(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(
      `models.json 解析失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new Error("models.json 顶层必须是对象，请手动修复后再改");
  }
  return parsed;
}

function writeRawConfig(config: Record<string, unknown>, file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.pidesk-tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
}

/** 覆盖快照投影：只暴露本 UI 管理的三个字段，未知/非法值按"未设置"处理。 */
export function readModelOverrides(
  file: string = getUserModelsConfigPath(),
): PiModelOverridesSnapshot {
  const raw = readRawConfig(file);
  const providers = isRecord(raw.providers) ? raw.providers : {};
  const out: PiModelOverridesSnapshot = {};
  for (const [providerId, providerConfig] of Object.entries(providers)) {
    if (!isRecord(providerConfig) || !isRecord(providerConfig.modelOverrides)) continue;
    const models: PiModelOverridesSnapshot[string] = {};
    for (const [modelId, entry] of Object.entries(providerConfig.modelOverrides)) {
      if (!isRecord(entry)) continue;
      const projected: PiModelOverridesSnapshot[string][string] = {};
      if (
        typeof entry.contextWindow === "number" &&
        Number.isSafeInteger(entry.contextWindow) &&
        entry.contextWindow > 0
      ) {
        projected.contextWindow = entry.contextWindow;
      }
      if (
        typeof entry.maxTokens === "number" &&
        Number.isSafeInteger(entry.maxTokens) &&
        entry.maxTokens > 0
      ) {
        projected.maxTokens = entry.maxTokens;
      }
      if (Array.isArray(entry.input)) {
        const modalities = entry.input.filter(isModality);
        if (modalities.length > 0) projected.input = modalities;
      }
      if (Object.keys(projected).length > 0) models[modelId] = projected;
    }
    if (Object.keys(models).length > 0) out[providerId] = models;
  }
  return out;
}

export interface ModelOverrideUpdate {
  provider: string;
  modelId: string;
  patch: PiModelOverridePatch;
}

function validContextWindow(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function validMaxTokens(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * 校验补丁并写回原始配置（纯函数：结构复制写，不改入参；测试锚点）。
 * 空对象逐级清理：entry 空删 modelId，modelOverrides 空删该键，provider 空删 provider。
 */
export function applyModelOverridePatch(
  raw: Record<string, unknown>,
  update: ModelOverrideUpdate,
): Record<string, unknown> {
  const provider = update.provider.trim();
  const modelId = update.modelId.trim();
  if (!provider || !modelId) throw new Error("provider / modelId 不能为空");
  const { patch } = update;
  if (
    patch.contextWindow !== undefined &&
    patch.contextWindow !== null &&
    !validContextWindow(patch.contextWindow)
  ) {
    throw new Error("上下文窗口必须是正整数");
  }
  if (
    patch.maxTokens !== undefined &&
    patch.maxTokens !== null &&
    !validMaxTokens(patch.maxTokens)
  ) {
    throw new Error("输出上限必须是正整数");
  }
  if (
    patch.input !== undefined &&
    patch.input !== null &&
    (!Array.isArray(patch.input) || patch.input.length === 0 || !patch.input.every(isModality))
  ) {
    throw new Error('input 只接受 ["text", "image"] 的非空子集');
  }
  if (
    patch.contextWindow === undefined &&
    patch.maxTokens === undefined &&
    patch.input === undefined
  ) {
    throw new Error("补丁为空");
  }

  const providers = { ...(isRecord(raw.providers) ? raw.providers : {}) };
  const providerConfig = { ...(isRecord(providers[provider]) ? providers[provider] : {}) };
  const overrides = {
    ...(isRecord(providerConfig.modelOverrides) ? providerConfig.modelOverrides : {}),
  };
  const entry = { ...(isRecord(overrides[modelId]) ? overrides[modelId] : {}) };

  if (patch.contextWindow === null) delete entry.contextWindow;
  else if (patch.contextWindow !== undefined) entry.contextWindow = patch.contextWindow;
  if (patch.maxTokens === null) delete entry.maxTokens;
  else if (patch.maxTokens !== undefined) entry.maxTokens = patch.maxTokens;
  if (patch.input === null) delete entry.input;
  else if (patch.input !== undefined) entry.input = patch.input;

  if (Object.keys(entry).length === 0) delete overrides[modelId];
  else overrides[modelId] = entry;
  if (Object.keys(overrides).length === 0) delete providerConfig.modelOverrides;
  else providerConfig.modelOverrides = overrides;
  if (Object.keys(providerConfig).length === 0) delete providers[provider];
  else providers[provider] = providerConfig;

  const next = { ...raw };
  if (Object.keys(providers).length === 0) delete next.providers;
  else next.providers = providers;
  return next;
}

/** 校验 + 读盘 + 写盘（原子）；失败时原文件不动。 */
export function setModelOverride(
  update: ModelOverrideUpdate,
  file: string = getUserModelsConfigPath(),
): void {
  const raw = readRawConfig(file);
  const next = applyModelOverridePatch(raw, update);
  writeRawConfig(next, file);
}
