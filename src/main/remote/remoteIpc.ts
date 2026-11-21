import { ipcMain } from "electron";
import { exact, id } from "../../shared/remote";
import {
  REMOTE_IPC,
  type RemoteAccountInput,
  type RemoteEnrollment,
} from "../../shared/remoteDesktop";
import { envelopeAsync } from "../ipc/envelope";
import { getMainWindow } from "../window/createMainWindow";
import { remoteService } from "./remoteService";

/** Only the application's main frame may read pairing secrets or control remote access. */
function trusted(event: Electron.IpcMainInvokeEvent): boolean {
  const window = getMainWindow();
  return (
    !!window &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame
  );
}

/** Register a single remote API, sharing one service and one sender boundary. */
export function registerRemoteIpc(): void {
  const handle = (channel: string, action: (request: unknown) => Promise<unknown>): void => {
    ipcMain.handle(channel, (event, request: unknown) => {
      if (!trusted(event)) return { ok: false, error: "UNTRUSTED_SENDER" };
      return envelopeAsync(() => action(request));
    });
  };
  handle(REMOTE_IPC.snapshot, async () => remoteService.snapshot());
  handle(REMOTE_IPC.enroll, (request) => remoteService.enroll(request as RemoteEnrollment));
  handle(REMOTE_IPC.account, (request) => remoteService.setAccount(request as RemoteAccountInput));
  handle(REMOTE_IPC.cancelLogin, async () => remoteService.cancelLogin());
  handle(REMOTE_IPC.resetEnrollment, async (request) => {
    const r = exact(request, ["localOnly"]);
    if (typeof r.localOnly !== "boolean") throw new Error("INVALID_FRAME");
    return remoteService.resetEnrollment(r.localOnly);
  });
  handle(REMOTE_IPC.desktops, async (request) => {
    const r = exact(request, ["relayOrigin"]);
    if (typeof r.relayOrigin !== "string") throw new Error("INVALID_FRAME");
    return remoteService.desktops(r.relayOrigin);
  });
  handle(REMOTE_IPC.removeDesktop, async (request) => {
    const r = exact(request, ["relayOrigin", "desktopId"]);
    if (typeof r.relayOrigin !== "string" || typeof r.desktopId !== "string")
      throw new Error("INVALID_FRAME");
    return remoteService.removeDesktop(r.relayOrigin, r.desktopId);
  });
  handle(REMOTE_IPC.logout, async () => remoteService.logout());
  handle(REMOTE_IPC.connect, async () => {
    await remoteService.start();
    return remoteService.snapshot();
  });
  handle(REMOTE_IPC.disconnect, async () => {
    remoteService.stop();
    return remoteService.snapshot();
  });
  handle(REMOTE_IPC.invite, () => remoteService.invite());
  handle(REMOTE_IPC.approve, async (request) => {
    const r = exact(request, ["claimId"]);
    return remoteService.approve(id(r.claimId));
  });
  handle(REMOTE_IPC.reject, () => remoteService.reject());
  handle(REMOTE_IPC.revoke, () => remoteService.revoke());
}
