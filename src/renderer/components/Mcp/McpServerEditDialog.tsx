import { useEffect, useState } from "react";
import type {
  McpExposure,
  McpOAuthEntry,
  McpSaveServerRequest,
  McpServerEntry,
} from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Modal } from "../ui/Modal";
import { Toggle } from "../ui/Toggle";
import styles from "./McpServerEditDialog.module.css";

/** 编辑目标：name + 当前配置；add 模式下为 null。 */
export interface McpEditTarget {
  name: string;
  config: McpServerEntry;
}

interface McpServerEditDialogProps {
  open: boolean;
  /** null = 新增。 */
  initial: McpEditTarget | null;
  /**
   * 市场预填（docs/design/41）：add 语义（previousName = null、标题为「添加」），
   * 但字段与名称用模板带出的默认值；与 initial 互斥使用。
   */
  prefill?: { name: string; config: McpServerEntry } | null;
  busy: boolean;
  /** 主进程校验失败等信息。 */
  error: string | null;
  onClose: () => void;
  onSubmit: (req: McpSaveServerRequest) => void;
}

/** server 名规则（对齐 pi core/mcp-servers.ts）。 */
const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

const EXPOSURES: readonly McpExposure[] = ["codemode", "deferred", "direct", "hidden"];

/** 非空行列表（args 用）。 */
function parseLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** KEY=VALUE / KEY: VALUE 行列表 → 记录（env / headers 用）。值为空的行跳过：
 * 市场预填的未填变量、或编辑中清空的行都不应写进 mcp.json。 */
function parseKeyValueLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of parseLines(text)) {
    const colon = line.indexOf(":");
    const eq = line.indexOf("=");
    const idx = colon >= 0 && (eq < 0 || colon < eq) ? colon : eq;
    if (idx <= 0) continue;
    const value = line.slice(idx + 1).trim();
    if (!value) continue;
    out[line.slice(0, idx).trim()] = value;
  }
  return out;
}

/** 环境变量 / 工作目录 / 超时都是低频字段：已有值时折叠区默认展开（编辑不被藏住）。 */
function hasAdvancedContent(config: McpServerEntry | undefined): boolean {
  if (!config) return false;
  const envFilled = Boolean(config.env && Object.keys(config.env).length > 0);
  return envFilled || Boolean(config.cwd) || config.timeout !== undefined;
}

/** MCP server 编辑 / 新增对话框（写用户级 mcp.json）。 */
export function McpServerEditDialog({
  open,
  initial,
  prefill = null,
  busy,
  error,
  onClose,
  onSubmit,
}: McpServerEditDialogProps) {
  const t = useT();
  const [name, setName] = useState("");
  // 错误视觉从首次输入才开始：空表单一打开就标红像出了错（docs/design/40 优化 4）
  const [nameTouched, setNameTouched] = useState(false);
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [envText, setEnvText] = useState("");
  const [cwd, setCwd] = useState("");
  const [url, setUrl] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [oauthCallbackPort, setOauthCallbackPort] = useState("");
  const [oauthScope, setOauthScope] = useState("");
  const [oauthClientName, setOauthClientName] = useState("");
  const [description, setDescription] = useState("");
  const [exposure, setExposure] = useState<McpExposure>("codemode");
  const [timeoutText, setTimeoutText] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // 切换传输方式且另一侧已填内容时先确认：保存只保留当前传输方式的字段（docs/design/40 优化 12）
  const [pendingTransport, setPendingTransport] = useState<"stdio" | "http" | null>(null);

  useEffect(() => {
    if (!open) return;
    // 编辑（initial）与市场预填（prefill）共用装载逻辑；预填保持 add 语义
    const config = initial?.config ?? prefill?.config;
    setName(initial?.name ?? prefill?.name ?? "");
    setNameTouched(false);
    setTransport(config?.url ? "http" : "stdio");
    setCommand(config?.command ?? "");
    setArgsText((config?.args ?? []).join("\n"));
    setEnvText(
      Object.entries(config?.env ?? {})
        .map(([key, value]) => `${key}=${value}`)
        .join("\n"),
    );
    setCwd(config?.cwd ?? "");
    setUrl(config?.url ?? "");
    setHeadersText(
      Object.entries(config?.headers ?? {})
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n"),
    );
    const oauth = config?.oauth ?? {};
    setOauthClientId(typeof oauth.clientId === "string" ? oauth.clientId : "");
    setOauthClientSecret(typeof oauth.clientSecret === "string" ? oauth.clientSecret : "");
    setOauthCallbackPort(typeof oauth.callbackPort === "number" ? String(oauth.callbackPort) : "");
    setOauthScope(typeof oauth.scope === "string" ? oauth.scope : "");
    setOauthClientName(typeof oauth.clientName === "string" ? oauth.clientName : "");
    setDescription(config?.description ?? "");
    setExposure(config?.exposure ?? "codemode");
    setTimeoutText(config?.timeout !== undefined ? String(config.timeout) : "");
    setEnabled(config?.enabled !== false);
    setAdvancedOpen(hasAdvancedContent(config));
    setPendingTransport(null);
  }, [open, initial, prefill]);

  const nameValid = NAME_PATTERN.test(name.trim());
  const primaryFilled =
    transport === "stdio"
      ? command.trim().length > 0
      : url.trim().length > 0 && /^https?:\/\//.test(url.trim());
  const canSubmit = nameValid && primaryFilled && !busy;

  const stdioFilled =
    command.trim() !== "" || argsText.trim() !== "" || envText.trim() !== "" || cwd.trim() !== "";
  const httpFilled =
    url.trim() !== "" ||
    headersText.trim() !== "" ||
    oauthClientId.trim() !== "" ||
    oauthClientSecret.trim() !== "" ||
    oauthCallbackPort.trim() !== "" ||
    oauthScope.trim() !== "" ||
    oauthClientName.trim() !== "";

  const requestTransport = (next: "stdio" | "http"): void => {
    if (next === transport) return;
    const otherSideFilled = transport === "stdio" ? httpFilled : stdioFilled;
    if (otherSideFilled) {
      setPendingTransport(next);
      return;
    }
    setTransport(next);
  };

  /** 将被丢弃字段的清单（确认文案用）；当前传输侧已填写的才列出。 */
  const pendingFieldLabels = (): string => {
    const parts: string[] = [];
    if (transport === "stdio") {
      if (command.trim()) parts.push(t("mcp.edit.command"));
      if (argsText.trim()) parts.push(t("mcp.edit.args"));
      if (envText.trim()) parts.push(t("mcp.edit.env"));
      if (cwd.trim()) parts.push(t("mcp.edit.cwd"));
    } else {
      if (url.trim()) parts.push(t("mcp.edit.url"));
      if (headersText.trim()) parts.push(t("mcp.edit.headers"));
      if (
        oauthClientId.trim() ||
        oauthClientSecret.trim() ||
        oauthCallbackPort.trim() ||
        oauthScope.trim() ||
        oauthClientName.trim()
      ) {
        parts.push(t("mcp.edit.oauthSection"));
      }
    }
    return parts.join(" · ");
  };

  const buildEntry = (): McpServerEntry => {
    const entry: McpServerEntry = { enabled, exposure };
    const desc = description.trim();
    if (desc) entry.description = desc;
    const timeout = Number(timeoutText);
    if (timeoutText.trim() !== "" && Number.isFinite(timeout) && timeout > 0)
      entry.timeout = timeout;
    if (transport === "stdio") {
      entry.command = command.trim();
      const args = parseLines(argsText);
      if (args.length > 0) entry.args = args;
      const env = parseKeyValueLines(envText);
      if (Object.keys(env).length > 0) entry.env = env;
      const cwdTrimmed = cwd.trim();
      if (cwdTrimmed) entry.cwd = cwdTrimmed;
    } else {
      entry.url = url.trim();
      const headers = parseKeyValueLines(headersText);
      if (Object.keys(headers).length > 0) entry.headers = headers;
      const oauth: McpOAuthEntry = {};
      if (oauthClientId.trim()) oauth.clientId = oauthClientId.trim();
      if (oauthClientSecret.trim()) oauth.clientSecret = oauthClientSecret.trim();
      if (oauthScope.trim()) oauth.scope = oauthScope.trim();
      if (oauthClientName.trim()) oauth.clientName = oauthClientName.trim();
      const port = Number(oauthCallbackPort);
      if (oauthCallbackPort.trim() !== "" && Number.isInteger(port) && port >= 1 && port <= 65535) {
        oauth.callbackPort = port;
      }
      if (Object.keys(oauth).length > 0) entry.oauth = oauth;
    }
    return entry;
  };

  const submit = (): void => {
    if (!canSubmit) return;
    onSubmit({
      previousName: initial?.name ?? null,
      name: name.trim(),
      config: buildEntry(),
    });
  };

  return (
    <>
      <Modal
        open={open}
        // 传输切换确认弹在前面时挡住本对话框的 Escape / 遮罩关闭，避免连关两层
        onClose={busy || pendingTransport !== null ? () => {} : onClose}
        ariaLabel={initial ? t("mcp.edit.editTitle") : t("mcp.edit.addTitle")}
        panelClassName={styles.panel}
      >
        <div className={styles.body}>
          <h2 className={styles.title}>
            {initial ? t("mcp.edit.editTitle") : t("mcp.edit.addTitle")}
          </h2>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="mcp-name">
              {t("mcp.edit.name")}
            </label>
            <input
              id="mcp-name"
              className={[styles.input, nameTouched && !nameValid ? styles.inputInvalid : ""].join(
                " ",
              )}
              value={name}
              disabled={busy}
              placeholder={t("mcp.edit.namePlaceholder")}
              onChange={(event) => {
                setNameTouched(true);
                setName(event.target.value);
              }}
            />
            {nameTouched && !nameValid ? (
              <p className={styles.hint}>{t("mcp.edit.nameInvalid")}</p>
            ) : null}
          </div>

          <div className={styles.field}>
            <span className={styles.label}>{t("mcp.edit.transport")}</span>
            <div className={styles.transportRow}>
              <button
                type="button"
                className={[
                  styles.transportOption,
                  transport === "stdio" ? styles.transportOptionActive : "",
                ].join(" ")}
                disabled={busy}
                onClick={() => requestTransport("stdio")}
              >
                {t("mcp.edit.transport.stdio")}
              </button>
              <button
                type="button"
                className={[
                  styles.transportOption,
                  transport === "http" ? styles.transportOptionActive : "",
                ].join(" ")}
                disabled={busy}
                onClick={() => requestTransport("http")}
              >
                {t("mcp.edit.transport.http")}
              </button>
            </div>
          </div>

          {transport === "stdio" ? (
            <>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="mcp-command">
                  {t("mcp.edit.command")}
                </label>
                <input
                  id="mcp-command"
                  className={styles.input}
                  value={command}
                  disabled={busy}
                  placeholder={t("mcp.edit.commandPlaceholder")}
                  onChange={(event) => setCommand(event.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="mcp-args">
                  {t("mcp.edit.args")}
                </label>
                <textarea
                  id="mcp-args"
                  className={styles.textarea}
                  value={argsText}
                  disabled={busy}
                  rows={3}
                  placeholder={t("mcp.edit.argsHint")}
                  onChange={(event) => setArgsText(event.target.value)}
                />
              </div>
            </>
          ) : (
            <>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="mcp-url">
                  {t("mcp.edit.url")}
                </label>
                <input
                  id="mcp-url"
                  className={styles.input}
                  value={url}
                  disabled={busy}
                  placeholder={t("mcp.edit.urlPlaceholder")}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="mcp-headers">
                  {t("mcp.edit.headers")}
                </label>
                <textarea
                  id="mcp-headers"
                  className={styles.textarea}
                  value={headersText}
                  disabled={busy}
                  rows={2}
                  placeholder={t("mcp.edit.headersHint")}
                  onChange={(event) => setHeadersText(event.target.value)}
                />
              </div>
              <details className={styles.collapsible}>
                <summary className={styles.label}>{t("mcp.edit.oauthSection")}</summary>
                <div className={styles.collapsibleGrid}>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="mcp-oauth-client-id">
                      {t("mcp.edit.oauth.clientId")}
                    </label>
                    <input
                      id="mcp-oauth-client-id"
                      className={styles.input}
                      value={oauthClientId}
                      disabled={busy}
                      onChange={(event) => setOauthClientId(event.target.value)}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="mcp-oauth-client-secret">
                      {t("mcp.edit.oauth.clientSecret")}
                    </label>
                    <input
                      id="mcp-oauth-client-secret"
                      className={styles.input}
                      type="password"
                      value={oauthClientSecret}
                      disabled={busy}
                      onChange={(event) => setOauthClientSecret(event.target.value)}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="mcp-oauth-port">
                      {t("mcp.edit.oauth.callbackPort")}
                    </label>
                    <input
                      id="mcp-oauth-port"
                      className={styles.input}
                      type="number"
                      min={1}
                      max={65535}
                      value={oauthCallbackPort}
                      disabled={busy}
                      onChange={(event) => setOauthCallbackPort(event.target.value)}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="mcp-oauth-scope">
                      {t("mcp.edit.oauth.scope")}
                    </label>
                    <input
                      id="mcp-oauth-scope"
                      className={styles.input}
                      value={oauthScope}
                      disabled={busy}
                      placeholder={t("mcp.edit.oauth.scopePlaceholder")}
                      onChange={(event) => setOauthScope(event.target.value)}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="mcp-oauth-client-name">
                      {t("mcp.edit.oauth.clientName")}
                    </label>
                    <input
                      id="mcp-oauth-client-name"
                      className={styles.input}
                      value={oauthClientName}
                      disabled={busy}
                      onChange={(event) => setOauthClientName(event.target.value)}
                    />
                  </div>
                </div>
              </details>
            </>
          )}

          {/* 环境变量 / 工作目录 / 超时是低频字段：折叠进高级选项，首屏只留高频项（docs/design/40 优化 11） */}
          <details
            className={styles.collapsible}
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
          >
            <summary className={styles.label}>{t("mcp.edit.advancedSection")}</summary>
            <div className={styles.collapsibleGrid}>
              {transport === "stdio" ? (
                <>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="mcp-env">
                      {t("mcp.edit.env")}
                    </label>
                    <textarea
                      id="mcp-env"
                      className={styles.textarea}
                      value={envText}
                      disabled={busy}
                      rows={3}
                      placeholder={t("mcp.edit.envHint")}
                      onChange={(event) => setEnvText(event.target.value)}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="mcp-cwd">
                      {t("mcp.edit.cwd")}
                    </label>
                    <input
                      id="mcp-cwd"
                      className={styles.input}
                      value={cwd}
                      disabled={busy}
                      placeholder={t("mcp.edit.cwdPlaceholder")}
                      onChange={(event) => setCwd(event.target.value)}
                    />
                  </div>
                </>
              ) : null}
              <div className={styles.field}>
                <label className={styles.label} htmlFor="mcp-timeout">
                  {t("mcp.edit.timeout")}
                </label>
                <input
                  id="mcp-timeout"
                  className={styles.input}
                  type="number"
                  min={1}
                  value={timeoutText}
                  disabled={busy}
                  onChange={(event) => setTimeoutText(event.target.value)}
                />
              </div>
            </div>
          </details>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="mcp-exposure">
              {t("mcp.edit.exposure")}
            </label>
            <select
              id="mcp-exposure"
              className={styles.input}
              value={exposure}
              disabled={busy}
              onChange={(event) => setExposure(event.target.value as McpExposure)}
            >
              {EXPOSURES.map((value) => (
                <option key={value} value={value}>
                  {t(`mcp.exposure.${value}`)}
                </option>
              ))}
            </select>
            <p className={styles.hint}>{t(`mcp.exposure.${exposure}.hint`)}</p>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="mcp-description">
              {t("mcp.edit.description")}
            </label>
            <input
              id="mcp-description"
              className={styles.input}
              value={description}
              disabled={busy}
              placeholder={t("mcp.edit.descriptionPlaceholder")}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className={styles.field}>
            <span className={styles.label} id="mcp-enabled-label">
              {t("mcp.edit.enabled")}
            </span>
            <div className={styles.enabledRow}>
              <Toggle
                checked={enabled}
                disabled={busy}
                aria-labelledby="mcp-enabled-label"
                onChange={setEnabled}
              />
              <span className={styles.hint}>{t("mcp.edit.enabledHint")}</span>
            </div>
          </div>

          {error ? <p className={styles.errorBanner}>{error}</p> : null}

          <div className={styles.actions}>
            <Button disabled={busy} onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" disabled={!canSubmit} onClick={submit}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingTransport !== null}
        title={t("mcp.edit.switchTransport.title")}
        message={t("mcp.edit.switchTransport.message", { fields: pendingFieldLabels() })}
        confirmLabel={t("mcp.edit.switchTransport.confirm")}
        onConfirm={() => {
          if (pendingTransport) setTransport(pendingTransport);
          setPendingTransport(null);
        }}
        onCancel={() => setPendingTransport(null)}
      />
    </>
  );
}
