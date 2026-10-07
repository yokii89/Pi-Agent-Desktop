/**
 * 「盒模型」tab：四区示意 + 每边数值（docs/design/06 §3.2）。
 * 观感对齐 DevTools 盒模型图：同心色带 + 边上数值 + 底部图例明细。
 */

import type { ReactNode } from "react";
import { useT } from "../../../../hooks/useT";
import { useInspectorStore } from "../../../../stores/inspectorStore";
import styles from "./BoxModelTab.module.css";

type Sides = [number, number, number, number];

/** 一圈的四个数值：上 / 右 / 下 / 左。 */
function Band({
  className,
  values,
  children,
}: {
  className: string;
  values: Sides;
  children: ReactNode;
}) {
  const [top, right, bottom, left] = values;
  return (
    <div className={[styles.band, className].join(" ")}>
      <span className={styles.edgeTop}>{top}</span>
      <span className={styles.edgeRight}>{right}</span>
      <span className={styles.edgeBottom}>{bottom}</span>
      <span className={styles.edgeLeft}>{left}</span>
      {children}
    </div>
  );
}

const SIDE_KEYS = ["top", "right", "bottom", "left"] as const;

function SidesText({ values }: { values: Sides }) {
  return (
    <span className={styles.sides}>
      {values.map((n, i) => (
        <span key={SIDE_KEYS[i]} className={styles.sideChip}>
          {n}
        </span>
      ))}
    </span>
  );
}

export function BoxModelTab({ compact }: { compact: boolean }) {
  const t = useT();
  const { boxModel, loading, stale } = useInspectorStore();

  if (loading && !boxModel) return <p className={styles.empty}>{t("browser.box.loading")}</p>;
  if (!boxModel) {
    return (
      <p className={styles.empty}>
        {stale ? t("browser.box.stale") : t("browser.box.noSelection")}
      </p>
    );
  }

  const TONE_CLASS: Record<string, string> = {
    margin: styles.swatchMargin,
    border: styles.swatchBorder,
    padding: styles.swatchPadding,
    content: styles.swatchContent,
  };

  const rows: Array<{
    key: string;
    label: string;
    tone: "margin" | "border" | "padding" | "content";
    value: ReactNode;
  }> = [
    {
      key: "margin",
      label: "margin",
      tone: "margin",
      value: <SidesText values={boxModel.margin} />,
    },
    {
      key: "border",
      label: "border",
      tone: "border",
      value: <SidesText values={boxModel.border} />,
    },
    {
      key: "padding",
      label: "padding",
      tone: "padding",
      value: <SidesText values={boxModel.padding} />,
    },
    {
      key: "content",
      label: t("browser.box.content"),
      tone: "content",
      value: (
        <span className={styles.contentValue}>
          {boxModel.content.width}
          <span className={styles.times}>×</span>
          {boxModel.content.height}
        </span>
      ),
    },
  ];

  return (
    <div className={compact ? `${styles.root} ${styles.rootCompact}` : styles.root}>
      <div className={styles.diagram}>
        <Band className={styles.margin} values={boxModel.margin}>
          <Band className={styles.border} values={boxModel.border}>
            <Band className={styles.padding} values={boxModel.padding}>
              <span className={styles.content}>
                {boxModel.content.width}×{boxModel.content.height}
              </span>
            </Band>
          </Band>
        </Band>
      </div>

      <ul className={styles.legend}>
        {rows.map((row) => (
          <li key={row.key} className={styles.legendRow}>
            <span className={`${styles.swatch} ${TONE_CLASS[row.tone]}`} aria-hidden="true" />
            <span className={styles.legendLabel}>{row.label}</span>
            <span className={styles.legendValue}>{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
