import { describe, expect, it } from "vitest";
import {
  BROWSER_PARTITION,
  isInAppPopupUrl,
  type PageOpenSignals,
  resolvePageOpenTarget,
} from "./browserPolicyRules";

describe("BROWSER_PARTITION", () => {
  it("is the dedicated persistent partition of the panel", () => {
    expect(BROWSER_PARTITION).toBe("persist:browser");
  });
});

describe("isInAppPopupUrl", () => {
  it("keeps http(s) and about:blank inside the app", () => {
    expect(isInAppPopupUrl("https://accounts.google.com/o/oauth2/auth")).toBe(true);
    expect(isInAppPopupUrl("http://localhost:3000/callback")).toBe(true);
    expect(isInAppPopupUrl("HTTPS://EXAMPLE.COM/x")).toBe(true);
    expect(isInAppPopupUrl("about:blank")).toBe(true);
  });

  it("rejects non-web schemes", () => {
    expect(isInAppPopupUrl("mailto:a@b.c")).toBe(false);
    expect(isInAppPopupUrl("file:///C:/secret.html")).toBe(false);
    expect(isInAppPopupUrl("devtools://devtools/bundled/x.html")).toBe(false);
    expect(isInAppPopupUrl("")).toBe(false);
  });
});

// 用例名对应 docs/design/63 §二 的实测矩阵（Electron 41.0.3 + CDP 受信任点击，
// 探针 `temp/browser-link-probe/`）：字段值就是 Electron 当时递给策略层的原文。
const PAGE = "https://example.com/page";

function signals(over: Partial<PageOpenSignals> = {}): PageOpenSignals {
  return { url: PAGE, disposition: "foreground-tab", frameName: "", features: "", ...over };
}

describe("resolvePageOpenTarget", () => {
  it("拒绝非 Web 协议（矩阵里没有一条被放宽）", () => {
    expect(resolvePageOpenTarget(signals({ url: "mailto:a@b.c" }))).toBe("deny");
    expect(resolvePageOpenTarget(signals({ url: "file:///C:/secret.html" }))).toBe("deny");
    expect(resolvePageOpenTarget(signals({ url: "javascript:alert(1)" }))).toBe("deny");
  });

  it("D5：about:blank 要活句柄，留子窗", () => {
    expect(resolvePageOpenTarget(signals({ url: "about:blank" }))).toBe("window");
  });

  it("D2/D4：带 features 的显式弹窗（OAuth 标准形态）留子窗", () => {
    expect(
      resolvePageOpenTarget(
        signals({ disposition: "new-window", features: "width=420,height=520,left=40,top=40" }),
      ),
    ).toBe("window");
    // 尺寸之外只给了 popup 标记，同样算显式弹窗
    expect(resolvePageOpenTarget(signals({ disposition: "new-window", features: "popup" }))).toBe(
      "window",
    );
  });

  it("C1/C2/C3：命名 target 指望复用同一窗，留子窗", () => {
    expect(resolvePageOpenTarget(signals({ frameName: "myspace" }))).toBe("window");
    expect(resolvePageOpenTarget(signals({ frameName: "win2" }))).toBe("window");
  });

  it("B4：Shift+左键是用户显式要开新窗（features 仍为空），留子窗", () => {
    expect(resolvePageOpenTarget(signals({ disposition: "new-window" }))).toBe("window");
  });

  it("B1/B2/B6/B7 与 D1/D3/D6、E1/E3：链接点击与裸 window.open 同签名，一起进面板页签", () => {
    expect(resolvePageOpenTarget(signals())).toBe("tab");
    expect(resolvePageOpenTarget(signals({ url: "http://localhost:3000/x" }))).toBe("tab");
  });

  it("B3/B5：Ctrl+左键与中键（background-tab）P1 也开页签，不抢语义", () => {
    expect(resolvePageOpenTarget(signals({ disposition: "background-tab" }))).toBe("tab");
  });

  it("未归类的 disposition 保守进页签，不再甩浮窗", () => {
    expect(resolvePageOpenTarget(signals({ disposition: "other" }))).toBe("tab");
    expect(resolvePageOpenTarget(signals({ disposition: "default" }))).toBe("tab");
  });

  it("features / frameName 只有空白字符时不算「显式弹窗 / 命名窗」", () => {
    expect(resolvePageOpenTarget(signals({ features: "  " }))).toBe("tab");
    expect(resolvePageOpenTarget(signals({ frameName: " " }))).toBe("tab");
  });
});

// 注意：本文件曾包含 `normalizeBrowserUserAgent` / `buildBrowserClientHintHeaders` /
// `isBlockedSigninHost` 三组用例，随「面板不做 UA / UA-CH 伪装」的修复一起删除
// （动机与实测见 docs/design/42 §6.9）。
