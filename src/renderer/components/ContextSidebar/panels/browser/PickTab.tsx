import {
  ArrowRight,
  CheckCircle,
  Clipboard,
  Copy,
  CursorClick,
  Eye,
  Image,
} from "@phosphor-icons/react";
import type { BrowserPickMode } from "../../../../../shared/ipc";
import { useT } from "../../../../hooks/useT";
import { useBrowserStore } from "../../../../stores/browserStore";
import { useInspectorStore } from "../../../../stores/inspectorStore";
import styles from "./BrowserInspector.module.css";

/**
 * 「拾取」tab：模式开关 + 当前元素摘要 + 动作。
 * 产品动线：圈选元素 → Enter /「加入对话」→ 芯片进中央输入框（默认无截图）。
 */

const MODES: Array<{
  id: BrowserPickMode;
  labelKey: string;
  hintKey: string;
  icon: typeof Eye;
}> = [
  {
    id: "select",
    labelKey: "browser.pick.mode.select",
    hintKey: "browser.pick.mode.selectHint",
    icon: CursorClick,
  },
  {
    id: "browse",
    labelKey: "browser.pick.mode.browse",
    hintKey: "browser.pick.mode.browseHint",
    icon: Eye,
  },
];

export function PickTab() {
  const t = useT();
  const browser = useBrowserStore();
  const inspector = useInspectorStore();
  const item = browser.lastPicked;
  const activeMode = MODES.find((mode) => mode.id === browser.pickMode) ?? MODES[0];
  const alreadyInChat = item ? browser.chatElements.some((entry) => entry.id === item.id) : false;

  return (
    <div>
      {!browser.pickActive ? (
        <p className={styles.empty}>
          {t("browser.pick.idle")}
          <br />
          {t("browser.pick.idleHint")}
        </p>
      ) : (
        <>
          <div className={styles.modeSwitch}>
            {MODES.map((mode) => {
              const Icon = mode.icon;
              const selected = mode.id === browser.pickMode;
              return (
                <button
                  key={mode.id}
                  type="button"
                  aria-pressed={selected}
                  className={[styles.modeButton, selected ? styles.modeButtonActive : ""].join(" ")}
                  onClick={() => browser.setPickMode(mode.id)}
                >
                  <Icon size={14} weight={selected ? "fill" : "regular"} />
                  {t(mode.labelKey)}
                </button>
              );
            })}
          </div>
          <p className={styles.modeHint}>
            {t(activeMode.hintKey)}
            {t("browser.pick.modeFooter")}
          </p>
        </>
      )}

      {inspector.isAncestorTarget && (
        <div className={styles.hint}>
          <span className={styles.hintText}>
            {t("browser.pick.ancestor", { label: inspector.label })}
          </span>
          <button type="button" className={styles.widenButton} onClick={inspector.resetTarget}>
            {t("browser.pick.backToSelected")}
          </button>
        </div>
      )}

      {item === null ? (
        <p className={styles.empty}>{t("browser.pick.noSelection")}</p>
      ) : (
        <>
          <div className={styles.summary}>
            <CursorClick size={18} weight="fill" className={styles.summaryIcon} />
            <span className={styles.summaryMeta}>
              <span className={styles.targetLabel} title={item.selector}>
                {item.label}
              </span>
              <span className={styles.targetSize}>
                {item.textSummary
                  ? item.textSummary.slice(0, 48)
                  : item.rect
                    ? `${Math.round(item.rect.width)}×${Math.round(item.rect.height)} · ${t(
                        "browser.pick.viewportSize",
                        {
                          width: item.viewport.width,
                          height: item.viewport.height,
                        },
                      )}`
                    : item.kind === "screenshot"
                      ? t("browser.pick.screenshotItem")
                      : ""}
              </span>
            </span>
          </div>

          <div className={styles.actionRow}>
            <button
              type="button"
              className={[styles.actionButton, styles.actionPrimary].join(" ")}
              disabled={alreadyInChat}
              onClick={() => browser.addLastPickedToChat()}
            >
              <CheckCircle size={14} weight="regular" />
              {alreadyInChat ? t("browser.pick.inChat") : t("browser.pick.addToChat")}
              {!alreadyInChat && (
                <span className={styles.actionHint}>
                  <ArrowRight size={10} weight="bold" />
                  Enter
                </span>
              )}
            </button>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => browser.copyText(item.selector, t("browser.pick.copySelectorLabel"))}
            >
              <Copy size={14} weight="regular" />
              {t("browser.pick.copySelector")}
            </button>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => browser.copyText(item.styles, t("browser.pick.copyStylesLabel"))}
            >
              <Clipboard size={14} weight="regular" />
              {t("browser.pick.copyStyles")}
            </button>
            <button
              type="button"
              className={styles.actionButton}
              title={t("browser.pick.screenshotOnlyHint")}
              onClick={() => browser.addLastPickedScreenshot()}
            >
              <Image size={14} weight="regular" />
              {t("browser.pick.screenshotOnly")}
            </button>
          </div>

          <dl className={styles.detailList}>
            <div className={styles.detailRow}>
              <dt className={styles.detailKey}>{t("browser.pick.detail.selector")}</dt>
              <dd className={[styles.detailValue, styles.mono].join(" ")}>
                {item.selector || "—"}
              </dd>
            </div>
            <div className={styles.detailRow}>
              <dt className={styles.detailKey}>{t("browser.pick.detail.text")}</dt>
              <dd className={styles.detailValue}>{item.textSummary || "—"}</dd>
            </div>
            <div className={styles.detailRow}>
              <dt className={styles.detailKey}>{t("browser.pick.detail.a11y")}</dt>
              <dd className={styles.detailValue}>{item.a11y ?? "—"}</dd>
            </div>
            <div className={styles.detailRow}>
              <dt className={styles.detailKey}>{t("browser.pick.detail.source")}</dt>
              <dd className={styles.detailValue}>{item.url}</dd>
            </div>
          </dl>
        </>
      )}
    </div>
  );
}
