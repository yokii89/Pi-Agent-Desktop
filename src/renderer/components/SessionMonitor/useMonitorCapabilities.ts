import { useEffect, useMemo, useRef, useState } from "react";
import type { PiSlashCommand } from "../../../shared/ipc";
import { readSlashCommandCache } from "../../services/slashCommandCache";
import type { SessionEntry } from "../../stores/sessionTranscript";
import { collectCapabilityUsage, type MonitorCapabilityUsage } from "./sessionMonitorData";

/** 监控卡「技能与 MCP」区的数据：本会话实际发生过的调用。 */
export interface MonitorCapabilities {
  usage: MonitorCapabilityUsage;
}

interface MonitorCapabilitiesArgs {
  active: boolean;
  cwd: string | null;
  /** 会话进程存活：只有它能保证 `get_commands` 走 RPC 而不是新起进程。 */
  processAlive: boolean;
  requestCommands: () => Promise<PiSlashCommand[]>;
  entries: readonly SessionEntry[];
}

/**
 * 技能与 MCP 的取数：调用事实全部从会话条目派生，这里只负责拿技能目录。
 *
 * 目录用来把「模型读了某个 SKILL.md」映射回技能名，读 `slashCommandCache`
 * （cwd 级，斜杠面板写过就有）；未命中且进程存活时才补发一次 `get_commands`——
 * 冷会话不为了这张卡 spawn pi（docs/会话进程懒加载方案 §5.2）。
 * MCP 不再读 mcp.json：卡上只展示实际调用，可用量归 MCP 面板。
 */
export function useMonitorCapabilities(args: MonitorCapabilitiesArgs): MonitorCapabilities {
  const { active, cwd, processAlive, requestCommands, entries } = args;
  const [commands, setCommands] = useState<PiSlashCommand[] | null>(null);
  const requestRef = useRef(requestCommands);
  requestRef.current = requestCommands;

  useEffect(() => {
    if (!active) return;
    const cached = readSlashCommandCache(cwd);
    setCommands(cached);
    if (cached || !processAlive) return;

    let cancelled = false;
    void requestRef
      .current()
      .then((list) => {
        // 直接用返回值，避免缓存键与当前 cwd 不一致时目录落空；空结果再回看缓存
        if (!cancelled) setCommands(list.length > 0 ? list : readSlashCommandCache(cwd));
      })
      .catch(() => {
        // 拿不到目录就不识别模型读取；用户命令与 MCP 调用不依赖它
      });
    return () => {
      cancelled = true;
    };
  }, [active, cwd, processAlive]);

  const usage = useMemo(() => collectCapabilityUsage(entries, commands), [entries, commands]);
  return { usage };
}
