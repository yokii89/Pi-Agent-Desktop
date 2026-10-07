import type { DesktopViewClient, LiveViewSession, ViewSessionEvent } from "./client.js";
import { ViewHostError } from "./client.js";
import type {
  HeaderSide,
  ViewAction,
  ViewClosedReason,
  ViewErrorPayload,
  ViewHelloPayload,
  ViewModeAccent,
  ViewModeDescriptor,
  ViewNode,
  ViewPlacement,
  ViewResult,
  ViewSpec,
} from "./types.js";
import { ACCESS_MODE_ACTIONS, SLOTTED_VIEW_PLACEMENTS } from "./types.js";

export { ACCESS_MODE_ACTIONS };

export interface ViewCallOptions {
  signal?: AbortSignal;
  /** One-shot: close on first submit-kind action. Default true for static specs. */
  oneShot?: boolean;
  /**
   * Host rejection for this view (`limit` / `placement` / `protocol`).
   * Without it a one-shot form cannot tell "the Host refused to render this"
   * from "the user dismissed it" — both resolve `undefined` (docs/design/20 O2).
   */
  onError?: (error: ViewErrorPayload) => void;
}

async function assertPlacementSupported(
  client: DesktopViewClient,
  placement: ViewPlacement,
): Promise<void> {
  let hello: ViewHelloPayload | null;
  try {
    hello = await client.ensureConnected();
  } catch (err) {
    // 传输失败必须与“宿主明确拒绝槽位”区分，但同样是 ViewHostError 族的失败，
    // 不能把裸 Error 泄给调用方（调用方需要稳定错误类型做降级判断）。
    // 已经是 ViewHostError 的原样透传，否则调用方看到的 code 会被宿主的原因
    // （limit / placement / protocol）覆盖成 internal。
    if (err instanceof ViewHostError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new ViewHostError(
      `View transport unavailable (client.ensureConnected() failed): ${message}`,
      { code: "internal", payload: { message, code: "internal" } },
    );
  }
  if (hello && !hello.placements.includes(placement)) {
    throw new ViewHostError(`Host does not support placement "${placement}"`, {
      code: "placement",
      closedReason: "placement",
    });
  }
}

/** Options for `openHeader` — compact title-bar slots (docs/design/08 §5.3.2 header). */
export interface OpenHeaderOptions {
  /** left（缺省）| center | right；每 connection 每侧最多 1 个，同侧顶替。 */
  side?: HeaderSide;
  title?: string;
  root: ViewNode;
  /** 最多渲染 2 个；建议 ghost / primary。 */
  actions?: ViewAction[];
  signal?: AbortSignal;
  onEvent?: (event: ViewSessionEvent, session: LiveViewSession) => void;
}

/**
 * Build a `ViewSpec` for the title-bar header slot.
 * Compact by design: caption / progress / one or two buttons. Wide forms → modal/settings.
 */
export function headerSpec(options: OpenHeaderOptions): ViewSpec {
  return {
    title: options.title,
    placement: "header",
    // header 必须落在顶栏，不要静默降级成 modal
    placementRequired: true,
    placementHint: { headerSide: options.side ?? "left" },
    root: options.root,
    actions: options.actions,
  };
}

/**
 * Open a header strip on the title bar (left / center / right).
 * Resolves with the live session — call `session.close()` or await `session.closed`.
 * Same connection + same side: a new open replaces the previous strip.
 *
 * Fails fast with `ViewHostError` when `hello` is present and the host does
 * not advertise the `header` slot.
 *
 * ```ts
 * const session = await openHeader(desktop, {
 *   side: "right",
 *   root: { type: "text", content: "索引中…", variant: "caption" },
 *   actions: [{ id: "stop", label: "停止", variant: "ghost", kind: "event" }],
 *   onEvent: (e, s) => {
 *     if (e.type === "action" && e.actionId === "stop") {
 *       s.close({ action: "stop", values: {} });
 *     }
 *   },
 * });
 * session.update({ type: "text", content: "完成", variant: "caption" });
 * session.close();
 * ```
 */
export async function openHeader(
  client: DesktopViewClient,
  options: OpenHeaderOptions,
): Promise<LiveViewSession> {
  await assertPlacementSupported(client, "header");
  return client.openLive(headerSpec(options), {
    signal: options.signal,
    onEvent: options.onEvent,
  });
}

/** Options for `openWidget` — composer-adjacent widget slots. */
export interface OpenWidgetOptions {
  /** aboveEditor（缺省，输入栏上方）| belowEditor */
  side?: "aboveEditor" | "belowEditor";
  /**
   * true（推荐表单）= @ 菜单式覆盖层，不占输入栈高度；
   * false/缺省 = 停靠条（≤96px，适合状态/进度）。
   */
  floating?: boolean;
  title?: string;
  root: ViewNode;
  actions?: ViewAction[];
  signal?: AbortSignal;
  onEvent?: (event: ViewSessionEvent, session: LiveViewSession) => void;
}

/**
 * Build a `ViewSpec` for the composer widget slot.
 * Prefer `floating: true` for interactive forms (questionnaires, pickers).
 */
export function widgetSpec(options: OpenWidgetOptions): ViewSpec {
  return {
    title: options.title,
    placement: "widget",
    // 贴输入栏是本槽位的语义；不要静默降级成 modal
    placementRequired: true,
    placementHint: {
      side: options.side ?? "aboveEditor",
      floating: options.floating === true,
    },
    root: options.root,
    actions: options.actions,
  };
}

/**
 * Open a widget above/below the task composer.
 * Resolves with the live session — call `session.close()` or await `session.closed`.
 * Same connection: a new widget open replaces the previous one.
 *
 * Fails fast with `ViewHostError` when `hello` is present and the host does
 * not advertise the `widget` slot.
 *
 * ```ts
 * const session = await openWidget(desktop, {
 *   floating: true,
 *   title: "回答问题",
 *   root: { type: "list", id: "q0", items },
 *   actions: [
 *     { id: "cancel", label: "取消", variant: "ghost" },
 *     { id: "submit", label: "提交", variant: "primary" },
 *   ],
 *   onEvent: (e, s) => {
 *     if (e.type === "action" && e.actionId === "submit") {
 *       s.close({ action: "submit", values: e.values ?? {} });
 *     }
 *   },
 * });
 * ```
 */
export async function openWidget(
  client: DesktopViewClient,
  options: OpenWidgetOptions,
): Promise<LiveViewSession> {
  await assertPlacementSupported(client, "widget");
  return client.openLive(widgetSpec(options), {
    signal: options.signal,
    onEvent: options.onEvent,
  });
}

/** Shared shape for the three resident slotted placements (panel / sidebar / settings). */
interface OpenSlottedOptionsBase {
  title?: string;
  root: ViewNode;
  actions?: ViewAction[];
  /** Stable Contribution key (docs/design/16) — binds this view to a Catalog entry. */
  contributionKey?: string;
  signal?: AbortSignal;
  onEvent?: (event: ViewSessionEvent, session: LiveViewSession) => void;
}

/** Options for `openPanel` — right-hand ContextSidebar dynamic tab (docs/design/08 §5.3.3). */
export interface OpenPanelOptions extends OpenSlottedOptionsBase {
  /**
   * Stable slot id. **Required** (docs/design/19 §2.2): the Host falls back to
   * `ext-<viewId>` when omitted, and that id changes on every reconnect — the
   * tab identity would drift instead of being replaced in place.
   */
  panelId: string;
}

/** Options for `openSettingsView` — settings page card. Same stability rule. */
export interface OpenSettingsViewOptions extends OpenSlottedOptionsBase {
  /** Stable slot id (**required**) — multiple ids stack as cards on the page. */
  panelId: string;
}

/** Options for `openSidebar` — left NavSidebar embedded card. */
export interface OpenSidebarOptions extends OpenSlottedOptionsBase {
  /** Stable slot id; omission is tolerated but deplorable (identity drift). */
  panelId?: string;
}

function slottedSpec(
  options: OpenSlottedOptionsBase,
  placement: ViewPlacement,
  panelId: string | undefined,
): ViewSpec {
  return {
    title: options.title,
    placement,
    // 常驻槽：Host 不支持时必须显式失败（由 hello 预检兜住），不静默降级成 modal
    placementRequired: true,
    placementHint: { panelId },
    root: options.root,
    actions: options.actions,
    contributionKey: options.contributionKey,
  };
}

/**
 * Open a dynamic tab in the **right-hand** ContextSidebar (`panel`, docs/design/19 §2.1).
 *
 * Same connection + same `panelId`: the new open replaces the previous view and
 * the stale one receives `closed(replaced)`. **Idempotent re-open** — safe to
 * call on every reconnect.
 *
 * Resolves `null` (never throws) when the Host is absent / too old, or the
 * connection fails — mirroring `registerAccessMode` so resident callers can
 * fall back to their TUI path.
 *
 * ```ts
 * const session = await openPanel(desktop, {
 *   panelId: "telegram-bridge",
 *   title: "Telegram",
 *   root: project(status),
 *   actions: [{ id: "refresh", label: "刷新", variant: "ghost" }],
 *   onEvent: (e) => { if (e.type === "action") void handle(e.actionId); },
 * });
 * session?.update(project(nextStatus));
 * ```
 */
export async function openPanel(
  client: DesktopViewClient | null,
  options: OpenPanelOptions,
): Promise<LiveViewSession | null> {
  const result = await openPanelResult(client, options);
  return result.ok ? result.session : null;
}

/**
 * Open a card on the settings page. Multiple distinct `panelId`s stack
 * vertically. Do **not** route credentials through this slot: View payloads
 * cross IPC and the renderer (docs/design/19 §2.7).
 */
export async function openSettingsView(
  client: DesktopViewClient | null,
  options: OpenSettingsViewOptions,
): Promise<LiveViewSession | null> {
  const result = await openSettingsViewResult(client, options);
  return result.ok ? result.session : null;
}

/**
 * Open an embedded card in the **left-hand** NavSidebar (`sidebar`).
 * Prefer `openPanel` for wide, table-ish content — the left nav is narrow.
 */
export async function openSidebar(
  client: DesktopViewClient | null,
  options: OpenSidebarOptions,
): Promise<LiveViewSession | null> {
  const result = await openSidebarResult(client, options);
  return result.ok ? result.session : null;
}

/**
 * Why a slotted open did not produce a session.
 *
 * The four `ViewErrorCode` members are the **Host's** own reasons, passed
 * through unchanged. The rest are conditions only the SDK can observe — the
 * whole point of this union is that "the user cancelled", "the Host refused",
 * "this Host has no such slot" and "the pipe is down" no longer collapse into
 * one `null` (准则 §6, docs/design/20 O2).
 */
export type ViewOpenFailureCode =
  | ViewHostError["code"]
  /** No host env: plain terminal pi. Not retryable — fall back to TUI. */
  | "no-host"
  /** Connected, but `hello` never arrived: a slow Host, not an old one. Retryable. */
  | "handshake-timeout"
  /** Socket / disposed client. Retryable. */
  | "transport"
  /** The caller's own `signal` was already aborted. Not a failure of anyone else. */
  | "aborted"
  /** Options the SDK refuses to send (blank `panelId` → Host-side identity drift). */
  | "invalid";

export interface ViewOpenFailure {
  ok: false;
  code: ViewOpenFailureCode;
  message: string;
  /** Whether re-calling later (or after a reconnect) can plausibly succeed. */
  retryable: boolean;
  /** Host `error` frame payload, when the Host said why. */
  error?: ViewErrorPayload;
}

export type ViewOpenResult = { ok: true; session: LiveViewSession } | ViewOpenFailure;

/** `panel` / `sidebar` / `settings` need a stable slot id; a blank one is a bug. */
function panelIdFailure(placement: ViewPlacement, panelId: string | undefined): ViewOpenFailure {
  const required = panelId === undefined && placement !== "sidebar";
  return {
    ok: false,
    code: "invalid",
    retryable: false,
    message:
      `${placement === "panel" ? "openPanel" : placement === "settings" ? "openSettingsView" : "openSidebar"} ` +
      (required
        ? `requires a stable panelId — the Host would fall back to ext-<viewId>, which changes on every reconnect.`
        : `panelId must be non-empty when provided (trim to "" is identity drift).`),
  };
}

function openFailure(
  code: ViewOpenFailureCode,
  message: string,
  retryable: boolean,
  error?: ViewErrorPayload,
): ViewOpenFailure {
  return error
    ? { ok: false, code, message, retryable, error }
    : { ok: false, code, message, retryable };
}

/**
 * Discriminated open for the three resident slots. This is the real
 * implementation; `openPanel` / `openSidebar` / `openSettingsView` are the
 * documented soft (`null`) projections of it.
 */
export async function openPanelResult(
  client: DesktopViewClient | null,
  options: OpenPanelOptions,
): Promise<ViewOpenResult> {
  return openSlotResult(client, options, "panel", options.panelId);
}

/** Discriminated variant of {@link openSidebar}. */
export async function openSidebarResult(
  client: DesktopViewClient | null,
  options: OpenSidebarOptions,
): Promise<ViewOpenResult> {
  return openSlotResult(client, options, "sidebar", options.panelId);
}

/** Discriminated variant of {@link openSettingsView}. */
export async function openSettingsViewResult(
  client: DesktopViewClient | null,
  options: OpenSettingsViewOptions,
): Promise<ViewOpenResult> {
  return openSlotResult(client, options, "settings", options.panelId);
}

async function openSlotResult(
  client: DesktopViewClient | null,
  options: OpenSlottedOptionsBase,
  placement: ViewPlacement,
  panelId: string | undefined,
): Promise<ViewOpenResult> {
  if (!client) {
    return openFailure("no-host", "No PiDesk View host in this environment (TUI fallback).", false);
  }
  if (options.signal?.aborted) {
    return openFailure("aborted", "Open aborted before dispatch.", false);
  }
  if (SLOTTED_VIEW_PLACEMENTS.has(placement) && (panelId === undefined || !panelId.trim())) {
    if (placement !== "sidebar" || panelId !== undefined) {
      return panelIdFailure(placement, panelId);
    }
  }
  let session: LiveViewSession | null = null;
  try {
    const hello = await client.ensureConnected();
    if (!hello) {
      // hello 缺失 = 慢宿主 / 握手未结算：与“老宿主没有这个槽”不是一回事
      return openFailure(
        "handshake-timeout",
        `Host connected but sent no hello; cannot confirm "${placement}" support.`,
        true,
      );
    }
    if (!hello.placements.includes(placement)) {
      return openFailure(
        "placement",
        `Host does not advertise placement "${placement}" (too old for this slot).`,
        false,
      );
    }
    session = await client.openLive(slottedSpec(options, placement, panelId), {
      signal: options.signal,
      onEvent: options.onEvent,
    });
    return { ok: true, session };
  } catch (err) {
    // 连接失败 / client 已 dispose：可重试，绝不向扩展抛错
    session?.close();
    if (err instanceof ViewHostError) {
      return openFailure(
        err.code,
        err.message,
        err.code === "limit" || err.code === "internal",
        err.payload,
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return openFailure("transport", message, true);
  }
}

function isSubmitAction(actions: ViewAction[] | undefined, actionId: string): boolean {
  const action = actions?.find((a) => a.id === actionId);
  if (!action) return true;
  return (action.kind ?? "submit") === "submit";
}

/**
 * One-shot form helper (docs/design/08 §4.1).
 *
 * Opens a static `ViewSpec`, tracks change values, and closes on the first
 * submit-kind action. Resolves to `ViewResult`, or `undefined` on dismiss /
 * Host force-close.
 *
 * For realtime UIs use `client.open(spec, { onEvent })` instead.
 */
export async function viewOnDesktop(
  client: DesktopViewClient,
  spec: ViewSpec,
  options?: ViewCallOptions,
): Promise<ViewResult | undefined> {
  const signal = options?.signal;
  if (signal?.aborted) return undefined;
  const oneShot = options?.oneShot ?? true;
  let values: Record<string, unknown> = {};

  const result = await client.open(spec, {
    signal,
    onEvent: (event, session: LiveViewSession) => {
      if (event.type === "change") {
        values = { ...values, [event.nodeId]: event.value };
        return;
      }
      if (event.type === "error") {
        options?.onError?.(event.error);
        return;
      }
      if (event.type === "action") {
        if (event.values) values = { ...values, ...event.values };
        if (oneShot && isSubmitAction(spec.actions, event.actionId)) {
          session.close({ action: event.actionId, values });
        }
      }
    },
  });

  return result ?? undefined;
}

/** Convenience builder: column of children. */
export function column(children: ViewNode[], gap?: number): ViewNode {
  return gap === undefined ? { type: "column", children } : { type: "column", children, gap };
}

/** Convenience builder: row of children. */
export function row(children: ViewNode[], gap?: number): ViewNode {
  return gap === undefined ? { type: "row", children } : { type: "row", children, gap };
}

/** Convenience builder: card group. */
export function card(title: string | undefined, children: ViewNode[]): ViewNode {
  return title === undefined ? { type: "card", children } : { type: "card", title, children };
}

/** Options for `registerAccessMode` — composer access-mode slot (PiDesk docs/design/14). */
export interface RegisterAccessModeOptions {
  /** Stable mode id (dedupe key on the Host). */ id: string;
  /** Row title in the access-mode panel. */
  title: string;
  /** Row description. */
  description?: string;
  /**
   * Host built-in icon name; unknown names fall back. Current set:
   * `"shield"` | `"shield-check"` | `"clipboard"`.
   */
  icon?: string;
  /** Accent color while active; default "default". */
  accent?: ViewModeAccent;
  /**
   * Stable Contribution key matching PiDesk Catalog (docs/design/16 §5.3).
   * When set, Host can bind cold-state entries to this live registration.
   * Omit for legacy extensions without a static manifest.
   */
  contributionKey?: string;
  signal?: AbortSignal;
  onEvent?: (event: ViewSessionEvent, session: LiveViewSession) => void;
}

/** Live handle for a registered access mode. The extension owns the truth. */
export interface AccessModeHandle {
  /** View id of the registration (matches `session.id`). */
  readonly viewId: string;
  readonly session: LiveViewSession;
  /**
   * Report mode state to the Host (chip + panel row). `detail` explains the
   * active state, e.g. a refusal reason while `active` stays false.
   */
  setActive(active: boolean, detail?: string): void;
}

/** How the Host let a registration attempt end without an `opened` ack. */
type OpenedOutcome =
  | { ok: true }
  | { ok: false; kind: "refused"; error?: ViewErrorPayload; closedReason?: string }
  | { ok: false; kind: "timeout" }
  | { ok: false; kind: "transport"; closedReason?: string };

/** Closed reasons that mean "the pipe/session went away", never "the Host said no". */
const TRANSPORT_CLOSE_REASONS: readonly ViewClosedReason[] = [
  "dispose",
  "rebind",
  "abort",
  "session",
] as const;

/**
 * Wait for the Host `opened` ack (or the reason there isn't one). Access-mode
 * registration must land in its slot — modal fallback is meaningless here.
 */
function awaitOpened(session: LiveViewSession, timeoutMs = 3000): Promise<OpenedOutcome> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (outcome: OpenedOutcome): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      off();
      resolve(outcome);
    };
    const off = session.onEvent((event) => {
      if (event.type === "opened") finish({ ok: true });
      else if (event.type === "error") finish({ ok: false, kind: "refused", error: event.error });
    });
    void session.closed.then((payload) => {
      const reason = payload?.reason;
      if (reason && TRANSPORT_CLOSE_REASONS.includes(reason as ViewClosedReason)) {
        finish({ ok: false, kind: "transport", closedReason: reason });
        return;
      }
      finish({ ok: false, kind: "refused", closedReason: reason });
    });
    const timer = setTimeout(() => finish({ ok: false, kind: "timeout" }), timeoutMs);
    timer.unref?.();
  });
}

/**
 * Why a resident-slot registration attempt failed.
 * - `no-host` / `unsupported`: permanent soft-fail — do not retry.
 * - `refused`: the Host explicitly rejected this registration.
 * - `timeout`: the Host never acked within the handshake budget (slow host).
 * - `transport`: the pipe dropped or the client was disposed mid-attempt.
 * - `failed` / `invalid`: generic retryable failure / bad options.
 *
 * `timeout` and `transport` were folded into `refused` / `failed` before
 * docs/design/20 O2, which made "the host is just slow" indistinguishable from
 * "the host said no" — the exact confusion that turns a re-probe loop into a
 * permanent give-up.
 */
export type SlotRegisterFailure =
  | "no-host"
  | "unsupported"
  | "invalid"
  | "refused"
  | "failed"
  | "timeout"
  | "transport";

export type SlotRegisterOutcome<H> =
  | { ok: true; handle: H }
  | { ok: false; reason: SlotRegisterFailure; error?: ViewErrorPayload };

/**
 * Register an access mode into PiDesk's composer mode dropdown.
 *
 * The Host renders one row per registration; activation flows back as
 * `mode:activate` / `mode:deactivate` action events on the session. The
 * extension stays the source of truth: call `handle.setActive()` after the
 * mode actually changes (also from TUI toggles, keeping both surfaces in sync).
 *
 * Resolves `null` (never throws) when the Host is absent, too old (no
 * `access-mode` in `hello`), refuses the slot, the connection fails, or
 * `id`/`title` are empty — callers fall back to their command / shortcut path.
 *
 * Prefer `superviseAccessMode` (slot.ts) for resident chips: it owns
 * re-registration, backoff, and shutdown. This function is the one-shot
 * primitive underneath.
 */
export async function registerAccessMode(
  client: DesktopViewClient,
  options: RegisterAccessModeOptions,
): Promise<AccessModeHandle | null> {
  const outcome = await tryRegisterAccessMode(client, options);
  return outcome.ok ? outcome.handle : null;
}

/**
 * Soft-registration with an explicit failure reason — used by the slot
 * supervisor to decide retry vs. permanent unsupported.
 */
export async function tryRegisterAccessMode(
  client: DesktopViewClient | null,
  options: RegisterAccessModeOptions,
): Promise<SlotRegisterOutcome<AccessModeHandle>> {
  if (!client) return { ok: false, reason: "no-host" };
  if (options.signal?.aborted) return { ok: false, reason: "invalid" };
  if (!options.id.trim() || !options.title.trim()) {
    // 非法描述符会被宿主静默清洗成不可见注册，这里提前给出可诊断的失败
    console.warn("[pidesk/view-sdk] registerAccessMode requires non-empty id and title");
    return { ok: false, reason: "invalid" };
  }

  const descriptor: ViewModeDescriptor = {
    id: options.id,
    title: options.title,
    description: options.description,
    icon: options.icon,
    accent: options.accent,
  };

  let session: LiveViewSession | null = null;
  try {
    const hello = await client.ensureConnected();
    // hello 缺失 = 慢宿主 / 握手预算耗尽，可重试；hello 在但无槽位 = 老宿主，停止。
    if (!hello) return { ok: false, reason: "timeout" };
    if (!hello.placements.includes("access-mode")) return { ok: false, reason: "unsupported" };

    session = await client.openLive(
      {
        placement: "access-mode",
        // 注册槽语义就是落在模式面板；老宿主必须显式失败（由 hello 预检兜住，不弹 modal）
        placementRequired: true,
        placementHint: { mode: { ...descriptor } },
        // Host 不渲染本槽位的树；root 仅满足协议必填
        root: { type: "text", content: options.title, variant: "caption" },
        contributionKey: options.contributionKey,
      },
      { signal: options.signal, onEvent: options.onEvent },
    );

    const opened = await awaitOpened(session);
    if (opened.ok) {
      return {
        ok: true,
        handle: {
          viewId: session.id,
          session,
          setActive(active, detail) {
            descriptor.active = active;
            descriptor.detail = detail;
            session?.update({ placementHint: { mode: { ...descriptor } } });
          },
        },
      };
    }

    session.close();
    if (opened.kind === "timeout") return { ok: false, reason: "timeout" };
    if (opened.kind === "transport") return { ok: false, reason: "transport" };
    return { ok: false, reason: "refused", error: opened.error };
  } catch (err) {
    // 连接失败 / client 已 dispose：可重试（管道闪断），绝不向扩展抛错
    session?.close();
    if (err instanceof ViewHostError) {
      if (err.code === "placement") return { ok: false, reason: "unsupported" };
      if (err.code === "limit" || err.code === "protocol") {
        return { ok: false, reason: "refused", error: err.payload };
      }
      return { ok: false, reason: "transport" };
    }
    return { ok: false, reason: "transport" };
  }
}
