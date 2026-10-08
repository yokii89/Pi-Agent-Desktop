import { useEffect, useRef } from "react";
import { eventToCombo } from "../../shared/shortcuts";
import { findActionByCombo } from "../actions/actionRegistry";
import { useActionContext } from "../actions/useActionContext";

/** 焦点是否在可编辑控件（输入框 / textarea / contenteditable）。 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

/**
 * 渲染层全局快捷键：按动作注册表匹配当前键位映射（设置 → 键盘快捷键）。
 * 动作未标 allowInEditable 时，焦点在输入框 / contenteditable 让位（避免抢输入）；
 * 命令面板开关例外（面板开着时焦点在面板输入框，同键再按 = 关闭，VS Code 语义）。
 * IME 组合期（isComposing）的按键是候选操作，不触发动作。
 */
export function useGlobalShortcuts(): void {
  const ctx = useActionContext();
  // 监听器只注册一次，事件时读最新上下文（latest-ref），键位改动即时生效
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat || event.isComposing) return;
      const combo = eventToCombo(event);
      if (!combo) return;
      const action = findActionByCombo(ctxRef.current.shortcuts, combo);
      if (!action) return;
      if (!action.allowInEditable && isEditableTarget(event.target)) return;
      event.preventDefault();
      action.run(ctxRef.current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
