import { type Ref, useEffect, useImperativeHandle, useState } from "react";
import type { InputBuddyKind } from "../../../../shared/inputBuddy";
import type { SessionId } from "../../../../shared/ipc";
import { useT } from "../../../hooks/useT";
import { BuddyCapy } from "./BuddyCapy";
import { BuddyCat } from "./BuddyCat";
import { BuddyDog } from "./BuddyDog";
import { BuddyParrot } from "./BuddyParrot";
import type { BuddyPose } from "./buddyPose";
import styles from "./InputBuddy.module.css";
import { useBuddyMood } from "./useBuddyMood";

/** 点击彩蛋 / 误触提示：随机姿态展示时长，结束后回到当前会话状态对应的姿态。 */
const POKE_MS = 1800;
/** 闲置多久没人理就委屈巴巴。够长，不会在读完一段回答时突然变脸。 */
const LONELY_MS = 240_000;
/** 点击可抽到的姿态；idle 是默认态，抽到等于没反应，故不参与。 */
const POKE_POSES: readonly BuddyPose[] = [
  "happy",
  "tilt",
  "wave",
  "sleep",
  "alert",
  "thinking",
  "angry",
  "eating",
  "sad",
  "celebration",
  "dizzy",
];

export interface InputBuddyHandle {
  /** 一次性情绪（误触发送、点到被禁用的按钮）：不改业务状态，到点自动收回。 */
  nudge: (pose: BuddyPose) => void;
}

interface InputBuddyProps {
  kind: InputBuddyKind;
  /** 会话正在生成时思考。 */
  running: boolean;
  /** 切换会话 / 切换访问模式时歪头等待。 */
  switching: boolean;
  /** 需要用户注意（阻断浮层、待确认）时警觉竖耳。 */
  alert: boolean;
  /** 当前会话运行时 id：伙伴只对当前会话的收口做表情。 */
  sessionId: SessionId | null;
  ref?: Ref<InputBuddyHandle>;
}

/**
 * 输入栏右上角的动物伙伴：装饰 + 点击彩蛋。
 * 常态姿态跟随会话状态（生成中思考、收口时庆祝/头晕/委屈、投喂时进食）；
 * 点一下随机换个表情，误触发送时生气一下，都不写回任何业务 store。
 */
export function InputBuddy({ kind, running, switching, alert, sessionId, ref }: InputBuddyProps) {
  const t = useT();
  const [poke, setPoke] = useState<BuddyPose | null>(null);
  const [lonely, setLonely] = useState(false);
  const mood = useBuddyMood(sessionId);

  useImperativeHandle(ref, () => ({ nudge: (pose) => setPoke(pose) }), []);

  // 点击 / 误触抽到的姿态到点自动收回；每次触发换新值，effect 重跑即重置计时
  useEffect(() => {
    if (!poke) return;
    const timer = window.setTimeout(() => setPoke(null), POKE_MS);
    return () => window.clearTimeout(timer);
  }, [poke]);

  // 闲置超时：一段时间没有任何输入就委屈巴巴，一动就恢复；生成中不算闲置
  useEffect(() => {
    if (running) {
      setLonely(false);
      return;
    }
    let timer = window.setTimeout(() => setLonely(true), LONELY_MS);
    const wake = (): void => {
      setLonely(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setLonely(true), LONELY_MS);
    };
    window.addEventListener("pointerdown", wake, { passive: true });
    window.addEventListener("keydown", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [running]);

  if (kind === "none") return null;

  // 优先级：需要用户注意 > 一次性情绪 > 切换等待 > 生成中 > 闲到发慌 > 常态
  const basePose: BuddyPose = alert
    ? "alert"
    : mood
      ? mood.pose
      : switching
        ? "tilt"
        : running
          ? "thinking"
          : lonely
            ? "sad"
            : "idle";
  const pose = poke ?? basePose;

  /** 随机抽一个与当前不同的姿态，避免点下去看不出变化。 */
  const pokeBuddy = (): void => {
    const pool = POKE_POSES.filter((candidate) => candidate !== pose);
    const next = pool[Math.floor(Math.random() * pool.length)] ?? "happy";
    setPoke(next);
  };

  return (
    <button
      type="button"
      className={styles.buddy}
      title={t("session.input.buddy.greet")}
      aria-label={t("session.input.buddy.greet")}
      // 按下不把焦点从输入框抢走：点完还能接着打字
      onMouseDown={(event) => event.preventDefault()}
      onClick={pokeBuddy}
    >
      {kind === "dog" && <BuddyDog pose={pose} />}
      {kind === "cat" && <BuddyCat pose={pose} />}
      {kind === "parrot" && <BuddyParrot pose={pose} />}
      {kind === "capy" && <BuddyCapy pose={pose} />}
    </button>
  );
}
