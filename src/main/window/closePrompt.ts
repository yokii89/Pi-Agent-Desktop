import { app, type BrowserWindow } from "electron";
import { t } from "../../shared/i18n";
import { WINDOW_IPC } from "../../shared/ipc";
import type { WindowCloseRequest } from "../../shared/windowClose";
import { procService } from "../proc/procService";
import { listLiveSessions } from "../session/piSession";
import { getSettings, updateSettings } from "../settings/settings";
import { liveTerminalCount } from "../terminal/terminal";
import { ClosePromptProtocol } from "./closePromptProtocol";
import { setQuitProcPolicy } from "./quitPolicy";
import {
  applyTrayEnabled,
  cancelQuitting,
  ensureTrayForHide,
  isQuittingApp,
  markQuitting,
} from "./tray";

const prompts = new WeakMap<BrowserWindow, ClosePromptProtocol>();
let processQuitPrompt: (() => boolean) | null = null;

function quit(policy: "kill" | "keep" = "kill"): void {
  setQuitProcPolicy(policy);
  markQuitting();
  app.quit();
}

/** 只对主窗口接管用户关窗；应用主动退出仍由 before-quit 流程处理。 */
export function attachClosePrompt(win: BrowserWindow): void {
  const send = (channel: string, payload: unknown): void => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed())
      win.webContents.send(channel, payload);
  };
  const hide = (remember: boolean): void => {
    if (!ensureTrayForHide()) throw new Error(t("window.close.hide.blocked"));
    updateSettings({ showInTray: true, ...(remember ? { closeAction: "tray" as const } : {}) });
    win.hide();
  };
  const fallback = (): void => {
    try {
      hide(false);
      return;
    } catch (error) {
      console.warn("[close] 无法隐藏到托盘，退出应用", error);
    }
    quit();
  };
  const protocol = new ClosePromptProtocol({
    request: (id, kind) => {
      let snapshot: WindowCloseRequest;
      if (kind === "process-quit") {
        const alive = procService.listAllAlive();
        snapshot = {
          id,
          kind,
          procs: alive.length,
          commands: alive
            .slice(0, 5)
            .map((proc) => ({ pid: proc.pid, command: proc.commandLine || proc.name })),
        };
      } else {
        snapshot = {
          id,
          kind,
          sessions: listLiveSessions().length,
          terminals: liveTerminalCount(),
          procs: procService.listAllAlive().length,
          trayAvailable: ensureTrayForHide(),
        };
      }
      send(WINDOW_IPC.closeRequest, snapshot);
    },
    settled: (id) => send(WINDOW_IPC.closeSettled, id),
    execute: (decision) => {
      if (decision.kind === "process-quit") {
        if (decision.action === "cancel") {
          cancelQuitting();
          return;
        }
        quit(decision.action);
        return;
      }
      const { action, remember } = decision;
      if (action === "cancel") {
        applyTrayEnabled(getSettings().showInTray);
      } else if (action === "tray") {
        hide(remember);
      } else {
        if (remember) updateSettings({ closeAction: "quit" });
        quit();
      }
    },
    fallback: (kind) => {
      if (kind === "process-quit") {
        quit();
        return;
      }
      fallback();
    },
  });
  prompts.set(win, protocol);
  const requestProcessQuit = (): boolean => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return false;
    // 托盘菜单可在主窗口隐藏时触发退出；自绘询问必须先回到可见窗口。
    if (!win.isVisible()) win.show();
    win.focus();
    protocol.request("process-quit");
    return true;
  };
  processQuitPrompt = requestProcessQuit;
  win.on("close", (event) => {
    if (isQuittingApp()) return;
    event.preventDefault();
    if (protocol.isPending) return;
    const action = getSettings().closeAction;
    if (action === "quit") {
      quit();
    } else if (action === "tray") {
      // 托盘失效时重新询问，让用户显式选择退出。
      try {
        hide(false);
      } catch {
        protocol.request();
      }
    } else {
      protocol.request();
    }
  });
  const onLoading = (): void => protocol.fail();
  win.webContents.on("did-start-loading", onLoading);
  win.webContents.on("render-process-gone", onLoading);
  win.once("closed", () => {
    protocol.dispose();
    prompts.delete(win);
    if (processQuitPrompt === requestProcessQuit) processQuitPrompt = null;
  });
}

/** 应用退出时接管原生后台进程确认，改由主窗口的自绘界面作答。 */
export function requestProcessQuitPrompt(): boolean {
  return processQuitPrompt?.() ?? false;
}

/** 主窗口的显示回执；其他窗口不能确认本窗口的关闭询问。 */
export function acknowledgeClosePrompt(win: BrowserWindow, id: unknown): void {
  prompts.get(win)?.ready(id);
}

/** 处理主窗口的关闭决策；协议层验证 id、动作与 remember。 */
export function decideClosePrompt(win: BrowserWindow, decision: unknown): void {
  prompts.get(win)?.decide(decision);
}
