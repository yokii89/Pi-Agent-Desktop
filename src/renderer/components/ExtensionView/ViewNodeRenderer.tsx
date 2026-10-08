import { type KeyboardEvent, useId, useLayoutEffect, useRef, useState } from "react";
import type { ViewNode } from "../../../shared/view";
import { useT } from "../../hooks/useT";
import { MarkdownContent } from "../SessionArea/MarkdownContent";
import { Button } from "../ui/Button";
import {
  formatCell,
  resolveAlign,
  resolveColumnWeights,
  type TableAlign,
  truncationLabel,
  windowTableRows,
} from "./table-node";
import { type ActiveTabState, reconcileActiveTab, wrappedStep } from "./tabs-node";
import styles from "./ViewNodeRenderer.module.css";

export interface ViewFormBridge {
  values: Record<string, unknown>;
  onChange: (nodeId: string, value: unknown) => void;
  onButtonAction: (buttonId: string) => void;
}

interface ViewNodeRendererProps {
  node: ViewNode;
  bridge: ViewFormBridge;
}

function gapStyle(gap: number | undefined): { gap?: string } {
  if (typeof gap !== "number" || !Number.isFinite(gap)) return {};
  return { gap: `${Math.max(0, Math.min(gap, 48))}px` };
}

/** ViewNode 子节点无稳定 id；整树替换不保留局部 state，位置 key 足够。 */
function childKey(child: ViewNode, index: number): string {
  if ("id" in child && typeof child.id === "string") return `${child.type}:${child.id}`;
  return `${child.type}#${index}`;
}

/** ViewNode → React（docs/design/08 §5.1）；未知 type 由主进程降级为 text 占位。 */
export function ViewNodeRenderer({ node, bridge }: ViewNodeRendererProps) {
  const t = useT();
  const fieldId = useId();
  switch (node.type) {
    case "text": {
      const cls =
        node.variant === "heading"
          ? styles.heading
          : node.variant === "caption"
            ? styles.caption
            : styles.body;
      return <p className={cls}>{node.content}</p>;
    }
    case "markdown":
      return (
        <div className={styles.markdown}>
          <MarkdownContent text={node.content} />
        </div>
      );
    case "divider":
      return <hr className={styles.divider} />;
    case "column":
      return (
        <div className={styles.column} style={gapStyle(node.gap)}>
          {node.children.map((child, index) => (
            <ViewNodeRenderer key={childKey(child, index)} node={child} bridge={bridge} />
          ))}
        </div>
      );
    case "row":
      return (
        <div className={styles.row} style={gapStyle(node.gap)}>
          {node.children.map((child, index) => (
            <ViewNodeRenderer key={childKey(child, index)} node={child} bridge={bridge} />
          ))}
        </div>
      );
    case "card":
      return (
        <div className={styles.card}>
          {node.title ? <div className={styles.cardTitle}>{node.title}</div> : null}
          <div className={styles.cardBody}>
            {node.children.map((child, index) => (
              <ViewNodeRenderer key={childKey(child, index)} node={child} bridge={bridge} />
            ))}
          </div>
        </div>
      );
    case "button": {
      const variant =
        node.variant === "primary" ? "primary" : node.variant === "danger" ? "danger" : "default";
      return (
        <Button
          variant={variant}
          disabled={node.disabled}
          className={node.variant === "ghost" ? styles.ghostButton : undefined}
          onClick={() => bridge.onButtonAction(node.id)}
        >
          {node.label}
        </Button>
      );
    }
    case "input": {
      const raw = bridge.values[node.id];
      const value: string = typeof raw === "string" ? raw : "";
      return (
        <div className={styles.field}>
          {node.label ? (
            <label className={styles.fieldLabel} htmlFor={fieldId}>
              {node.label}
            </label>
          ) : null}
          {node.multiline ? (
            <textarea
              id={fieldId}
              className={styles.textarea}
              rows={4}
              placeholder={node.placeholder}
              value={value}
              onChange={(e) => bridge.onChange(node.id, e.target.value)}
            />
          ) : (
            <input
              id={fieldId}
              className={styles.input}
              type="text"
              placeholder={node.placeholder}
              value={value}
              onChange={(e) => bridge.onChange(node.id, e.target.value)}
            />
          )}
        </div>
      );
    }
    case "select": {
      const raw = bridge.values[node.id];
      const value: string = typeof raw === "string" ? raw : "";
      return (
        <div className={styles.field}>
          {node.label ? (
            <label className={styles.fieldLabel} htmlFor={fieldId}>
              {node.label}
            </label>
          ) : null}
          <select
            id={fieldId}
            className={styles.select}
            value={value}
            onChange={(e) => bridge.onChange(node.id, e.target.value)}
          >
            <option value="" disabled>
              {t("ui.view.selectPlaceholder")}
            </option>
            {node.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.description ? `${option.label} — ${option.description}` : option.label}
              </option>
            ))}
          </select>
        </div>
      );
    }
    case "checkbox": {
      const checked = bridge.values[node.id] === true;
      return (
        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => bridge.onChange(node.id, e.target.checked)}
          />
          <span>{node.label}</span>
        </label>
      );
    }
    case "list": {
      const raw = bridge.values[node.id];
      const selected = new Set(
        Array.isArray(raw)
          ? raw.filter((v): v is string => typeof v === "string")
          : typeof raw === "string" && raw
            ? [raw]
            : [],
      );
      const multi = node.multiple === true;
      return (
        <div className={styles.list} role="listbox" aria-multiselectable={multi}>
          {node.items.map((item) => {
            const active = selected.has(item.value);
            return (
              <button
                key={item.value}
                type="button"
                role="option"
                aria-selected={active}
                className={[styles.listItem, active ? styles.listItemActive : ""].join(" ")}
                onClick={() => {
                  if (multi) {
                    const next = new Set(selected);
                    if (next.has(item.value)) next.delete(item.value);
                    else next.add(item.value);
                    bridge.onChange(node.id, [...next]);
                  } else {
                    bridge.onChange(node.id, item.value);
                  }
                }}
              >
                {multi ? (
                  <span
                    className={[styles.listCheck, active ? styles.listCheckOn : ""].join(" ")}
                    aria-hidden
                  >
                    {active ? "✓" : ""}
                  </span>
                ) : null}
                <span className={styles.listText}>
                  <span className={styles.listLabel}>{item.label}</span>
                  {item.description ? (
                    <span className={styles.listDesc}>{item.description}</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      );
    }
    case "progress": {
      const pct = Math.round((node.value ?? 0) * 100);
      return (
        <div className={styles.progressWrap}>
          {node.label ? <span className={styles.fieldLabel}>{node.label}</span> : null}
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${pct}%` }} />
          </div>
          <span className={styles.caption}>{pct}%</span>
        </div>
      );
    }
    case "tabs":
      return <TabsView node={node} bridge={bridge} />;
    case "table":
      return <TableView node={node} />;
    case "unknown":
      return (
        <div className={styles.unknownNode} role="note">
          <span className={styles.unknownNodeType}>{node.originalType || "?"}</span>
          <span>{t("ui.view.unsupportedNode")}</span>
        </div>
      );
    default:
      return <p className={styles.caption}>{t("ui.view.unsupportedNodeShort")}</p>;
  }
}

type TabsViewNode = Extract<ViewNode, { type: "tabs" }>;

/** 面板内第一个可交互元素（选项列表在 DOM 序上先于输入框，天然优先）。 */
function firstFocusableIn(scope: ParentNode | null | undefined): HTMLElement | null {
  return (
    scope?.querySelector<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])",
    ) ?? null
  );
}

function activePanelOf(root: HTMLElement | null | undefined): HTMLElement | null {
  return root?.querySelector<HTMLElement>("[data-tab-panel]:not([hidden])") ?? null;
}

/**
 * tabs 挂载（docs/design/08 §5.1）：
 * - 全部页签常驻挂载、非激活仅 hidden——切页签不丢输入法/焦点/值；
 * - 本地切换（点击 chip / ←→）不产生事件；扩展 update 携带新的 activeTab 时
 *   才显式接管（reconcileActiveTab），答完自动前进即走这条路径；
 * - 键盘：←→ 切页签（焦点在输入框内时归还光标移动）、↑↓ 在 listbox 选项间
 *   环绕、数字 1-9 跳到当前面板第 N 个选项（只聚焦不确认，防误按提交）。
 */
function TabsView({ node, bridge }: { node: TabsViewNode; bridge: ViewFormBridge }) {
  const t = useT();
  const tabs = node.tabs;
  const [tabState, setTabState] = useState<ActiveTabState>(() => {
    const valid = node.activeTab !== undefined && tabs.some((tab) => tab.id === node.activeTab);
    return {
      activeId: valid ? (node.activeTab as string) : (tabs[0]?.id ?? ""),
      lastExplicit: node.activeTab,
    };
  });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const focusPanelPendingRef = useRef(false);
  const baseId = useId();

  // 渲染期调解（React 官方 "adjust state when props change" 模式）：
  // prop 出现了与上次显式值不同的 activeTab → 扩展显式接管。
  // 仅当激活页签真的变化时才布防聚焦，否则会打断面板内的既有焦点。
  const reconciled = reconcileActiveTab(tabState, node.activeTab);
  if (reconciled) {
    if (reconciled.activeId !== tabState.activeId) focusPanelPendingRef.current = true;
    setTabState(reconciled);
  }

  useLayoutEffect(() => {
    if (!focusPanelPendingRef.current) return;
    focusPanelPendingRef.current = false;
    firstFocusableIn(activePanelOf(rootRef.current))?.focus();
  });

  const switchTo = (tabId: string): void => {
    setTabState((prev) => (prev.activeId === tabId ? prev : { ...prev, activeId: tabId }));
  };

  const focusChip = (tabId: string): void => {
    rootRef.current
      ?.querySelector<HTMLElement>(`[role="tab"][data-tab-id="${CSS.escape(tabId)}"]`)
      ?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement | null;
    if (!target || target.closest("input, textarea, select, [contenteditable='true']")) return;
    const currentIndex = tabs.findIndex((tab) => tab.id === tabState.activeId);

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const next =
        tabs[wrappedStep(currentIndex, event.key === "ArrowRight" ? 1 : -1, tabs.length)];
      if (!next) return;
      event.preventDefault();
      if (target.closest("[role='tablist']")) {
        // ARIA tabs：焦点随箭头在 chip 间移动并自动激活
        switchTo(next.id);
        focusChip(next.id);
        return;
      }
      // 面板内切页：旧面板即将 hidden，焦点送入新面板。
      // 环绕回自身（如单页签）是彻底的 no-op，不得布防聚焦。
      if (next.id !== tabState.activeId) {
        focusPanelPendingRef.current = true;
        switchTo(next.id);
      }
      return;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const listbox = target.closest<HTMLElement>("[role='listbox']");
      if (listbox) {
        const options = [...listbox.querySelectorAll<HTMLElement>("[role='option']")];
        if (options.length === 0) return;
        event.preventDefault();
        const current = options.indexOf(
          target.closest<HTMLElement>("[role='option']") as HTMLElement,
        );
        const next =
          options[
            wrappedStep(
              current === -1 ? 0 : current,
              event.key === "ArrowDown" ? 1 : -1,
              options.length,
            )
          ];
        next?.focus();
        return;
      }
      if (event.key === "ArrowDown" && target.closest("[role='tablist']")) {
        // ↓ 从 chip 进入当前面板
        event.preventDefault();
        firstFocusableIn(activePanelOf(rootRef.current))?.focus();
      }
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      if (!target.closest("[role='tablist']") || tabs.length === 0) return;
      event.preventDefault();
      const next = tabs[event.key === "Home" ? 0 : tabs.length - 1];
      switchTo(next.id);
      focusChip(next.id);
      return;
    }

    if (/^[1-9]$/.test(event.key)) {
      const options = activePanelOf(rootRef.current)?.querySelectorAll<HTMLElement>(
        "[role='option']",
      );
      const option = options?.[Number(event.key) - 1];
      if (option) {
        event.preventDefault();
        option.focus();
      }
    }
  };

  return (
    <div ref={rootRef} className={styles.tabs}>
      <div className={styles.tabBar} role="tablist" onKeyDown={handleKeyDown}>
        {tabs.map((tab, index) => {
          const active = tab.id === tabState.activeId;
          const dotClass =
            tab.status === "answered"
              ? styles.tabDotAnswered
              : tab.status === "attention"
                ? styles.tabDotAttention
                : styles.tabDotOpen;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              data-tab-id={tab.id}
              aria-selected={active}
              aria-controls={`${baseId}-panel-${index}`}
              aria-label={
                tab.status === "answered"
                  ? t("ui.view.tabAnswered", { label: tab.label })
                  : tab.status === "attention"
                    ? t("ui.view.tabAttention", { label: tab.label })
                    : undefined
              }
              tabIndex={active ? 0 : -1}
              title={tab.label}
              className={[styles.tabChip, active ? styles.tabChipActive : ""].join(" ")}
              onClick={() => switchTo(tab.id)}
            >
              <span aria-hidden className={[styles.tabDot, dotClass].join(" ")}>
                {tab.status === "answered" ? "✓" : tab.status === "attention" ? "!" : ""}
              </span>
              <span className={styles.tabLabel}>{tab.label}</span>
            </button>
          );
        })}
      </div>
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          role="tabpanel"
          data-tab-panel=""
          id={`${baseId}-panel-${index}`}
          hidden={tab.id !== tabState.activeId}
          className={styles.tabPanel}
          onKeyDown={handleKeyDown}
        >
          {tab.children.map((child, childIndex) => (
            <ViewNodeRenderer key={childKey(child, childIndex)} node={child} bridge={bridge} />
          ))}
        </div>
      ))}
    </div>
  );
}

type TableViewNode = Extract<ViewNode, { type: "table" }>;

function alignClass(align: TableAlign): string {
  if (align === "right") return styles.tableAlignRight;
  if (align === "center") return styles.tableAlignCenter;
  return "";
}

/**
 * 表格挂载（docs/design/19 §3.2.1）：只读呈现，不进表单 values、不产生事件。
 * 用原生 `<table>` + `table-layout: fixed` 而非 grid + ARIA——列宽权重由
 * colgroup 百分比表达，同时白拿 `th scope="col"` 的可访问性语义。
 * 单元格溢出用省略号 + title 保住行高一致，列对齐是这张表存在的理由。
 */
function TableView({ node }: { node: TableViewNode }) {
  const t = useT();
  const weights = resolveColumnWeights(node.columns);
  const visible = windowTableRows(node.rows, node.maxRows);

  if (visible.total === 0) {
    return <p className={styles.tableEmpty}>{node.emptyText ?? t("ui.view.tableEmpty")}</p>;
  }

  return (
    <>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <colgroup>
            {node.columns.map((column, index) => (
              <col key={column.key} style={{ width: `${weights[index]}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {node.columns.map((column) => (
                <th key={column.key} scope="col" className={alignClass(resolveAlign(column))}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.rows.map((row) => (
              <tr key={row.id}>
                {node.columns.map((column) => {
                  const cell = formatCell(row.cells[column.key]);
                  return (
                    <td key={column.key} className={alignClass(resolveAlign(column))} title={cell}>
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visible.hidden > 0 ? (
        <p className={styles.tableTruncation}>
          {truncationLabel(visible.rows.length, visible.total)}
        </p>
      ) : null}
    </>
  );
}
