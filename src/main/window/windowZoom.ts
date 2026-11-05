import type { BrowserWindow, WebContents } from "electron";
import { resolveUiZoomAction, stepUiZoom } from "../../shared/uiZoom";
import { getSettings, updateSettings } from "../settings/settings";

/**
 * 把已保存的界面缩放应用到窗口页面。
 * 挂在 `dom-ready` 上重复应用：Electron 的 zoomFactor 在整页重载（HMR / Ctrl+R）后
 * 不保证保留，重放一次成本可忽略，却能让「上次缩放到 125%」重启后依然成立。
 */
function applyStoredUiZoom(wc: WebContents): void {
  const factor = getSettings().uiZoom;
  if (wc.isDestroyed()) return;
  wc.setZoomFactor(factor);
}

/**
 * 接管 Ctrl+= / Ctrl+- / Ctrl+0（见 shared/uiZoom 的说明：默认菜单的 Zoom In 加速键
 * 在 Windows 上只认字面「+」，Ctrl+= 没有反应）。
 * 必须在主进程这一层拦：菜单加速键由浏览器进程消费，渲染层收不到。
 */
export function attachWindowZoom(win: BrowserWindow): void {
  const wc = win.webContents;
  applyStoredUiZoom(wc);
  wc.on("dom-ready", () => applyStoredUiZoom(wc));
  wc.on("before-input-event", (event, input) => {
    const action = resolveUiZoomAction(input);
    if (!action) return;
    // 不阻断的话默认菜单的同名加速键还会再跑一遍，一次按键缩两级
    event.preventDefault();
    const factor = stepUiZoom(wc.getZoomFactor(), action);
    wc.setZoomFactor(factor);
    // 按住不放会连发 keyDown，只在松开前的最后一次落盘
    if (!input.isAutoRepeat && factor !== getSettings().uiZoom) {
      updateSettings({ uiZoom: factor });
    }
  });
}
