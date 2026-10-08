import { ipcMain } from "electron";
import type {
  BrowserApplyLoginCookiesRequest,
  BrowserApplyLoginCookiesResult,
  BrowserApplyPastedCookiesRequest,
  BrowserApplyPastedCookiesResult,
  BrowserBoundsRequest,
  BrowserCloseInstanceRequest,
  BrowserImportLoginDataRequest,
  BrowserImportLoginDataResult,
  BrowserInstanceInfo,
  BrowserLoginSource,
  BrowserNavigateRequest,
  BrowserOpenLocalFileRequest,
  BrowserOverlaySuppressedRequest,
  BrowserPickModeRequest,
  BrowserPreviewLoginCookiesRequest,
  BrowserPreviewLoginCookiesResult,
  BrowserSaveScreenshotRequest,
  BrowserSetActiveInstanceRequest,
  BrowserViewportRequest,
  BrowserZoomRequest,
  InspectorNodeRequest,
  IpcResult,
  StylePatchClearRequest,
  StylePatchExportRequest,
  StylePatchRequest,
} from "../../shared/ipc";
import { BROWSER_IPC } from "../../shared/ipc";
import { envelope, envelopeAsync } from "../ipc/envelope";
import { importBrowserLoginData } from "./browserDataImport";
import {
  backBrowser,
  captureBrowserOverlayFreeze,
  captureBrowserScreenshot,
  clearBrowserCache,
  clearBrowserCookies,
  closeBrowserInstance,
  createBrowserInstance,
  ensureDefaultInstance,
  forceReloadBrowser,
  forwardBrowser,
  inspectBoxModel,
  inspectDomTree,
  inspectStyles,
  listBrowserInstances,
  navigateBrowser,
  openBrowserDevTools,
  openBrowserExternal,
  openLocalFileInBrowser,
  reloadBrowser,
  saveBrowserScreenshot,
  setActiveBrowserInstance,
  setBrowserBounds,
  setBrowserOverlaySuppressed,
  setBrowserPickMode,
  setBrowserViewport,
  setBrowserZoom,
  startPickMode,
  stopBrowser,
  stopPickMode,
  stylePatch,
  stylePatchClear,
  stylePatchExport,
} from "./browserView";
import {
  applyBrowserLoginCookies,
  applyPastedLoginCookies,
  listBrowserLoginSources,
  previewBrowserLoginCookies,
} from "./loginImport";

/** 注册浏览器面板 IPC（docs/design/05 §7.2）。 */
export function registerBrowserIpc(): void {
  ipcMain.handle(
    BROWSER_IPC.navigate,
    (_event, req: BrowserNavigateRequest): Promise<IpcResult<null>> =>
      envelopeAsync(async () => {
        await navigateBrowser(req.url);
        return null;
      }),
  );

  ipcMain.handle(
    BROWSER_IPC.openLocalFile,
    (_event, req: BrowserOpenLocalFileRequest): IpcResult<null> =>
      envelope(() => {
        openLocalFileInBrowser(req?.path ?? "");
        return null;
      }),
  );

  ipcMain.handle(
    BROWSER_IPC.reload,
    (): IpcResult<null> =>
      envelope(() => {
        reloadBrowser();
        return null;
      }),
  );

  ipcMain.handle(
    BROWSER_IPC.back,
    (): IpcResult<null> =>
      envelope(() => {
        backBrowser();
        return null;
      }),
  );

  ipcMain.handle(
    BROWSER_IPC.forward,
    (): IpcResult<null> =>
      envelope(() => {
        forwardBrowser();
        return null;
      }),
  );

  ipcMain.handle(
    BROWSER_IPC.stop,
    (): IpcResult<null> =>
      envelope(() => {
        stopBrowser();
        return null;
      }),
  );

  ipcMain.handle(
    BROWSER_IPC.openExternal,
    (): Promise<IpcResult<null>> =>
      envelopeAsync(async () => {
        await openBrowserExternal();
        return null;
      }),
  );

  ipcMain.handle(
    BROWSER_IPC.screenshot,
    (): Promise<IpcResult<unknown>> => envelopeAsync(() => captureBrowserScreenshot()),
  );

  ipcMain.handle(
    BROWSER_IPC.pickStart,
    (): Promise<IpcResult<null>> =>
      envelopeAsync(async () => {
        await startPickMode();
        return null;
      }),
  );

  ipcMain.handle(
    BROWSER_IPC.pickStop,
    (): Promise<IpcResult<null>> =>
      envelopeAsync(async () => {
        await stopPickMode();
        return null;
      }),
  );

  ipcMain.handle(
    BROWSER_IPC.setPickMode,
    (_event, req: BrowserPickModeRequest): Promise<IpcResult<null>> =>
      envelopeAsync(async () => {
        await setBrowserPickMode(req.mode);
        return null;
      }),
  );

  // 检查器只读三件套（06 §4.4）：入参统一为 nodeId，返回已是主进程裁剪后的 DTO
  ipcMain.handle(
    BROWSER_IPC.inspectStyles,
    (_event, req: InspectorNodeRequest): Promise<IpcResult<unknown>> =>
      envelopeAsync(() => inspectStyles(req.nodeId)),
  );

  ipcMain.handle(
    BROWSER_IPC.inspectBoxModel,
    (_event, req: InspectorNodeRequest): Promise<IpcResult<unknown>> =>
      envelopeAsync(() => inspectBoxModel(req.nodeId)),
  );

  ipcMain.handle(
    BROWSER_IPC.inspectDomTree,
    (_event, req: InspectorNodeRequest): Promise<IpcResult<unknown>> =>
      envelopeAsync(() => inspectDomTree(req.nodeId)),
  );

  // 样式热更改（docs/design/22）：写 PiDesk 调整样式表，页面即时预览
  ipcMain.handle(
    BROWSER_IPC.stylePatch,
    (_event, req: StylePatchRequest): Promise<IpcResult<unknown>> =>
      envelopeAsync(() => stylePatch(req.nodeId, req.selector ?? "", req.declarations ?? [])),
  );

  ipcMain.handle(
    BROWSER_IPC.stylePatchClear,
    (_event, req: StylePatchClearRequest): Promise<IpcResult<null>> =>
      envelopeAsync(async () => {
        await stylePatchClear(req ?? { selector: null });
        return null;
      }),
  );

  ipcMain.handle(
    BROWSER_IPC.stylePatchExport,
    (_event, req: StylePatchExportRequest): IpcResult<unknown> =>
      envelope(() => stylePatchExport(req ?? { host: "" })),
  );

  ipcMain.handle(
    BROWSER_IPC.setBounds,
    (_event, req: BrowserBoundsRequest): IpcResult<null> =>
      envelope(() => {
        setBrowserBounds(req);
        return null;
      }),
  );

  ipcMain.handle(
    BROWSER_IPC.setViewport,
    (_event, req: BrowserViewportRequest): IpcResult<null> =>
      envelope(() => {
        setBrowserViewport(req?.width ?? null);
        return null;
      }),
  );

  ipcMain.handle(
    BROWSER_IPC.forceReload,
    (): IpcResult<null> =>
      envelope(() => {
        forceReloadBrowser();
        return null;
      }),
  );

  ipcMain.handle(
    BROWSER_IPC.openDevTools,
    (): IpcResult<null> =>
      envelope(() => {
        openBrowserDevTools();
        return null;
      }),
  );

  ipcMain.handle(
    BROWSER_IPC.setZoom,
    (_event, req: BrowserZoomRequest): IpcResult<null> =>
      envelope(() => {
        setBrowserZoom(req?.factor ?? 1);
        return null;
      }),
  );

  ipcMain.handle(
    BROWSER_IPC.clearCookies,
    (): Promise<IpcResult<null>> =>
      envelopeAsync(async () => {
        await clearBrowserCookies();
        return null;
      }),
  );

  ipcMain.handle(
    BROWSER_IPC.applyPastedCookies,
    (
      _event,
      req: BrowserApplyPastedCookiesRequest,
    ): Promise<IpcResult<BrowserApplyPastedCookiesResult>> =>
      envelopeAsync(() => applyPastedLoginCookies(req ?? { host: "", raw: "" })),
  );

  ipcMain.handle(
    BROWSER_IPC.listLoginSources,
    (): Promise<IpcResult<BrowserLoginSource[]>> => envelopeAsync(() => listBrowserLoginSources()),
  );

  ipcMain.handle(
    BROWSER_IPC.previewLoginCookies,
    (
      _event,
      req: BrowserPreviewLoginCookiesRequest,
    ): Promise<IpcResult<BrowserPreviewLoginCookiesResult>> =>
      envelopeAsync(() => previewBrowserLoginCookies(req ?? { sourceId: "", host: "" })),
  );

  ipcMain.handle(
    BROWSER_IPC.applyLoginCookies,
    (
      _event,
      req: BrowserApplyLoginCookiesRequest,
    ): Promise<IpcResult<BrowserApplyLoginCookiesResult>> =>
      envelopeAsync(() => applyBrowserLoginCookies(req ?? { sourceId: "", host: "" })),
  );

  ipcMain.handle(
    BROWSER_IPC.importLoginData,
    (
      _event,
      req: BrowserImportLoginDataRequest,
    ): Promise<IpcResult<BrowserImportLoginDataResult>> =>
      envelopeAsync(() => importBrowserLoginData(req ?? { sourceId: "" })),
  );

  ipcMain.handle(
    BROWSER_IPC.clearCache,
    (): Promise<IpcResult<null>> =>
      envelopeAsync(async () => {
        await clearBrowserCache();
        return null;
      }),
  );

  ipcMain.handle(
    BROWSER_IPC.captureOverlayFreeze,
    (): Promise<IpcResult<{ freeze: string | null }>> =>
      envelopeAsync(() => captureBrowserOverlayFreeze()),
  );

  ipcMain.handle(
    BROWSER_IPC.setOverlaySuppressed,
    (_event, req: BrowserOverlaySuppressedRequest): IpcResult<null> =>
      envelope(() => {
        setBrowserOverlaySuppressed(Boolean(req?.suppressed), req?.reason);
        return null;
      }),
  );

  ipcMain.handle(
    BROWSER_IPC.saveScreenshot,
    (_event, req: BrowserSaveScreenshotRequest): IpcResult<{ path: string }> =>
      envelope(() => saveBrowserScreenshot(req?.base64 ?? "")),
  );

  ipcMain.handle(
    BROWSER_IPC.createInstance,
    (): IpcResult<{ id: string }> =>
      envelope(() => {
        return { id: createBrowserInstance() };
      }),
  );

  ipcMain.handle(
    BROWSER_IPC.closeInstance,
    (_event, req: BrowserCloseInstanceRequest): IpcResult<null> =>
      envelope(() => {
        closeBrowserInstance(req?.id ?? "");
        return null;
      }),
  );

  ipcMain.handle(
    BROWSER_IPC.setActiveInstance,
    (_event, req: BrowserSetActiveInstanceRequest): Promise<IpcResult<null>> =>
      envelopeAsync(async () => {
        await setActiveBrowserInstance(req?.id ?? "");
        return null;
      }),
  );

  ipcMain.handle(
    BROWSER_IPC.listInstances,
    (): IpcResult<BrowserInstanceInfo[]> =>
      envelope(() => {
        ensureDefaultInstance();
        return listBrowserInstances();
      }),
  );
}
