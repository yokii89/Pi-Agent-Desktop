import { Plus } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useT } from "../../../../../hooks/useT";
import { resolvePropertyMeta, searchCatalog } from "./propertyCatalog";
import styles from "./styleEdit.module.css";

/**
 * 添加属性（UI 重设计）：幽灵声明行 `name: value`，聚焦即实线，Enter 提交。
 * 目录建议浮层挂在卡片内，未命中目录按文本写入。
 */

/** propertyCatalog 的 group 是 UI 分类标签；按原中文映射到文案 key。 */
const GROUP_LABEL_KEYS: Record<string, string> = {
  盒模型: "browser.styles.group.boxModel",
  边框: "browser.styles.group.border",
  布局: "browser.styles.group.layout",
  Flex: "browser.styles.group.flex",
  排版: "browser.styles.group.typography",
  视觉: "browser.styles.group.visual",
  定位: "browser.styles.group.position",
  其他: "browser.styles.group.other",
};

export interface AddPropertyFormProps {
  existingNames: string[];
  compact?: boolean;
  onAdd: (name: string, value: string) => void;
}

export function AddPropertyForm({ existingNames, compact, onAdd }: AddPropertyFormProps) {
  const t = useT();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const existing = useMemo(
    () =>
      new Set(
        existingNames.map((n) => (n.trim().startsWith("--") ? n.trim() : n.trim().toLowerCase())),
      ),
    [existingNames],
  );
  const suggestions = useMemo(() => searchCatalog(name, 10), [name]);
  const kindHint = resolvePropertyMeta(name).kind;

  const submit = (): void => {
    const trimmedName = name.trim();
    const trimmedValue = value.trim();
    if (!trimmedName || !trimmedValue) return;
    if (/[{};]/.test(trimmedName) || /[{};]/.test(trimmedValue)) return;
    onAdd(trimmedName, trimmedValue);
    setName("");
    setValue("");
    setOpen(false);
  };

  return (
    <div className={styles.addForm}>
      <div className={styles.addGhost}>
        <input
          className={styles.addName}
          value={name}
          placeholder={t("browser.styles.addPlaceholder.name")}
          spellCheck={false}
          onChange={(event) => {
            setName(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
            if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        <span className={styles.addColon}>:</span>
        <input
          className={styles.addValue}
          value={value}
          placeholder={t("browser.styles.addPlaceholder.value")}
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button
          type="button"
          className={styles.addSubmit}
          title={t("browser.styles.addSubmit")}
          disabled={!name.trim() || !value.trim()}
          onClick={submit}
        >
          <Plus size={14} weight="regular" />
        </button>
      </div>
      {open && suggestions.length > 0 && !compact && (
        <ul className={styles.suggestList}>
          {suggestions.map((meta) => {
            const key = meta.name.startsWith("--") ? meta.name : meta.name.toLowerCase();
            const taken = existing.has(key);
            return (
              <li key={meta.name}>
                <button
                  type="button"
                  className={styles.suggestItem}
                  disabled={taken}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setName(meta.name);
                    setOpen(false);
                  }}
                >
                  <span className={styles.suggestName}>{meta.name}</span>
                  <span className={styles.suggestMeta}>
                    {GROUP_LABEL_KEYS[meta.group] ? t(GROUP_LABEL_KEYS[meta.group]) : meta.group}
                    {taken ? ` · ${t("browser.styles.added")}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className={styles.addHint}>
        {name.trim() && kindHint === "text"
          ? t("browser.styles.addHint.text")
          : t("browser.styles.addHint.default")}
      </p>
    </div>
  );
}
