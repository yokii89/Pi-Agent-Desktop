import { useEffect, useRef, useState } from "react";
import type { BrowserLoginSource } from "../../../../../shared/ipc";
import { useT } from "../../../../hooks/useT";
import { browserService } from "../../../../services/browserService";
import { settingsService } from "../../../../services/settingsService";
import { useBrowserStore } from "../../../../stores/browserStore";
import { useUiStore } from "../../../../stores/uiStore";
import { prepareOverlayFreeze, releaseOverlayFreeze } from "../../../../utils/overlayFreeze";
import { Button } from "../../../ui/Button";
import { Modal } from "../../../ui/Modal";
import styles from "./ImportLoginDialog.module.css";

const SUPPRESS_REASON = "loginImport";

type Step = "consent" | "method" | "auto" | "paste";

/** 从当前地址推导预填 host；无有效 http(s) 地址时退回 localhost。 */
function hostFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (/^https?:$/.test(parsed.protocol) && parsed.hostname) return parsed.hostname;
  } catch {
    // ignore
  }
  return "localhost";
}

export interface ImportLoginDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 登录态导入对话框（docs/design/09）：
 * 同意（仅首次）→ 选择自动读取/手动粘贴 → 写入 persist:browser。
 * 打开期间抑制 WebContentsView，避免原生页面盖住 Modal。
 */
export function ImportLoginDialog({ open, onClose }: ImportLoginDialogProps) {
  const t = useT();
  const store = useBrowserStore();
  const { showToast } = useUiStore();
  const [step, setStep] = useState<Step | null>(null);
  const [host, setHost] = useState("localhost");
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [sources, setSources] = useState<BrowserLoginSource[]>([]);
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [previewNames, setPreviewNames] = useState<string[] | null>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: setOverlayFreeze 稳定；只随 open 开关
  useEffect(() => {
    if (!open) return;
    // 从更多菜单交接时已有冻结帧且视图已抑制，只需挂上本对话框的 reason
    if (store.overlayFreeze) {
      void browserService.setOverlaySuppressed(true, SUPPRESS_REASON);
    } else {
      void prepareOverlayFreeze(SUPPRESS_REASON, store.setOverlayFreeze);
    }
    return () => {
      releaseOverlayFreeze(SUPPRESS_REASON, store.setOverlayFreeze);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const settings = await settingsService.get();
      if (cancelled) return;
      setStep(settings?.browserLoginImportConsent ? "method" : "consent");
    })();
    setHost(hostFromUrl(store.url));
    setRaw("");
    setBusy(false);
    setError(null);
    setWarnings([]);
    setSources([]);
    setSourcesLoaded(false);
    setSourceId(null);
    setPreviewNames(null);
    return () => {
      cancelled = true;
    };
  }, [open, store.url]);

  useEffect(() => {
    if (!open || step !== "paste") return;
    pasteRef.current?.focus();
  }, [open, step]);

  const loadSources = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const list = await browserService.listLoginSources();
      setSources(list);
      setSourcesLoaded(true);
      if (list.length === 0) {
        setError(t("browser.loginImport.errNoSources"));
        return;
      }
      setSourceId(list[0]?.id ?? null);
      setStep("auto");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("browser.loginImport.errDetect"));
    } finally {
      setBusy(false);
    }
  };

  const handleClose = (): void => {
    if (busy) return;
    onClose();
  };

  const finishWithToast = (applied: number, extraWarnings: string[]): void => {
    const suffix =
      extraWarnings.length > 0
        ? t("browser.loginImport.toastSuffix", { warning: extraWarnings[0] })
        : "";
    showToast(t("browser.loginImport.toast", { count: applied, suffix }));
    if (store.url) {
      void browserService.forceReload().catch(() => {});
    }
    onClose();
  };

  const handlePreview = async (): Promise<void> => {
    if (busy || !sourceId) return;
    const trimmedHost = host.trim();
    if (!trimmedHost) {
      setError(t("browser.loginImport.errNeedHost"));
      return;
    }
    setBusy(true);
    setError(null);
    setWarnings([]);
    setPreviewNames(null);
    try {
      const result = await browserService.previewLoginCookies({
        sourceId,
        host: trimmedHost,
      });
      setPreviewNames(result.names);
      setWarnings(result.warnings);
      if (result.names.length === 0) {
        setError(
          result.failed > 0
            ? t("browser.loginImport.errDecrypt")
            : t("browser.loginImport.errNoMatch"),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t("browser.loginImport.errRead");
      setError(message);
      if (/v20|应用绑定|无法自动解密|DPAPI|复制 Cookie/.test(message)) {
        setWarnings((w) => [...w, t("browser.loginImport.warnManual")]);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleAutoImport = async (): Promise<void> => {
    if (busy || !sourceId) return;
    const trimmedHost = host.trim();
    if (!trimmedHost) {
      setError(t("browser.loginImport.errNeedHost"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await browserService.applyLoginCookies({
        sourceId,
        host: trimmedHost,
      });
      finishWithToast(result.applied, result.warnings);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("browser.loginImport.errImport"));
    } finally {
      setBusy(false);
    }
  };

  const handlePasteImport = async (): Promise<void> => {
    if (busy) return;
    const trimmedHost = host.trim();
    if (!trimmedHost) {
      setError(t("browser.loginImport.errNeedHost"));
      return;
    }
    if (!raw.trim()) {
      setError(t("browser.loginImport.errNeedPaste"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await browserService.applyPastedCookies({ host: trimmedHost, raw });
      finishWithToast(result.applied, []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("browser.loginImport.errImport"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      ariaLabel={t("browser.loginImport.title")}
      panelClassName={styles.panel}
    >
      {step === null && (
        <div className={styles.body}>
          <h2 className={styles.title}>{t("browser.loginImport.title")}</h2>
          <p className={styles.hint}>{t("browser.loginImport.preparing")}</p>
        </div>
      )}
      {step === "consent" && (
        <div className={styles.body}>
          <h2 className={styles.title}>{t("browser.loginImport.title")}</h2>
          <div className={styles.message}>
            <p className={styles.paragraph}>{t("browser.loginImport.intro")}</p>
            <ul className={styles.list}>
              <li>{t("browser.loginImport.consent.sites")}</li>
              <li>{t("browser.loginImport.consent.local")}</li>
              <li>{t("browser.loginImport.consent.revoke")}</li>
              <li>{t("browser.loginImport.consent.once")}</li>
            </ul>
          </div>
          <div className={styles.actions}>
            <Button disabled={busy} onClick={handleClose}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                void settingsService.set({ browserLoginImportConsent: true });
                setStep("method");
              }}
            >
              {t("browser.loginImport.understood")}
            </Button>
          </div>
        </div>
      )}

      {step === "method" && (
        <div className={styles.body}>
          <h2 className={styles.title}>{t("browser.loginImport.methodTitle")}</h2>
          <p className={styles.hint}>{t("browser.loginImport.methodHint")}</p>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <div className={styles.methodList}>
            <button
              type="button"
              className={styles.methodCard}
              disabled={busy}
              onClick={() => void loadSources()}
            >
              <span className={styles.methodTitle}>{t("browser.loginImport.method.auto")}</span>
              <span className={styles.methodDesc}>{t("browser.loginImport.method.autoDesc")}</span>
            </button>
            <button
              type="button"
              className={styles.methodCard}
              disabled={busy}
              onClick={() => {
                setError(null);
                setWarnings([]);
                setStep("paste");
              }}
            >
              <span className={styles.methodTitle}>{t("browser.loginImport.method.paste")}</span>
              <span className={styles.methodDesc}>{t("browser.loginImport.method.pasteDesc")}</span>
            </button>
          </div>
          <div className={styles.actions}>
            <Button disabled={busy} onClick={() => setStep("consent")}>
              {t("context.back")}
            </Button>
          </div>
        </div>
      )}

      {step === "auto" && (
        <div className={styles.body}>
          <h2 className={styles.title}>{t("browser.loginImport.autoTitle")}</h2>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t("browser.loginImport.profile")}</span>
            <select
              className={styles.select}
              value={sourceId ?? ""}
              disabled={busy || sources.length === 0}
              onChange={(event) => {
                setSourceId(event.target.value);
                setPreviewNames(null);
                setError(null);
                setWarnings([]);
              }}
            >
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.browserLabel} · {source.profileLabel}
                  {source.isDefaultBrowser ? t("browser.loginImport.defaultBrowser") : ""}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t("browser.loginImport.targetHost")}</span>
            <input
              className={styles.input}
              value={host}
              spellCheck={false}
              autoComplete="off"
              placeholder={t("browser.loginImport.hostPlaceholder")}
              disabled={busy}
              onChange={(event) => {
                setHost(event.target.value);
                setPreviewNames(null);
              }}
            />
          </label>
          {previewNames && previewNames.length > 0 ? (
            <div className={styles.previewBox}>
              <div className={styles.fieldLabel}>
                {t("browser.loginImport.previewCount", { count: previewNames.length })}
              </div>
              <div className={styles.nameList}>
                {previewNames.map((name) => (
                  <span key={name} className={styles.nameChip}>
                    {name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {warnings.map((w) => (
            <p key={w} className={styles.hint}>
              {w}
            </p>
          ))}
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <p className={styles.hint}>{t("browser.loginImport.autoHint")}</p>
          <div className={styles.actions}>
            <Button disabled={busy} onClick={() => setStep("method")}>
              {t("context.back")}
            </Button>
            {error ? (
              <Button
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setWarnings([]);
                  setStep("paste");
                }}
              >
                {t("browser.loginImport.usePaste")}
              </Button>
            ) : null}
            {previewNames && previewNames.length > 0 ? (
              <Button variant="primary" disabled={busy} onClick={() => void handleAutoImport()}>
                {busy
                  ? t("browser.loginImport.importing")
                  : t("browser.loginImport.importN", { count: previewNames.length })}
              </Button>
            ) : (
              <Button variant="primary" disabled={busy} onClick={() => void handlePreview()}>
                {busy ? t("browser.loginImport.reading") : t("browser.loginImport.preview")}
              </Button>
            )}
          </div>
        </div>
      )}

      {step === "paste" && (
        <div className={styles.body}>
          <h2 className={styles.title}>{t("browser.loginImport.pasteTitle")}</h2>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t("browser.loginImport.targetHost")}</span>
            <input
              className={styles.input}
              value={host}
              spellCheck={false}
              autoComplete="off"
              placeholder={t("browser.loginImport.hostPlaceholder")}
              disabled={busy}
              onChange={(event) => setHost(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t("browser.loginImport.cookieBody")}</span>
            <textarea
              ref={pasteRef}
              className={styles.textarea}
              value={raw}
              spellCheck={false}
              placeholder={t("browser.loginImport.cookiePlaceholder")}
              disabled={busy}
              rows={5}
              onChange={(event) => setRaw(event.target.value)}
            />
          </label>
          <p className={styles.hint}>{t("browser.loginImport.pasteHint")}</p>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <div className={styles.actions}>
            <Button
              disabled={busy}
              onClick={() => {
                setError(null);
                setStep(sourcesLoaded && sources.length > 0 ? "auto" : "method");
              }}
            >
              {t("context.back")}
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void handlePasteImport()}>
              {busy ? t("browser.loginImport.importing") : t("browser.loginImport.import")}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
