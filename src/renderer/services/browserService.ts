import type {
  BrowserApplyLoginCookiesRequest,
  BrowserApplyLoginCookiesResult,
  BrowserApplyPastedCookiesRequest,
  BrowserApplyPastedCookiesResult,
  BrowserBoundsRequest,
  BrowserConsoleError,
  BrowserImportLoginDataRequest,
  BrowserImportLoginDataResult,
  BrowserInstanceInfo,
  BrowserLoginSource,
  BrowserPickedElement,
  BrowserPickMode,
  BrowserPreviewLoginCookiesRequest,
  BrowserPreviewLoginCookiesResult,
  BrowserPushMessage,
  BrowserScreenshotResult,
  InspectorBoxModel,
  InspectorDomTree,
  InspectorStyleData,
  StylePatchClearRequest,
  StylePatchDeclaration,
  StylePatchExportRequest,
  StylePatchResult,
} from "../../shared/ipc";
import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

let pushListenersBound = false;
const pushListeners = new Set<(message: BrowserPushMessage) => void>();

function ensureBound(): void {
  const api = pideskApi();
  if (pushListenersBound || !api) return;
  pushListenersBound = true;
  api.browser.onOutput((message) => {
    for (const listener of pushListeners) listener(message);
  });
}

/**
 * 浏览器面板服务（docs/design/05 / 06）：请求-响应直通主进程，
 * 推送（navigated / picked / console / error / loading / pick / inspectInvalidated）
 * 在此分发。检查器三件套也是请求-响应，只是入参换成采集时拿到的 nodeId。
 */
export const browserService = {
  navigate(url: string): Promise<void> {
    const api = pideskApi();
    if (!api) return Promise.resolve();
    return unwrap(api.browser.navigate({ url })).then(() => undefined);
  },
  /** 在侧栏浏览器中打开本地 HTML 文件（file:// 专用通道，主进程校验后缀与存在性）。 */
  openLocalFile(path: string): Promise<void> {
    const api = pideskApi();
    if (!api) return Promise.resolve();
    return unwrap(api.browser.openLocalFile({ path })).then(() => undefined);
  },
  reload(): Promise<void> {
    const api = pideskApi();
    if (!api) return Promise.resolve();
    return unwrap(api.browser.reload()).then(() => undefined);
  },
  back(): void {
    pideskApi()
      ?.browser.back()
      .catch(() => {});
  },
  forward(): void {
    pideskApi()
      ?.browser.forward()
      .catch(() => {});
  },
  stop(): void {
    pideskApi()
      ?.browser.stop()
      .catch(() => {});
  },
  openExternal(): Promise<void> {
    const api = pideskApi();
    if (!api) return Promise.resolve();
    return unwrap(api.browser.openExternal()).then(() => undefined);
  },
  screenshot(): Promise<BrowserScreenshotResult | null> {
    const api = pideskApi();
    if (!api) return Promise.resolve(null);
    return unwrap(api.browser.screenshot()).catch(() => null);
  },
  async pickStart(): Promise<void> {
    const api = pideskApi();
    if (!api) return;
    await unwrap(api.browser.pickStart());
  },
  async pickStop(): Promise<void> {
    const api = pideskApi();
    if (!api) return;
    await unwrap(api.browser.pickStop());
  },
  /** 拾取会话内切换子模式（圈选 / 浏览，06 §3.1）。 */
  async setPickMode(mode: BrowserPickMode): Promise<void> {
    const api = pideskApi();
    if (!api) return;
    await unwrap(api.browser.setPickMode({ mode }));
  },

  /**
   * 检查器只读三件套（06 §4.4）。
   * 失败（节点失效 / 会话已关）统一返回 null —— 调用方按「已失效」处理，
   * 不能让 CDP 的协议错误冒泡成 UI 崩溃。
   */
  async inspectStyles(nodeId: number): Promise<InspectorStyleData | null> {
    const api = pideskApi();
    if (!api) return null;
    return unwrap(api.browser.inspectStyles({ nodeId })).catch(() => null);
  },
  async inspectBoxModel(nodeId: number): Promise<InspectorBoxModel | null> {
    const api = pideskApi();
    if (!api) return null;
    return unwrap(api.browser.inspectBoxModel({ nodeId })).catch(() => null);
  },
  async inspectDomTree(nodeId: number): Promise<InspectorDomTree | null> {
    const api = pideskApi();
    if (!api) return null;
    return unwrap(api.browser.inspectDomTree({ nodeId })).catch(() => null);
  },

  /**
   * 样式热更改（docs/design/22）：全量替换某 selector 的调整声明。
   * 失败返回 null，由调用方提示；不把 CDP 协议错误冒泡成 UI 崩溃。
   */
  async stylePatch(
    nodeId: number,
    selector: string,
    declarations: StylePatchDeclaration[],
  ): Promise<StylePatchResult | null> {
    const api = pideskApi();
    if (!api) return null;
    return unwrap(api.browser.stylePatch({ nodeId, selector, declarations })).catch(() => null);
  },

  /** 清除调整；selector=null 清空全部。 */
  async stylePatchClear(selector: string | null): Promise<void> {
    const api = pideskApi();
    if (!api) return;
    await unwrap(api.browser.stylePatchClear({ selector } satisfies StylePatchClearRequest)).catch(
      () => undefined,
    );
  },

  /** 导出调整为 CSS 文本（失败返回空串）。 */
  async stylePatchExport(host: string): Promise<string> {
    const api = pideskApi();
    if (!api) return "";
    return unwrap(api.browser.stylePatchExport({ host } satisfies StylePatchExportRequest))
      .then((result) => result.css)
      .catch(() => "");
  },
  /** 面板宿主区域 bounds 同步；失败静默（下一次 RO 触发会重试）。 */
  setBounds(req: BrowserBoundsRequest): void {
    pideskApi()
      ?.browser.setBounds(req)
      .catch(() => {});
  },
  setViewport(width: number | null): void {
    pideskApi()
      ?.browser.setViewport({ width })
      .catch(() => {});
  },

  /** 忽略缓存强制刷新。 */
  forceReload(): Promise<void> {
    const api = pideskApi();
    if (!api) return Promise.resolve();
    return unwrap(api.browser.forceReload()).then(() => undefined);
  },

  /** 打开页面 DevTools（独立窗口）。 */
  openDevTools(): Promise<void> {
    const api = pideskApi();
    if (!api) return Promise.resolve();
    return unwrap(api.browser.openDevTools()).then(() => undefined);
  },

  /** 页面缩放（1 = 100%）。 */
  setZoom(factor: number): void {
    pideskApi()
      ?.browser.setZoom({ factor })
      .catch(() => {});
  },

  /** 清除 persist:browser 分区 Cookie。 */
  clearCookies(): Promise<void> {
    const api = pideskApi();
    if (!api) return Promise.resolve();
    return unwrap(api.browser.clearCookies()).then(() => undefined);
  },

  /** 清除 persist:browser 分区 HTTP 缓存。 */
  clearCache(): Promise<void> {
    const api = pideskApi();
    if (!api) return Promise.resolve();
    return unwrap(api.browser.clearCache()).then(() => undefined);
  },

  /** 手动粘贴 Cookie 导入 persist:browser（docs/design/09 M1）。 */
  applyPastedCookies(
    req: BrowserApplyPastedCookiesRequest,
  ): Promise<BrowserApplyPastedCookiesResult> {
    const api = pideskApi();
    if (!api) return Promise.reject(new Error("预加载 API 不可用"));
    return unwrap(api.browser.applyPastedCookies(req));
  },

  /** 列出本机 Chromium Profile（docs/design/09 M2）。 */
  listLoginSources(): Promise<BrowserLoginSource[]> {
    const api = pideskApi();
    if (!api) return Promise.resolve([]);
    return unwrap(api.browser.listLoginSources()).catch(() => []);
  },

  /** 预览将导入的 Cookie 名称（不含 value）。 */
  previewLoginCookies(
    req: BrowserPreviewLoginCookiesRequest,
  ): Promise<BrowserPreviewLoginCookiesResult> {
    const api = pideskApi();
    if (!api) return Promise.reject(new Error("预加载 API 不可用"));
    return unwrap(api.browser.previewLoginCookies(req));
  },

  /** 从本机浏览器读取并写入 persist:browser。 */
  applyLoginCookies(req: BrowserApplyLoginCookiesRequest): Promise<BrowserApplyLoginCookiesResult> {
    const api = pideskApi();
    if (!api) return Promise.reject(new Error("预加载 API 不可用"));
    return unwrap(api.browser.applyLoginCookies(req));
  },

  /** 全量导入本机浏览器数据（docs/design/42 §6.6）。 */
  importLoginData(req: BrowserImportLoginDataRequest): Promise<BrowserImportLoginDataResult> {
    const api = pideskApi();
    if (!api) return Promise.reject(new Error("预加载 API 不可用"));
    return unwrap(api.browser.importLoginData(req));
  },

  /** 仅截取当前页冻结帧（视图仍可见）。 */
  async captureOverlayFreeze(): Promise<string | null> {
    const api = pideskApi();
    if (!api) return null;
    try {
      const result = await unwrap(api.browser.captureOverlayFreeze());
      return result.freeze;
    } catch {
      return null;
    }
  },

  /**
   * 临时隐藏页面视图（区域截图 / 设置浮窗 / 更多菜单等与宿主区重叠的浮层）。
   * reason 标识来源，多来源可叠加。不截帧；需要垫底时先 captureOverlayFreeze。
   * 返回 Promise，便于浮层交接（先挂新 reason 再摘旧 reason）时 await 主进程落账。
   */
  setOverlaySuppressed(suppressed: boolean, reason?: string): Promise<void> {
    const api = pideskApi();
    if (!api) return Promise.resolve();
    return unwrap(api.browser.setOverlaySuppressed({ suppressed, reason }))
      .then(() => undefined)
      .catch(() => undefined);
  },

  /** 将渲染层裁剪好的 PNG base64 落盘，返回路径。 */
  saveScreenshot(base64: string): Promise<string | null> {
    const api = pideskApi();
    if (!api) return Promise.resolve(null);
    return unwrap(api.browser.saveScreenshot({ base64 }))
      .then((result) => result.path)
      .catch(() => null);
  },

  /** 新建浏览器页面实例，返回实例 id。 */
  createInstance(): Promise<string | null> {
    const api = pideskApi();
    if (!api) return Promise.resolve(null);
    return unwrap(api.browser.createInstance()).then((result) => result.id);
  },

  /** 关闭指定浏览器页面实例。 */
  closeInstance(id: string): Promise<void> {
    const api = pideskApi();
    if (!api) return Promise.resolve();
    return unwrap(api.browser.closeInstance({ id })).then(() => undefined);
  },

  /** 切换当前活跃的浏览器页面实例。 */
  setActiveInstance(id: string): Promise<void> {
    const api = pideskApi();
    if (!api) return Promise.resolve();
    return unwrap(api.browser.setActiveInstance({ id })).then(() => undefined);
  },

  /** 列出全部浏览器页面实例。 */
  listInstances(): Promise<BrowserInstanceInfo[]> {
    const api = pideskApi();
    if (!api) return Promise.resolve([]);
    return unwrap(api.browser.listInstances()).catch(() => []);
  },

  /** 订阅浏览器推送。 */
  subscribe(callback: (message: BrowserPushMessage) => void): () => void {
    ensureBound();
    pushListeners.add(callback);
    return () => pushListeners.delete(callback);
  },
};

/** 渲染层托盘/上下文芯片的统一条目：元素与"仅截图"两种形态共用（docs/design/05 P1-1/P1-5）。 */
export interface BrowserContextItem {
  id: string;
  kind: "element" | "screenshot";
  url: string;
  at: number;
  /** screenshot 形态时为 "img"。 */
  tag: string;
  selector: string;
  label: string;
  outerHTML: string;
  textSummary: string;
  a11y: string | null;
  rect: { x: number; y: number; width: number; height: number } | null;
  viewport: { width: number; height: number };
  styles: string;
  screenshot: { base64: string; path: string } | null;
  attached: boolean;
  stale: boolean;
}

export function itemFromPickedElement(element: BrowserPickedElement): BrowserContextItem {
  const classList = element.class_attr?.trim() ?? "";
  return {
    id: element.id,
    kind: "element",
    url: element.url,
    at: element.at,
    tag: element.tag,
    selector: element.selector,
    label: `${element.tag}${classList ? `.${classList.split(/\s+/).join(".")}` : ""}`,
    outerHTML: element.outerHTML,
    textSummary: element.textSummary,
    a11y:
      element.a11yRole || element.a11yName
        ? `role=${element.a11yRole ?? "?"}${element.a11yName ? ` name="${element.a11yName}"` : ""}`
        : null,
    rect: element.rect,
    viewport: element.viewport,
    styles: Object.entries(element.styles)
      .map(([key, value]) => `${key}: ${value}`)
      .join("; "),
    screenshot: element.screenshot,
    attached: false,
    stale: false,
  };
}

export function itemFromScreenshot(shot: BrowserScreenshotResult, seq: number): BrowserContextItem {
  return {
    id: `shot-${Date.now()}-${seq}`,
    kind: "screenshot",
    url: shot.url,
    at: Date.now(),
    tag: "img",
    selector: "",
    label: "视口截图",
    outerHTML: "",
    textSummary: "",
    a11y: null,
    rect: null,
    viewport: { width: shot.width, height: shot.height },
    styles: "",
    screenshot: { base64: shot.base64, path: shot.path },
    attached: false,
    stale: false,
  };
}

/** 元素"仅截图"（docs/design/06 §6.3）：只保留截图与来源 URL。 */
export function screenshotItemFromElement(element: BrowserContextItem): BrowserContextItem {
  return {
    ...element,
    id: `${element.id}-shot`,
    kind: "screenshot",
    label: "元素截图",
    outerHTML: "",
    attached: false,
    stale: false,
  };
}

export type { BrowserConsoleError };
