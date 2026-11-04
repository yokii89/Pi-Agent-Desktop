import { Lightning, PencilSimple, Trash } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clampThinkingLevel,
  type PiApiKeyProviderOption,
  type PiAuthProviderStatus,
  type PiAuthSnapshot,
  type PiAuthUpsertRequest,
  type PiImportableProvider,
  type PiModelOption,
  type PiModelOverridePatch,
  type PiModelOverridesSnapshot,
} from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { authService } from "../../services/authService";
import { fsService } from "../../services/fsService";
import { modelOverridesService } from "../../services/modelOverridesService";
import { sessionService } from "../../services/sessionService";
import { getComposerThinkingLevel, useComposerStore } from "../../stores/composerStore";
import { useSessionMeta } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import {
  buildModelOverrideRows,
  type ModelOverrideRow,
  reuseModelOverrideRows,
} from "../../utils/modelOverrides";
import { AiModelIcon } from "../AiIcons/AiModelIcon";
import { AiProviderLogo } from "../AiIcons/AiProviderLogo";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { GlideChevron } from "../ui/GlideChevron";
import { Menu, type MenuItem } from "../ui/Menu";
import { CredentialDialog } from "./CredentialDialog";
import { ModelOverridesSection } from "./ModelOverridesSection";
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
  const { syncThinkingState } = useComposerStore();
  const { showToast } = useUiStore();
  const [auth, setAuth] = useState<PiAuthSnapshot | null>(null);
  const [apiKeyProviders, setApiKeyProviders] = useState<PiApiKeyProviderOption[]>([]);
  const [models, setModels] = useState<PiModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [applying, setApplying] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogCredential, setDialogCredential] = useState<PiAuthProviderStatus | null>(null);
  const [dialogSaving, setDialogSaving] = useState(false);
  const [importingProvider, setImportingProvider] = useState<string | null>(null);

  // 模型能力（docs/design/49 起，docs/design/50 改版）
  const [overrides, setOverrides] = useState<PiModelOverridesSnapshot>({});
  const [savingOverrideKey, setSavingOverrideKey] = useState<string | null>(null);

  const activeProviderId = auth?.activeProvider ?? null;

  /** provider id → 是否网关类：静态表说了算，注册表里的历史凭据按有无 baseUrl 兜底。 */
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

  // 模型能力覆盖：挂载即载入模型清单与覆盖快照（仅一次；凭据变更由既有流程各自刷新）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只随挂载跑一次，不跟 refreshModelsForActive 的 auth 依赖重跑
  useEffect(() => {
    void refreshModelsForActive();
    void modelOverridesService
      .get()
      .then(setOverrides)
      .catch(() => {});
  }, []);

  const applyModel = useCallback(
    async (model: PiModelOption): Promise<void> => {
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
    },
    [processAlive, refreshModelState, showToast, t],
  );

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

  /** 二次确认中的凭据（null = 确认窗关闭）；pidesk 来源删密钥，pi 来源只取消继承。 */
  const [pendingRemove, setPendingRemove] = useState<PiAuthProviderStatus | null>(null);
  const [removing, setRemoving] = useState(false);

  const removeCredential = async (credential: PiAuthProviderStatus): Promise<void> => {
    setRemoving(true);
    try {
      const snapshot = await authService.remove(credential.id);
      if (snapshot) setAuth(snapshot);
      if (dialogCredential?.id === credential.id) setDialogOpen(false);
      setPendingRemove(null);
      showToast(
        t(
          credential.origin === "pi"
            ? "settings.models.credential.unlinked"
            : "settings.models.credential.removed",
          { name: credential.name },
        ),
      );
      // 顶上了新的激活项时模型列表要跟着变
      void refreshModelsForActive();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("settings.models.credential.removeFailed"));
    } finally {
      setRemoving(false);
    }
  };

  const importProvider = async (provider: PiImportableProvider): Promise<void> => {
    setImportingProvider(provider.provider);
    try {
      const snapshot = await authService.import(provider.provider);
      if (snapshot) setAuth(snapshot);
      showToast(t("settings.models.inherit.imported", { name: provider.label }));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("settings.models.inherit.importFailed"));
    } finally {
      setImportingProvider(null);
    }
  };

  const openCreateForm = (): void => {
    setDialogCredential(null);
    setDialogOpen(true);
  };

  const openEditForm = (credential: PiAuthProviderStatus): void => {
    setDialogCredential(credential);
    setDialogOpen(true);
  };

  /** 校验已挪进对话框内联呈现；这里只管写盘、对账模型列表与提示结果。 */
  const saveCredential = async (req: PiAuthUpsertRequest): Promise<void> => {
    setDialogSaving(true);
    try {
      const snapshot = await authService.upsert(req);
      if (snapshot) setAuth(snapshot);
      setDialogOpen(false);
      showToast(
        req.id
          ? t("settings.models.credential.updated", { name: req.name })
          : t("settings.models.credential.added", { name: req.name }),
      );
      void refreshModelsForActive();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("settings.models.credential.saveFailed"));
    } finally {
      setDialogSaving(false);
    }
  };

  // ---------------------------------------------------------------------
  // 模型能力（docs/design/50）：即改即存 + 主进程写盘后自动重载存活会话
  // ---------------------------------------------------------------------

  const previousOverrideRows = useRef<ModelOverrideRow[]>([]);
  const overrideRows = useMemo(() => {
    const next = reuseModelOverrideRows(
      buildModelOverrideRows(models, overrides, selectedKey),
      previousOverrideRows.current,
    );
    previousOverrideRows.current = next;
    return next;
  }, [models, overrides, selectedKey]);

  const saveOverride = useCallback(
    async (row: ModelOverrideRow, patch: PiModelOverridePatch): Promise<void> => {
      const key = `${row.provider}/${row.modelId}`;
      setSavingOverrideKey(key);
      try {
        const result = await modelOverridesService.set({
          provider: row.provider,
          modelId: row.modelId,
          patch,
        });
        const snapshot = await modelOverridesService.get();
        setOverrides(snapshot);
        if (result.reloaded > 0) showToast(t("settings.models.overrides.savedLive"));
        else if (result.failed > 0) showToast(t("settings.models.overrides.savedBusy"));
        else showToast(t("settings.models.overrides.savedIdle"));
        // 生效值来自 pi（主进程已重载存活会话）；存活路径极快，后台静默刷新。
        // 不能 await：无存活会话时 getModels 会短连 pi（实测 ~1s），会拖到浮层关闭之后。
        void sessionService
          .getModels()
          .then((list) => {
            if (list.length === 0) return;
            const filtered = activeProviderId
              ? list.filter((m) => m.provider === activeProviderId)
              : list;
            setModels(filtered);
            // 只有改思考档位时才动输入栏；空态/冷会话没有存活实例可问，直接同步
            if (row.isDefault && patch.thinkingLevels !== undefined) {
              const updated = filtered.find(
                (m) => m.provider === row.provider && m.modelId === row.modelId,
              );
              const levels = updated?.availableThinkingLevels;
              if (levels && levels.length > 0) {
                syncThinkingState(clampThinkingLevel(getComposerThinkingLevel(), levels), levels);
              }
            }
          })
          .catch(() => {
            // 模型清单刷新失败不影响写盘结果；保留旧列表
          });
        // 存活会话以 pi 的 get_state 为准（可能 clamp 当前档位）
        void refreshModelState();
      } catch (error) {
        showToast(
          error instanceof Error && error.message
            ? error.message
            : t("settings.models.overrides.saveFailed"),
        );
      } finally {
        setSavingOverrideKey(null);
      }
    },
    [t, activeProviderId, showToast, syncThinkingState, refreshModelState],
  );

  const modelTriggerLabel = selectedKey || modelLabel || t("settings.models.selectModel");

  // 列表已有模型时，后台刷新（loadingModels 翻转）不该重建上百个条目与图标
  const modelMenuState: "ready" | "loading" | "empty" =
    models.length > 0 ? "ready" : loadingModels ? "loading" : "empty";

  const modelMenuItems: MenuItem[] = useMemo(() => {
    if (modelMenuState !== "ready") {
      const loading = modelMenuState === "loading";
      return [
        {
          key: loading ? "__loading" : "__empty",
          label: t(loading ? "settings.models.loading" : "settings.models.empty"),
          disabled: true,
        },
      ];
    }
    return models.map((model) => {
      const key = `${model.provider}/${model.modelId}`;
      return {
        key,
        label: model.label,
        icon: <AiModelIcon provider={model.provider} modelId={model.modelId} size={16} />,
        hint: selectedKey === key ? t("settings.models.current") : undefined,
        onSelect: () => void applyModel(model),
      };
    });
  }, [modelMenuState, models, selectedKey, applyModel, t]);

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
                    <GlideChevron size={14} />
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
                    {credential.origin === "pi" && (
                      <span className={styles.authOriginBadge}>
                        {t("settings.models.credential.originPiBadge")}
                      </span>
                    )}
                    {credential.sourceMissing && (
                      <span className={styles.authMissingBadge}>
                        {t("settings.models.credential.sourceMissingBadge")}
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
                    <Button
                      className={styles.authIconBtn}
                      disabled={credential.sourceMissing}
                      title={t("settings.models.credential.activate")}
                      aria-label={t("settings.models.credential.activate")}
                      onClick={() => void activateCredential(credential.id, credential.name)}
                    >
                      <Lightning size={16} weight="regular" />
                    </Button>
                  )}
                  {credential.origin !== "pi" && (
                    <Button
                      className={styles.authIconBtn}
                      title={t("settings.models.credential.edit")}
                      aria-label={t("settings.models.credential.edit")}
                      onClick={() => openEditForm(credential)}
                    >
                      <PencilSimple size={16} weight="regular" />
                    </Button>
                  )}
                  <Button
                    className={styles.authIconBtn}
                    variant="danger"
                    title={t("common.remove")}
                    aria-label={t("common.remove")}
                    onClick={() => setPendingRemove(credential)}
                  >
                    <Trash size={16} weight="regular" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.modelEmpty}>{t("settings.models.credential.empty")}</p>
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

      {auth && auth.importable.length > 0 && (
        <SettingsSection title={t("settings.models.inherit.title")}>
          <p className={styles.authHint}>{t("settings.models.inherit.description")}</p>
          <div className={styles.authList}>
            {auth.importable.map((provider) => (
              <div key={provider.provider} className={styles.authRow}>
                <AiProviderLogo providerId={provider.provider} size={22} />
                <div className={styles.authRowMain}>
                  <div className={styles.authIdLine}>
                    <span className={styles.authId}>{provider.label}</span>
                    {provider.expired && (
                      <span className={styles.authExpiredBadge}>
                        {t("settings.models.credential.expired")}
                      </span>
                    )}
                  </div>
                  <span className={styles.authMeta}>
                    {provider.provider}
                    {provider.kind === "api_key"
                      ? " · API Key"
                      : provider.kind === "oauth"
                        ? " · OAuth"
                        : ""}
                    {provider.maskedCredential ? ` · ${provider.maskedCredential}` : ""}
                  </span>
                </div>
                <div className={styles.authActions}>
                  <Button
                    disabled={importingProvider === provider.provider}
                    onClick={() => void importProvider(provider)}
                  >
                    {t("settings.models.inherit.import")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </SettingsSection>
      )}

      <ModelOverridesSection
        rows={overrideRows}
        loading={loadingModels}
        savingKey={savingOverrideKey}
        onSave={saveOverride}
      />

      <CredentialDialog
        open={dialogOpen}
        credential={dialogCredential}
        providers={apiKeyProviders}
        gatewayByProvider={providerGatewayMap}
        activeProviderId={activeProviderId}
        activeModels={models}
        busy={dialogSaving}
        onClose={() => setDialogOpen(false)}
        onSubmit={saveCredential}
      />

      <ConfirmDialog
        open={pendingRemove !== null}
        nested
        tone="danger"
        busy={removing}
        busyLabel={t("settings.models.credential.removing")}
        title={t("settings.models.credential.removeConfirm.title")}
        confirmLabel={t("common.remove")}
        message={
          pendingRemove
            ? t(
                pendingRemove.origin === "pi"
                  ? "settings.models.credential.removeConfirm.inherited"
                  : "settings.models.credential.removeConfirm.message",
                { name: pendingRemove.name },
              )
            : ""
        }
        onConfirm={() => {
          if (pendingRemove) void removeCredential(pendingRemove);
        }}
        onCancel={() => setPendingRemove(null)}
      />
    </div>
  );
}
