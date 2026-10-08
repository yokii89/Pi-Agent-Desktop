import { describe, expect, it } from "vitest";
import { BROWSER_PARTITION, isInAppPopupUrl } from "./browserPolicyRules";

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

// 注意：本文件曾包含 `normalizeBrowserUserAgent` / `buildBrowserClientHintHeaders` /
// `isBlockedSigninHost` 三组用例，随「面板不做 UA / UA-CH 伪装」的修复一起删除
// （动机与实测见 docs/design/42 §6.9）。
