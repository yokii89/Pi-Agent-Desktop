import type { ReactNode } from "react";
import { useT } from "../../../../hooks/useT";
import { useInspectorStore } from "../../../../stores/inspectorStore";
import styles from "./BoxModelTab.module.css";

type Sides = [number, number, number, number];
type Layer = "margin" | "border" | "padding";

const SIDE_KEYS = ["top", "right", "bottom", "left"] as const;
const LAYERS: Layer[] = ["margin", "border", "padding"];

/** Keep fractional geometry readable without changing the underlying measurements. */
function formatSize(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function Band({ layer, values, children }: { layer: Layer; values: Sides; children: ReactNode }) {
  return (
    <div className={`${styles.band} ${styles[layer]}`}>
      <span className={styles.bandLabel}>{layer}</span>
      {values.map((value, index) => (
        <span
          key={SIDE_KEYS[index]}
          className={styles[SIDE_KEYS[index]]}
          title={`${layer}-${SIDE_KEYS[index]}: ${value}px`}
        >
          {formatSize(value)}
        </span>
      ))}
      <div className={styles.inner}>{children}</div>
    </div>
  );
}

/** Box geometry shares one set of layer colors between the diagram and the side table. */
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

  return (
    <div
      className={compact ? `${styles.root} ${styles.rootCompact}` : styles.root}
      data-selectable-text
    >
      <div className={styles.diagram}>
        <Band layer="margin" values={boxModel.margin}>
          <Band layer="border" values={boxModel.border}>
            <Band layer="padding" values={boxModel.padding}>
              <div className={styles.content}>
                <span className={styles.contentLabel}>{t("browser.box.content")}</span>
                <span
                  className={styles.contentSize}
                  title={`${boxModel.content.width} × ${boxModel.content.height} px`}
                >
                  <span>{formatSize(boxModel.content.width)}</span>
                  <span className={styles.times}>×</span>
                  <span>{formatSize(boxModel.content.height)}</span>
                </span>
                <span className={styles.unit}>px</span>
              </div>
            </Band>
          </Band>
        </Band>
      </div>

      <table className={styles.details} aria-label={t("browser.box.measurements")}>
        <thead>
          <tr>
            <th scope="col" className={styles.unit}>
              px
            </th>
            {SIDE_KEYS.map((side) => (
              <th key={side} scope="col">
                {t(`browser.box.${side}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {LAYERS.map((layer) => (
            <tr key={layer} className={styles[layer]}>
              <th scope="row">
                <span className={styles.layerName}>
                  <span className={styles.swatch} aria-hidden="true" />
                  {layer}
                </span>
              </th>
              {boxModel[layer].map((value, index) => (
                <td key={SIDE_KEYS[index]} title={`${value}px`}>
                  {formatSize(value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
