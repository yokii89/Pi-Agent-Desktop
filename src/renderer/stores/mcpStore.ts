import { useSyncExternalStore } from "react";
import type { McpProbeResult } from "../../shared/ipc";

/**
 * MCP 面板的跨页持久状态（docs/design/40 MCP优化方案 1）：
 * 探测最长 60 秒，切页（中央区按页条件渲染）不应丢快照；dirty 横幅同理——
 * 「改了配置待重载」的提醒一旦消失，用户可能忘记重载会话。
 * 探测中的开始时间一并保留，返回页面后已等待秒数从真实起点续算。
 */
export interface McpPagePersistentState {
  probe: McpProbeResult | null;
  /** 本次探测使用的项目 cwd（null = 主进程默认目录）；换项目后快照即失效。 */
  probeCwd: string | null;
  probing: boolean;
  probingStartedAt: number | null;
  probeError: string | null;
  /** 配置已变更待重载活跃会话。 */
  dirty: boolean;
}

const initialState: McpPagePersistentState = {
  probe: null,
  probeCwd: null,
  probing: false,
  probingStartedAt: null,
  probeError: null,
  dirty: false,
};

let state: McpPagePersistentState = initialState;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const mcpStore = {
  get(): McpPagePersistentState {
    return state;
  },
  /** 浅合并更新；跨页保留的状态都经此写入。 */
  set(partial: Partial<McpPagePersistentState>): void {
    state = { ...state, ...partial };
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** 订阅 MCP 面板跨页状态（McpPage 挂载即复用，切页不丢）。 */
export function useMcpPageState(): McpPagePersistentState {
  return useSyncExternalStore(mcpStore.subscribe, mcpStore.get);
}
