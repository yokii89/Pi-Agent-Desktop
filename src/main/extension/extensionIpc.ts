import { ipcMain } from "electron";
import type {
  IpcResult,
  PiPackageInstallRequest,
  PiPackageRemoveRequest,
  PiPackageSetEnabledRequest,
  PiPackageSetResourceEnabledRequest,
  PiPackagesSnapshot,
} from "../../shared/ipc";
import { EXTENSION_IPC } from "../../shared/ipc";
import { envelopeAsync } from "../ipc/envelope";
import { markExtensionStale } from "../session/runtimeCoordinator";
import { invalidateCatalog } from "./contributionCatalog";
import { reloadWorkerForExtensionChange } from "./extensionWorkerManager";
import { installPackage, removePackage } from "./packageCli";
import { listPackages, setPackageEnabled, setPackageResourceEnabled } from "./packageStore";

/** 扩展变更后：刷新 Catalog、标记 stale、按需重启 Worker。 */
function afterExtensionMutation(): void {
  invalidateCatalog();
  markExtensionStale();
  void reloadWorkerForExtensionChange().catch(() => {});
}

/** 注册扩展 / pi packages IPC（docs/design/07）。 */
export function registerExtensionIpc(): void {
  ipcMain.handle(
    EXTENSION_IPC.list,
    (_event, req: { projectDir?: string | null }): Promise<IpcResult<PiPackagesSnapshot>> =>
      envelopeAsync(async () =>
        listPackages(typeof req?.projectDir === "string" && req.projectDir ? req.projectDir : null),
      ),
  );

  ipcMain.handle(
    EXTENSION_IPC.install,
    (_event, req: PiPackageInstallRequest): Promise<IpcResult<null>> =>
      envelopeAsync(async () => {
        if (typeof req?.source !== "string" || !req.source.trim()) {
          throw new Error("请填写包来源");
        }
        await installPackage({
          source: req.source.trim(),
          local: req.local === true,
          cwd: typeof req.cwd === "string" && req.cwd ? req.cwd : null,
        });
        afterExtensionMutation();
        return null;
      }),
  );

  ipcMain.handle(
    EXTENSION_IPC.remove,
    (_event, req: PiPackageRemoveRequest): Promise<IpcResult<null>> =>
      envelopeAsync(async () => {
        if (typeof req?.source !== "string" || !req.source.trim()) {
          throw new Error("缺少包来源");
        }
        await removePackage({
          source: req.source.trim(),
          local: req.local === true,
          cwd: typeof req.cwd === "string" && req.cwd ? req.cwd : null,
        });
        afterExtensionMutation();
        return null;
      }),
  );

  ipcMain.handle(
    EXTENSION_IPC.setEnabled,
    (_event, req: PiPackageSetEnabledRequest): Promise<IpcResult<null>> =>
      envelopeAsync(async () => {
        if (typeof req?.source !== "string" || !req.source.trim()) {
          throw new Error("缺少包来源");
        }
        if (req.scope !== "user" && req.scope !== "project") {
          throw new Error("作用域无效");
        }
        setPackageEnabled({
          source: req.source.trim(),
          scope: req.scope,
          enabled: req.enabled === true,
          cwd: typeof req.cwd === "string" && req.cwd ? req.cwd : null,
        });
        afterExtensionMutation();
        return null;
      }),
  );

  ipcMain.handle(
    EXTENSION_IPC.setResourceEnabled,
    (_event, req: PiPackageSetResourceEnabledRequest): Promise<IpcResult<null>> =>
      envelopeAsync(async () => {
        if (typeof req?.source !== "string" || !req.source.trim()) {
          throw new Error("缺少包来源");
        }
        if (req.scope !== "user" && req.scope !== "project") {
          throw new Error("作用域无效");
        }
        if (
          req.kind !== "extensions" &&
          req.kind !== "skills" &&
          req.kind !== "prompts" &&
          req.kind !== "themes"
        ) {
          throw new Error("资源类型无效");
        }
        if (typeof req?.relativePath !== "string" || !req.relativePath.trim()) {
          throw new Error("缺少资源路径");
        }
        setPackageResourceEnabled({
          source: req.source.trim(),
          scope: req.scope,
          kind: req.kind,
          relativePath: req.relativePath.trim(),
          enabled: req.enabled === true,
          cwd: typeof req.cwd === "string" && req.cwd ? req.cwd : null,
        });
        afterExtensionMutation();
        return null;
      }),
  );
}
