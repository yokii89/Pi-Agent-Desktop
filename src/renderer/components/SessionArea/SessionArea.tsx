import { useRef } from "react";
import { useInputClearance } from "../../hooks/useInputClearance";
import { useSessionMeta } from "../../stores/sessionStore";
import { WidgetMountAbove, WidgetMountBelow } from "../ExtensionView/ExtensionViewHost";
import { BackgroundProcsCard } from "./BackgroundProcs/BackgroundProcsCard";
import styles from "./SessionArea.module.css";
import { SessionView } from "./SessionView";
import { TaskInput } from "./TaskInput";
import { WelcomeSplash } from "./WelcomeSplash";

/**
 * ③ 中央会话区：empty 显示欢迎语 + 悬浮输入框（含工作区/Git 顶栏）；
 * running/idle 显示自研会话视图，输入框底部停靠。
 * 会话标题/目录/分支在 TitleBar 中间槽的 SessionHeader（docs/用户对话栏/7.1）。
 * 扩展 View 的 widget 槽挂在输入框上/下（docs/design/08 §5.3）。
 */
export function SessionArea() {
  const { phase } = useSessionMeta();
  const isEmpty = phase === "empty";
  const runningRef = useRef<HTMLDivElement>(null);
  const inputStackRef = useRef<HTMLDivElement>(null);
  useInputClearance(runningRef, inputStackRef, !isEmpty);

  return (
    <section className={styles.area}>
      {isEmpty ? (
        <div className={styles.splash}>
          <WelcomeSplash />
          <div className={styles.inputStack}>
            <WidgetMountAbove />
            <TaskInput variant="empty" />
            <WidgetMountBelow />
          </div>
        </div>
      ) : (
        <div className={styles.running} ref={runningRef}>
          <BackgroundProcsCard />
          <SessionView />
          <div className={styles.dockedInput}>
            <div className={styles.inputStack} ref={inputStackRef}>
              <WidgetMountAbove />
              <TaskInput variant="session" />
              <WidgetMountBelow />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
