import { useEffect, useRef, useState } from "react";
import type { InputBuddyKind } from "../../../../shared/inputBuddy";
import { useT } from "../../../hooks/useT";
import { BuddyCapy } from "./BuddyCapy";
import { BuddyCat } from "./BuddyCat";
import { BuddyDog } from "./BuddyDog";
import { BuddyParrot } from "./BuddyParrot";
import type { BuddyPose } from "./buddyPose";
import styles from "./InputBuddy.module.css";

/** 发送后短暂「开心」的时长；之后落回运行中的招手姿态。 */
const CHEER_MS = 1200;
/** 点击彩蛋：随机姿态展示时长，结束后回到当前会话状态对应的姿态。 */
const POKE_MS = 1800;
/** 点击可抽到的姿态；idle 是默认态，抽到等于没反应，故不参与。 */
const POKE_POSES: readonly BuddyPose[] = ["happy", "tilt", "wave", "sleep", "alert"];

interface InputBuddyProps {
  kind: InputBuddyKind;
  /** 会话正在生成时招手；刚开始生成的一小段先开心一下。 */
  running: boolean;
  /** 切换会话 / 切换访问模式时歪头等待。 */
  switching: boolean;
  /** 需要用户注意（阻断浮层、待确认）时警觉竖耳。 */
  alert: boolean;
}

/**
 * 输入栏右上角的动物伙伴：装饰 + 点击彩蛋。
 * 常态姿态只跟随会话状态；点一下随机换个表情，短暂展示后回到常态，不写回任何业务 store。
 */
export function InputBuddy({ kind, running, switching, alert }: InputBuddyProps) {
  const t = useT();
  const [cheering, setCheering] = useState(false);
  const [poke, setPoke] = useState<BuddyPose | null>(null);
  const wasRunning = useRef(false);

  useEffect(() => {
    if (!running) {
      wasRunning.current = false;
      setCheering(false);
      return;
    }
    if (wasRunning.current) return;
    wasRunning.current = true;
    setCheering(true);
    const timer = window.setTimeout(() => setCheering(false), CHEER_MS);
    return () => window.clearTimeout(timer);
  }, [running]);

  // 点击抽到的姿态到点自动收回；每次点击换新值，effect 重跑即重置计时
  useEffect(() => {
    if (!poke) return;
    const timer = window.setTimeout(() => setPoke(null), POKE_MS);
    return () => window.clearTimeout(timer);
  }, [poke]);

  if (kind === "none") return null;

  const basePose: BuddyPose = alert
    ? "alert"
    : switching
      ? "tilt"
      : running
        ? cheering
          ? "happy"
          : "wave"
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
