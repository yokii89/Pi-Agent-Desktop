import fs from "node:fs";
import path from "node:path";
import { getPiAgentDir } from "./piInfo";

/**
 * pi 自身 settings.json 的读写（~/.pi/agent/settings.json）。
 * 只处理 PiDesk 需要读改的字段：defaultProvider / defaultModel 等；
 * 读改写一律保留其余字段，文件损坏时写路径抛错、读路径回退空对象。
 */

function piSettingsFile(): string {
  return path.join(getPiAgentDir(), "settings.json");
}

/**
 * 读取原始文本并剥离 UTF-8 BOM。
 * PowerShell 等工具写 JSON 会带 BOM，Node utf8 解码不会自动剥离。
 */
function readRaw(): string {
  const raw = fs.readFileSync(piSettingsFile(), "utf8");
  return raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
}

/** 宽松读：缺失 / 损坏返回空对象。 */
export function readPiSettingsLenient(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readRaw()) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 严格读：缺失返回空对象，损坏抛中文错误。 */
export function readPiSettingsStrict(): Record<string, unknown> {
  let raw: string;
  try {
    raw = readRaw();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`pi 配置文件损坏（${piSettingsFile()}），请手动修复后再试`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`pi 配置文件损坏（${piSettingsFile()}），请手动修复后再试`);
  }
  return parsed as Record<string, unknown>;
}

/** 写回整个 settings 对象（目录不存在时创建）。 */
export function writePiSettings(next: Record<string, unknown>): void {
  const file = piSettingsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
}

/** 读取 pi 启动默认模型（settings.json 的 defaultProvider / defaultModel）。 */
export function readDefaultModel(): { provider: string | null; modelId: string | null } {
  const raw = readPiSettingsLenient();
  const provider =
    typeof raw.defaultProvider === "string" && raw.defaultProvider ? raw.defaultProvider : null;
  const modelId =
    typeof raw.defaultModel === "string" && raw.defaultModel ? raw.defaultModel : null;
  return { provider, modelId };
}

/**
 * 写入启动默认模型（对齐 pi `/model` + Ctrl+S 的落盘字段）。
 * 读-改-写保留其余字段；文件损坏时抛错。
 */
export function setDefaultModel(provider: string, modelId: string): void {
  const next = readPiSettingsStrict();
  next.defaultProvider = provider;
  next.defaultModel = modelId;
  writePiSettings(next);
}

/**
 * 只改 defaultProvider、保留 defaultModel。
 * 用于跨厂商激活且该凭据没有 preferredModel 时：避免把 defaultModel
 * 写成 provider id（非合法模型名），等用户在模型下拉选一次后再写回。
 */
export function setDefaultProviderOnly(provider: string): void {
  const next = readPiSettingsStrict();
  next.defaultProvider = provider;
  writePiSettings(next);
}
