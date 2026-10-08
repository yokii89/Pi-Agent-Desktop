import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useState } from "react";
import { findConflict, parseEventCombo, type ShortcutBinding } from "../../../shared/shortcuts";
import {
  ACTION_REGISTRY,
  type ActionDescriptor,
  type ActionSection,
  type BindableActionId,
} from "../../actions/actionRegistry";
import { useT } from "../../hooks/useT";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../ui/Button";
import { SettingRow, SettingsSection } from "./SettingRow";
import styles from "./Settings.module.css";

/** 键位面板的分组渲染顺序（动作多于section时按此排序展示）。 */
const SECTION_ORDER: ActionSection[] = ["navigation", "panels", "session", "review"];

const SECTION_TITLE_KEYS: Record<ActionSection, string> = {
  navigation: "settings.shortcuts.group.navigation",
  panels: "settings.shortcuts.group.panels",
  session: "settings.shortcuts.group.session",
  review: "settings.shortcuts.group.review",
};

/** 可绑定动作（defaultCombo 非 null 的注册表条目），按分组排序供面板渲染。 */
const BINDABLE = SECTION_ORDER.flatMap((section) =>
  ACTION_REGISTRY.filter(
    (action): action is ActionDescriptor & { id: BindableActionId } =>
      action.defaultCombo !== null && action.section === section,
  ),
);

/**
 * 键盘快捷键：清单来自动作注册表（与命令面板同源）。点击键位胶囊进入录入，
 * 原地捕获下一组合并立即持久化；冲突 / 保留组合 / 缺修饰键 toast 并继续等待；
 * Esc 取消；区尾一键恢复默认。
 */
export function ShortcutsPanel() {
  const t = useT();
  const { shortcuts, hydrated, dispatch, showToast } = useUiStore();
  const [capturing, setCapturing] = useState<BindableActionId | null>(null);

  const onChipKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    id: BindableActionId,
  ): void => {
    if (capturing !== id) return;
    // 冒泡阶段拦下：useGlobalShortcuts / Modal Esc 在录入期间不响应
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      setCapturing(null);
      return;
    }

    const parsed = parseEventCombo(event);
    if (parsed.type === "modifier") return;
    if (parsed.type === "invalid") {
      showToast(t("settings.shortcuts.needModifier"));
      return;
    }
    if (parsed.type === "reserved") {
      showToast(t("settings.shortcuts.reserved", { combo: parsed.combo }));
      return;
    }

    const bindings: ShortcutBinding[] = ACTION_REGISTRY.map((action) => ({
      id: action.id,
      defaultCombo: action.defaultCombo,
    }));
    const conflict = findConflict(bindings, shortcuts, parsed.combo, id);
    if (conflict) {
      const conflictAction = ACTION_REGISTRY.find((action) => action.id === conflict);
      showToast(
        t("settings.shortcuts.conflict", {
          combo: parsed.combo,
          action: conflictAction ? t(conflictAction.labelKey) : conflict,
        }),
      );
      return;
    }

    dispatch({ type: "setShortcut", id, combo: parsed.combo });
    setCapturing(null);
  };

  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>{t("settings.section.shortcuts")}</h2>
      <p className={styles.panelHint}>{t("settings.shortcuts.hint")}</p>
      {SECTION_ORDER.map((section) => {
        const items = BINDABLE.filter((action) => action.section === section);
        if (items.length === 0) return null;
        return (
          <SettingsSection key={section} title={t(SECTION_TITLE_KEYS[section])}>
            {items.map((action) => {
              const isCapturing = capturing === action.id;
              return (
                <SettingRow
                  key={action.id}
                  label={t(action.labelKey)}
                  description={action.descKey ? t(action.descKey) : undefined}
                  control={
                    <button
                      type="button"
                      className={[styles.keyChip, isCapturing ? styles.keyChipActive : ""]
                        .join(" ")
                        .trim()}
                      disabled={!hydrated}
                      aria-label={t("settings.shortcuts.rebind", {
                        action: t(action.labelKey),
                      })}
                      onClick={() => setCapturing(isCapturing ? null : action.id)}
                      onKeyDown={(e) => onChipKeyDown(e, action.id)}
                      onBlur={() => {
                        if (capturing === action.id) setCapturing(null);
                      }}
                    >
                      {isCapturing ? t("settings.shortcuts.listening") : shortcuts[action.id]}
                    </button>
                  }
                />
              );
            })}
          </SettingsSection>
        );
      })}
      <SettingsSection title={t("settings.shortcuts.group.manage")}>
        <SettingRow
          label={t("settings.shortcuts.reset")}
          description={t("settings.shortcuts.reset.description")}
          control={
            <Button
              disabled={!hydrated}
              onClick={() => {
                setCapturing(null);
                dispatch({ type: "resetShortcuts" });
              }}
            >
              {t("settings.shortcuts.reset.button")}
            </Button>
          }
        />
      </SettingsSection>
    </div>
  );
}
