import { Power, Tray } from "@phosphor-icons/react";
import {
  Fragment,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { WindowCloseDecision, WindowCloseRequest } from "../../../shared/windowClose";
import { useGlidePill } from "../../hooks/useGlidePill";
import { useT } from "../../hooks/useT";
import { browserService } from "../../services/browserService";
import { windowService } from "../../services/windowService";
import { PiMark } from "../Splash/PiMark";
import { Modal } from "../ui/Modal";
import styles from "./CloseRequestDialog.module.css";

type Action = "tray" | "quit";

/** 应用级关窗决策：预选与 Enter 共用滑动指示条的当前目标。 */
function CloseRequestDialog({
  request,
  open,
  onSettled,
}: {
  request: WindowCloseRequest;
  open: boolean;
  onSettled: (id: number) => void;
}) {
  const t = useT();
  const [remember, setRemember] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const secondRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const pill = useGlidePill(listRef, { onActiveChange: setActiveIndex });
  const actions: Action[] = request.trayAvailable ? ["tray", "quit"] : ["quit", "tray"];
  const running = request.sessions + request.terminals + request.procs > 0;

  useLayoutEffect(() => {
    if (open) pill.jumpTo(0);
  }, [open, pill]);

  useEffect(() => {
    if (!open) return;
    void browserService.setOverlaySuppressed(true, "close-request");
    void windowService.closeReady(request.id).catch((reason: unknown) => setError(String(reason)));
    return () => {
      void browserService.setOverlaySuppressed(false, "close-request");
    };
  }, [open, request.id]);

  const decide = async (action: WindowCloseDecision["action"]): Promise<void> => {
    if (!open || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await windowService.closeDecision({
        id: request.id,
        action,
        remember: action !== "cancel" && remember,
      });
      onSettled(request.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const targets = [
        firstRef.current,
        request.trayAvailable ? secondRef.current : null,
        cancelRef.current,
      ].filter((target): target is HTMLButtonElement => target !== null);
      const current = targets.indexOf(event.currentTarget);
      targets[
        (current + (event.key === "ArrowDown" ? 1 : -1) + targets.length) % targets.length
      ]?.focus();
    } else if (event.key === "Enter" && event.currentTarget !== cancelRef.current) {
      event.preventDefault();
      const index = pill.current();
      if (index !== null) void decide(actions[index]);
    }
  };

  const counts = [
    { kind: "session", count: request.sessions },
    { kind: "terminal", count: request.terminals },
    { kind: "proc", count: request.procs },
  ].filter(({ count }) => count > 0);
  const [before, after] = t("window.close.lead").split("{detail}");
  const selectedAction = activeIndex === null ? null : actions[activeIndex];

  return (
    <Modal
      open={open}
      onClose={() => void decide("cancel")}
      ariaLabel={t("window.close.title")}
      panelClassName={styles.panel}
      priority
      initialFocusRef={firstRef}
    >
      <div className={styles.head}>
        <PiMark className={styles.mark} />
        <h2 className={styles.title}>{t("window.close.title")}</h2>
      </div>
      {running && (
        <p className={styles.lead}>
          {before}
          {counts.map(({ kind, count }, index) => {
            const [prefix, suffix] = t(`window.close.lead.${kind}${count === 1 ? "" : "s"}`).split(
              "{count}",
            );
            return (
              <Fragment key={kind}>
                {index > 0 && t("window.close.separator")}
                {prefix}
                <b>{count}</b>
                {suffix}
              </Fragment>
            );
          })}
          {after}
        </p>
      )}
      <div ref={listRef} className={styles.cards} data-danger={selectedAction === "quit"}>
        <span ref={pill.pillRef} className={styles.indicator} aria-hidden="true" />
        {actions.map((action, index) => {
          const hide = action === "tray";
          const blocked = hide && !request.trayAvailable;
          const title = t(`window.close.${hide ? "hide" : "quit"}`);
          const hint = t(
            `window.close.${hide ? "hide" : "quit"}.${blocked ? "blocked" : running ? "hint" : "hintIdle"}`,
          );
          const Icon = hide ? Tray : Power;
          return (
            <button
              key={action}
              ref={index === 0 ? firstRef : secondRef}
              type="button"
              className={styles.card}
              data-glide-index={index}
              data-active={activeIndex === index}
              data-danger={!hide}
              disabled={blocked || busy}
              onPointerEnter={() => {
                if (!blocked) pill.highlight(index);
              }}
              onFocus={() => pill.highlight(index)}
              onKeyDown={onKeyDown}
              onClick={() => void decide(action)}
            >
              <span className={styles.tile}>
                <Icon size={16} weight="regular" />
              </span>
              <span className={styles.cardText}>
                <span className={styles.cardTitle}>{title}</span>
                <span className={styles.hint} title={hint}>
                  {hint}
                </span>
              </span>
              <kbd className={styles.kbd} data-visible={activeIndex === index}>
                Enter
              </kbd>
            </button>
          );
        })}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.footer}>
        <label className={styles.remember}>
          <input
            type="checkbox"
            checked={remember}
            disabled={busy}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              const index = pill.current();
              if (index !== null) void decide(actions[index]);
            }}
            onChange={(event) => setRemember(event.target.checked)}
          />
          {t("window.close.remember")}
        </label>
        <button
          ref={cancelRef}
          type="button"
          className={styles.cancel}
          disabled={busy}
          onFocus={() => pill.highlight(null)}
          onKeyDown={onKeyDown}
          onClick={() => void decide("cancel")}
        >
          {t("window.close.cancel")}
          <kbd className={styles.kbd} data-visible>
            Esc
          </kbd>
        </button>
      </div>
    </Modal>
  );
}

/** 顶层只订阅一次；保留最后一次快照，让关闭动画完成后再卸载面板。 */
export function CloseRequestDialogHost() {
  const [request, setRequest] = useState<WindowCloseRequest | null>(null);
  const [open, setOpen] = useState(false);
  const activeId = useRef<number | null>(null);
  const settle = useCallback((id: number): void => {
    if (activeId.current !== id) return;
    activeId.current = null;
    setOpen(false);
  }, []);
  useEffect(() => {
    const offRequest = windowService.onCloseRequest((snapshot) => {
      activeId.current = snapshot.id;
      setRequest(snapshot);
      setOpen(true);
    });
    const offSettled = windowService.onCloseSettled(settle);
    return () => {
      offRequest();
      offSettled();
    };
  }, [settle]);
  return request ? (
    <CloseRequestDialog key={request.id} request={request} open={open} onSettled={settle} />
  ) : null;
}
