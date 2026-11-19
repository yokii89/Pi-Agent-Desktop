import { ipcMain } from "electron";
import { exact, id, projectIds, type Scope } from "../../shared/remote";
import { REMOTE_IPC, type RemoteEnrollment } from "../../shared/remoteDesktop";
import { envelopeAsync } from "../ipc/envelope";
import { remoteService } from "./remoteService";
/** Only local desktop UI invokes approval/revocation; credentials never cross IPC. */
export function registerRemoteIpc(): void {
  ipcMain.handle(REMOTE_IPC.snapshot, () => envelopeAsync(async () => remoteService.snapshot()));
  ipcMain.handle(REMOTE_IPC.enroll, (_event, request: RemoteEnrollment) =>
    envelopeAsync(() => remoteService.enroll(request)),
  );
  ipcMain.handle(REMOTE_IPC.connect, () =>
    envelopeAsync(async () => {
      await remoteService.start();
      return remoteService.snapshot();
    }),
  );
  ipcMain.handle(REMOTE_IPC.disconnect, () =>
    envelopeAsync(async () => {
      remoteService.stop();
      return remoteService.snapshot();
    }),
  );
  ipcMain.handle(REMOTE_IPC.invite, () => envelopeAsync(() => remoteService.invite()));
  ipcMain.handle(REMOTE_IPC.approve, (_event, request: unknown) =>
    envelopeAsync(async () => {
      const r = exact(request, ["claimId", "projects", "scopes"]);
      if (!Array.isArray(r.projects) || !Array.isArray(r.scopes)) throw new Error("INVALID_FRAME");
      return remoteService.approve(id(r.claimId), projectIds(r.projects), r.scopes as Scope[]);
    }),
  );
  ipcMain.handle(REMOTE_IPC.reject, () => envelopeAsync(() => remoteService.reject()));
  ipcMain.handle(REMOTE_IPC.revoke, () => envelopeAsync(() => remoteService.revoke()));
}
