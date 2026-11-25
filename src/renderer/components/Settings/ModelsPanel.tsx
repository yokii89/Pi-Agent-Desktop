import { useEffect, useState } from "react";
import type { DurableModelConfig } from "../../../shared/durableProtocol";
import { useT } from "../../hooks/useT";
import { unwrap } from "../../services/ipc";
import { pideskApi } from "../../services/pideskApi";
import { useSessionMeta } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import styles from "./DurableModelSettings.module.css";
import { SettingRow, SettingsSection } from "./SettingRow";

const initial: DurableModelConfig = {
  baseUrl: "https://api.openai.com/v1",
  modelId: "",
  api: "openai-responses",
  contextWindow: 128000,
  maxTokens: 16384,
  reasoning: false,
  hasKey: false,
};

/** Desktop-owned model setup. Credentials are write-only and saved with OS encryption by main. */
export function ModelsPanel() {
  const t = useT();
  const { showToast } = useUiStore();
  const { refreshModelState } = useSessionMeta();
  const [config, setConfig] = useState(initial);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const api = pideskApi();
    if (!api) return;
    let cancelled = false;
    void unwrap(api.durable.model())
      .then((value) => {
        if (!cancelled && value) setConfig(value);
      })
      .catch((error: unknown) => showToast(String(error)));
    return () => {
      cancelled = true;
    };
  }, [showToast]);
  const save = async (): Promise<void> => {
    const api = pideskApi();
    if (!api) return;
    setBusy(true);
    try {
      const saved = await unwrap(api.durable.saveModel({ ...config, apiKey }));
      setConfig(saved);
      setApiKey("");
      await refreshModelState();
      showToast(t("session.durable.modelSaved"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsSection title={t("session.durable.modelTitle")}>
      <p className={styles.description}>{t("session.durable.modelDescription")}</p>
      <SettingRow
        label={t("session.durable.endpoint")}
        control={
          <input
            className={styles.input}
            aria-label={t("session.durable.endpoint")}
            type="url"
            value={config.baseUrl}
            onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })}
            disabled={busy}
          />
        }
      />
      <SettingRow
        label={t("session.durable.api")}
        control={
          <Select
            value={config.api}
            options={[
              { value: "openai-responses", label: "OpenAI Responses" },
              { value: "openai-completions", label: "OpenAI Chat Completions" },
            ]}
            onChange={(api) => setConfig({ ...config, api: api as DurableModelConfig["api"] })}
            disabled={busy}
            ariaLabel={t("session.durable.api")}
          />
        }
      />
      <SettingRow
        label={t("session.durable.modelId")}
        control={
          <input
            className={styles.input}
            aria-label={t("session.durable.modelId")}
            value={config.modelId}
            onChange={(event) => setConfig({ ...config, modelId: event.target.value })}
            disabled={busy}
          />
        }
      />
      <SettingRow
        label={t("session.durable.apiKey")}
        description={config.hasKey ? t("session.durable.keySaved") : undefined}
        control={
          <input
            className={styles.input}
            aria-label={t("session.durable.apiKey")}
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            disabled={busy}
          />
        }
      />
      <SettingRow
        label={t("session.durable.contextWindow")}
        control={
          <input
            className={styles.input}
            aria-label={t("session.durable.contextWindow")}
            type="number"
            min={1}
            max={10000000}
            value={config.contextWindow}
            onChange={(event) =>
              setConfig({ ...config, contextWindow: Number(event.target.value) })
            }
            disabled={busy}
          />
        }
      />
      <SettingRow
        label={t("session.durable.maxTokens")}
        control={
          <input
            className={styles.input}
            aria-label={t("session.durable.maxTokens")}
            type="number"
            min={1}
            max={config.contextWindow}
            value={config.maxTokens}
            onChange={(event) => setConfig({ ...config, maxTokens: Number(event.target.value) })}
            disabled={busy}
          />
        }
      />
      <SettingRow
        label={t("session.durable.reasoning")}
        control={
          <Select
            value={String(config.reasoning)}
            options={[
              { value: "false", label: t("session.durable.reasoningOff") },
              { value: "true", label: t("session.durable.reasoningOn") },
            ]}
            onChange={(value) => setConfig({ ...config, reasoning: value === "true" })}
            ariaLabel={t("session.durable.reasoning")}
            disabled={busy}
          />
        }
      />
      <Button
        onClick={() => void save()}
        disabled={busy || !config.modelId.trim() || (!config.hasKey && !apiKey.trim())}
      >
        {t("session.durable.saveModel")}
      </Button>
    </SettingsSection>
  );
}
