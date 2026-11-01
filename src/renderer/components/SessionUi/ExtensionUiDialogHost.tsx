import { useEffect } from "react";
import { sessionUiService } from "../../services/sessionUiService";
import { useSessionMeta } from "../../stores/sessionStore";
import { sessionUiStore, usePendingUiDialogs } from "../../stores/sessionUiStore";
import { useUiStore } from "../../stores/uiStore";
import { ExtensionUiDialog } from "./ExtensionUiDialog";

/**
 * 扩展对话框宿主（docs/design/123）：挂在 App 根，是 `extension_ui_request`
 * 在渲染层的唯一订阅点。
 *
 * 只渲染 **active 会话** 的对话框（与 modal 栈同一条隔离规则）。后台会话的请求留在
 * 登记表里不撤——主进程那边工具仍挂着，切回该会话即出现，切走也不会丢答案。
 * `notify` 降级成应用内提示条；`setStatus` / `setWidget` / `setTitle` /
 * `set_editor_text` 本轮不转发（发后即忘，不应答不会挂会话）。
 */
export function ExtensionUiDialogHost() {
  const { activeSessionId } = useSessionMeta();
  const { showToast } = useUiStore();
  const pending = usePendingUiDialogs();

  useEffect(
    () =>
      sessionUiService.onOutput((message) => {
        const kind = sessionUiStore.applyPush(message);
        if (kind === "notice" && message.type === "notice") {
          showToast(message.payload.message);
        }
      }),
    [showToast],
  );

  const current = pending.find((item) => item.sessionId === activeSessionId);
  if (!current) return null;
  return <ExtensionUiDialog key={current.id} dialog={current} />;
}
