import { Eye, EyeSlash, X } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type {
  PiApiKeyProviderOption,
  PiAuthProviderStatus,
  PiAuthUpsertRequest,
  PiModelOption,
} from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { AiProviderLogo } from "../AiIcons/AiProviderLogo";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Modal } from "../ui/Modal";
import { Select, type SelectOption } from "../ui/Select";
import styles from "./CredentialDialog.module.css";

interface CredentialDialogProps {
  open: boolean;
  /** null = 新增。 */
  credential: PiAuthProviderStatus | null;
  /** 可选厂商清单（含网关标记）。 */
  providers: readonly PiApiKeyProviderOption[];
  /** provider id → 是否网关类。 */
  gatewayByProvider: ReadonlyMap<string, boolean>;
  /**
   * 当前激活厂商与它的模型清单。
   * 模型列表按激活厂商取（newapi 也不例外，否则混出别的厂商的模型），
   * 所以给非激活厂商填偏好模型时没有列表可用，字段自动退成手动输入。
   */
  activeProviderId: string | null;
  activeModels: readonly PiModelOption[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (req: PiAuthUpsertRequest) => Promise<void>;
}

type FieldErrors = Partial<Record<"name" | "apiKey" | "baseUrl", string>>;

/** 空列表的稳定引用：每次渲染新建数组会让下游 memo 白算一遍。 */
const NO_MODELS: readonly PiModelOption[] = [];

/** 字段壳：label 在上、控件居中、报错在下（不再放说明句）。 */
function Field({
  label,
  htmlFor,
  requiredText,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  /** 传了才显示「必填」徽章（不必填的字段不传）。 */
  requiredText?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.field} data-invalid={error ? "true" : undefined}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
        {requiredText && <span className={styles.req}>{requiredText}</span>}
      </label>
      {children}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}

/**
 * 凭据新增 / 编辑对话框（docs/design/128）：叠在设置浮窗之上的二级浮窗。
 * 取代原先挤在列表下方一行里的内嵌表单——字段立起 label、单列铺开，网关项按需展开。
 * 校验从 toast 改成贴着字段内联；保存 ≠ 激活的语义不变，由 footer 一句话说明。
 */
export function CredentialDialog({
  open,
  credential,
  providers,
  gatewayByProvider,
  activeProviderId,
  activeModels,
  busy,
  onClose,
  onSubmit,
}: CredentialDialogProps) {
  const t = useT();
  const isCreate = credential === null;

  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [revealKey, setRevealKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiType, setApiType] = useState("openai-completions");
  const [preferredModel, setPreferredModel] = useState("");
  const [manualModel, setManualModel] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (!open) return;
    setName(credential?.name ?? "");
    setProvider(credential?.provider ?? providers[0]?.id ?? "anthropic");
    setApiKey("");
    setRevealKey(false);
    setBaseUrl(credential?.baseUrl ?? "");
    setApiType(credential?.api === "openai-responses" ? "openai-responses" : "openai-completions");
    setPreferredModel(credential?.preferredModel ?? "");
    setManualModel(false);
    setErrors({});
  }, [open, credential, providers]);

  const isGateway = gatewayByProvider.get(provider) === true;

  const providerOptions = useMemo(
    () =>
      providers.map((option) => ({
        value: option.id,
        label: option.label,
        icon: <AiProviderLogo providerId={option.id} size={16} />,
        hint:
          option.gateway === true ? t("settings.models.credential.gatewayOptionHint") : undefined,
      })),
    [providers, t],
  );

  const handleProviderChange = (next: string): void => {
    setProvider(next);
    if (gatewayByProvider.get(next) !== true) {
      setBaseUrl("");
      setApiType("openai-completions");
    }
    // 换厂商后模型列表的可用性变了，形态要重判
    setManualModel(false);
    setErrors((current) => (current.baseUrl ? { ...current, baseUrl: undefined } : current));
    // 新建时名称留空则跟随厂商名
    if (isCreate && !name.trim()) {
      const label = providers.find((option) => option.id === next)?.label;
      if (label) setName(label);
    }
  };

  /** 可做偏好的模型：只有表单厂商 = 激活厂商时才有列表。 */
  const modelChoices = useMemo(
    () => (provider === activeProviderId ? activeModels : NO_MODELS),
    [provider, activeProviderId, activeModels],
  );
  const useModelPicker = modelChoices.length > 0 && !manualModel;

  const modelOptions = useMemo<SelectOption[]>(() => {
    const rows = modelChoices.map((model) => ({ value: model.modelId, label: model.label }));
    const current = preferredModel.trim();
    if (current && !rows.some((row) => row.value === current)) {
      rows.unshift({ value: current, label: current });
    }
    return [{ value: "", label: t("settings.models.credential.modelNone") }, ...rows];
  }, [modelChoices, preferredModel, t]);

  const submit = (): void => {
    const nextErrors: FieldErrors = {};
    if (!name.trim()) nextErrors.name = t("settings.models.credential.nameRequired");
    if (isCreate && !apiKey.trim()) {
      nextErrors.apiKey = t("settings.models.credential.apiKeyRequired");
    }
    if (isGateway && isCreate && !baseUrl.trim()) {
      nextErrors.baseUrl = t("settings.models.credential.baseUrlRequired");
    }
    setErrors(nextErrors);
    if (Object.values(nextErrors).some((message) => Boolean(message))) return;

    void onSubmit({
      id: credential?.id ?? null,
      name: name.trim(),
      provider,
      apiKey: apiKey.trim() || null,
      preferredModel: preferredModel.trim(),
      ...(isGateway ? { baseUrl: baseUrl.trim() || null, api: apiType } : {}),
    });
  };

  const title = isCreate
    ? t("settings.models.credential.create")
    : t("settings.models.credential.editTitle", { name: credential.name });

  return (
    <Modal open={open} onClose={onClose} ariaLabel={title} panelClassName={styles.panel} nested>
      <header className={styles.head}>
        <div className={styles.headMain}>
          <h2 className={styles.title}>{title}</h2>
        </div>
        <IconButton title={t("common.close")} onClick={onClose}>
          <X size={18} weight="regular" />
        </IconButton>
      </header>

      <div className={styles.body}>
        <Field
          label={t("settings.models.credential.nameLabel")}
          htmlFor="credential-name"
          requiredText={t("settings.models.credential.required")}
          error={errors.name}
        >
          <input
            id="credential-name"
            className={styles.input}
            type="text"
            autoComplete="off"
            placeholder={t("settings.models.credential.namePlaceholder")}
            value={name}
            disabled={busy}
            onChange={(event) => {
              setName(event.target.value);
              setErrors((current) => ({ ...current, name: undefined }));
            }}
          />
        </Field>

        <Field
          label={t("settings.models.credential.providerLabel")}
          htmlFor={isCreate ? "credential-provider" : undefined}
        >
          {isCreate ? (
            <Select
              id="credential-provider"
              className={styles.select}
              value={provider}
              options={providerOptions}
              ariaLabel={t("settings.models.credential.providerLabel")}
              matchTriggerWidth
              disabled={busy}
              onChange={handleProviderChange}
            />
          ) : (
            <span className={styles.fixed}>
              <AiProviderLogo providerId={credential.provider} size={16} />
              <span className={styles.mono}>{credential.provider}</span>
              <span className={styles.fixedKind}>
                {credential.kind === "oauth" ? "OAuth" : "API Key"}
              </span>
            </span>
          )}
        </Field>

        <Field
          label={t("settings.models.credential.apiKeyLabel")}
          htmlFor="credential-key"
          requiredText={isCreate ? t("settings.models.credential.required") : undefined}
          error={errors.apiKey}
        >
          <div className={styles.keyWrap}>
            <input
              id="credential-key"
              className={[styles.input, styles.keyInput].join(" ")}
              type={revealKey ? "text" : "password"}
              autoComplete="off"
              placeholder={t("settings.models.credential.apiKeyPlaceholder")}
              value={apiKey}
              disabled={busy}
              onChange={(event) => {
                setApiKey(event.target.value);
                setErrors((current) => ({ ...current, apiKey: undefined }));
              }}
            />
            <IconButton
              className={styles.keyToggle}
              title={
                revealKey
                  ? t("settings.models.credential.apiKeyHide")
                  : t("settings.models.credential.apiKeyReveal")
              }
              onClick={() => setRevealKey((current) => !current)}
            >
              {revealKey ? (
                <EyeSlash size={16} weight="regular" />
              ) : (
                <Eye size={16} weight="regular" />
              )}
            </IconButton>
          </div>
        </Field>

        {isGateway && (
          <div className={styles.grid}>
            <Field
              label={t("settings.models.credential.baseUrlLabel")}
              htmlFor="credential-base-url"
              requiredText={isCreate ? t("settings.models.credential.required") : undefined}
              error={errors.baseUrl}
            >
              <input
                id="credential-base-url"
                className={[styles.input, styles.mono].join(" ")}
                type="text"
                autoComplete="off"
                placeholder={t("settings.models.credential.baseUrlPlaceholder")}
                value={baseUrl}
                disabled={busy}
                onChange={(event) => {
                  setBaseUrl(event.target.value);
                  setErrors((current) => ({ ...current, baseUrl: undefined }));
                }}
              />
            </Field>
            <Field label={t("settings.models.credential.apiTypeLabel")} htmlFor="credential-api">
              <Select
                id="credential-api"
                className={styles.select}
                value={apiType}
                ariaLabel={t("settings.models.credential.apiTypeLabel")}
                matchTriggerWidth
                disabled={busy}
                options={[
                  { value: "openai-completions", label: "openai-completions" },
                  { value: "openai-responses", label: "openai-responses" },
                ]}
                onChange={setApiType}
              />
            </Field>
          </div>
        )}

        <Field label={t("settings.models.credential.modelLabel")} htmlFor="credential-model">
          {useModelPicker ? (
            <div className={styles.modelRow}>
              <Select
                id="credential-model"
                className={[styles.select, styles.grow].join(" ")}
                value={preferredModel}
                ariaLabel={t("settings.models.credential.modelLabel")}
                matchTriggerWidth
                disabled={busy}
                options={modelOptions}
                placeholder={t("settings.models.credential.modelNone")}
                onChange={setPreferredModel}
              />
              <button type="button" className={styles.linkBtn} onClick={() => setManualModel(true)}>
                {t("settings.models.credential.modelManual")}
              </button>
            </div>
          ) : (
            <div className={styles.modelRow}>
              <input
                id="credential-model"
                className={[styles.input, styles.mono, styles.grow].join(" ")}
                type="text"
                autoComplete="off"
                placeholder={t("settings.models.credential.preferredModelPlaceholder")}
                value={preferredModel}
                disabled={busy}
                onChange={(event) => setPreferredModel(event.target.value)}
              />
              {modelChoices.length > 0 && (
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => setManualModel(false)}
                >
                  {t("settings.models.credential.modelFromList")}
                </button>
              )}
            </div>
          )}
        </Field>
      </div>

      <footer className={styles.foot}>
        <p className={styles.footNote}>{t("settings.models.credential.footerNote")}</p>
        <div className={styles.actions}>
          <Button disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={busy} onClick={submit}>
            {busy ? t("settings.models.credential.saving") : t("settings.models.credential.save")}
          </Button>
        </div>
      </footer>
    </Modal>
  );
}
