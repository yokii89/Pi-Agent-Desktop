import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PiInfo } from "../../shared/ipc";
import { type PiCommand, readPiVersion, resolvePiCommand } from "./piLauncher";

/** pi 的 agent 配置目录：PI_CODING_AGENT_DIR 环境变量优先，否则 ~/.pi/agent。 */
export function getPiAgentDir(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR;
  if (envDir && envDir.trim().length > 0) {
    const expanded = envDir.startsWith("~") ? path.join(os.homedir(), envDir.slice(1)) : envDir;
    return path.resolve(expanded);
  }
  return path.join(os.homedir(), ".pi", "agent");
}

interface PiSettingsFile {
  defaultProvider?: string;
  defaultModel?: string;
  defaultThinkingLevel?: string;
}

function readPiModelConfig(): Pick<PiInfo, "provider" | "model" | "thinkingLevel"> {
  try {
    const file = path.join(getPiAgentDir(), "settings.json");
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as PiSettingsFile;
    return {
      provider: parsed.defaultProvider ?? null,
      model: parsed.defaultModel ?? null,
      thinkingLevel: parsed.defaultThinkingLevel ?? null,
    };
  } catch {
    return { provider: null, model: null, thinkingLevel: null };
  }
}

/** 除版本号外的 pi 配置；会话模型回退标签只需要这些，不应触发子进程探测。 */
export interface PiConfigInfo {
  provider: string | null;
  model: string | null;
  thinkingLevel: string | null;
  executablePath: string | null;
}

interface ResolvedPiConfig {
  info: PiConfigInfo;
  command: PiCommand | null;
}

function resolvePiConfig(configuredPath: string | null): ResolvedPiConfig {
  let command: PiCommand | null = null;
  let executablePath = configuredPath;
  try {
    command = resolvePiCommand(configuredPath);
    executablePath = command.piPath;
  } catch {
    // 未找到 pi：版本为 null，渲染层展示"未接入"
  }
  return {
    command,
    info: {
      ...readPiModelConfig(),
      executablePath,
    },
  };
}

/** 读取 pi 配置（不含版本探测），供会话模型回退标签等热路径使用。 */
export function getPiConfigInfo(configuredPath: string | null): PiConfigInfo {
  return resolvePiConfig(configuredPath).info;
}

/** 读取 pi 信息（版本 + 默认模型配置）；版本探测异步且带缓存，不阻塞主进程。 */
export async function getPiInfo(
  configuredPath: string | null,
  options: { refresh?: boolean } = {},
): Promise<PiInfo> {
  const { info, command } = resolvePiConfig(configuredPath);
  const version = command ? await readPiVersion(command, options) : null;
  return { version, ...info };
}
