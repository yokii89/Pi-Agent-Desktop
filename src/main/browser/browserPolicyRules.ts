/**
 * 内嵌浏览器面板「在应用内浏览」策略里的纯逻辑（无 Electron 依赖，便于单测；
 * 同 `loginImportParse` 的拆分方式）。策略本体见 `browserPolicy.ts`，动机见 docs/design/42。
 *
 * 历史提醒：这里曾有过「UA 归一 + 伪造 UA-CH」的一组函数（docs/design/42 §3 L5 / §6.3），
 * 2026-10-08 实测证明**它们才是 Google 登录被拦的原因**（请求头自称 Google Chrome、而
 * 页面 JS 里的 `navigator.userAgentData.brands` 没有 Google Chrome，构成一对可被页面
 * 直接检出的矛盾），已整体删除，详见 §6.9。
 */

/** 面板共享分区名：主窗口与扩展 View 都不用，可据此判定 WebContents 归属。 */
export const BROWSER_PARTITION = "persist:browser";

/**
 * `window.open` 是否应留在应用内：http(s)，以及 `about:blank`
 * （部分站点先开空白窗、再用 `document.write` / 二次导航填内容）。
 * 其余 scheme 一律拒绝，不交给系统浏览器。
 */
export function isInAppPopupUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || url === "about:blank";
}

/** 开窗请求的落地形态（docs/design/63 §四 P1）。 */
export type PageOpenTarget = "tab" | "window" | "deny";

/** `resolvePageOpenTarget` 的入参：Electron `HandlerDetails` 里参与判定的四个字段。 */
export interface PageOpenSignals {
  url: string;
  disposition: string;
  frameName: string;
  features: string;
}

/**
 * 面板内一次「新窗口意图」该落在哪里（docs/design/63 §二 实测矩阵 → §四 规则表）。
 *
 * 判定顺序即优先级：
 * 1. 非 Web 协议一律拒绝（42 §二 L6，不借这次修复扩大可打开的协议面）。
 * 2. `about:blank` 留子窗：这类弹窗是「先开空窗再 `document.write`」，页面要的是**活句柄**，
 *    转成页签会让 `window.open()` 返回 `null`，站点写句柄当场抛错（63 F6）。
 * 3. `features` 非空留子窗：显式带尺寸才是「弹窗」（OAuth / 支付的标准形态），
 *    实测它与普通链接点击在 `disposition` 与 `features` 两个字段上同时不同（63 §二 结论 1）。
 * 4. `frameName` 非空留子窗：命名 target 的语义是「复用同一个窗反复导航」，子窗自带复用。
 * 5. `new-window` 留子窗：Shift+左键是用户**显式**要开新窗（实测 `features` 仍为空），
 *    顺带保留一条「我就想要浮窗」的手动逃生口。
 * 6. 其余（`foreground-tab` / `background-tab` / `default` / `other`）进**面板页签**：
 *    这是 `<a target=_blank>` 左键与裸 `window.open(httpUrl)` 的共同签名——两者实测逐字段
 *    相同、无法区分（63 §二 结论 2），故一并转页签，代价与缓解见 63 §六。
 *
 * P1 一律前台开；`background-tab` 的「开在后台不抢视图」留 63 §四 P2。
 */
export function resolvePageOpenTarget(signals: PageOpenSignals): PageOpenTarget {
  const { url, disposition, frameName, features } = signals;
  if (!isInAppPopupUrl(url)) return "deny";
  if (url === "about:blank") return "window";
  if (features.trim() !== "") return "window";
  if (frameName.trim() !== "") return "window";
  if (disposition === "new-window") return "window";
  return "tab";
}
