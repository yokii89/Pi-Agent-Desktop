import type { Icon } from "@phosphor-icons/react";

/**
 * 结果分区（与 ZCode CommandCenterDialog 的结果源对齐）。
 * `changes`（最近改动）只在空查询下出现，不作为可搜索作用域。
 */
export type PaletteSectionId = "commands" | "sessions" | "files" | "changes";

/**
 * 搜索作用域：由输入前缀推导（`>` 命令 / `#` 会话 / `@` 文件），或点击 Tab 显式设置。
 * `all` = 不限定，三类结果都出。
 */
export type PaletteScope = "all" | Exclude<PaletteSectionId, "changes">;

/** 行内高亮：命中字符在 title / subtitle 中的下标（升序）；分词未命中该文本时缺省。 */
export interface PaletteItemHighlight {
  title?: number[];
  subtitle?: number[];
}

/** 面板中的一条可选结果（命令 / 会话 / 文件统一模型）。 */
export interface PaletteItem {
  /** 全表唯一 id（分区前缀 + 业务键）。 */
  id: string;
  section: PaletteSectionId;
  /** 主标题（已本地化 / 已取会话标题或文件名）。 */
  title: string;
  /** 次级说明（路径 / 工作目录等），可空。 */
  subtitle?: string;
  icon: Icon;
  /** 右侧展示的快捷键胶囊文本（仅命令项）。 */
  shortcut?: string;
  /** 右侧展示的普通说明文本（相对时间 / `+N -N` 等）。 */
  meta?: string;
  /** 行内命中高亮（有查询时由 filterByQuery 附上）。 */
  highlight?: PaletteItemHighlight;
  /** 小写检索文本：标题 + 副标题 + 关键词（中英并列，提升模糊命中率）。 */
  searchText: string;
  /** 选中后执行；面板在 run 后自行关闭。 */
  run: () => void | Promise<void>;
}

/** 一个分区（标题 + 已排序条目 + 是否还有更多被折叠）。 */
export interface PaletteSection {
  id: PaletteSectionId;
  titleKey: string;
  items: PaletteItem[];
  /** 命中总数（可能大于 items.length，超出部分折叠进「显示更多」）。 */
  totalMatches: number;
}
