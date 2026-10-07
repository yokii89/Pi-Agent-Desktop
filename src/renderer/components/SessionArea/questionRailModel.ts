import type { SessionEntry } from "../../stores/sessionTranscript";
import {
  parseUserMessageSegments,
  readableUserMessageWithImages,
} from "../../utils/userMessageSegments";

/**
 * 对话问题导航分段栏（QuestionRail）的纯逻辑，借鉴 ZCode `ConversationTurnNavigator`
 * （docs/design/34、docs/design/30 借鉴清单）。全部为无副作用纯函数，便于 vitest
 * 直接覆盖（遵循 renderer「只测纯逻辑不挂 DOM」惯例）；DOM 测量、滚动跟随、气泡
 * 定时与跳转校正见 QuestionRail.tsx。
 */

/** 预览默认参数：与 ZCode turn navigator 对齐（220 字、前 2 段）。 */
export const QUESTION_PREVIEW_MAX_CHARS = 220;
export const QUESTION_PREVIEW_MAX_PARAGRAPHS = 2;

/** 一条用户问题对应的分段。 */
export interface QuestionSegment {
  /** 用户条目 id，作 DOM 定位锚点（SessionView 的 data-entry-id）。 */
  id: string;
  /** 在分段序列中的下标（0 起），激活/缩放/焦点导航都按它索引。 */
  index: number;
  /** 悬停气泡展示的可读预览（已切段/压缩/截断；纯图消息为图片计数文案）。 */
  preview: string;
}

/**
 * 空行切段 → 压缩每段内空白 → 取前 maxParagraphs 段（段间以换行分隔，供
 * `white-space: pre-line` 渲染）→ 按 maxChars 截断加省略号。空文本返回空串。
 */
export function previewFromText(
  text: string,
  maxChars = QUESTION_PREVIEW_MAX_CHARS,
  maxParagraphs = QUESTION_PREVIEW_MAX_PARAGRAPHS,
): string {
  const paragraphs = text
    .trim()
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .slice(0, Math.max(1, maxParagraphs));
  if (paragraphs.length === 0) return "";
  const joined = paragraphs.join("\n");
  const limit = Math.max(8, maxChars);
  if (joined.length <= limit) return joined;
  return `${joined.slice(0, limit - 3).trimEnd()}...`;
}

/**
 * 会话条目 → 问题分段序列：取全部 `kind === "user"` 条目，逐条还原可读文本
 * （剥离计划模式前缀、隐藏引用路径附注、文件芯片降为 @basename），仅图无文时
 * 回退图片计数文案（复用 readableUserMessageWithImages）。index 为序列内下标。
 */
export function buildQuestionSegments(entries: readonly SessionEntry[]): QuestionSegment[] {
  const segments: QuestionSegment[] = [];
  for (const entry of entries) {
    if (entry.kind !== "user") continue;
    const readable = readableUserMessageWithImages(
      parseUserMessageSegments(entry.text),
      entry.images?.length ?? 0,
    );
    segments.push({
      id: entry.id,
      index: segments.length,
      preview: previewFromText(readable),
    });
  }
  return segments;
}

/** 单个问题行在滚动内容中的实测位置（相对内容顶部，px）。 */
export interface QuestionRow {
  /** 对应 QuestionSegment.index。 */
  index: number;
  start: number;
  end: number;
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * 依滚动位置挑激活分段（ZCode `resolveConversationTurnNavigatorActiveQueryRowId` 规则）：
 * 与视口相交的行中取 start 最接近 scrollTop 者；无相交行时退回上方最后一行，
 * 再退回下方第一行。rows 为空返回 undefined。
 */
export function pickActiveSegment(
  rows: readonly QuestionRow[],
  scrollTop: number,
  viewportHeight: number,
): number | undefined {
  if (rows.length === 0) return undefined;

  const viewportStart = finiteNonNegative(scrollTop);
  const viewportEnd = viewportStart + Math.max(1, finiteNonNegative(viewportHeight));
  const normalized = rows
    .map((row) => {
      const start = finiteNonNegative(row.start);
      return {
        index: row.index,
        start,
        end: Math.max(start, finiteNonNegative(row.end)),
      };
    })
    .sort((left, right) => left.start - right.start || left.index - right.index);

  let nearest: (typeof normalized)[number] | undefined;
  for (const row of normalized) {
    if (row.end < viewportStart || row.start > viewportEnd) continue;
    if (
      nearest === undefined ||
      Math.abs(row.start - viewportStart) < Math.abs(nearest.start - viewportStart)
    ) {
      nearest = row;
    }
  }
  if (nearest !== undefined) return nearest.index;

  // 无相交行：优先上方最后一行，其次下方第一行
  let above: number | undefined;
  for (const row of normalized) {
    if (row.start <= viewportStart) above = row.index;
  }
  if (above !== undefined) return above;
  return normalized.find((row) => row.start > viewportStart)?.index;
}

/**
 * 距视觉焦点的分档视觉状态（ZCode `resolveConversationTurnNavigatorBarVisualState`）：
 * 0 → 2.6/1（峰），1 → 1.7/0.86，2 → 1.25/0.72，≥3 → 1/0.58（基线）。
 * focusIndex 为 undefined（无焦点）时全部落基线档。
 */
export interface SegmentVisualState {
  scaleX: number;
  opacity: number;
  /** 峰档用前景色，其余用弱色。 */
  focus: boolean;
}

export function segmentVisualState(
  itemIndex: number,
  focusIndex: number | undefined,
): SegmentVisualState {
  if (focusIndex === undefined) return { scaleX: 1, opacity: 0.58, focus: false };
  const distance = Math.abs(itemIndex - focusIndex);
  if (distance === 0) return { scaleX: 2.6, opacity: 1, focus: true };
  if (distance === 1) return { scaleX: 1.7, opacity: 0.86, focus: false };
  if (distance === 2) return { scaleX: 1.25, opacity: 0.72, focus: false };
  return { scaleX: 1, opacity: 0.58, focus: false };
}
