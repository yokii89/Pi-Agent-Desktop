import { Globe, MagnifyingGlass, TerminalWindow, X } from "@phosphor-icons/react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { McpMarketEntry, McpServerEntry } from "../../../shared/ipc";
import { useT } from "../../hooks/useT";
import { mcpService } from "../../services/mcpService";
import { useUiStore } from "../../stores/uiStore";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import styles from "./McpMarketDialog.module.css";

/** 市场一键添加的预填载荷：进现有编辑对话框（add 语义 + 字段预填）。 */
export interface McpMarketPrefill {
  name: string;
  config: McpServerEntry;
}

interface McpMarketDialogProps {
  open: boolean;
  /** 已配置条目（含市场已添加判定）。 */
  existing: Array<{ name: string; config: McpServerEntry }>;
  onClose: () => void;
  onAdd: (prefill: McpMarketPrefill) => void;
}

const SEARCH_DEBOUNCE_MS = 400;

/** stdio 参数命中包标识符：精确相等、npm 锁版本 `pkg@x.y` 或 pypi `pkg==x.y`。 */
function argsMatchPackage(args: string[], matchKey: string): boolean {
  return args.some(
    (arg) => arg === matchKey || arg.startsWith(`${matchKey}@`) || arg.startsWith(`${matchKey}==`),
  );
}

/** 已添加判定：建议名命中、url 相等或 stdio 包标识符出现在命令参数里。 */
function isEntryAdded(entry: McpMarketEntry, existing: McpMarketDialogProps["existing"]): boolean {
  return existing.some(({ name, config }) => {
    if (name === entry.suggestName) return true;
    if (entry.template.kind === "http") return config.url === entry.template.matchKey;
    return argsMatchPackage(config.args ?? [], entry.template.matchKey);
  });
}

/** 建议名与现有条目冲突时追加 -2 / -3… */
function dedupeName(base: string, existing: McpMarketDialogProps["existing"]): string {
  const taken = new Set(existing.map(({ name }) => name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** 模板 → 预填配置：env 带注册表默认值（密钥除外），headers 静态值保留；
 * 其余值留空由用户填写，编辑对话框保存时空值行丢弃。 */
function buildPrefillConfig(entry: McpMarketEntry): McpServerEntry {
  const config: McpServerEntry = { enabled: true, exposure: "codemode" };
  if (entry.template.kind === "stdio") {
    config.command = entry.template.command;
    config.args = entry.template.args;
    const env = (entry.template.env ?? []).reduce<Record<string, string>>((acc, item) => {
      acc[item.name] = item.isSecret ? "" : (item.defaultValue ?? "");
      return acc;
    }, {});
    if (Object.keys(env).length > 0) config.env = env;
  } else {
    config.url = entry.template.url;
    const headers = (entry.template.headers ?? []).reduce<Record<string, string>>((acc, item) => {
      // 含 {placeholder} 模板的值不预填，避免占位符被原样写进配置
      acc[item.name] = item.value && !item.value.includes("{") ? item.value : "";
      return acc;
    }, {});
    if (Object.keys(headers).length > 0) config.headers = headers;
  }
  return config;
}

function EnvVarChips({ entry }: { entry: McpMarketEntry }): ReactNode {
  const t = useT();
  const envVars = entry.template.env ?? [];
  const headers = entry.template.headers ?? [];
  if (envVars.length === 0 && headers.length === 0) return null;
  return (
    <div className={styles.detailBlock}>
      {envVars.length > 0 ? (
        <>
          <p className={styles.detailLabel}>{t("mcp.market.envVars")}</p>
          <div className={styles.chipRow}>
            {envVars.map((item) => (
              <span
                key={item.name}
                className={styles.envChip}
                title={item.description ?? item.name}
              >
                {item.name}
                {item.isRequired ? (
                  <em className={styles.chipMark}>{t("mcp.market.required")}</em>
                ) : null}
                {item.isSecret ? (
                  <em className={styles.chipMarkSecret}>{t("mcp.market.secret")}</em>
                ) : null}
              </span>
            ))}
          </div>
        </>
      ) : null}
      {headers.length > 0 ? (
        <>
          <p className={styles.detailLabel}>{t("mcp.market.headers")}</p>
          <div className={styles.chipRow}>
            {headers.map((item) => (
              <span
                key={item.name}
                className={styles.envChip}
                title={item.description ?? item.name}
              >
                {item.name}
              </span>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function MarketRow({
  entry,
  existing,
  onAdd,
}: {
  entry: McpMarketEntry;
  existing: McpMarketDialogProps["existing"];
  onAdd: McpMarketDialogProps["onAdd"];
}) {
  const t = useT();
  const { locale } = useUiStore();
  const [expanded, setExpanded] = useState(false);
  const added = isEntryAdded(entry, existing);
  const description =
    locale === "zh-CN" ? (entry.descriptionZh ?? entry.description) : entry.description;
  return (
    <div className={styles.row}>
      <div className={styles.rowHeader}>
        <span className={styles.rowName} title={entry.id}>
          {entry.title ?? entry.suggestName}
        </span>
        <span
          className={styles.kindBadge}
          title={entry.template.kind === "stdio" ? entry.template.command : entry.template.url}
        >
          {entry.template.kind === "stdio" ? (
            <TerminalWindow size={14} weight="regular" />
          ) : (
            <Globe size={14} weight="regular" />
          )}
          {entry.template.kind === "stdio" ? t("mcp.market.kindStdio") : t("mcp.market.kindHttp")}
        </span>
        {entry.needsUv ? <span className={styles.uvBadge}>{t("mcp.market.needsUv")}</span> : null}
        {added ? <span className={styles.addedBadge}>{t("mcp.market.added")}</span> : null}
        <span className={styles.rowSpacer} />
        <button
          type="button"
          className={styles.detailToggle}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {t("mcp.market.detail")}
        </button>
        {!added ? (
          <Button
            onClick={() =>
              onAdd({
                name: dedupeName(entry.suggestName, existing),
                config: buildPrefillConfig(entry),
              })
            }
          >
            {t("mcp.market.add")}
          </Button>
        ) : null}
      </div>
      <p className={styles.rowDesc}>{description}</p>
      {expanded ? (
        <div className={styles.rowDetail}>
          <div className={styles.detailBlock}>
            {entry.template.kind === "stdio" ? (
              <p className={styles.commandLine}>
                {entry.template.command} {(entry.template.args ?? []).join(" ")}
              </p>
            ) : (
              <p className={styles.commandLine}>{entry.template.url}</p>
            )}
            {entry.version ? <p className={styles.detailMeta}>v{entry.version}</p> : null}
            {entry.repositoryUrl ? (
              <a
                className={styles.repoLink}
                href={entry.repositoryUrl}
                target="_blank"
                rel="noreferrer"
              >
                {entry.repositoryUrl}
              </a>
            ) : null}
          </div>
          <EnvVarChips entry={entry} />
        </div>
      ) : null}
    </div>
  );
}

/** MCP 市场（docs/design/41）：精选清单 + 官方注册表搜索，添加走预填编辑对话框。 */
export function McpMarketDialog({ open, existing, onClose, onAdd }: McpMarketDialogProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [entries, setEntries] = useState<McpMarketEntry[]>([]);
  const [source, setSource] = useState<"curated" | "registry">("curated");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 请求序号：防抖/翻页竞态时只采纳最后一次请求的结果。 */
  const requestSeq = useRef(0);
  /** 最近一次精选清单：在线搜索失败时回退展示（错误文案引导用户从精选添加）。 */
  const curatedRef = useRef<McpMarketEntry[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  // 打开即聚焦搜索框（父组件 effect 晚于 Modal 的面板聚焦，覆盖生效）
  useEffect(() => {
    if (open) searchInputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    mcpService
      .marketSearch({ query: debouncedQuery })
      .then((result) => {
        if (seq !== requestSeq.current) return;
        setEntries(result.entries);
        setSource(result.source);
        setNextCursor(result.nextCursor);
        if (result.source === "curated") curatedRef.current = result.entries;
      })
      .catch((err) => {
        if (seq !== requestSeq.current) return;
        setNextCursor(null);
        setError(err instanceof Error ? err.message : String(err));
        // 在线搜索失败：回退精选清单（本地不出网，不会失败）
        setEntries(curatedRef.current);
        setSource("curated");
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [open, debouncedQuery]);

  // 关闭后清空搜索态，下次打开回到精选首屏
  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebouncedQuery("");
      setEntries([]);
      setSource("curated");
      setNextCursor(null);
      setError(null);
    }
  }, [open]);

  const loadMore = useCallback((): void => {
    if (!nextCursor || loadingMore) return;
    const seq = ++requestSeq.current;
    setLoadingMore(true);
    mcpService
      .marketSearch({ query: debouncedQuery, cursor: nextCursor })
      .then((result) => {
        if (seq !== requestSeq.current) return;
        setEntries((prev) => [...prev, ...result.entries]);
        setNextCursor(result.nextCursor);
      })
      .catch((err) => {
        if (seq !== requestSeq.current) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoadingMore(false);
      });
  }, [debouncedQuery, loadingMore, nextCursor]);

  const hasResults = !loading && entries.length > 0;
  const showEmpty = !loading && !error && entries.length === 0;
  const sectionLabel = useMemo(
    () => (source === "curated" ? t("mcp.market.featured") : t("mcp.market.searchResults")),
    [source, t],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel={t("mcp.market.title")}
      panelClassName={styles.panel}
    >
      <div className={styles.body}>
        <h2 className={styles.title}>{t("mcp.market.title")}</h2>
        <p className={styles.subtitle}>{t("mcp.market.subtitle")}</p>

        <div className={styles.searchRow}>
          <MagnifyingGlass size={16} weight="regular" />
          <input
            ref={searchInputRef}
            className={styles.searchInput}
            value={query}
            aria-label={t("mcp.market.searchPlaceholder")}
            placeholder={t("mcp.market.searchPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              className={styles.clearButton}
              aria-label={t("common.cancel")}
              onClick={() => setQuery("")}
            >
              <X size={14} weight="regular" />
            </button>
          ) : null}
        </div>

        <div className={styles.list}>
          {hasResults ? <p className={styles.sectionLabel}>{sectionLabel}</p> : null}
          {loading ? <p className={styles.stateLine}>{t("mcp.market.searching")}</p> : null}
          {error ? (
            <div className={styles.errorLine}>
              <p>{t("mcp.market.error", { error })}</p>
            </div>
          ) : null}
          {showEmpty ? <p className={styles.stateLine}>{t("mcp.market.empty")}</p> : null}
          {entries.map((entry) => (
            <MarketRow key={entry.id} entry={entry} existing={existing} onAdd={onAdd} />
          ))}
          {nextCursor && !loading ? (
            <button
              type="button"
              className={styles.loadMore}
              disabled={loadingMore}
              onClick={loadMore}
            >
              {loadingMore ? t("mcp.market.loadingMore") : t("mcp.market.loadMore")}
            </button>
          ) : null}
        </div>

        <div className={styles.actions}>
          <Button onClick={onClose}>{t("common.close")}</Button>
        </div>
      </div>
    </Modal>
  );
}
