import { useEffect, useState } from "react";
import {
  type BuiltinToolsConfig,
  defaultBuiltinToolsConfig,
  publicBuiltinToolsConfig,
  SEARCH_PROVIDERS,
  type SearchProviderId,
} from "../../../shared/builtinTools";
import { useT } from "../../hooks/useT";
import { unwrap } from "../../services/ipc";
import { pideskApi } from "../../services/pideskApi";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import styles from "./DurableModelSettings.module.css";
import { SettingRow, SettingsSection } from "./SettingRow";

/** Native tool settings share the existing model settings surface and write-only credential flow. */
export function BuiltinToolsSettings() {
  const t = useT();
  const { showToast } = useUiStore();
  const [config, setConfig] = useState<BuiltinToolsConfig>(() =>
    publicBuiltinToolsConfig(defaultBuiltinToolsConfig()),
  );
  const [keys, setKeys] = useState<Partial<Record<SearchProviderId, string>>>({});
  const [imageKey, setImageKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const api = pideskApi();
    if (!api) return;
    let cancelled = false;
    void unwrap(api.durable.builtinTools())
      .then((value) => {
        if (!cancelled) {
          setConfig(value);
          setLoaded(true);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) showToast(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [showToast]);
  const provider = config.web.provider;
  const searchConfig = config.web.providers[provider];
  const defaultEndpoint =
    provider === "ollama" ? "http://localhost:11434" : "http://localhost:8080";
  const save = async () => {
    const api = pideskApi();
    if (!api) return;
    setBusy(true);
    try {
      const providers: Partial<Record<SearchProviderId, { baseUrl: string; apiKey: string }>> = {};
      for (const id of SEARCH_PROVIDERS) {
        const previous = config.web.providers[id];
        if (previous || keys[id] || id === provider)
          providers[id] = {
            baseUrl:
              previous?.baseUrl ??
              (id === "ollama"
                ? "http://localhost:11434"
                : id === "searxng"
                  ? "http://localhost:8080"
                  : ""),
            apiKey: keys[id] ?? "",
          };
      }
      setConfig(
        await unwrap(
          api.durable.saveBuiltinTools({
            web: { provider, providers },
            image: {
              provider: config.image.provider,
              baseUrl: config.image.baseUrl,
              model: config.image.model,
              apiKey: imageKey,
            },
          }),
        ),
      );
      setKeys({});
      setImageKey("");
      showToast(t("settings.builtins.saved"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const disabled = busy || !loaded;
  const input = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    secret = false,
  ) => (
    <input
      className={styles.input}
      aria-label={label}
      type={secret ? "password" : "text"}
      autoComplete={secret ? "new-password" : "off"}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    />
  );
  return (
    <SettingsSection title={t("settings.builtins.title")}>
      <p className={styles.description}>{t("settings.builtins.description")}</p>
      <SettingRow
        label={t("settings.builtins.searchProvider")}
        control={
          <Select
            value={provider}
            options={SEARCH_PROVIDERS.map((id) => ({ value: id, label: id }))}
            onChange={(value) =>
              setConfig({ ...config, web: { ...config.web, provider: value as SearchProviderId } })
            }
            disabled={disabled}
            ariaLabel={t("settings.builtins.searchProvider")}
          />
        }
      />
      {(provider === "searxng" || provider === "ollama") && (
        <SettingRow
          label={t("settings.builtins.searchEndpoint")}
          control={input(
            t("settings.builtins.searchEndpoint"),
            searchConfig?.baseUrl ?? defaultEndpoint,
            (baseUrl) =>
              setConfig({
                ...config,
                web: {
                  ...config.web,
                  providers: {
                    ...config.web.providers,
                    [provider]: { ...searchConfig, hasKey: searchConfig?.hasKey ?? false, baseUrl },
                  },
                },
              }),
          )}
        />
      )}
      <SettingRow
        label={t("settings.builtins.searchKey")}
        description={searchConfig?.hasKey ? t("session.durable.keySaved") : undefined}
        control={input(
          t("settings.builtins.searchKey"),
          keys[provider] ?? "",
          (value) => setKeys({ ...keys, [provider]: value }),
          true,
        )}
      />
      <SettingRow
        label={t("settings.builtins.imageProvider")}
        control={
          <Select
            value={config.image.provider}
            options={[
              { value: "openai", label: t("settings.builtins.openaiCompatible") },
              { value: "openrouter", label: "OpenRouter" },
            ]}
            onChange={(value) =>
              setConfig({
                ...config,
                image: {
                  ...config.image,
                  provider: value as "openai" | "openrouter",
                  baseUrl:
                    value === "openrouter"
                      ? "https://openrouter.ai/api/v1"
                      : "https://api.openai.com/v1",
                },
              })
            }
            disabled={disabled}
            ariaLabel={t("settings.builtins.imageProvider")}
          />
        }
      />
      <SettingRow
        label={t("settings.builtins.imageEndpoint")}
        control={input(t("settings.builtins.imageEndpoint"), config.image.baseUrl, (baseUrl) =>
          setConfig({ ...config, image: { ...config.image, baseUrl } }),
        )}
      />
      <SettingRow
        label={t("settings.builtins.imageModel")}
        control={input(t("settings.builtins.imageModel"), config.image.model, (model) =>
          setConfig({ ...config, image: { ...config.image, model } }),
        )}
      />
      <SettingRow
        label={t("settings.builtins.imageKey")}
        description={config.image.hasKey ? t("session.durable.keySaved") : undefined}
        control={input(t("settings.builtins.imageKey"), imageKey, setImageKey, true)}
      />
      <Button
        onClick={() => void save()}
        disabled={disabled || !config.image.baseUrl.trim() || !config.image.model.trim()}
      >
        {t("settings.builtins.save")}
      </Button>
    </SettingsSection>
  );
}
