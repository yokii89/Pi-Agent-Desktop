import type { IpcResult } from "../../shared/ipc";
import { registerBrowserIpc } from "../browser/browserIpc";
import { registerCatalogIpc } from "../extension/catalogIpc";
import { registerExtensionIpc } from "../extension/extensionIpc";
import { registerWorkerIpc } from "../extension/workerIpc";
import { registerFsIpc } from "../fs/fsIpc";
import { registerGitIpc } from "../git/gitIpc";
import { registerGitHubIpc } from "../github/githubIpc";
import { registerMcpIpc } from "../mcp/mcpIpc";
import { registerNotificationIpc } from "../notification/notificationIpc";
import { registerProcIpc } from "../proc/processIpc";
import { registerProjectIpc } from "../project/projectIpc";
import { registerSchedulerIpc } from "../scheduler/schedulerIpc";
import { registerPrefetchIpc } from "../session/prefetchIpc";
import { registerRuntimeIpc } from "../session/runtimeIpc";
import { registerSessionIpc } from "../session/sessionIpc";
import { registerSettingsIpc } from "../settings/settingsIpc";
import { registerTerminalIpc } from "../terminal/terminalIpc";
import { registerUpdaterIpc } from "../updater/updaterIpc";
import { registerUsageIpc } from "../usage/usageIpc";
import { registerViewActivateIpc } from "../view/viewActivateIpc";
import { registerViewIpc } from "../view/viewIpc";
import { registerInspectorFloatIpc } from "../window/inspectorFloatIpc";
import { registerWindowIpc } from "../window/windowIpc";

/** 集中注册所有 IPC handler。各域 handler 就近放在对应功能模块内。 */
export function registerIpc(): void {
  const registrars = [
    registerWindowIpc,
    registerSettingsIpc,
    registerNotificationIpc,
    registerProjectIpc,
    registerSessionIpc,
    registerProcIpc,
    registerRuntimeIpc,
    registerPrefetchIpc,
    registerSchedulerIpc,
    registerTerminalIpc,
    registerUsageIpc,
    registerFsIpc,
    registerGitIpc,
    registerGitHubIpc,
    registerMcpIpc,
    registerBrowserIpc,
    registerExtensionIpc,
    registerCatalogIpc,
    registerWorkerIpc,
    registerViewIpc,
    registerViewActivateIpc,
    registerUpdaterIpc,
    registerInspectorFloatIpc,
  ] as const;
  for (const register of registrars) {
    register();
  }
}

/** 渲染层 invoke 的统一入口类型提示（仅供主进程内部参考）。 */
export type IpcRegistrar = () => IpcResult<void>;
