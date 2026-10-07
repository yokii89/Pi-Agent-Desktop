import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PiInfo } from "../../shared/ipc";
import { resolvePiCommand, runPiVersion } from "./piLauncher";

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

/** 读取 pi 信息（版本 + 默认模型配置），供模型展示与设置页关于区。 */
export function getPiInfo(configuredPath: string | null): PiInfo {
  let version: string | null = null;
  let executablePath: string | null = configuredPath;
  try {
    const command = resolvePiCommand(configuredPath);
    executablePath = command.piPath;
    version = runPiVersion(command);
  } catch {
    // 未找到 pi：版本为 null，渲染层展示"未接入"
  }
  return {
    version,
    ...readPiModelConfig(),
    executablePath,
  };
}
