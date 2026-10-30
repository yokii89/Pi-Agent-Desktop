/**
 * 会话监控卡的派生数据（纯函数）：摘要、工作区改动、来源、技能名、路径与 URL 短语。
 *
 * 卡片只负责展示，判定与取数口径全在这里，便于不启 UI 直接跑断言。
 * 数据来源都是渲染层已有的东西：会话条目、git 变更、斜杠命令缓存、附件；
 * 不为这张卡新增任何 pi RPC，也不自建会话存储（docs/design/96 / 98）。
 */
import type { PiSlashCommand, SessionSummary } from "../../../shared/ipc";
import type { SessionEntry } from "../../stores/sessionTranscript";

/** 工作区文件改动汇总（文件数 + 增删行）。 */
export interface MonitorEdits {
  files: number;
  additions: number;
  deletions: number;
}

/** 「来源」区的单条：随用户消息发出的图片或浏览器元素。 */
export interface MonitorSource {
  key: string;
  kind: "image" | "element";
  label: string;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/**
 * 摘要正文：最后一条含正文的 assistant 消息。
 *
 * 卡片是"状态卡"不是聊天气泡，所以把换行折成单段（模型输出常带硬换行，
 * 折行后由 CSS 的多行截断统一收敛），但不做 Markdown 渲染——摘要只求扫一眼。
 */
export function lastAssistantText(entries: readonly SessionEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.kind !== "assistant") continue;
    const parts: string[] = [];
    for (const block of entry.blocks) {
      if (block.kind === "text") parts.push(block.text);
    }
    const text = parts.join("\n").trim();
    if (text) return text.replace(/\s+/g, " ");
  }
  return null;
}

/**
 * 「文件变更」口径：**项目工作区全部未提交改动**（`reviewStore.summary`，与审查面板
 * 头部汇总同源；含已暂存 / 未暂存 / 未跟踪），不是某一轮的差集——卡片回答的是
 * “这个项目现在有哪些改动”，换会话、恢复历史后都应如实反映工作区。
 * 文件数为 0 表示工作区干净（或目录不是 git 仓库），显示「无改动」。
 */
export function editsFromWorkingTree(summary: MonitorEdits): MonitorEdits | null {
  return summary.files > 0 ? summary : null;
}

/**
 * 「更新时间」：优先取侧栏会话摘要里的 updatedAt（pi JSONL 的最后一条消息时间），
 * 新会话尚未落盘时回退到文档流里最后一条带时间戳的条目。
 */
export function sessionUpdatedAt(
  sessions: readonly SessionSummary[],
  activeSessionFile: string | null,
  entries: readonly SessionEntry[],
): number | null {
  const matched = activeSessionFile
    ? sessions.find((session) => session.file === activeSessionFile)
    : undefined;
  if (matched?.updatedAt) return matched.updatedAt;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.kind === "run") {
      return entry.endedAt || entry.startedAt || null;
    }
    if (entry.kind === "notice" || entry.kind === "error" || entry.kind === "snapshot") {
      return entry.at || null;
    }
    if (entry.kind === "editsSummary") return entry.at || null;
  }
  return null;
}

/** 「来源」区：最近几条随消息发出的图片 / 浏览器元素，新的在前。 */
export function collectSources(entries: readonly SessionEntry[], limit = 3): MonitorSource[] {
  const sources: MonitorSource[] = [];
  for (let i = entries.length - 1; i >= 0 && sources.length < limit; i -= 1) {
    const entry = entries[i];
    if (entry.kind !== "user") continue;

    const images = entry.images ?? [];
    for (let j = images.length - 1; j >= 0 && sources.length < limit; j -= 1) {
      const image = images[j];
      const ext = IMAGE_EXTENSIONS[image.mimeType] ?? "png";
      sources.push({
        key: `image:${i}:${j}`,
        kind: "image",
        label: image.name?.trim() || `image.${ext}`,
      });
    }

    const items = entry.items ?? [];
    for (let j = items.length - 1; j >= 0 && sources.length < limit; j -= 1) {
      const item = items[j];
      sources.push({
        key: `element:${item.id}`,
        kind: "element",
        label: item.label.trim() || item.selector,
      });
    }
  }
  return sources;
}

/**
 * 当前 cwd 可用的技能名（`get_commands` 的 `source === "skill"` 子集）。
 * 展示名剥掉 pi 的 `skill:` 前缀：分区标题已经写着「技能」，行内再带一遍只是噪声。
 */
export function skillNames(commands: readonly PiSlashCommand[] | null | undefined): string[] {
  return (commands ?? [])
    .filter((command) => command.source === "skill")
    .map((command) => command.name.replace(/^skill:/, ""));
}

/** 网址短语：去掉协议与尾斜杠，超长从尾部截断（域名与主干路径优先保留）。 */
export function shortenUrl(url: string, max = 32): string {
  const stripped = url.replace(/^[a-z]+:\/\//i, "").replace(/\/$/, "");
  return stripped.length <= max ? stripped : `${stripped.slice(0, max - 1)}…`;
}
