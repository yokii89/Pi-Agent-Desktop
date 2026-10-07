/**
 * Catalog + live View 合并投影（docs/design/16 §10.1、§6.3）。
 * 纯函数，便于单测；真值仍在扩展侧。
 */

import type {
  AccessModeSelectionState,
  ContributionViewState,
  ExtensionContribution,
} from "../../shared/contribution";
import { t } from "../../shared/i18n";
import type { ViewModeDescriptor, ViewPlacementHint } from "../../shared/view";

export interface LiveAccessModeSnapshot {
  /** live viewId（legacy 路径可能无 contributionKey）。 */
  id: string;
  sessionId?: string;
  boundSessionId?: string | null;
  contributionKey?: string;
  mode?: ViewModeDescriptor;
  placementHint?: ViewPlacementHint;
}

export interface ActivationTxn {
  contributionKey: string;
  sessionId: string | null;
  actionId: "mode:activate" | "mode:deactivate" | "view:open";
  startedAt: number;
  error?: string;
}

export interface LastKnownMode {
  contributionKey: string;
  sessionId: string | null;
  title: string;
  active: boolean;
  detail?: string;
  icon?: string;
  accent?: ExtensionContribution["accent"];
}

export interface MergedAccessModeRow {
  key: string;
  contributionKey?: string;
  title: string;
  description?: string;
  icon?: string;
  accent?: ExtensionContribution["accent"];
  state: ContributionViewState;
  /** live 扩展上报的 active；仅 state=live 时可信任。 */
  liveActive: boolean;
  liveConfirmed?: boolean;
  detail?: string;
  /** live viewId；advertised/suspended/failed 时可能为空。 */
  liveViewId?: string;
  /** 激活失败原因。 */
  error?: string;
  /** suspended 时的 last-known 提示。 */
  suspendedLabel?: string;
}

function sessionKeyOf(entry: { sessionId?: string; boundSessionId?: string | null }): string {
  return entry.sessionId ?? entry.boundSessionId ?? "";
}

function accessModeBelongs(
  entry: { sessionId?: string; boundSessionId?: string | null },
  activeSessionId: string | null,
): boolean {
  if (!activeSessionId) return false;
  if (entry.sessionId) return entry.sessionId === activeSessionId;
  return entry.boundSessionId === activeSessionId;
}

/**
 * 合并 Catalog access-mode 条目与 live 注册。
 *
 * - 只有 Catalog → advertised
 * - Catalog + 激活事务 → activating / failed
 * - Catalog + live → live
 * - Catalog + 曾 live 后关闭 → suspended
 * - 只有 legacy live（无 key）→ live
 */
export function mergeAccessModeRows(opts: {
  catalogEntries: ExtensionContribution[];
  liveEntries: LiveAccessModeSnapshot[];
  activationTxns: ActivationTxn[];
  lastKnown: LastKnownMode[];
  activeSessionId: string | null;
  /** 该会话 runtime 是否 ready（用于 full access 三态，不直接决定行状态）。 */
  runtimeReady: boolean;
}): MergedAccessModeRow[] {
  const { catalogEntries, liveEntries, activationTxns, lastKnown, activeSessionId } = opts;

  const catalogModes = catalogEntries.filter((e) => e.placement === "access-mode");
  const visibleLive = liveEntries.filter((e) => accessModeBelongs(e, activeSessionId));

  const liveByKey = new Map<string, LiveAccessModeSnapshot>();
  const liveById = new Map<string, LiveAccessModeSnapshot>();
  for (const live of visibleLive) {
    liveById.set(live.id, live);
    if (live.contributionKey) liveByKey.set(live.contributionKey, live);
  }

  const txnByKey = new Map<string, ActivationTxn>();
  for (const txn of activationTxns) {
    if (txn.sessionId === activeSessionId || (txn.sessionId === null && !activeSessionId)) {
      txnByKey.set(txn.contributionKey, txn);
    }
  }

  const lastByKey = new Map<string, LastKnownMode>();
  for (const item of lastKnown) {
    if (item.sessionId === activeSessionId) lastByKey.set(item.contributionKey, item);
  }

  const usedLiveIds = new Set<string>();
  const rows: MergedAccessModeRow[] = [];

  for (const cat of catalogModes) {
    const live = liveByKey.get(cat.key);
    const txn = txnByKey.get(cat.key);
    const known = lastByKey.get(cat.key);
    let state: ContributionViewState = "advertised";
    if (live) usedLiveIds.add(live.id);
    if (txn && !txn.error) {
      state = "activating";
    } else if (live) {
      state = "live";
    } else if (txn?.error) {
      state = "failed";
    } else if (known) {
      state = "suspended";
    }

    const mode = live?.mode;
    rows.push({
      key: cat.key,
      contributionKey: cat.key,
      title: mode?.title ?? cat.title,
      description: mode?.description ?? cat.description,
      icon: mode?.icon ?? cat.icon,
      accent: cat.accent,
      state,
      liveActive: state === "live" && mode?.active === true,
      liveConfirmed: typeof mode?.active === "boolean",
      detail: state === "live" ? mode?.detail : undefined,
      liveViewId: live?.id,
      error: txn?.error,
      suspendedLabel:
        state === "suspended" && known
          ? known.active
            ? `${known.title}${t("session.access.pausedSuffix")}`
            : known.title
          : undefined,
    });
  }

  // legacy live：无 contributionKey 或 key 不在 Catalog
  for (const live of visibleLive) {
    if (usedLiveIds.has(live.id)) continue;
    if (live.contributionKey && catalogModes.some((c) => c.key === live.contributionKey)) {
      continue;
    }
    const mode = live.mode;
    if (!mode) continue;
    rows.push({
      key: live.id,
      contributionKey: live.contributionKey,
      title: mode.title,
      description: mode.description,
      icon: mode.icon,
      state: "live",
      liveActive: mode.active === true,
      liveConfirmed: typeof mode.active === "boolean",
      detail: mode.detail,
      liveViewId: live.id,
    });
  }

  return rows;
}

/**
 * 访问模式选择三态（docs/design/16 §6.3）。
 * unresolved 时不得把「完全访问」勾成已确认。
 *
 * ready 且 Catalog 声明了 access-mode 但尚未出现 live 注册时：
 * - 宽限期内 → unresolved（给扩展注册时间）
 * - 注册超时仍为 unresolved，不能将缺少上报解释为权限已解除。
 */

export function resolveAccessModeSelection(opts: {
  rows: MergedAccessModeRow[];
  runtimeReady: boolean;
  /** Catalog 是否声明了该 context 的 access-mode（无声明 + ready → confirmed-full）。 */
  catalogHasAccessModes: boolean;
  /** 任一声明模式是否仍在 activating。 */
  anyActivating: boolean;
  /**
   * ready 之后扩展注册宽限是否已过。
   * 缺省 true：无 live 时直接确认 full（兼容已存活进程 / processAlive 兜底）。
   */
  registrationSettled?: boolean;
}): AccessModeSelectionState {
  const activeLive = opts.rows.find((r) => r.state === "live" && r.liveActive);
  if (activeLive) return "confirmed-extension";

  if (!opts.runtimeReady || opts.anyActivating) return "unresolved";

  const liveRows = opts.rows.filter((r) => r.state === "live");
  if (!opts.catalogHasAccessModes) return "confirmed-full";

  // 注册超时不能证明门禁已关闭；所有声明项都必须有 live 确认。
  return liveRows.length === opts.rows.length &&
    liveRows.length > 0 &&
    liveRows.every((row) => row.liveConfirmed)
    ? "confirmed-full"
    : "unresolved";
}

/** 芯片展示标题。 */
export function accessModeChipLabel(opts: {
  selection: AccessModeSelectionState;
  rows: MergedAccessModeRow[];
}): { title: string; subtitle?: string; activeKey: string | null } {
  const active = opts.rows.find((r) => r.state === "live" && r.liveActive);
  if (opts.selection === "confirmed-extension" && active) {
    return {
      title: active.title,
      subtitle: active.detail,
      activeKey: active.contributionKey ?? active.key,
    };
  }
  if (opts.selection === "confirmed-full") {
    return { title: t("session.access.full"), activeKey: "full" };
  }
  // unresolved：有 last-known 则展示暂停态，否则中性文案
  const suspended = opts.rows.find((r) => r.state === "suspended");
  if (suspended?.suspendedLabel) {
    return { title: suspended.suspendedLabel, activeKey: null };
  }
  const activating = opts.rows.find((r) => r.state === "activating");
  if (activating) {
    return { title: t("session.access.activating", { title: activating.title }), activeKey: null };
  }
  return { title: t("session.access.mode"), activeKey: null };
}

export function accessModeMatchesSessionPure(
  entry: { sessionId?: string; boundSessionId?: string | null },
  activeSessionId: string | null,
): boolean {
  return accessModeBelongs(entry, activeSessionId);
}

export { sessionKeyOf };
