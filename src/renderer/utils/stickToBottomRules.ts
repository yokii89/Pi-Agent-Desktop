/**
 * 滚动跟随状态机的判定规则（纯函数，供 `useStickToBottom` 消费、可脱离 DOM 单测）。
 * 死区与现象的完整推演见 docs/design/121。
 *
 * 两条规则都按**方向**判定，而不是按"单次位移是否够大"判定，原因有两个死区：
 *
 * 1. 脱离跟随曾要求"距底 > 回贴阈值"。小幅度滚轮一次只走几像素，永远不满足，
 *    而 follow 期任何内容高度变化（流式增量、代码高亮落定、`content-visibility`
 *    首次实现真实高度）都会重新贴底 —— 表现为「往上划被弹回来，只有一帧划出阈值才划得上去」。
 * 2. 脱离跟随曾要求"单帧位移 > 2px"。Windows 的平滑滚动会把一次小幅度滚轮摊成
 *    每帧 1px 的连续事件，单帧阈值同样永远攒不满，是同一个回弹的另一半根因。
 *
 * 现在 follow 的不变式只有一条：**贴在底部（距底 ≈ 0）**。
 * 滚动事件里 scrollTop 在减少且已经离了底，就只能是用户上滚，一帧也算数。
 */

/** 距底多近仍视为"在底部"（px）：free → follow 的回贴阈值。 */
export const REATTACH_THRESHOLD_PX = 48;
/**
 * 距底小于等于该值即视为已贴底（px）。
 * 同时充当抖动过滤器：内容变矮时浏览器会把 scrollTop 钳回底部，
 * 那是负位移但距底仍是 0（亚像素布局/缩放可能留下不到 1px 的余量），不算用户上滚。
 */
export const AT_BOTTOM_EPSILON_PX = 1;

export type FollowMode = "follow" | "free";

/** 一次 scroll 事件的全部输入：不读 DOM，调用方负责量好。 */
export interface ScrollSignal {
  mode: FollowMode;
  /** 上一次入账的 scrollTop（px） */
  prevTop: number;
  /** 本次 scrollTop（px） */
  top: number;
  /** 本次距视口底部的高度（px） */
  distance: number;
}

/**
 * 一次 scroll 事件应触发的迁移：
 * - `release` 脱离跟随（用户上滚）；
 * - `reattach` 恢复跟随（用户向下滚回到底部附近）；
 * - `unread` 保持 free，只回报未读高度；
 * - `none` 什么都不做。
 */
export type ScrollTransition = "release" | "reattach" | "unread" | "none";

export function scrollTransition({ mode, prevTop, top, distance }: ScrollSignal): ScrollTransition {
  const delta = top - prevTop;
  if (mode === "follow") {
    return delta < 0 && distance > AT_BOTTOM_EPSILON_PX ? "release" : "none";
  }
  // 只有"向下滚进回贴区"才恢复跟随：否则刚脱离 follow 立刻被同一片区域粘回去，
  // 死区只是换了个位置。
  if (delta > 0 && distance < REATTACH_THRESHOLD_PX) return "reattach";
  return "unread";
}
