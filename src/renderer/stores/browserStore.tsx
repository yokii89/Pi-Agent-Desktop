import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { t } from "../../shared/i18n";
import type {
  BrowserConsoleError,
  BrowserInstanceInfo,
  BrowserPickMode,
  BrowserRecentUrl,
} from "../../shared/ipc";
import {
  type BrowserContextItem,
  browserService,
  itemFromPickedElement,
  itemFromScreenshot,
  screenshotItemFromElement,
} from "../services/browserService";
import { inspectorFloatService } from "../services/inspectorFloatService";
import { settingsService } from "../services/settingsService";
import { useUiStore } from "./uiStore";

/** 检查器浮窗渲染进程（docs/design/38）：加入对话须跨窗回主窗。 */
function isInspectorFloatSurface(): boolean {
  return document.documentElement.dataset.surface === "inspector";
}

/** 对话区元素芯片上限：超出时淘汰最旧的未发送元素。 */
const MAX_CHAT_ELEMENTS = 12;
/** 缩放区间与步进（与主进程 setBrowserZoom 的夹取一致）。 */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
export const ZOOM_STEP = 0.1;
/** 浏览器页面实例上限（与主进程一致）。 */
export const MAX_BROWSER_INSTANCES = 8;

/** 区域截图会话：整屏冻结帧 + 视口 CSS 尺寸，供渲染层框选后裁剪。 */
export interface RegionCaptureSession {
  base64: string;
  url: string;
  /** 视口 CSS 宽高（与冻结帧对应）。 */
  width: number;
  height: number;
}

interface BrowserState {
  /** 全部浏览器页面（页签）；导航状态字段只反映活跃页。 */
  pages: BrowserInstanceInfo[];
  /** 当前活跃页面 id。 */
  activePageId: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** 拾取会话开关（主进程为事实源，pick 推送对齐）。 */
  pickActive: boolean;
  /** 拾取会话内的子模式：圈选（overlay on）/ 浏览（overlay off，06 §3.1）。 */
  pickMode: BrowserPickMode;
  /** 页面实例是否已创建（地址栏可见即 true，控制空态展示）。 */
  started: boolean;
  recentUrls: BrowserRecentUrl[];
  errors: BrowserConsoleError[];
  /**
   * 最近一次拾取的元素（检查器查看目标）。
   * Enter /「加入对话」后写入 chatElements，默认不附带截图。
   */
  lastPicked: BrowserContextItem | null;
  /** 已进入中央输入框的元素芯片（发送后清空）。 */
  chatElements: BrowserContextItem[];
  viewportWidth: number | null;
  /** 页面缩放因子（1 = 100%），与主进程 setZoomFactor 对齐。 */
  zoomFactor: number;
  /** 区域截图会话；非 null 时页面视图被抑制，宿主区展示冻结帧供框选。 */
  regionCapture: RegionCaptureSession | null;
  /**
   * 浮层抑制期间的页面冻结帧（dataURL）。
   * 更多菜单等打开时主进程 capturePage，垫在宿主区避免露黑底。
   */
  overlayFreeze: string | null;
}

type BrowserAction =
  | { type: "setPages"; pages: BrowserInstanceInfo[]; activePageId: string }
  | { type: "pageCreated"; page: BrowserInstanceInfo }
  | { type: "pageClosed"; id: string }
  | { type: "pageActivated"; id: string }
  | {
      type: "navigated";
      url: string;
      title: string;
      canGoBack: boolean;
      canGoForward: boolean;
      commit: boolean;
    }
  | { type: "loading"; loading: boolean }
  | { type: "started" }
  | { type: "pick"; active: boolean; mode: BrowserPickMode }
  | { type: "consoleError"; error: BrowserConsoleError }
  | { type: "clearErrors" }
  | { type: "setRecentUrls"; urls: BrowserRecentUrl[] }
  | { type: "picked"; item: BrowserContextItem }
  | { type: "chatAdd"; item: BrowserContextItem }
  | { type: "chatAddFromLastPicked" }
  | { type: "chatRemove"; id: string }
  | { type: "chatClear" }
  | { type: "setViewport"; width: number | null }
  | { type: "setZoom"; factor: number }
  | { type: "regionCaptureStart"; session: RegionCaptureSession }
  | { type: "regionCaptureEnd" }
  | { type: "setOverlayFreeze"; freeze: string | null };

const initialState: BrowserState = {
  pages: [],
  activePageId: "",
  url: "",
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  pickActive: false,
  pickMode: "select",
  started: false,
  recentUrls: [],
  errors: [],
  lastPicked: null,
  chatElements: [],
  viewportWidth: null,
  zoomFactor: 1,
  regionCapture: null,
  overlayFreeze: null,
};

function browserReducer(state: BrowserState, action: BrowserAction): BrowserState {
  switch (action.type) {
    case "setPages":
      return { ...state, pages: action.pages, activePageId: action.activePageId };
    case "pageCreated":
      return {
        ...state,
        pages: [...state.pages, action.page],
        activePageId: action.page.id,
        // 新页未导航：活跃展示态清空，保留空态
        url: "",
        title: "",
        started: false,
        loading: false,
        canGoBack: false,
        canGoForward: false,
        pickActive: false,
        pickMode: "select",
        errors: [],
      };
    case "pageClosed": {
      const closedIndex = state.pages.findIndex((page) => page.id === action.id);
      const pages = state.pages.filter((page) => page.id !== action.id);
      // 与主进程 closeBrowserInstance 同构：优先原位置后的下一个，否则前一个
      const activePageId =
        state.activePageId === action.id
          ? (pages[closedIndex]?.id ?? pages[closedIndex - 1]?.id ?? pages[0]?.id ?? "")
          : state.activePageId;
      return { ...state, pages, activePageId };
    }
    case "pageActivated":
      return {
        ...state,
        activePageId: action.id,
        // 切换页先清拾取与错误；导航态等主进程 setActive 后的推送对齐
        pickActive: false,
        pickMode: "select",
        errors: [],
      };
    case "navigated": {
      const changed = action.url !== state.url || action.commit;
      const started = Boolean(action.url);
      const pages = state.pages.map((page) =>
        page.id === state.activePageId
          ? { ...page, url: action.url, title: action.title, started }
          : page,
      );
      return {
        ...state,
        pages,
        url: action.url,
        title: action.title,
        canGoBack: action.canGoBack,
        canGoForward: action.canGoForward,
        started,
        // 真实导航/刷新（含热重载整页刷新）后对话元素标记过期；页内路由不失效
        lastPicked:
          changed && state.lastPicked ? { ...state.lastPicked, stale: true } : state.lastPicked,
        chatElements: changed
          ? state.chatElements.map((item) => ({ ...item, stale: true }))
          : state.chatElements,
      };
    }
    case "loading":
      return { ...state, loading: action.loading };
    case "started":
      return { ...state, started: true };
    case "pick":
      return { ...state, pickActive: action.active, pickMode: action.mode };
    case "consoleError":
      return { ...state, errors: [...state.errors.slice(-(50 - 1)), action.error] };
    case "clearErrors":
      return { ...state, errors: [] };
    case "setRecentUrls":
      return { ...state, recentUrls: action.urls };
    case "picked":
      // 拾取只更新「当前选中」，不自动进对话 —— Enter /「加入对话」才确认
      return { ...state, lastPicked: action.item };
    case "chatAdd": {
      if (state.chatElements.some((item) => item.id === action.item.id)) return state;
      const next = [...state.chatElements, { ...action.item, attached: true }];
      return { ...state, chatElements: next.slice(-MAX_CHAT_ELEMENTS) };
    }
    case "chatAddFromLastPicked": {
      // 默认文本优先：进对话框的元素芯片不附带截图
      if (!state.lastPicked) return state;
      const { screenshot: _screenshot, ...rest } = state.lastPicked;
      const item = { ...rest, screenshot: null };
      if (state.chatElements.some((entry) => entry.id === item.id)) return state;
      const next = [...state.chatElements, { ...item, attached: true }];
      return { ...state, chatElements: next.slice(-MAX_CHAT_ELEMENTS) };
    }
    case "chatRemove":
      return { ...state, chatElements: state.chatElements.filter((item) => item.id !== action.id) };
    case "chatClear":
      return { ...state, chatElements: [] };
    case "setViewport":
      return { ...state, viewportWidth: action.width };
    case "setZoom":
      return { ...state, zoomFactor: action.factor };
    case "regionCaptureStart":
      return { ...state, regionCapture: action.session };
    case "regionCaptureEnd":
      return { ...state, regionCapture: null };
    case "setOverlayFreeze":
      return { ...state, overlayFreeze: action.freeze };
    default:
      return state;
  }
}

interface BrowserStoreValue extends BrowserState {
  /** 新建浏览器页面并切过去；达到上限或 IPC 失败时返回 null。 */
  createPage: () => Promise<string | null>;
  /** 关闭指定浏览器页面。 */
  closePage: (id: string) => Promise<void>;
  /** 切换活跃浏览器页面。 */
  setActivePage: (id: string) => Promise<void>;
  navigate: (input: string) => Promise<void>;
  /** 在侧栏浏览器中打开本地 HTML 文件；返回是否成功（调用方据此决定是否切 Tab）。 */
  openLocalFile: (filePath: string) => Promise<boolean>;
  reload: () => Promise<void>;
  back: () => void;
  forward: () => void;
  stop: () => void;
  openExternal: () => void;
  /** 十字准星按钮：进入/退出拾取会话（ESC 由主进程兜底并回推状态）。 */
  togglePick: () => void;
  /** 退出拾取会话（ESC 的「浏览 → 退出」那一层，06 §3.1）。 */
  exitPick: () => void;
  /** 拾取会话内的子模式切换（圈选 / 浏览）。 */
  setPickMode: (mode: BrowserPickMode) => void;
  /** 把最近拾取的元素作为截图芯片加入对话（兜底动作，默认不走）。 */
  addLastPickedScreenshot: () => void;
  /** Enter /「加入对话」：把最近拾取元素写入中央输入框芯片（默认无截图）。 */
  addLastPickedToChat: () => void;
  /** 直接加入对话（截图、区域截图等）。 */
  addChatElement: (item: BrowserContextItem) => void;
  removeChatElement: (id: string) => void;
  /** 发送后清空对话芯片。 */
  clearChatElements: () => void;
  /** 视口截图并入对话（兜底输入）。 */
  captureViewportToChat: () => Promise<void>;
  /** 进入手动区域截图：冻结整屏并在宿主区展示选区 UI。 */
  startRegionCapture: () => Promise<void>;
  /** 退出区域截图（取消或完成后恢复页面视图）。 */
  endRegionCapture: () => void;
  /** 按 CSS 像素裁剪冻结帧并入对话。 */
  confirmRegionCapture: (clip: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => Promise<void>;
  /** 刷新并等待加载完成，返回视口截图（验证闭环）。 */
  reloadAndCapture: () => Promise<{ base64: string; url: string } | null>;
  setViewport: (width: number | null) => void;
  /** 忽略缓存强制刷新。 */
  forceReload: () => Promise<void>;
  /** 打开页面 DevTools（独立窗口）。 */
  openDevTools: () => Promise<void>;
  /** 步进缩放（delta 建议传 ±ZOOM_STEP，最终夹在 50%–300%）。 */
  stepZoom: (delta: number) => void;
  /** 浮层抑制冻结帧（更多菜单等打开时垫宿主区，避免露黑底）。 */
  setOverlayFreeze: (freeze: string | null) => void;
  clearCookies: () => Promise<void>;
  clearCache: () => Promise<void>;
  copyText: (text: string, what: string) => void;
}

const BrowserStoreContext = createContext<BrowserStoreValue | null>(null);

let screenshotSeq = 0;

/**
 * 按 CSS 像素裁剪 PNG base64。
 * 冻结帧可能是 device 像素，用 naturalWidth/cssWidth 换算后再 drawImage。
 */
async function cropBase64Png(
  base64: string,
  cssWidth: number,
  cssHeight: number,
  clip: { x: number; y: number; width: number; height: number },
): Promise<string> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("冻结帧解码失败"));
    img.src = `data:image/png;base64,${base64}`;
  });
  const scaleX = cssWidth > 0 ? img.naturalWidth / cssWidth : 1;
  const scaleY = cssHeight > 0 ? img.naturalHeight / cssHeight : 1;
  const sx = Math.max(0, Math.round(clip.x * scaleX));
  const sy = Math.max(0, Math.round(clip.y * scaleY));
  const sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.round(clip.width * scaleX)));
  const sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.round(clip.height * scaleY)));
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建裁剪画布");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const dataUrl = canvas.toDataURL("image/png");
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

/** 浏览器面板状态：拾取 → Enter 进对话芯片；截图是显式兜底，默认不走。 */
export function BrowserProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(browserReducer, initialState);
  const { showToast, dispatch: uiDispatch } = useUiStore();
  const activePageIdRef = useRef("");
  // 同步 ref，供推送订阅闭包读取最新活跃页
  useEffect(() => {
    activePageIdRef.current = state.activePageId;
  }, [state.activePageId]);

  // 外网提示去重：同一 host 只提示一次
  const warnedHostsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // 启动恢复最近 URL 与视口预设，并拉取浏览器页签列表
    settingsService.get().then((settings) => {
      if (!settings) return;
      dispatch({ type: "setRecentUrls", urls: settings.browserRecentUrls ?? [] });
      dispatch({ type: "setViewport", width: settings.browserViewportWidth ?? null });
      if (settings.browserViewportWidth) {
        browserService.setViewport(settings.browserViewportWidth);
      }
    });
    void browserService.listInstances().then((pages) => {
      if (pages.length === 0) return;
      dispatch({
        type: "setPages",
        pages,
        activePageId: pages[0]?.id ?? "",
      });
    });

    return browserService.subscribe((message) => {
      // 后台页也可能推送（加载中的旧页）；只处理当前活跃页的消息
      if (message.id !== activePageIdRef.current) return;
      switch (message.type) {
        case "navigated": {
          dispatch({
            type: "navigated",
            url: message.payload.url,
            title: message.payload.title,
            canGoBack: message.payload.canGoBack,
            canGoForward: message.payload.canGoForward,
            commit: message.payload.kind === "commit",
          });
          try {
            const host = new URL(message.payload.url).hostname;
            const isLocal =
              host === "localhost" ||
              host === "127.0.0.1" ||
              host === "::1" ||
              host.endsWith(".local") ||
              /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
            if (!isLocal && !warnedHostsRef.current.has(host)) {
              warnedHostsRef.current.add(host);
              showToast(t("browser.toast.externalWarn"));
            }
          } catch {
            // URL 解析失败不阻断
          }
          break;
        }
        case "picked":
          dispatch({ type: "picked", item: itemFromPickedElement(message.payload) });
          break;
        case "pickConfirm": {
          // 页面 Enter 广播到双窗：芯片只落在主窗；浮窗 UI 的「加入对话」另走 chatAdd 意图
          if (isInspectorFloatSurface()) break;
          // 这里用函数式更新读最新 lastPicked（subscribe 闭包拿不到本次 reducer 后的 state）
          dispatch({ type: "chatAddFromLastPicked" });
          break;
        }
        case "console":
          dispatch({ type: "consoleError", error: message.payload });
          break;
        case "error":
          showToast(message.payload);
          break;
        case "loading":
          dispatch({ type: "loading", loading: message.payload });
          break;
        case "pick":
          dispatch({ type: "pick", active: message.payload.active, mode: message.payload.mode });
          break;
      }
    });
  }, [showToast]);

  const createPage = useCallback(async (): Promise<string | null> => {
    if (state.pages.length >= MAX_BROWSER_INSTANCES) {
      showToast(t("browser.toast.maxInstances", { count: MAX_BROWSER_INSTANCES }));
      return null;
    }
    try {
      // createInstance 内部会 setActive，推送可能在返回前到达；先占 ref
      const pending = browserService.createInstance();
      // id 在 await 后才知道；用微任务窗口接受即将到来的推送（id 未知时先放行）
      // 简化：create 返回后再对齐 ref，pageCreated 已重置空白态，丢弃新建页的空 navigated 无影响
      const id = await pending;
      if (!id) {
        showToast(t("browser.toast.createFailed"));
        return null;
      }
      activePageIdRef.current = id;
      dispatch({
        type: "pageCreated",
        page: { id, url: "", title: "", started: false },
      });
      dispatch({ type: "loading", loading: false });
      dispatch({ type: "clearErrors" });
      dispatch({ type: "pick", active: false, mode: "select" });
      return id;
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("browser.toast.createFailed"));
      return null;
    }
  }, [state.pages.length, showToast]);

  const closePage = useCallback(
    async (id: string): Promise<void> => {
      if (state.pages.length <= 1) {
        showToast(t("browser.toast.keepOne"));
        return;
      }
      const closedIndex = state.pages.findIndex((page) => page.id === id);
      const remaining = state.pages.filter((page) => page.id !== id);
      // 与主进程 closeBrowserInstance 同构：优先原位置后的下一个，否则前一个
      const nextActive =
        state.activePageId === id
          ? (remaining[closedIndex]?.id ?? remaining[closedIndex - 1]?.id ?? remaining[0]?.id ?? "")
          : state.activePageId;
      // 关闭活跃页：先本地切到下一个，主进程推送的 navigated 才能写进正确页签
      if (nextActive && nextActive !== state.activePageId) {
        activePageIdRef.current = nextActive;
        dispatch({ type: "pageActivated", id: nextActive });
      }
      try {
        await browserService.closeInstance(id);
        dispatch({ type: "pageClosed", id });
      } catch (err) {
        activePageIdRef.current = state.activePageId;
        dispatch({ type: "pageActivated", id: state.activePageId });
        showToast(err instanceof Error ? err.message : t("browser.toast.closeFailed"));
      }
    },
    [state.pages, state.activePageId, showToast],
  );

  const setActivePage = useCallback(
    async (id: string): Promise<void> => {
      if (!id || id === state.activePageId) return;
      const prevId = state.activePageId;
      // 先落本地 activePageId：主进程 setActive 的推送必须命中「已是新 id」的 reducer 状态
      activePageIdRef.current = id;
      dispatch({ type: "pageActivated", id });
      try {
        await browserService.setActiveInstance(id);
      } catch (err) {
        activePageIdRef.current = prevId;
        dispatch({ type: "pageActivated", id: prevId });
        showToast(err instanceof Error ? err.message : t("browser.toast.switchFailed"));
      }
    },
    [state.activePageId, showToast],
  );

  const navigate = useCallback(
    async (input: string): Promise<void> => {
      try {
        await browserService.navigate(input);
        dispatch({ type: "started" });
      } catch (err) {
        showToast(err instanceof Error ? err.message : t("browser.toast.navigateFailed"));
      }
    },
    [showToast],
  );

  /**
   * 在侧栏浏览器中打开本地 HTML 文件（文件面板 file:// 专用通道）。
   * 返回是否成功，供调用方决定是否切 Tab。首次使用时 store 还没有页签，
   * 主进程会静默建默认实例但推送会被订阅按 activePageId 丢弃——所以先
   * createPage 对齐 id，后续 navigated 推送才能写进地址栏。
   */
  const openLocalFile = useCallback(
    async (filePath: string): Promise<boolean> => {
      try {
        if (state.pages.length === 0) {
          const id = await createPage();
          if (!id) return false;
        }
        await browserService.openLocalFile(filePath);
        // 打开成功即带到浏览器 Tab：来源面板（文件预览）状态已跨 Tab 保活，可随时切回
        uiDispatch({ type: "setRightSidebar", open: true, tab: "browser" });
        return true;
      } catch (err) {
        showToast(err instanceof Error ? err.message : t("browser.toast.openLocalFailed"));
        return false;
      }
    },
    [state.pages.length, createPage, showToast, uiDispatch],
  );

  const reload = useCallback(async (): Promise<void> => {
    try {
      await browserService.reload();
    } catch {
      // 静默：未打开页面时无需刷新
    }
  }, []);

  const togglePick = useCallback((): void => {
    if (state.pickActive) {
      browserService.pickStop().catch(() => {});
      return;
    }
    browserService.pickStart().catch((err: unknown) => {
      showToast(err instanceof Error ? err.message : t("browser.toast.pickFailed"));
    });
  }, [state.pickActive, showToast]);

  const exitPick = useCallback((): void => {
    browserService.pickStop().catch(() => {});
  }, []);

  const setPickMode = useCallback(
    (mode: BrowserPickMode): void => {
      browserService.setPickMode(mode).catch((err: unknown) => {
        showToast(err instanceof Error ? err.message : t("browser.toast.pickModeFailed"));
      });
    },
    [showToast],
  );

  const addChatElement = useCallback((item: BrowserContextItem): void => {
    dispatch({ type: "chatAdd", item });
  }, []);

  const addLastPickedToChat = useCallback((): void => {
    if (isInspectorFloatSurface()) {
      void inspectorFloatService.chatAdd();
      return;
    }
    dispatch({ type: "chatAddFromLastPicked" });
  }, []);

  const addLastPickedScreenshot = useCallback((): void => {
    if (!state.lastPicked) return;
    dispatch({ type: "chatAdd", item: screenshotItemFromElement(state.lastPicked) });
  }, [state.lastPicked]);

  const removeChatElement = useCallback((id: string): void => {
    dispatch({ type: "chatRemove", id });
  }, []);

  const clearChatElements = useCallback((): void => {
    dispatch({ type: "chatClear" });
  }, []);

  const captureViewportToChat = useCallback(async (): Promise<void> => {
    const shot = await browserService.screenshot();
    if (!shot) {
      showToast(t("browser.toast.captureNoPage"));
      return;
    }
    screenshotSeq += 1;
    dispatch({ type: "chatAdd", item: itemFromScreenshot(shot, screenshotSeq) });
  }, [showToast]);

  const endRegionCapture = useCallback((): void => {
    void browserService.setOverlaySuppressed(false, "regionCapture");
    dispatch({ type: "regionCaptureEnd" });
  }, []);

  const startRegionCapture = useCallback(async (): Promise<void> => {
    if (state.regionCapture) return;
    // 拾取 overlay 与选区 UI 冲突，先退出拾取
    if (state.pickActive) browserService.pickStop().catch(() => {});
    const shot = await browserService.screenshot();
    if (!shot) {
      showToast(t("browser.toast.captureNoPage"));
      return;
    }
    // 冻结帧先落到宿主区，再藏原生视图，避免闪一帧底色
    dispatch({
      type: "regionCaptureStart",
      session: {
        base64: shot.base64,
        url: shot.url,
        width: shot.width,
        height: shot.height,
      },
    });
    void browserService.setOverlaySuppressed(true, "regionCapture");
  }, [state.regionCapture, state.pickActive, showToast]);

  const confirmRegionCapture = useCallback(
    async (clip: { x: number; y: number; width: number; height: number }): Promise<void> => {
      const session = state.regionCapture;
      if (!session) return;
      if (clip.width < 2 || clip.height < 2) {
        showToast(t("browser.toast.regionTooSmall"));
        return;
      }
      try {
        const cropped = await cropBase64Png(session.base64, session.width, session.height, clip);
        const path = await browserService.saveScreenshot(cropped);
        if (!path) {
          showToast(t("browser.toast.regionSaveFailed"));
          return;
        }
        screenshotSeq += 1;
        dispatch({
          type: "chatAdd",
          item: itemFromScreenshot(
            {
              base64: cropped,
              path,
              url: session.url,
              width: Math.round(clip.width),
              height: Math.round(clip.height),
            },
            screenshotSeq,
          ),
        });
      } catch {
        showToast(t("browser.toast.regionFailed"));
      } finally {
        endRegionCapture();
      }
    },
    [state.regionCapture, showToast, endRegionCapture],
  );

  const reloadAndCapture = useCallback(async (): Promise<{
    base64: string;
    url: string;
  } | null> => {
    if (!state.url) {
      showToast(t("browser.toast.noPage"));
      return null;
    }
    // 等待本次刷新的导航完成推送（loading → false），超时兜底 15s
    let unsubscribe: (() => void) | null = null;
    const done = new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => {
        unsubscribe?.();
        resolve();
      }, 15000);
      unsubscribe = browserService.subscribe((message) => {
        if (message.type === "loading" && message.payload === false) {
          window.clearTimeout(timer);
          unsubscribe?.();
          resolve();
        }
      });
    });
    try {
      await browserService.reload();
      await done;
    } catch {
      showToast(t("browser.toast.reloadFailed"));
      return null;
    }
    const shot = await browserService.screenshot();
    if (!shot) {
      showToast(t("browser.toast.captureFailed"));
      return null;
    }
    return { base64: shot.base64, url: shot.url };
  }, [state.url, showToast]);

  const setViewport = useCallback((width: number | null): void => {
    dispatch({ type: "setViewport", width });
    browserService.setViewport(width);
    settingsService.set({ browserViewportWidth: width });
  }, []);

  const forceReload = useCallback(async (): Promise<void> => {
    try {
      await browserService.forceReload();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("browser.toast.forceReloadFailed"));
    }
  }, [showToast]);

  const openDevTools = useCallback(async (): Promise<void> => {
    try {
      await browserService.openDevTools();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("browser.toast.devtoolsFailed"));
    }
  }, [showToast]);

  const stepZoom = useCallback(
    (delta: number): void => {
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, state.zoomFactor + delta));
      dispatch({ type: "setZoom", factor: next });
      browserService.setZoom(next);
    },
    [state.zoomFactor],
  );

  const setOverlayFreeze = useCallback((freeze: string | null): void => {
    dispatch({ type: "setOverlayFreeze", freeze });
  }, []);

  const clearCookies = useCallback(async (): Promise<void> => {
    try {
      await browserService.clearCookies();
      showToast(t("browser.toast.cookiesCleared"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("browser.toast.clearCookiesFailed"));
    }
  }, [showToast]);

  const clearCache = useCallback(async (): Promise<void> => {
    try {
      await browserService.clearCache();
      showToast(t("browser.toast.cacheCleared"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("browser.toast.clearCacheFailed"));
    }
  }, [showToast]);

  const copyText = useCallback(
    (text: string, what: string): void => {
      navigator.clipboard
        .writeText(text)
        .then(() => showToast(t("common.copiedWhat", { what })))
        .catch(() => showToast(t("common.copyFailed")));
    },
    [showToast],
  );

  const value = useMemo<BrowserStoreValue>(
    () => ({
      ...state,
      createPage,
      closePage,
      setActivePage,
      navigate,
      openLocalFile,
      reload,
      back: () => browserService.back(),
      forward: () => browserService.forward(),
      stop: () => browserService.stop(),
      openExternal: () => {
        browserService
          .openExternal()
          .catch((err: unknown) =>
            showToast(err instanceof Error ? err.message : t("common.openFailed")),
          );
      },
      togglePick,
      exitPick,
      setPickMode,
      addLastPickedToChat,
      addLastPickedScreenshot,
      addChatElement,
      removeChatElement,
      clearChatElements,
      captureViewportToChat,
      startRegionCapture,
      endRegionCapture,
      confirmRegionCapture,
      reloadAndCapture,
      setViewport,
      forceReload,
      openDevTools,
      stepZoom,
      setOverlayFreeze,
      clearCookies,
      clearCache,
      copyText,
    }),
    [
      state,
      createPage,
      closePage,
      setActivePage,
      navigate,
      openLocalFile,
      reload,
      togglePick,
      exitPick,
      setPickMode,
      addLastPickedToChat,
      addLastPickedScreenshot,
      addChatElement,
      removeChatElement,
      clearChatElements,
      captureViewportToChat,
      startRegionCapture,
      endRegionCapture,
      confirmRegionCapture,
      reloadAndCapture,
      setViewport,
      forceReload,
      openDevTools,
      stepZoom,
      setOverlayFreeze,
      clearCookies,
      clearCache,
      copyText,
      showToast,
    ],
  );

  return <BrowserStoreContext.Provider value={value}>{children}</BrowserStoreContext.Provider>;
}

export function useBrowserStore(): BrowserStoreValue {
  const ctx = useContext(BrowserStoreContext);
  if (!ctx) throw new Error("useBrowserStore 必须在 BrowserProvider 内使用");
  return ctx;
}
