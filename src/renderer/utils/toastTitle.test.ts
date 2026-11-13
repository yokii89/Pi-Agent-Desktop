import { describe, expect, it } from "vitest";
import { toastSessionTitle } from "./toastTitle";

describe("toastSessionTitle", () => {
  it("最新用户消息优先于 pi 的会话名", () => {
    expect(
      toastSessionTitle({
        lastUserText: "把登录页的错误提示改一下",
        sessionName: "登录页重构",
        firstUserMessage: "帮忙看看登录页",
      }),
    ).toBe("把登录页的错误提示改一下");
  });

  it("没有最新消息时退回会话名，再退回首条消息", () => {
    expect(toastSessionTitle({ lastUserText: null, sessionName: "登录页重构" })).toBe("登录页重构");
    expect(
      toastSessionTitle({ lastUserText: "  ", sessionName: "  ", firstUserMessage: "首条" }),
    ).toBe("首条");
  });

  it("全部为空时返回 undefined（toast 只用应用名）", () => {
    expect(toastSessionTitle({})).toBeUndefined();
    expect(toastSessionTitle({ lastUserText: "\n  ", sessionName: null })).toBeUndefined();
  });

  it("把换行与连续空白压成单行", () => {
    expect(toastSessionTitle({ lastUserText: "第一条\n\n  继续 干活 " })).toBe("第一条 继续 干活");
  });
});
