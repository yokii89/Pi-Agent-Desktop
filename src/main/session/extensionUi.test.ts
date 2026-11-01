/**
 * 扩展 UI 子协议主进程侧的纯逻辑测试（docs/design/123）。
 * 传输用假 sink 注入，不起 Electron、不拉 pi 进程。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionId, SessionUiPush } from "../../shared/ipc";
import { buildResponseRecord, parseUiRequest, SessionUiLedger } from "./extensionUi";

const SESSION: SessionId = "sess_test";

interface FakeSink {
  ledger: SessionUiLedger;
  pushes: SessionUiPush[];
  written: Record<string, unknown>[];
  /** 模拟进程已退出：写回一律失败。 */
  dead(): void;
  /** 模拟窗口已销毁：推送不投递（对话框应当场按未答结算）。 */
  noWindow(): void;
}

function makeSink(): FakeSink {
  let writable = true;
  let deliverable = true;
  const pushes: SessionUiPush[] = [];
  const written: Record<string, unknown>[] = [];
  const ledger = new SessionUiLedger({
    push: (message) => {
      if (!deliverable) return false;
      pushes.push(message);
      return true;
    },
    writeLine: (_sessionId, record) => {
      if (!writable) return false;
      written.push(record);
      return true;
    },
  });
  return {
    ledger,
    pushes,
    written,
    dead: () => {
      writable = false;
    },
    noWindow: () => {
      deliverable = false;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("parseUiRequest（消毒与分类）", () => {
  it("select：保留候选项、裁剪超长字段、封顶 timeout", () => {
    const parsed = parseUiRequest({
      type: "extension_ui_request",
      id: "u1",
      method: "select",
      title: "T".repeat(500),
      options: ["a", "", 7, "b"],
      timeout: 10 ** 9,
    });
    expect(parsed).toEqual({
      kind: "dialog",
      id: "u1",
      request: {
        method: "select",
        title: "T".repeat(200),
        options: ["a", "b"],
        timeoutMs: 3_600_000,
      },
    });
  });

  it("notify → notice；notifyType 非法时按 info", () => {
    expect(
      parseUiRequest({ id: "n1", method: "notify", message: "hi", notifyType: "loud" }),
    ).toEqual({ kind: "notice", id: "n1", notice: { message: "hi", level: "info" } });
  });

  it("已知发后即忘方法归 drop（消费但不应答）", () => {
    for (const method of ["setStatus", "setWidget", "setTitle", "set_editor_text"]) {
      expect(parseUiRequest({ id: "d", method })).toEqual({ kind: "drop" });
    }
  });

  it("不认识的方法带 id 时归 unknown（宁多答不漏答）", () => {
    expect(parseUiRequest({ id: "x", method: "pickFiles" })).toEqual({
      kind: "unknown",
      id: "x",
      method: "pickFiles",
    });
  });

  it("没有 id：对话框方法归 invalid，发后即忘归 drop", () => {
    expect(parseUiRequest({ method: "select", title: "t", options: ["a"] })).toEqual({
      kind: "invalid",
    });
    expect(parseUiRequest({ method: "setWidget", widgetKey: "k" })).toEqual({ kind: "drop" });
  });

  it("非对象输入归 invalid", () => {
    expect(parseUiRequest(null)).toEqual({ kind: "invalid" });
    expect(parseUiRequest("select")).toEqual({ kind: "invalid" });
  });
});

describe("buildResponseRecord", () => {
  it("三种应答形态", () => {
    expect(buildResponseRecord("a", { cancelled: true })).toEqual({
      type: "extension_ui_response",
      id: "a",
      cancelled: true,
    });
    expect(buildResponseRecord("a", { confirmed: false })).toEqual({
      type: "extension_ui_response",
      id: "a",
      confirmed: false,
    });
    expect(buildResponseRecord("a", { value: "opt" })).toEqual({
      type: "extension_ui_response",
      id: "a",
      value: "opt",
    });
  });
});

describe("SessionUiLedger（应答与结算）", () => {
  it("对话框入表并推给渲染层；应答写回一次后即出表", () => {
    const sink = makeSink();
    expect(
      sink.ledger.handleRecord(SESSION, {
        id: "r1",
        method: "select",
        title: "选一个",
        options: ["a", "b"],
      }),
    ).toBe(true);
    expect(sink.pushes).toEqual([
      {
        sessionId: SESSION,
        type: "request",
        id: "r1",
        payload: { method: "select", title: "选一个", options: ["a", "b"] },
      },
    ]);
    expect(sink.ledger.pendingCount(SESSION)).toBe(1);

    expect(sink.ledger.respond(SESSION, "r1", { value: "b" })).toBe(true);
    expect(sink.written).toEqual([{ type: "extension_ui_response", id: "r1", value: "b" }]);
    expect(sink.ledger.pendingCount(SESSION)).toBe(0);
    // 重复应答不再写回
    expect(sink.ledger.respond(SESSION, "r1", { value: "a" })).toBe(false);
    expect(sink.written).toHaveLength(1);
  });

  it("select 应答候选项之外的值：不写回（渲染层报告不是可信输入）", () => {
    const sink = makeSink();
    sink.ledger.handleRecord(SESSION, { id: "r", method: "select", options: ["a"] });
    expect(sink.ledger.respond(SESSION, "r", { value: "zzz" })).toBe(false);
    expect(sink.written).toHaveLength(0);
    expect(sink.ledger.pendingCount(SESSION)).toBe(1);
  });

  it("confirm 只接受布尔；input/editor 接受空串", () => {
    const sink = makeSink();
    sink.ledger.handleRecord(SESSION, { id: "c", method: "confirm", title: "t", message: "m" });
    expect(sink.ledger.respond(SESSION, "c", { value: "yes" })).toBe(false);
    expect(sink.ledger.respond(SESSION, "c", { confirmed: true })).toBe(true);
    sink.ledger.handleRecord(SESSION, { id: "i", method: "input", title: "t" });
    expect(sink.ledger.respond(SESSION, "i", { value: "" })).toBe(true);
  });

  it("cancel 对任何对话框方法都合法", () => {
    const sink = makeSink();
    sink.ledger.handleRecord(SESSION, { id: "s", method: "select", options: ["a"] });
    expect(sink.ledger.respond(SESSION, "s", { cancelled: true })).toBe(true);
    expect(sink.written[0]).toMatchObject({ id: "s", cancelled: true });
  });

  it("带 timeout：到点只撤窗、不写回（pi 已自行结算）", () => {
    vi.useFakeTimers();
    const sink = makeSink();
    sink.ledger.handleRecord(SESSION, { id: "t1", method: "input", title: "t", timeout: 1000 });
    vi.advanceTimersByTime(1000);
    expect(sink.pushes.at(-1)).toEqual({
      sessionId: SESSION,
      type: "settled",
      id: "t1",
      payload: { reason: "timeout" },
    });
    expect(sink.written).toHaveLength(0);
    expect(sink.ledger.pendingCount(SESSION)).toBe(0);
    // 用户随后才作答：请求已不在，不再写回
    expect(sink.ledger.respond(SESSION, "t1", { value: "late" })).toBe(false);
  });

  it("带 timeout 但在到点前作答：定时器清掉，不重复撤窗", () => {
    vi.useFakeTimers();
    const sink = makeSink();
    sink.ledger.handleRecord(SESSION, { id: "t2", method: "input", timeout: 1000 });
    expect(sink.ledger.respond(SESSION, "t2", { value: "ok" })).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(sink.pushes.filter((p) => p.type === "settled")).toHaveLength(1);
  });

  it("dropSession：逐个写回 cancelled 并通知撤窗；进程已死也照通知", () => {
    const sink = makeSink();
    sink.ledger.handleRecord(SESSION, { id: "a", method: "input" });
    sink.ledger.handleRecord(SESSION, { id: "b", method: "confirm" });
    sink.dead();
    sink.ledger.dropSession(SESSION);
    expect(sink.written).toHaveLength(0);
    expect(
      sink.pushes.filter((p) => p.type === "settled").map((p) => (p as { id: string }).id),
    ).toEqual(["a", "b"]);
    expect(sink.ledger.pendingCount(SESSION)).toBe(0);
    // 幂等：再次 drop 不产生新通知
    sink.ledger.dropSession(SESSION);
    expect(sink.pushes.filter((p) => p.type === "settled")).toHaveLength(2);
  });

  it("unknown 方法写回 cancelled，避免会话挂在渲染不出来的请求上", () => {
    const sink = makeSink();
    expect(sink.ledger.handleRecord(SESSION, { id: "u", method: "pickFiles" })).toBe(true);
    expect(sink.written).toEqual([{ type: "extension_ui_response", id: "u", cancelled: true }]);
    expect(sink.pushes).toHaveLength(0);
  });

  it("drop / invalid 不写回也不推送", () => {
    const sink = makeSink();
    expect(sink.ledger.handleRecord(SESSION, { id: "d", method: "setTitle", title: "x" })).toBe(
      true,
    );
    expect(sink.ledger.handleRecord(SESSION, { method: "select", options: ["a"] })).toBe(false);
    expect(sink.written).toHaveLength(0);
    expect(sink.pushes).toHaveLength(0);
  });

  it("同一 id 重发不重复弹窗", () => {
    const sink = makeSink();
    sink.ledger.handleRecord(SESSION, { id: "dup", method: "input" });
    sink.ledger.handleRecord(SESSION, { id: "dup", method: "input" });
    expect(sink.pushes.filter((p) => p.type === "request")).toHaveLength(1);
    expect(sink.ledger.pendingCount(SESSION)).toBe(1);
  });

  it("窗口已销毁（推送投递不出去）：不登记请求，当场按未答写回 cancelled", () => {
    const sink = makeSink();
    sink.noWindow();
    expect(sink.ledger.handleRecord(SESSION, { id: "nw", method: "select", options: ["a"] })).toBe(
      true,
    );
    expect(sink.pushes).toHaveLength(0);
    expect(sink.ledger.pendingCount(SESSION)).toBe(0);
    expect(sink.written).toEqual([{ type: "extension_ui_response", id: "nw", cancelled: true }]);
  });

  it("会话隔离：A 的应答不影响 B 的待答请求", () => {
    const sink = makeSink();
    sink.ledger.handleRecord(SESSION, { id: "same", method: "input" });
    sink.ledger.handleRecord("sess_other", { id: "same", method: "input" });
    expect(sink.ledger.respond(SESSION, "same", { value: "x" })).toBe(true);
    expect(sink.ledger.respond("sess_other", "same", { value: "y" })).toBe(true);
    expect(sink.ledger.pendingCount(SESSION)).toBe(0);
    expect(sink.ledger.pendingCount("sess_other")).toBe(0);
  });
});
