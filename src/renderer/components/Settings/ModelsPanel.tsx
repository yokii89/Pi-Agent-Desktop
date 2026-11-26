import { useEffect, useState } from "react";
import type { DurableModelConfig } from "../../../shared/durableProtocol";
import type { GatewayCatalog, GatewayModelInfo } from "../../../shared/newApi";
import { useT } from "../../hooks/useT";
import { unwrap } from "../../services/ipc";
import { pideskApi } from "../../services/pideskApi";
import { useSessionMeta } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { BuiltinToolsSettings } from "./BuiltinToolsSettings";
import styles from "./DurableModelSettings.module.css";
import { GatewayModelCatalogSettings } from "./GatewayModelCatalogSettings";
import { SettingRow, SettingsSection } from "./SettingRow";

const initial: DurableModelConfig = {
  baseUrl: "https://api.openai.com/v1",
  modelId: "",
  api: "openai-responses",
  contextWindow: 1_000_000,
  maxTokens: 65_536,
  reasoning: true,
  capabilityMode: "auto",
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
  const [catalog, setCatalog] = useState<GatewayCatalog<GatewayModelInfo>>({
    models: [],
    fetchedAt: null,
    stale: false,
    error: null,
  });
  useEffect(() => {
    const api = pideskApi();
    if (!api) return;
    let cancelled = false;
    setBusy(true);
    void Promise.all([unwrap(api.durable.model()), unwrap(api.durable.modelCatalog())])
      .then(([value, models]) => {
        if (!cancelled) {
          if (value) setConfig(value);
          setCatalog(models);
        }
      })
      .catch((error: unknown) => showToast(String(error)))
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
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
      setCatalog(await unwrap(api.durable.modelCatalog()));
      await refreshModelState();
      showToast(t("session.durable.modelSaved"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const maintain = async (action: "refresh" | "clear" | "test" | "import"): Promise<void> => {
    const api = pideskApi();
    if (!api) return;
    setBusy(true);
    try {
      if (action === "clear") {
        await unwrap(api.durable.clearModelCache());
        setCatalog({ models: [], fetchedAt: null, stale: false, error: null });
        showToast(t("settings.newapi.cleared"));
      } else if (action === "test") {
        const result = await unwrap(api.durable.testModelConnection());
        showToast(t("settings.newapi.tested", result));
      } else {
        if (action === "import") {
          setConfig(await unwrap(api.durable.importCodexModel()));
          setApiKey("");
        }
        setCatalog(await unwrap(api.durable.modelCatalog(action === "refresh")));
        await refreshModelState();
        if (action === "import") showToast(t("settings.newapi.imported"));
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SettingsSection title={t("session.durable.modelTitle")}>
        <p className={styles.description}>{t("session.durable.modelDescription")}</p>
        <GatewayModelCatalogSettings
          catalog={catalog}
          modelId={config.modelId}
          busy={busy}
          configured={config.hasKey}
          onSelect={(model) =>
            setConfig({
              ...config,
              modelId: model.id,
              contextWindow: model.contextWindow,
              maxTokens: model.maxTokens,
              reasoning: model.reasoning,
              input: model.input,
              capabilityMode: "auto",
              preferredThinking: undefined,
            })
          }
          onRefresh={() => void maintain("refresh")}
          onClear={() => void maintain("clear")}
          onTest={() => void maintain("test")}
          onImport={() => void maintain("import")}
        />
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
          description={t("settings.newapi.modelHint")}
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
          label={t("settings.newapi.capabilities")}
          description={t("settings.newapi.capabilityHint")}
          control={
            <Select
              value={config.capabilityMode ?? "manual"}
              options={[
                { value: "auto", label: t("settings.newapi.auto") },
                { value: "manual", label: t("settings.newapi.manual") },
              ]}
              onChange={(mode) =>
                setConfig({ ...config, capabilityMode: mode as "auto" | "manual" })
              }
              disabled={busy}
              ariaLabel={t("settings.newapi.capabilities")}
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
                setConfig({
                  ...config,
                  contextWindow: Number(event.target.value),
                  capabilityMode: "manual",
                })
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
              onChange={(value) =>
                setConfig({ ...config, reasoning: value === "true", capabilityMode: "manual" })
              }
              ariaLabel={t("session.durable.reasoning")}
              disabled={busy}
            />
          }
        />
        <Button onClick={() => void save()} disabled={busy || (!config.hasKey && !apiKey.trim())}>
          {t("session.durable.saveModel")}
        </Button>
      </SettingsSection>
      <BuiltinToolsSettings />
    </>
  );
}
