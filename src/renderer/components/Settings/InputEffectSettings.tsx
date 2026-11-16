import { INPUT_EFFECTS, isInputEffect } from "../../../shared/inputEffect";
import { useT } from "../../hooks/useT";
import { useUiStore } from "../../stores/uiStore";
import { InputAura } from "../SessionArea/InputAura";
import auraStyles from "../SessionArea/InputAura.module.css";
import { Segmented } from "../ui/Segmented";
import styles from "./InputEffectSettings.module.css";
import { SettingRow, SettingsSection } from "./SettingRow";

/** 设置预览与实际输入栏共用特效，避免缩略图和选中后的效果不一致。 */
export function InputEffectSettings() {
  const t = useT();
  const { inputEffect, hydrated, dispatch } = useUiStore();
  return (
    <SettingsSection title={t("settings.personalization.inputEffect")}>
      <SettingRow
        stack
        label={t("settings.personalization.inputEffect.style")}
        description={t("settings.personalization.inputEffect.description")}
        control={
          <div className={styles.controls}>
            <Segmented
              semantics="radio"
              ariaLabel={t("settings.personalization.inputEffect")}
              value={inputEffect}
              items={INPUT_EFFECTS.map((effect) => ({
                value: effect,
                label: t(`settings.personalization.inputEffect.option.${effect}`),
                disabled: !hydrated,
              }))}
              onChange={(effect) => {
                if (isInputEffect(effect)) dispatch({ type: "setInputEffect", effect });
              }}
            />
            <div
              className={`${styles.preview} ${inputEffect !== "none" ? auraStyles.surface : ""}`}
              data-effect={inputEffect}
            >
              {inputEffect !== "none" && <InputAura effect={inputEffect} />}
              {/* 原生多行可编辑区用于体验输入能量，不与会话草稿或发送链路相连。 */}
              {/* biome-ignore lint/a11y/useSemanticElements: 与实际输入栏一致，用 contenteditable 预览输入事件 */}
              <div
                className={styles.editor}
                contentEditable="plaintext-only"
                suppressContentEditableWarning
                role="textbox"
                tabIndex={0}
                data-selectable-text
                aria-multiline="true"
                aria-label={t("settings.personalization.inputEffect.preview")}
                data-placeholder={t("settings.personalization.inputEffect.previewHint")}
                spellCheck={false}
              />
              <span className={styles.caption} data-selectable-text>
                {t(`settings.personalization.inputEffect.option.${inputEffect}`)}
              </span>
            </div>
          </div>
        }
      />
    </SettingsSection>
  );
}
