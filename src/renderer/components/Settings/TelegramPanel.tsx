import { useEffect, useState } from "react";
import type { TelegramStatus } from "../../../shared/telegram";
import { useT } from "../../hooks/useT";
import { unwrap } from "../../services/ipc";
import { pideskApi } from "../../services/pideskApi";
import { useSessionMeta } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../ui/Button";
import { Toggle } from "../ui/Toggle";
import styles from "./DurableModelSettings.module.css";
import { SettingRow, SettingsSection } from "./SettingRow";

/** App-level settings never create a model session just to display connection status. */
export function TelegramPanel() {
  const t = useT();
  const { showToast } = useUiStore();
  const { activeSessionId, processAlive } = useSessionMeta();
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [token, setToken] = useState("");
  const [userId, setUserId] = useState("");
  const [chatId, setChatId] = useState("");
  const [proactive, setProactive] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const api = pideskApi();
    if (!api) return;
    let cancelled = false;
    void unwrap(api.telegram.status())
      .then((value) => {
        if (cancelled) return;
        setStatus(value);
        setUserId(String(value.config.userId ?? ""));
        setChatId(String(value.config.chatId ?? ""));
        setProactive(value.config.proactive);
      })
      .catch((error: unknown) => showToast(String(error)));
    const timer = window.setInterval(() => {
      void unwrap(api.telegram.status())
        .then((value) => {
          if (!cancelled) setStatus(value);
        })
        .catch(() => {});
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [showToast]);
  const run = async (action: "save" | "connect" | "disconnect" | "bind") => {
    const api = pideskApi();
    if (!api || busy) return;
    setBusy(true);
    try {
      const result = await unwrap(
        action === "save"
          ? api.telegram.save({ token, userId: Number(userId), chatId: Number(chatId), proactive })
          : action === "bind"
            ? api.telegram.bind(activeSessionId as string)
            : api.telegram[action](),
      );
      setStatus(result);
      if (action === "save") setToken("");
    } catch (error) {
      showToast(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsSection title={t("telegram.title")}>
      <p className={styles.description} data-selectable-text>
        {t("telegram.description")}
      </p>
      <p data-selectable-text>
        {t(status?.connected ? "telegram.connected" : "telegram.disconnected")}
        {status?.bot ? ` · @${status.bot}` : ""}
        {status?.error ? ` · ${status.error}` : ""}
      </p>
      <SettingRow
        label={t("telegram.token")}
        description={status?.config.hasToken ? t("telegram.saved") : undefined}
        control={
          <input
            className={styles.input}
            type="password"
            autoComplete="new-password"
            aria-label={t("telegram.token")}
            value={token}
            disabled={busy}
            onChange={(event) => setToken(event.target.value)}
          />
        }
      />
      <SettingRow
        label={t("telegram.user")}
        control={
          <input
            className={styles.input}
            inputMode="numeric"
            aria-label={t("telegram.user")}
            value={userId}
            disabled={busy}
            onChange={(event) => setUserId(event.target.value)}
          />
        }
      />
      <SettingRow
        label={t("telegram.chat")}
        control={
          <input
            className={styles.input}
            inputMode="numeric"
            aria-label={t("telegram.chat")}
            value={chatId}
            disabled={busy}
            onChange={(event) => setChatId(event.target.value)}
          />
        }
      />
      <SettingRow
        label={t("telegram.project")}
        control={
          <Toggle
            checked={proactive}
            onChange={setProactive}
            disabled={busy}
            aria-label={t("telegram.project")}
          />
        }
      />
      <SettingRow
        label={t("telegram.target")}
        description={status?.config.sessionKey ?? undefined}
        control={
          <Button
            disabled={busy || !processAlive || !activeSessionId}
            onClick={() => void run("bind")}
          >
            {t("telegram.bind")}
          </Button>
        }
      />
      <SettingRow
        label={t("telegram.title")}
        control={
          <>
            <Button
              disabled={busy || !userId || !chatId || (!token && !status?.config.hasToken)}
              onClick={() => void run("save")}
            >
              {t("common.save")}
            </Button>
            <Button
              disabled={busy || !status?.config.hasToken || !status.config.sessionKey}
              onClick={() => void run(status?.connected ? "disconnect" : "connect")}
            >
              {t(status?.connected ? "telegram.disconnect" : "telegram.connect")}
            </Button>
          </>
        }
      />
    </SettingsSection>
  );
}
