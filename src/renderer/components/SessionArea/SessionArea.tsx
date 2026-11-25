import { useCallback, useRef, useState } from "react";
import { useInputClearance } from "../../hooks/useInputClearance";
import { useT } from "../../hooks/useT";
import { composerDraftKey } from "../../stores/composerDrafts";
import { useProjectStore } from "../../stores/projectStore";
import { useSessionMeta } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { WidgetMountAbove, WidgetMountBelow } from "../ExtensionView/ExtensionViewHost";
import { QueueTray } from "./QueueTray";
import styles from "./SessionArea.module.css";
import { SessionView } from "./SessionView";
import { TaskInput } from "./TaskInput";
import { WelcomeSplash } from "./WelcomeSplash";

/**
 * ③ 中央会话区：empty 显示欢迎语 + 悬浮输入框（含工作区/Git 顶栏）；
 * running/idle 显示自研会话视图，输入框底部停靠。
 * 会话标题/目录/分支在 TitleBar 中间槽的 SessionHeader（docs/用户对话栏/7.1）。
 * 扩展 View 的 widget 槽挂在输入框上/下（docs/design/08 §5.3）。
 * 终端面板展开时输入区贴住面板边框（.inputFlush），收起时留一档窗口底距。
 */
export function SessionArea() {
  const { phase, activeSessionId, activeSessionFile } = useSessionMeta();
  const t = useT();
  const readOnly =
    !!activeSessionFile &&
    !activeSessionFile.startsWith("durable:") &&
    !activeSessionFile.startsWith("pending:");
  const { currentProject } = useProjectStore();
  const draftKey = composerDraftKey(activeSessionId, currentProject?.dir ?? null, phase);
  const [workspaceFocusSeq, setWorkspaceFocusSeq] = useState(0);
  const requestWorkspaceFocus = useCallback(() => setWorkspaceFocusSeq((seq) => seq + 1), []);
  const { terminalPanelVisible } = useUiStore();
  const isEmpty = phase === "empty";
  const runningRef = useRef<HTMLDivElement>(null);
  const inputStackRef = useRef<HTMLDivElement>(null);
  useInputClearance(runningRef, inputStackRef, !isEmpty);

  return (
    <section
      className={[styles.area, terminalPanelVisible ? styles.inputFlush : ""]
        .filter(Boolean)
        .join(" ")}
    >
      {isEmpty ? (
        <div className={styles.splash}>
          <WelcomeSplash />
          <div className={styles.inputStack}>
            <WidgetMountAbove />
            <TaskInput
              key={draftKey}
              draftKey={draftKey}
              variant="empty"
              workspaceFocusSeq={workspaceFocusSeq}
              onWorkspaceSelected={requestWorkspaceFocus}
            />
            <WidgetMountBelow />
          </div>
        </div>
      ) : (
        <div className={styles.running} ref={runningRef}>
          <SessionView />
          <div className={styles.dockedInput} data-panel-geo="monitor-input">
            <div className={styles.inputStack} ref={inputStackRef}>
              {readOnly ? (
                <p className={styles.readOnly} data-selectable-text="">
                  {t("session.legacy.readOnly")}
                </p>
              ) : (
                <>
                  <WidgetMountAbove />
                  <QueueTray />
                  <TaskInput
                    key={draftKey}
                    draftKey={draftKey}
                    variant="session"
                    workspaceFocusSeq={workspaceFocusSeq}
                    onWorkspaceSelected={requestWorkspaceFocus}
                  />
                  <WidgetMountBelow />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
