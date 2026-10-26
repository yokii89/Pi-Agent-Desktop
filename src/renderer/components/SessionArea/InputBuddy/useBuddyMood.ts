import { useEffect, useRef, useState } from "react";
import type { PiAgentEvent, SessionId, SessionPushMessage } from "../../../../shared/ipc";
import { sessionService } from "../../../services/sessionService";
import { createSessionRunSignalTracker } from "../../../utils/sessionRunSignals";
import type { BuddyPose } from "./buddyPose";

/** 情绪停留时长：够看清表情，又不至于盖住下一个状态。 */
const MOOD_MS = {
  eating: 1500,
  celebration: 2400,
  dizzy: 2600,
  sad: 2200,
} as const;

export interface BuddyMood {
  pose: BuddyPose;
}

const isUserPrompt = (event: PiAgentEvent): boolean =>
  event.type === "message_start" && event.message.role === "user";

/**
 * 把当前会话的运行信号翻译成伙伴的一次情绪：
 * 投喂（用户刚发出消息）→ 进食、completed → 庆祝、failed/crashed → 头晕、
 * interrupted/truncated → 委屈。
 *
 * 只认当前会话，且订阅的是推送流而不是 entries——伙伴是装饰，
 * 不能因为流式 delta 每个 token 重渲染一次（AGENTS.md「高频文档流」）。
 */
export function useBuddyMood(sessionId: SessionId | null): BuddyMood | null {
  // 情绪带上所属会话：切到别的会话时不用额外 effect 清场，旧情绪直接不成立
  const [mood, setMood] = useState<(BuddyMood & { sessionId: SessionId | null }) | null>(null);
  const timer = useRef<number | null>(null);
  const activeId = useRef(sessionId);
  activeId.current = sessionId;

  useEffect(() => {
    const show = (pose: BuddyPose, ms: number): void => {
      setMood({ pose, sessionId: activeId.current });
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setMood(null);
      }, ms);
    };

    const trackRun = createSessionRunSignalTracker((id, signal) => {
      if (id !== activeId.current) return;
      switch (signal.kind) {
        case "started":
          return;
        case "completed":
          show("celebration", MOOD_MS.celebration);
          return;
        case "failed":
        case "crashed":
          show("dizzy", MOOD_MS.dizzy);
          return;
        case "interrupted":
        case "truncated":
          show("sad", MOOD_MS.sad);
          return;
      }
    });

    const unsubscribe = sessionService.subscribe((message: SessionPushMessage) => {
      if (message.sessionId !== activeId.current) return;
      const fed =
        message.type === "event"
          ? isUserPrompt(message.payload)
          : message.type === "eventBatch" && message.payload.some(isUserPrompt);
      if (fed) show("eating", MOOD_MS.eating);
      trackRun(message);
    });

    return () => {
      unsubscribe();
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, []);

  return mood && mood.sessionId === sessionId ? mood : null;
}
