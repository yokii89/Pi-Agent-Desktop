import { ipcMain } from "electron";
import type { ContributionCatalogSnapshot } from "../../shared/contribution";
import { CATALOG_IPC } from "../../shared/contribution";
import type { IpcResult } from "../../shared/ipc";
import { envelope, envelopeAsync } from "../ipc/envelope";
import { markExtensionStale } from "../session/runtimeCoordinator";
import { getCatalogSnapshot, invalidateCatalog } from "./contributionCatalog";

/** Contribution Catalog IPC（docs/design/16 Phase A）。 */
export function registerCatalogIpc(): void {
  ipcMain.handle(
    CATALOG_IPC.list,
    (_event, req: { projectDir?: string | null }): IpcResult<ContributionCatalogSnapshot> =>
      envelope(() =>
        getCatalogSnapshot(
          typeof req?.projectDir === "string" && req.projectDir ? req.projectDir : null,
        ),
      ),
  );

  ipcMain.handle(
    CATALOG_IPC.refresh,
    (
      _event,
      req: { contextId?: string; projectDir?: string | null },
    ): Promise<IpcResult<ContributionCatalogSnapshot>> =>
      envelopeAsync(async () => {
        invalidateCatalog({
          contextId: typeof req?.contextId === "string" ? req.contextId : undefined,
          projectDir:
            req?.projectDir === undefined
              ? undefined
              : typeof req.projectDir === "string" && req.projectDir
                ? req.projectDir
                : null,
        });
        markExtensionStale();
        return getCatalogSnapshot(
          typeof req?.projectDir === "string" && req.projectDir ? req.projectDir : null,
        );
      }),
  );
}
