import { ipcMain } from "electron";
import type {
  FsListResult,
  FsPreviewResult,
  FsReadResult,
  FsSaveImageRequest,
  FsSaveImageResult,
  FsSaveTextRequest,
  FsSaveTextResult,
  FsSearchHit,
  FsWatchRequest,
  IpcResult,
} from "../../shared/ipc";
import { FS_IPC } from "../../shared/ipc";
import { envelope, envelopeAsync } from "../ipc/envelope";
import {
  listDirectory,
  openDirectory,
  pickFile,
  readFile,
  revealInExplorer,
  saveImageToDownloads,
  saveTextFile,
  searchFiles,
} from "./fsService";
import { readPreviewImage } from "./imagePreview";
import { readPreviewMedia } from "./mediaPreview";
import { openInVsCode } from "./openInVsCode";
import { unwatchDirectory, watchDirectory } from "./watcher";

/** 注册文件系统 IPC（docs/design/03 §5 / §8）。 */
export function registerFsIpc(): void {
  ipcMain.handle(
    FS_IPC.list,
    (_event, req: { dir: string }): IpcResult<FsListResult> =>
      envelope(() => listDirectory(req.dir)),
  );

  ipcMain.handle(
    FS_IPC.read,
    (_event, req: { path: string }): Promise<IpcResult<FsReadResult>> =>
      envelopeAsync(() => readFile(req.path)),
  );

  ipcMain.handle(
    FS_IPC.preview,
    (_event, req: { path: string }): Promise<IpcResult<FsPreviewResult>> =>
      envelopeAsync(async () => {
        const media = await readPreviewMedia(req.path);
        if (media) return media;
        const image = await readPreviewImage(req.path);
        if (image) return image;
        const result = await readFile(req.path);
        if (result.kind === "image") throw new Error("Image preview routing mismatch");
        return result;
      }),
  );

  ipcMain.handle(
    FS_IPC.save,
    (_event, req: FsSaveTextRequest): Promise<IpcResult<FsSaveTextResult>> =>
      envelopeAsync(() => saveTextFile(req)),
  );

  ipcMain.handle(
    FS_IPC.search,
    (_event, req: { dir: string; query: string }): Promise<IpcResult<FsSearchHit[]>> =>
      envelopeAsync(() => searchFiles(req.dir, req.query)),
  );

  ipcMain.handle(
    FS_IPC.pickFile,
    (): Promise<IpcResult<string | null>> => envelopeAsync(async () => pickFile()),
  );

  ipcMain.handle(
    FS_IPC.openPath,
    (_event, req: { dir: string }): Promise<IpcResult<null>> =>
      envelopeAsync(async () => {
        await openDirectory(req.dir);
        return null;
      }),
  );

  ipcMain.handle(
    FS_IPC.openInVsCode,
    (_event, req: { dir: string }): Promise<IpcResult<null>> =>
      envelopeAsync(async () => {
        await openInVsCode(req.dir);
        return null;
      }),
  );

  ipcMain.handle(
    FS_IPC.reveal,
    (_event, req: { path: string }): IpcResult<null> =>
      envelope(() => {
        revealInExplorer(req.path);
        return null;
      }),
  );

  ipcMain.handle(
    FS_IPC.saveImageToDownloads,
    (_event, req: FsSaveImageRequest): Promise<IpcResult<FsSaveImageResult>> =>
      envelopeAsync(() => saveImageToDownloads(req)),
  );

  ipcMain.handle(
    FS_IPC.watch,
    (_event, req: FsWatchRequest): IpcResult<null> =>
      envelope(() => {
        watchDirectory(req.dir);
        return null;
      }),
  );

  ipcMain.handle(
    FS_IPC.unwatch,
    (_event, req: FsWatchRequest): IpcResult<null> =>
      envelope(() => {
        unwatchDirectory(req.dir);
        return null;
      }),
  );
}
