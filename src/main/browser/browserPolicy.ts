import {
  app,
  type BrowserWindow,
  type HandlerDetails,
  type Session,
  session,
  type WebContents,
  type WindowOpenHandlerResponse,
} from "electron";
import { getMainWindow } from "../window/createMainWindow";
import { BROWSER_PARTITION, resolvePageOpenTarget } from "./browserPolicyRules";

/**
 * 内嵌浏览器面板的「在应用内浏览」策略（docs/design/42）。
 *
 * 与主窗口 / 扩展 View 不同，面板本身是浏览器：站内导航与 `window.open`（典型场景是
 * Google / SSO 登录弹窗）必须留在 PiDesk 内。否则登录被丢给系统浏览器，Cookie 落在那边的
 * 会话里，面板依旧未登录——用户看到的症状就是「点登录跳去了默认浏览器」。
 * 面板与其弹窗共用 `persist:browser` 分区，登录 Cookie 因此会回到面板。
 *
 * 本模块只做 Electron 侧接线，判定规则是纯函数（`browserPolicyRules.ts`，有单测）。
 */

let browserSession: Session | null = null;

/**
 * 同时存活的站内弹窗上限。页面可以在没有用户手势的情况下反复 `window.open`，
 * 实测 Electron 不套用 Chromium 的弹窗拦截器（无手势连续 5 次全部开窗），
 * 不设上限就是一个页面刷满渲染进程的入口。
 */
const MAX_BROWSER_POPUPS = 4;
const livePopups = new Set<BrowserWindow>();

let popupBlockedListener: ((limit: number) => void) | null = null;

/**
 * 「这条开窗请求请面板开一个新页签」的执行入口。由 `browserView` 注入（它才持有页面实例表
 * 与推送通道），与 `setBrowserPopupBlockedListener` 同形，避免策略层反向依赖 `browserView`
 * 造成循环引用（docs/design/63 §四 P1）。
 */
let pageOpenHandler: ((opener: WebContents, url: string) => void) | null = null;

/**
 * 页签落地形态的执行入口注入。
 *
 * 注入点在 `registerBrowserLifecycle()`（`src/main/index.ts:24`，模块加载即执行），
 * 早于任何 WebContents 存在，因此不可能出现「开窗请求没人接」。
 */
export function setBrowserPageOpenHandler(
  handler: ((opener: WebContents, url: string) => void) | null,
): void {
  pageOpenHandler = handler;
}

/**
 * 弹窗被上限拒绝时的上报入口。由 `browserView` 注入（它才持有页面实例与推送通道），
 * 避免策略层反向依赖 `browserView` 造成循环引用。
 */
export function setBrowserPopupBlockedListener(listener: ((limit: number) => void) | null): void {
  popupBlockedListener = listener;
}

/** 面板共享 session；主进程内同一分区始终返回同一实例，可据此判定归属。 */
export function getBrowserSession(): Session {
  if (!browserSession) browserSession = session.fromPartition(BROWSER_PARTITION);
  return browserSession;
}

/**
 * 判定 WebContents 是否属于面板（含 `window.open` 弹窗）。
 *
 * 用 session 而不是实例表：弹窗由 Electron 直接创建、实例表里没有它，但它继承父窗的
 * `persist:browser` 分区（实测确认，opener 关系也保留）。判定发生在事件触发时而不是创建时，
 * 因此 `web-contents-created` 的注册顺序不影响结果。
 */
export function isBrowserContents(contents: WebContents): boolean {
  // session 只能在 app ready 之后取；早于 ready 的 contents 不可能是面板
  if (!app.isReady()) return false;
  try {
    return contents.session === getBrowserSession();
  } catch {
    // contents 已销毁时取 session 会抛错，按「不是面板」处理
    return false;
  }
}

/**
 * 面板 session 的身份：**不做任何伪装**（docs/design/42 §6.9）。
 *
 * 这里曾有过「UA 归一成 Chrome + 手动注入 UA-CH」的一对函数，2026-10-08 实测证明它们
 * 正是 Google 登录被拦的原因：请求头自称 `Google Chrome`，而页面 JS 里
 * `navigator.userAgentData.brands` 根本没有 `Google Chrome`（含 `getHighEntropyValues()`
 * 的 `fullVersionList`），构成一对页面侧可直接检出的矛盾 → Google 判定「内嵌应用冒充
 * 浏览器」→ 既弹通行密钥选择器又报 `This browser or app may not be secure`。
 * 保留 Chromium / Electron 自己的诚实身份（与 ZCode 同档）后，登录直接放行。
 */

/**
 * 面板内一次开窗请求的落地（docs/design/63 §四 P1，取代 42 §二 L2 的「一律开子窗」）：
 *
 * - `tab`：交 `browserView` 在面板里开新页签，这里返回 `deny`——不 deny 的话 Electron
 *   已经把子窗建出来了，页签和浮窗会同时出现。
 * - `window`：应用内原生子窗（`action:"allow"` + `parent` = 主窗）。留给带 `features` 的
 *   显式弹窗（OAuth / 支付靠 `window.opener` 收尾）、`about:blank`（站点要**活句柄**写内容）、
 *   命名 target（语义是复用同一个窗）、Shift+左键（用户显式要开新窗）。子窗以主窗为 parent：
 *   跟随 PiDesk 最小化 / 关闭，不留孤儿窗口。
 * - `deny`：非 Web 协议，不交给系统浏览器（与 42 §二 L6 一致）。
 *
 * 分类本身是纯函数 `resolvePageOpenTarget`（实测依据见 63 §二 矩阵），本函数只做 Electron
 * 侧接线。弹窗上限仍只对 `window` 生效——页签有自己的上限（`MAX_BROWSER_INSTANCES`）。
 */
export function browserWindowOpenResponse(
  opener: WebContents,
  details: HandlerDetails,
): WindowOpenHandlerResponse {
  const target = resolvePageOpenTarget(details);
  if (target === "deny") return { action: "deny" };
  if (target === "tab") {
    pageOpenHandler?.(opener, details.url);
    return { action: "deny" };
  }
  if (livePopups.size >= MAX_BROWSER_POPUPS) {
    popupBlockedListener?.(MAX_BROWSER_POPUPS);
    return { action: "deny" };
  }
  // 允许后子窗由 Electron 创建，只能事后登记（deny 不触发 did-create-window）
  opener.once("did-create-window", (child) => {
    livePopups.add(child);
    child.once("closed", () => livePopups.delete(child));
  });
  const parent = getMainWindow();
  return {
    action: "allow",
    overrideBrowserWindowOptions: {
      ...(parent ? { parent } : {}),
      autoHideMenuBar: true,
      // 不写死尺寸：window.open 的 features（OAuth 弹窗常自带 width/height）会被本处选项覆盖
      webPreferences: {
        partition: BROWSER_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    },
  };
}
