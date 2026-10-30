import { useEffect, useRef, useState } from "react";
import type { PiSlashCommand } from "../../../shared/ipc";
import { mcpService } from "../../services/mcpService";
import { readSlashCommandCache } from "../../services/slashCommandCache";
import { useMcpPageState } from "../../stores/mcpStore";
import { skillNames } from "./sessionMonitorData";

/** 监控卡「技能与 MCP」区的数据。 */
export interface MonitorCapabilities {
  /** 当前 cwd 可用的技能名（来自 pi 的 `get_commands`）。 */
  skills: string[];
  /** 用户级 mcp.json 的条目数与启用数；null = 未读到（或无 preload）。 */
  mcp: { total: number; enabled: number } | null;
  /** MCP 配置已改、待重载活跃会话（与 MCP 面板的横幅同源）。 */
  mcpDirty: boolean;
}

interface MonitorCapabilitiesArgs {
  active: boolean;
  cwd: string | null;
  /** 会话进程存活：只有它能保证 `get_commands` 走 RPC 而不是新起进程。 */
  processAlive: boolean;
  requestCommands: () => Promise<PiSlashCommand[]>;
}

/**
 * 技能与 MCP 的取数。
 *
 * 技能读 `slashCommandCache`（cwd 级缓存，斜杠面板写过就有），未命中且进程存活时才
 * 补发一次 `get_commands`——冷会话不为了这张卡 spawn pi（docs/会话进程懒加载方案 §5.2）。
 * MCP 只读 mcp.json 快照，不触发 `pi mcp list` 探测：那是 MCP 面板的 60 秒级操作，
 * 一块监控卡不该在后台连一遍所有 server。
 */
export function useMonitorCapabilities(args: MonitorCapabilitiesArgs): MonitorCapabilities {
  const { active, cwd, processAlive, requestCommands } = args;
  const [skills, setSkills] = useState<string[]>([]);
  const [mcp, setMcp] = useState<{ total: number; enabled: number } | null>(null);
  const { dirty } = useMcpPageState();
  const requestRef = useRef(requestCommands);
  requestRef.current = requestCommands;

  useEffect(() => {
    if (!active) return;
    const cached = readSlashCommandCache(cwd);
    setSkills(skillNames(cached));
    if (cached || !processAlive) return;

    let cancelled = false;
    void requestRef
      .current()
      .then(() => {
        if (!cancelled) setSkills(skillNames(readSlashCommandCache(cwd)));
      })
      .catch(() => {
        // 拿不到命令列表就不展示技能区，不打扰用户
      });
    return () => {
      cancelled = true;
    };
  }, [active, cwd, processAlive]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void mcpService
      .list()
      .then((snapshot) => {
        if (cancelled) return;
        const enabled = snapshot.entries.filter(
          (entry) => !entry.invalid && entry.config.enabled !== false,
        ).length;
        setMcp({ total: snapshot.entries.length, enabled });
      })
      .catch(() => {
        if (!cancelled) setMcp(null);
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  return { skills, mcp, mcpDirty: dirty };
}
