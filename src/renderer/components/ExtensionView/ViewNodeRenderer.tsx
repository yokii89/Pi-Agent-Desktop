import { type KeyboardEvent, useId, useLayoutEffect, useRef, useState } from "react";
import type { ViewNode } from "../../../shared/view";
import { useT } from "../../hooks/useT";
import { MarkdownContent } from "../SessionArea/MarkdownContent";
import { Button } from "../ui/Button";
import { OptionList, type OptionRow } from "../ui/OptionList";
import { Segmented } from "../ui/Segmented";
import { Select } from "../ui/Select";
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
      const tone =
        node.tone === "success"
          ? styles.toneSuccess
          : node.tone === "warning"
            ? styles.toneWarning
            : node.tone === "danger"
              ? styles.toneDanger
              : node.tone === "muted"
                ? styles.toneMuted
                : "";
      return <p className={[cls, tone].filter(Boolean).join(" ")}>{node.content}</p>;
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
          <Select
            id={fieldId}
            className={styles.select}
            ariaLabel={node.label}
            value={value}
            placeholder={t("ui.view.selectPlaceholder")}
            options={node.options.map((option) => ({
              value: option.value,
              label: option.label,
              hint: option.description,
            }))}
            onChange={(next) => bridge.onChange(node.id, next)}
          />
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
    case "list":
      return <ListField node={node} bridge={bridge} />;
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

type ListViewNode = Extract<ViewNode, { type: "list" }>;

/**
 * 常驻 list 字段。至少一项带 `preview` 时进入两栏（docs/design/79）：
 * 右栏跟随 hover / 行焦点，指针移出列表后保留最后一个落点，
 * 而不是退回选中项——用户可能正把指针移进预览里阅读。
 */
function ListField({ node, bridge }: { node: ListViewNode; bridge: ViewFormBridge }) {
  const t = useT();
  const raw = bridge.values[node.id];
  const readonly = node.readonly === true;
  const selected = new Set(
    Array.isArray(raw)
      ? raw.filter((v): v is string => typeof v === "string")
      : typeof raw === "string" && raw
        ? [raw]
        : [],
  );
  const multi = node.multiple === true;
  const [activeValue, setActiveValue] = useState<string | null>(null);

  const previewMode = node.items.some(
    (item) => typeof item.preview === "string" && item.preview.length > 0,
  );
  const selectedValue =
    typeof raw === "string" && raw
      ? raw
      : Array.isArray(raw)
        ? (raw.find((value): value is string => typeof value === "string") ?? null)
        : null;
  const activeItem =
    (activeValue !== null ? node.items.find((item) => item.value === activeValue) : undefined) ??
    (!readonly && selectedValue !== null
      ? node.items.find((item) => item.value === selectedValue)
      : undefined) ??
    node.items.find((item) => item.preview) ??
    node.items[0];

  // 每个条目恰好占一个可点行，OptionList 的行序就是 items 下标
  const rows = node.items.map<OptionRow>((item) => {
    const active = selected.has(item.value);
    return {
      key: item.value,
      text: item.label,
      selected: active,
      className: [styles.listItem, active ? styles.listItemActive : ""].join(" "),
      node: (
        <>
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
            {item.description ? <span className={styles.listDesc}>{item.description}</span> : null}
          </span>
        </>
      ),
    };
  });

  // 只读态（docs/06 R1）：不写 values、不画选中条、行不是 option 也不进 Tab 序。
  // 不用 OptionList 是因为它的行天生是 button/listbox option，拦截点击只能得到
  // 「看起来能点但没反应」；这里换成真正的 list/listitem 语义。
  const list = readonly ? (
    <div className={styles.list}>
      <ul className={[styles.listRows, styles.readonlyList].join(" ")}>
        {node.items.map((item) => (
          <li
            key={item.value}
            className={styles.readonlyItem}
            onMouseEnter={() => setActiveValue(item.value)}
          >
            <span className={styles.listText}>
              <span className={styles.listLabel}>{item.label}</span>
              {item.description ? (
                <span className={styles.listDesc}>{item.description}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  ) : (
    <div className={styles.list}>
      <OptionList
        rows={rows}
        role="listbox"
        className={styles.listRows}
        // 弹出式列表收起即卸载，药丸留着无所谓；这是常驻面板，指针移出后必须熄灭，
        // 否则一次悬停的高亮会被读成「已选中」，和左侧强调条打架。
        rememberPosition={false}
        // null 是「指针离开列表」：预览保留最后一个落点，别在用户移向预览时闪回选中项
        onActiveChange={(index) => {
          if (index === null) return;
          const item = node.items[index];
          if (item) setActiveValue(item.value);
        }}
        onSelect={(index) => {
          const item = node.items[index];
          if (!item) return;
          if (multi) {
            const next = new Set(selected);
            if (next.has(item.value)) next.delete(item.value);
            else next.add(item.value);
            bridge.onChange(node.id, [...next]);
          } else {
            bridge.onChange(node.id, item.value);
          }
        }}
      />
    </div>
  );

  if (!previewMode) return list;

  return (
    <div className={styles.listPreviewOuter}>
      <div className={styles.listPreviewWrap}>
        {list}
        <section className={styles.optionPreview} aria-label={t("ui.view.optionPreview")}>
          {activeItem?.preview ? (
            <div className={styles.optionPreviewMarkdown}>
              <MarkdownContent text={activeItem.preview} />
            </div>
          ) : (
            <div className={styles.optionPreviewFallback}>
              <div className={styles.optionPreviewTitle}>{activeItem?.label}</div>
              {activeItem?.description ? (
                <div className={styles.optionPreviewDesc}>{activeItem.description}</div>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
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
 * - 键盘：页签条上的 ←→/Home/End 由 Segmented 原语负责；这一层只保留原语覆盖不到的
 *   部分——面板内 ←→ 切页、↑↓ 在 listbox 选项间环绕、↓ 从页签条进入面板、
 *   数字 1-9 跳到当前面板第 N 个选项（只聚焦不确认，防误按提交）。焦点在输入框内时归还光标移动。
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

  // 切页从顶部开始（docs/06 R2）：页签条 sticky 后切页仍要回到结论行，
  // 而不是停在上一页的滚动位置。滚动不移动焦点，被点击的 chip 仍握着焦点。
  const activeId = tabState.activeId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeId 是「该复位了」的信号，effect 体只读祖先 DOM
  useLayoutEffect(() => {
    const scroller = rootRef.current?.closest<HTMLElement>("[data-panel-scroll]");
    scroller?.scrollTo({ top: 0 });
  }, [activeId]);

  const switchTo = (tabId: string): void => {
    setTabState((prev) => (prev.activeId === tabId ? prev : { ...prev, activeId: tabId }));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement | null;
    if (!target || target.closest("input, textarea, select, [contenteditable='true']")) return;

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      // 页签条内的 ←→ 归 Segmented（焦点停在 chip 上并激活落点），这里只管面板内切页
      if (target.closest("[role='tablist']")) return;
      const currentIndex = tabs.findIndex((tab) => tab.id === tabState.activeId);
      const next =
        tabs[wrappedStep(currentIndex, event.key === "ArrowRight" ? 1 : -1, tabs.length)];
      if (!next) return;
      event.preventDefault();
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
    // biome-ignore lint/a11y/noStaticElementInteractions: 这层只归一 chip/面板冒泡上来的按键，不是控件，不挂 role
    <div ref={rootRef} className={styles.tabs} onKeyDown={handleKeyDown}>
      <div className={styles.tabBarSticky}>
        <Segmented
          className={styles.tabBar}
          semantics="tab"
          size="sm"
          equal={false}
          scrollable
          value={tabState.activeId}
          items={tabs.map((tab, index) => {
            const statusName =
              tab.status === "answered"
                ? t("ui.view.tabAnswered", { label: tab.label })
                : tab.status === "attention"
                  ? t("ui.view.tabAttention", { label: tab.label })
                  : null;
            const dotClass =
              tab.status === "answered"
                ? styles.tabDotAnswered
                : tab.status === "attention"
                  ? styles.tabDotAttention
                  : styles.tabDotOpen;
            return {
              value: tab.id,
              title: tab.label,
              ariaLabel: statusName ?? undefined,
              ariaControls: `${baseId}-panel-${index}`,
              label: (
                <>
                  {tab.status === "none" ? null : (
                    <span aria-hidden className={[styles.tabDot, dotClass].join(" ")}>
                      {tab.status === "answered" ? "✓" : tab.status === "attention" ? "!" : ""}
                    </span>
                  )}
                  <span className={styles.tabLabel}>{tab.label}</span>
                </>
              ),
            };
          })}
          onChange={switchTo}
        />
      </div>
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          role="tabpanel"
          data-tab-panel=""
          id={`${baseId}-panel-${index}`}
          hidden={tab.id !== tabState.activeId}
          className={styles.tabPanel}
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
                <th
                  key={column.key}
                  scope="col"
                  className={alignClass(resolveAlign(column))}
                  title={column.label}
                >
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
