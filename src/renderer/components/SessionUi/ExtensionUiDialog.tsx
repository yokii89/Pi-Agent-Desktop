import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { useT } from "../../hooks/useT";
import {
  type PendingUiDialog,
  sessionUiStore,
  type UiAnswerPayload,
} from "../../stores/sessionUiStore";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { OptionList, type OptionListHandle, type OptionRow } from "../ui/OptionList";
import styles from "./ExtensionUiDialog.module.css";

/**
 * 扩展对话框（pi `ctx.ui.select / confirm / input / editor`）。
 *
 * 一条请求一个对话框，同一会话多条并发时按到达顺序一次只演一个（pi 的 RPC 对话框
 * 本来就是串行的）。Esc / 点遮罩 = 未答（回 `cancelled:true`），**永不留悬空请求**：
 * 主进程在超时 / 会话退出时也会推 `settled` 把窗撤掉。
 */
export function ExtensionUiDialog({ dialog }: { dialog: PendingUiDialog }) {
  const t = useT();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<OptionListHandle>(null);
  const [text, setText] = useState(dialog.prefill ?? "");

  const answer = (payload: UiAnswerPayload): void => {
    void sessionUiStore.answer(dialog, payload);
  };
  const cancel = (): void => answer({ cancelled: true });

  // 打开即把焦点交给第一个可操作元素：候选首行 / 输入框 / 主按钮。
  // 交给 Modal 只会聚焦到面板本身，键盘用户还得先 Tab 一轮。
  // 只跑挂载一次：宿主按 dialog.id 加了 key，换请求就是重新挂载。
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const target = body.querySelector<HTMLElement>(
      "[data-glide-index], input, textarea, [data-primary]",
    );
    target?.focus();
  }, []);

  const title = dialog.title || t("ui.extensionDialog.ariaLabel");
  const options = dialog.options ?? [];

  const rows: OptionRow[] = options.map((option) => ({
    key: option,
    text: option,
    node: <span className={styles.optionLabel}>{option}</span>,
  }));

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      listRef.current?.moveCursor(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      listRef.current?.moveCursor(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      listRef.current?.toEdge("first");
    } else if (event.key === "End") {
      event.preventDefault();
      listRef.current?.toEdge("last");
    }
  };

  const onFieldKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void => {
    // 单行：Enter 即提交。多行：Enter 是换行，提交走 Ctrl/Cmd+Enter。
    if (event.key !== "Enter") return;
    if (dialog.method === "editor" && !event.ctrlKey && !event.metaKey) return;
    if (dialog.method !== "editor" && event.ctrlKey) return;
    event.preventDefault();
    answer({ value: text });
  };

  return (
    <Modal open onClose={cancel} ariaLabel={title} panelClassName={styles.panel}>
      <div className={styles.body} ref={bodyRef}>
        <h2 className={styles.title}>{title}</h2>
        {dialog.method === "select" ? (
          options.length > 0 ? (
            <OptionList
              ref={listRef}
              rows={rows}
              role="listbox"
              ariaLabel={t("ui.extensionDialog.selectAriaLabel")}
              className={styles.list}
              onKeyDown={onListKeyDown}
              onSelect={(index) => {
                const option = options[index];
                if (option !== undefined) answer({ value: option });
              }}
            />
          ) : (
            <p className={styles.hint}>{t("ui.extensionDialog.noOptions")}</p>
          )
        ) : null}
        {dialog.message ? <p className={styles.message}>{dialog.message}</p> : null}
        {dialog.method === "input" ? (
          <input
            className={styles.field}
            type="text"
            value={text}
            placeholder={dialog.placeholder || t("ui.extensionDialog.inputPlaceholder")}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onFieldKeyDown}
          />
        ) : null}
        {dialog.method === "editor" ? (
          <textarea
            className={[styles.field, styles.textarea].join(" ")}
            rows={6}
            value={text}
            placeholder={dialog.placeholder}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onFieldKeyDown}
          />
        ) : null}
      </div>
      <div className={styles.footer}>
        <Button onClick={cancel}>{t("ui.extensionDialog.cancel")}</Button>
        {dialog.method === "confirm" ? (
          <Button variant="primary" data-primary="true" onClick={() => answer({ confirmed: true })}>
            {t("ui.extensionDialog.confirmYes")}
          </Button>
        ) : null}
        {dialog.method === "input" || dialog.method === "editor" ? (
          <Button variant="primary" data-primary="true" onClick={() => answer({ value: text })}>
            {t("ui.extensionDialog.submit")}
          </Button>
        ) : null}
      </div>
    </Modal>
  );
}
