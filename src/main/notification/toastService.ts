import { Notification } from "electron";
import { NOTIFICATION_IPC, type SystemToastRequest } from "../../shared/notification";
import { resolveNotificationIconPath } from "../appIcon";
import { getSettings } from "../settings/settings";
import { getMainWindow } from "../window/createMainWindow";

/** 与 Windows toast 可读性相关的硬截断（协议层也截，这里兜底 IPC 直调）。 */
const TITLE_MAX = 200;
const BODY_MAX = 500;

function clampText(value: string | undefined, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * 按目标（sessionId → title）记录上次弹出时间。
 * 内建路径已在 renderer 防抖；SDK Host 直弹不经 renderer，这里兜底同一 `debounceMs`。
 */
const lastShownAt = new Map<string, number>();

function toastTargetKey(req: SystemToastRequest): string {
  return req.sessionId ?? req.title;
}

/**
 * 展示系统桌面 toast（docs/design/24）。
 * 门禁：`systemToast` 开、主窗口存在且**未聚焦**、同目标防抖；场景语义由调用方负责。
 * 点击：聚焦主窗口并推送 `NOTIFICATION_IPC.activated` 供渲染层回跳会话。
 *
 * @returns 是否实际展示（false = 门禁未过或平台不支持）。
 */
export function showSystemToast(req: SystemToastRequest): boolean {
  if (!Notification.isSupported()) return false;
  const settings = getSettings().notification;
  if (!settings.systemToast) return false;

  const win = getMainWindow();
  if (!win || win.isDestroyed() || win.isFocused()) return false;

  const title = clampText(req.title, TITLE_MAX);
  if (!title) return false;
  const body = clampText(req.body, BODY_MAX);

  const key = toastTargetKey(req);
  const now = Date.now();
  const debounceMs = settings.debounceMs;
  const last = lastShownAt.get(key);
  if (debounceMs > 0 && last !== undefined && now - last < debounceMs) return false;

  try {
    const toast = new Notification({
      title,
      body: body ?? "",
      // Windows toast 靠 icon 写入 appLogoOverride；缺图标时头部只显示 AUMID
      icon: resolveNotificationIconPath(),
      silent: true, // 声音由 renderer 提示音链路负责，避免双响
    });
    toast.on("click", () => {
      const target = getMainWindow();
      if (!target || target.isDestroyed()) return;
      if (target.isMinimized()) target.restore();
      // 隐藏到托盘时 show 才能回到前台；已可见时无害
      target.show();
      target.focus();
      target.webContents.send(NOTIFICATION_IPC.activated, {
        sessionId: req.sessionId,
        sessionFile: req.sessionFile,
      });
    });
    lastShownAt.set(key, now);
    // 防抖表不无限增长：超过窗口期的旧目标直接清掉
    if (lastShownAt.size > 64) {
      for (const [k, at] of lastShownAt) {
        if (now - at > Math.max(debounceMs, 5000) * 4) lastShownAt.delete(k);
      }
    }
    toast.show();
    return true;
  } catch {
    // 系统通知失败不阻塞会话
    return false;
  }
}
