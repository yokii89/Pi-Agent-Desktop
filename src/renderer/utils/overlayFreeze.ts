import { flushSync } from "react-dom";
import { browserService } from "../services/browserService";

/** 等两帧 rAF，确保冻结帧 <img> 已完成布局与绘制。 */
function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/**
 * 浮层打开前的防闪流程：
 * 1. 截当前页冻结帧（视图仍可见）
 * 2. 同步写入 store 并等一帧绘制（垫底画面已就位）
 * 3. 再抑制/隐藏 WebContentsView
 *
 * 若先藏视图再 setState，中间会露一帧宿主底色（闪烁）。
 */
export async function prepareOverlayFreeze(
  reason: string,
  applyFreeze: (freeze: string | null) => void,
): Promise<void> {
  const freeze = await browserService.captureOverlayFreeze();
  flushSync(() => {
    applyFreeze(freeze);
  });
  if (freeze) await waitForPaint();
  browserService.setOverlaySuppressed(true, reason);
}

/**
 * 浮层关闭：先恢复视图，再清冻结帧（顺序反过来会闪一下垫底图）。
 * 多来源叠加时主进程只在最后一个 reason 释放后才真正显示视图。
 */
export function releaseOverlayFreeze(
  reason: string,
  applyFreeze: (freeze: string | null) => void,
): void {
  void browserService.setOverlaySuppressed(false, reason);
  applyFreeze(null);
}

/**
 * 浮层交接：先 await 新 reason 抑制成功，再释放旧 reason。
 * 用于「更多菜单 → 导入对话框」：避免菜单 cleanup 先恢复视图，
 * 原生 WebContentsView 在数帧内盖住 Modal。冻结帧保持不动。
 */
export async function handoffOverlaySuppress(
  nextReason: string,
  prevReason: string,
): Promise<void> {
  await browserService.setOverlaySuppressed(true, nextReason);
  void browserService.setOverlaySuppressed(false, prevReason);
}
