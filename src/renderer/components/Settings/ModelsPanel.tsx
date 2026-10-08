import { CaretDown } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  PiApiKeyProviderOption,
  PiAuthProviderStatus,
  PiAuthSnapshot,
  PiModelOption,
} from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { authService } from "../../services/authService";
import { fsService } from "../../services/fsService";
import { sessionService } from "../../services/sessionService";
import { useSessionMeta } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../ui/Button";
import { Menu, type MenuItem } from "../ui/Menu";
import { AiProviderLogo } from "./AiProviderLogo";
import { SettingRow, SettingsSection } from "./SettingRow";
import styles from "./Settings.module.css";

/**
 * 模型设置：默认模型下拉 + 命名凭据管理。
 * 同一 provider 可挂多条凭据（公司/个人等），激活时把密钥写入 auth.json 标准键。
 * 网关类（newapi）可自定义 baseUrl / api；官方源固定端点。
 */
export function ModelsPanel() {
  const t = useT();
  const { modelLabel, processAlive, refreshModelState } = useSessionMeta();
  const { showToast } = useUiStore();
  const [auth, setAuth] = useState<PiAuthSnapshot | null>(null);
  const [apiKeyProviders, setApiKeyProviders] = useState<PiApiKeyProviderOption[]>([]);
  const [models, setModels] = useState<PiModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [applying, setApplying] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState<"create" | string | null>(null);
  const [formName, setFormName] = useState("");
  const [formProvider, setFormProvider] = useState("anthropic");
  const [formApiKey, setFormApiKey] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");
  const [formApiType, setFormApiType] = useState("openai-completions");
  const [formPreferredModel, setFormPreferredModel] = useState("");
  const [formSaving, setFormSaving] = useState(false);

  const activeProviderId = auth?.activeProvider ?? null;

  const providerGatewayMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const option of apiKeyProviders) {
      map.set(option.id, option.gateway === true);
    }
    for (const provider of auth?.providers ?? []) {
      if (!map.has(provider.provider)) map.set(provider.provider, Boolean(provider.baseUrl));
    }
    return map;
  }, [apiKeyProviders, auth?.providers]);

  const formIsGateway = providerGatewayMap.get(formProvider) === true;

  const loadAuth = useCallback(async (): Promise<void> => {
    const [snapshot, providers] = await Promise.all([
      authService.list(),
      authService.listApiKeyProviders(),
    ]);
    setAuth(snapshot);
    setApiKeyProviders(providers);
  }, []);

  useEffect(() => {
    void loadAuth();
  }, [loadAuth]);

  useEffect(() => {
    if (!modelLabel || modelLabel === "pi") {
      setSelectedKey(null);
      return;
    }
    setSelectedKey((modelLabel.split(":")[0] ?? modelLabel).trim());
  }, [modelLabel]);

  const refreshModelsForActive = useCallback(async (): Promise<void> => {
    setLoadingModels(true);
    try {
      // 先读激活态，避免 setState 闭包里还是旧 provider
      const authSnap = (await authService.list()) ?? auth;
      const activeId = authSnap?.activeProvider ?? null;
      if (authSnap) setAuth(authSnap);
      const list = await sessionService.getModels({ force: true });
      // 严格按激活凭据过滤：newapi 也不例外，否则会混出其它厂商模型
      const filtered = activeId ? list.filter((m) => m.provider === activeId) : list;
      setModels(filtered);
    } finally {
      setLoadingModels(false);
    }
  }, [auth]);

  const applyModel = async (model: PiModelOption): Promise<void> => {
    setApplying(true);
    try {
      const key = `${model.provider}/${model.modelId}`;
      const next = await sessionService.setModel(model.provider, model.modelId);
      setSelectedKey(key);
      await refreshModelState();
      if (processAlive && next.sessionApplied === false) {
        showToast(t("settings.models.applied.deferred", { key }));
      } else if (processAlive) {
        showToast(t("settings.models.applied.switched", { key }));
      } else {
        showToast(t("settings.models.applied.saved", { key }));
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("settings.models.applyFailed"));
    } finally {
      setApplying(false);
    }
  };

  const activateCredential = async (credentialId: string, name: string): Promise<void> => {
    try {
      const snapshot = await authService.setActive(credentialId);
      if (snapshot) setAuth(snapshot);
      await refreshModelState();
      const activated = snapshot?.providers.find((p) => p.id === credentialId);
      // 无偏好模型时（尤其是跨厂商）提示用户选一次，避免会话仍挂在旧模型上
      if (activated && !activated.preferredModel) {
        showToast(t("settings.models.credential.activatedNeedModel", { name }));
      } else {
        showToast(t("settings.models.credential.activated", { name }));
      }
      void refreshModelsForActive();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : t("settings.models.credential.activateFailed"),
      );
    }
  };

  const removeCredential = async (credentialId: string, name: string): Promise<void> => {
    try {
      const snapshot = await authService.remove(credentialId);
      if (snapshot) setAuth(snapshot);
      if (formOpen === credentialId) setFormOpen(null);
      showToast(t("settings.models.credential.removed", { name }));
      // 顶上了新的激活项时模型列表要跟着变
      void refreshModelsForActive();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("settings.models.credential.removeFailed"));
    }
  };

  const openCreateForm = (): void => {
    setFormOpen("create");
    const firstProvider = apiKeyProviders[0]?.id ?? "anthropic";
    setFormName("");
    setFormProvider(firstProvider);
    setFormApiKey("");
    setFormBaseUrl("");
    setFormApiType("openai-completions");
    setFormPreferredModel("");
  };

  const openEditForm = (credential: PiAuthProviderStatus): void => {
    setFormOpen(credential.id);
    setFormName(credential.name);
    setFormProvider(credential.provider);
    setFormApiKey("");
    setFormBaseUrl(credential.baseUrl ?? "");
    setFormApiType(
      credential.api === "openai-responses" ? "openai-responses" : "openai-completions",
    );
    setFormPreferredModel(credential.preferredModel ?? "");
  };

  const handleProviderChange = (nextProvider: string): void => {
    setFormProvider(nextProvider);
    const isGateway = providerGatewayMap.get(nextProvider) === true;
    if (!isGateway) {
      setFormBaseUrl("");
      setFormApiType("openai-completions");
    }
    // 新建时名称留空则用厂商 label；有内容则保留用户输入
    if (formOpen === "create" && !formName.trim()) {
      const label = apiKeyProviders.find((p) => p.id === nextProvider)?.label;
      if (label) setFormName(label);
    }
  };

  const submitForm = async (): Promise<void> => {
    const isEdit = formOpen !== "create";
    const provider = formProvider.trim();
    const name = formName.trim();
    if (!provider) {
      showToast(t("settings.models.credential.providerRequired"));
      return;
    }
    if (!name) {
      showToast(t("settings.models.credential.nameRequired"));
      return;
    }
    if (!isEdit && !formApiKey.trim()) {
      showToast(t("settings.models.credential.apiKeyRequired"));
      return;
    }
    const isGateway = providerGatewayMap.get(provider) === true;
    const baseUrl = formBaseUrl.trim();
    if (isGateway && !isEdit && !baseUrl) {
      showToast(t("settings.models.credential.baseUrlRequired"));
      return;
    }
    setFormSaving(true);
    try {
      const snapshot = await authService.upsert({
        id: isEdit ? formOpen : null,
        name,
        provider,
        apiKey: formApiKey.trim() || null,
        preferredModel: formPreferredModel.trim(),
        ...(isGateway ? { baseUrl: baseUrl || null, api: formApiType } : {}),
      });
      if (snapshot) setAuth(snapshot);
      setFormOpen(null);
      setFormApiKey("");
      showToast(
        isEdit
          ? t("settings.models.credential.updated", { name })
          : t("settings.models.credential.added", { name }),
      );
      void refreshModelsForActive();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("settings.models.credential.saveFailed"));
    } finally {
      setFormSaving(false);
    }
  };

  const modelTriggerLabel = selectedKey || modelLabel || t("settings.models.selectModel");

  const modelMenuItems: MenuItem[] =
    loadingModels && models.length === 0
      ? [{ key: "__loading", label: t("settings.models.loading"), disabled: true }]
      : models.length === 0
        ? [{ key: "__empty", label: t("settings.models.empty"), disabled: true }]
        : models.map((model) => {
            const key = `${model.provider}/${model.modelId}`;
            return {
              key,
              label: model.label,
              hint: selectedKey === key ? t("settings.models.current") : undefined,
              onSelect: () => void applyModel(model),
            };
          });

  return (
    <div className={styles.panel}>
      <h2 className={styles.panelTitle}>{t("settings.section.models")}</h2>

      <SettingsSection title={t("settings.models.defaultModel")}>
        <SettingRow
          label={t("settings.models.defaultModel")}
          description={
            processAlive
              ? t("settings.models.defaultModel.descriptionActive")
              : t("settings.models.defaultModel.descriptionIdle")
          }
          control={
            <Menu
              direction="bottom"
              align="right"
              trigger={({ onClick }) => (
                <button
                  type="button"
                  className={styles.modelSelectBtn}
                  disabled={applying}
                  onClick={() => {
                    void refreshModelsForActive();
                    onClick();
                  }}
                >
                  {activeProviderId && <AiProviderLogo providerId={activeProviderId} size={16} />}
                  <span className={styles.modelSelectText}>{modelTriggerLabel}</span>
                  {loadingModels ? (
                    <span className={styles.modelSelectHint}>
                      {t("settings.models.refreshing")}
                    </span>
                  ) : (
                    <CaretDown size={14} weight="regular" />
                  )}
                </button>
              )}
              items={modelMenuItems}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title={t("settings.models.group.credentials")}>
        <div className={styles.authSectionBar}>
          <p className={styles.authHint}>
            {t("settings.models.credentials.hintBefore")} <code>~/.pi/agent/auth.json</code>
            {t("settings.models.credentials.hintAfter")}
          </p>
          <Button onClick={openCreateForm}>{t("settings.models.credential.create")}</Button>
        </div>

        {auth && auth.providers.length > 0 ? (
          <div className={styles.authList}>
            {auth.providers.map((credential) => (
              <div
                key={credential.id}
                className={[styles.authRow, credential.active ? styles.authRowActive : ""]
                  .join(" ")
                  .trim()}
              >
                <AiProviderLogo providerId={credential.provider} size={22} />
                <div className={styles.authRowMain}>
                  <div className={styles.authIdLine}>
                    <span className={styles.authId}>{credential.name}</span>
                    {credential.active && (
                      <span className={styles.authActiveBadge}>
                        {t("settings.models.credential.activeBadge")}
                      </span>
                    )}
                    {credential.expired && (
                      <span className={styles.authExpiredBadge}>
                        {t("settings.models.credential.expired")}
                      </span>
                    )}
                  </div>
                  <span className={styles.authMeta}>
                    {credential.provider}
                    {credential.kind === "api_key"
                      ? " · API Key"
                      : credential.kind === "oauth"
                        ? " · OAuth"
                        : ""}
                    {credential.maskedCredential ? ` · ${credential.maskedCredential}` : ""}
                    {credential.baseUrl ? ` · ${credential.baseUrl}` : ""}
                    {credential.api ? ` · ${credential.api}` : ""}
                    {credential.preferredModel
                      ? ` · ${t("settings.models.credential.preferred", {
                          model: credential.preferredModel,
                        })}`
                      : ""}
                  </span>
                </div>
                <div className={styles.authActions}>
                  {!credential.active && (
                    <Button onClick={() => void activateCredential(credential.id, credential.name)}>
                      {t("settings.models.credential.activate")}
                    </Button>
                  )}
                  <Button onClick={() => openEditForm(credential)}>
                    {t("settings.models.credential.edit")}
                  </Button>
                  <Button onClick={() => void removeCredential(credential.id, credential.name)}>
                    {t("common.remove")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.modelEmpty}>{t("settings.models.credential.empty")}</p>
        )}

        {formOpen && (
          <div className={styles.authFormCard}>
            <p className={styles.authFormTitle}>
              {formOpen === "create"
                ? t("settings.models.credential.create")
                : t("settings.models.credential.editTitle", {
                    name: formName || formOpen,
                  })}
            </p>
            <div className={styles.authForm}>
              <input
                className={styles.authInput}
                type="text"
                placeholder={t("settings.models.credential.namePlaceholder")}
                value={formName}
                autoComplete="off"
                onChange={(e) => setFormName(e.target.value)}
              />
              {formOpen === "create" ? (
                <select
                  className={styles.authSelect}
                  value={formProvider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  aria-label={t("settings.models.credential.providerLabel")}
                >
                  {apiKeyProviders.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className={styles.authFixedProvider}>
                  <AiProviderLogo providerId={formProvider} size={16} />
                  {formProvider}
                </span>
              )}
              <input
                className={styles.authInput}
                type="password"
                placeholder={
                  formOpen === "create"
                    ? t("settings.models.credential.apiKeyPlaceholder")
                    : t("settings.models.credential.apiKeyKeepPlaceholder")
                }
                value={formApiKey}
                autoComplete="off"
                onChange={(e) => setFormApiKey(e.target.value)}
              />
              {formIsGateway && (
                <>
                  <input
                    className={styles.authInput}
                    type="text"
                    placeholder={t("settings.models.credential.baseUrlPlaceholder")}
                    value={formBaseUrl}
                    autoComplete="off"
                    onChange={(e) => setFormBaseUrl(e.target.value)}
                  />
                  <select
                    className={styles.authSelect}
                    value={formApiType}
                    onChange={(e) => setFormApiType(e.target.value)}
                    aria-label={t("settings.models.credential.apiTypeLabel")}
                  >
                    <option value="openai-completions">openai-completions</option>
                    <option value="openai-responses">openai-responses</option>
                  </select>
                </>
              )}
              <input
                className={styles.authInput}
                type="text"
                placeholder={t("settings.models.credential.preferredModelPlaceholder")}
                value={formPreferredModel}
                onChange={(e) => setFormPreferredModel(e.target.value)}
              />
            </div>
            <div className={styles.authFormActions}>
              <Button onClick={() => setFormOpen(null)}>{t("common.cancel")}</Button>
              <Button onClick={() => void submitForm()} disabled={formSaving}>
                {formSaving ? t("settings.models.credential.saving") : t("common.save")}
              </Button>
            </div>
          </div>
        )}

        {auth?.file && (
          <p className={styles.authFilePath}>
            {t("settings.models.credential.registry", { path: auth.file })}
            <Button
              className={styles.authOpenBtn}
              onClick={() => void fsService.openPath(auth.file)}
            >
              {t("common.open")}
            </Button>
          </p>
        )}
      </SettingsSection>
    </div>
  );
}
