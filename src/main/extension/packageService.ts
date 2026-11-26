import type {
  ExtensionPushMessage,
  PiPackageInstallRequest,
  PiPackageRemoveRequest,
} from "../../shared/ipc";
import { EXTENSION_IPC } from "../../shared/ipc";
import { getPiAgentDir } from "../session/piInfo";
import { getMainWindow } from "../window/createMainWindow";
import { DesktopPackageManager } from "./packageManager";

function push(message: ExtensionPushMessage): void {
  getMainWindow()?.webContents.send(EXTENSION_IPC.output, message);
}
const manager = new DesktopPackageManager(getPiAgentDir, undefined, (payload) =>
  push({ type: "log", payload }),
);
async function operation(run: () => Promise<void>): Promise<void> {
  try {
    await run();
    push({ type: "exit", payload: { code: 0, ok: true } });
  } catch (error) {
    push({
      type: "error",
      payload: error instanceof Error ? error.message : "Package operation failed.",
    });
    throw error;
  }
}

/** Desktop-owned installation; logs retain the existing renderer contract. */
export const installPackage = (request: PiPackageInstallRequest): Promise<void> =>
  operation(() => manager.install(request));
/** Local packages are unregistered without deleting the source. */
export const removePackage = (request: PiPackageRemoveRequest): Promise<void> =>
  operation(() => manager.remove(request));
