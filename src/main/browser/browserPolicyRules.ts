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
