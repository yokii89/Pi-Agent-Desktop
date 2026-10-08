import { ipcMain } from "electron";
import type {
  ActivateContributionRequest,
  ActivateContributionResult,
} from "../../shared/contribution";
import type { IpcResult } from "../../shared/ipc";
import { VIEW_IPC } from "../../shared/view";
import { activateContribution } from "./contributionActivation";

/** Contribution 原子激活 IPC（docs/design/16 §7.2）。 */
export function registerViewActivateIpc(): void {
  ipcMain.handle(
    VIEW_IPC.activateContribution,
    (_event, req: ActivateContributionRequest): Promise<IpcResult<ActivateContributionResult>> =>
      (async () => {
        try {
          return {
            ok: true,
            data: await activateContribution(req ?? ({} as ActivateContributionRequest)),
          };
        } catch (error) {
          const details =
            error instanceof Error && "activationFailure" in error
              ? error.activationFailure
              : undefined;
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            errorDetails: details as
              | import("../../shared/contribution").ActivateContributionFailure
              | undefined,
          };
        }
      })(),
  );
}
