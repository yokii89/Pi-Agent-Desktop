import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiAgentEvent, SessionPushMessage } from "../../shared/ipc";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationSettings,
  type SystemToastRequest,
} from "../../shared/notification";
import { createSessionNotificationTriggers } from "../utils/sessionNotificationTriggers";

async function harness(patch: Partial<NotificationSettings> = {}) {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-15T00:00:00Z"));
  const showToast = vi.fn(async (_request: SystemToastRequest) => ({ ok: true, data: true }));
  const playAudio = vi.fn(async () => {});
  const hasFocus = vi.fn(() => false);
  vi.stubGlobal("document", { hasFocus });
  vi.stubGlobal("window", { pidesk: { notification: { showToast } } });
  vi.stubGlobal(
    "Audio",
    class {
      preload = "";
      currentTime = 0;
      volume = 1;
      pause() {}
      play = playAudio;
    },
  );
  const { notificationService } = await import("./notificationService");
  const { setI18nLocale } = await import("../../shared/i18n");
  setI18nLocale("en-US");
  notificationService.applySettings({ ...DEFAULT_NOTIFICATION_SETTINGS, ...patch });
  notificationService.setActiveSessionResolver(() => "A");
  notificationService.setToastSessionResolver((sessionId) => ({
    sessionTitle: sessionId,
    sessionFile: `${sessionId}.jsonl`,
  }));
  const handle = createSessionNotificationTriggers({
    sound: (scenario, sessionId, reason) =>
      notificationService.play({ scenario, sessionId, reason, source: "session" }, "sound"),
    toast: (scenario, sessionId, reason) =>
      notificationService.play({ scenario, sessionId, reason, source: "session" }, "toast"),
  });
  const event = (payload: PiAgentEvent, sessionId = "A"): void =>
    handle({ sessionId, type: "event", payload });
  const assistantEnd = (stopReason: string): void =>
    event({ type: "message_end", message: { role: "assistant", content: [], stopReason } });
  const attempt = (stopReason = "stop", willRetry = false): void => {
    event({ type: "agent_start" });
    assistantEnd(stopReason);
    event({ type: "agent_end", willRetry });
  };
  return {
    showToast,
    playAudio,
    hasFocus,
    handle,
    event,
    assistantEnd,
    attempt,
    notificationService,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("会话通知从 RPC 事件到桌面 IPC", () => {
  it("agent_end 只响提示音；紧接着的 settled 发一次 toast，不被声音防抖吞掉", async () => {
    const test = await harness();
    test.attempt();
    expect(test.playAudio).toHaveBeenCalledOnce();
    expect(test.showToast).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    test.event({ type: "agent_settled", aborted: false });
    expect(test.showToast).toHaveBeenCalledExactlyOnceWith({
      title: "PiDesk · A",
      body: "Task completed",
      sessionId: "A",
      sessionFile: "A.jsonl",
    });
    test.event({ type: "agent_settled", aborted: false });
    expect(test.showToast).toHaveBeenCalledOnce();
    expect(test.playAudio).toHaveBeenCalledOnce();
  });

  it.each([false, true])("续跑结束前不弹完成通知（willRetry=%s）", async (willRetry) => {
    const test = await harness();
    test.attempt("stop", willRetry);
    vi.advanceTimersByTime(1000);
    test.attempt("error");
    expect(test.showToast).not.toHaveBeenCalled();
    test.event({ type: "agent_settled", aborted: false });
    expect(test.showToast).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ body: "Failed", sessionId: "A" }),
    );
  });

  it.each(["stop", "error"])(
    "收尾期间中断覆盖先前的 %s 结果，默认不弹完成/失败通知",
    async (reason) => {
      const test = await harness();
      test.attempt(reason);
      test.event({ type: "agent_settled", aborted: true });
      expect(test.showToast).not.toHaveBeenCalled();
    },
  );

  it("开启中断场景后，重试取消只弹已中断", async () => {
    const test = await harness({
      scenarios: {
        ...DEFAULT_NOTIFICATION_SETTINGS.scenarios,
        interrupted: { enabled: true, sound: "4" },
      },
    });
    test.attempt("error", true);
    test.event({ type: "auto_retry_end", success: false, finalError: "Retry cancelled" });
    expect(test.showToast).not.toHaveBeenCalled();
    test.event({ type: "agent_settled", aborted: true });
    expect(test.showToast).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ body: "Interrupted" }),
    );
  });

  it("重试成功使用最后一次结果，stderr 不提前发失败 toast", async () => {
    const test = await harness();
    test.attempt("error", true);
    test.event({ type: "agent_start" });
    test.handle({ sessionId: "A", type: "error", payload: "warning" });
    test.assistantEnd("stop");
    test.event({ type: "agent_end" });
    expect(test.showToast).not.toHaveBeenCalled();
    test.event({ type: "agent_settled", aborted: false });
    expect(test.showToast).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ body: "Task completed" }),
    );
  });

  it("空闲历史事件不发通知，eventBatch 与单事件一致", async () => {
    const test = await harness();
    test.event({ type: "agent_end" });
    test.event({ type: "agent_settled", aborted: false });
    expect(test.showToast).not.toHaveBeenCalled();
    const message: SessionPushMessage = {
      sessionId: "B",
      type: "eventBatch",
      payload: [
        { type: "agent_start" },
        { type: "message_end", message: { role: "assistant", content: [], stopReason: "stop" } },
        { type: "agent_end" },
      ],
    };
    test.handle(message);
    expect(test.showToast).not.toHaveBeenCalled();
    test.handle({ ...message, payload: [{ type: "agent_settled", aborted: false }] });
    expect(test.showToast).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ body: "Task completed", sessionId: "B", sessionFile: "B.jsonl" }),
    );
  });

  it("已发 agent_end 但未 settled 时进程退出，提示需要介入", async () => {
    const test = await harness();
    test.attempt();
    test.handle({ sessionId: "A", type: "exit", payload: 1 });
    expect(test.showToast).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ body: "Needs attention" }),
    );
    test.event({ type: "agent_settled", aborted: false });
    expect(test.showToast).toHaveBeenCalledOnce();
  });

  it.each([false, true])("以 settled 时的焦点决定是否弹窗（初始聚焦=%s）", async (initialFocus) => {
    const test = await harness();
    test.hasFocus.mockReturnValue(initialFocus);
    test.attempt();
    test.hasFocus.mockReturnValue(!initialFocus);
    test.event({ type: "agent_settled", aborted: false });
    expect(test.showToast).toHaveBeenCalledTimes(initialFocus ? 1 : 0);
  });

  it("提示音关闭仍在 settled 后弹桌面通知", async () => {
    const test = await harness({ enabled: false });
    test.attempt();
    expect(test.showToast).not.toHaveBeenCalled();
    test.event({ type: "agent_settled", aborted: false });
    expect(test.showToast).toHaveBeenCalledOnce();
    expect(test.playAudio).not.toHaveBeenCalled();
  });

  it.each<Partial<NotificationSettings>>([
    { systemToast: false },
    {
      scenarios: {
        ...DEFAULT_NOTIFICATION_SETTINGS.scenarios,
        completed: { enabled: false, sound: "1" },
      },
    },
  ])("settled 仍尊重桌面通知和场景开关：%j", async (settings) => {
    const test = await harness(settings);
    test.attempt();
    test.event({ type: "agent_settled", aborted: false });
    expect(test.showToast).not.toHaveBeenCalled();
  });

  it("非会话通知保留即时投递，SDK 推送仍不重复弹窗", async () => {
    const test = await harness();
    test.notificationService.play({
      scenario: "needsAttention",
      sessionId: "A",
      source: "extension",
    });
    expect(test.playAudio).toHaveBeenCalledOnce();
    expect(test.showToast).toHaveBeenCalledOnce();
    test.notificationService.playFromHost({ scenario: "completed", sessionId: "A", source: "sdk" });
    expect(test.playAudio).toHaveBeenCalledTimes(2);
    expect(test.showToast).toHaveBeenCalledOnce();
  });
});
