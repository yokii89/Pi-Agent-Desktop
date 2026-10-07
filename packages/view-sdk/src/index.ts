/**
 * @pidesk/view-sdk — Client SDK for the PiDesk extension View protocol.
 *
 * Usage (extension author):
 * ```ts
 * import { connectDesktopView, viewOnDesktop } from "@pidesk/view-sdk";
 *
 * const desktop = connectDesktopView();
 * if (desktop) {
 *   // One-shot form
 *   const result = await viewOnDesktop(desktop, {
 *     title: "Pick one",
 *     root: { type: "list", id: "model", items },
 *     actions: [{ id: "ok", label: "确认", variant: "primary" }],
 *   });
 *
 *   // Realtime factory
 *   await desktop.open(spec, {
 *     onEvent: (e, session) => {
 *       if (e.type === "change") session.update(render(state));
 *       if (e.type === "action" && e.actionId === "ok") session.close({ values });
 *     },
 *   });
 *   return result; // undefined = user dismissed
 * }
 * // else: TUI ctx.ui.custom() / dialog walker
 * ```
 */

export {
  supportsCapability,
  supportsPatch,
  supportsTable,
  type TableViewOptions,
  tableView,
  tableViewFallback,
  viewLimits,
} from "./capabilities.js";
export {
  type ConnectDesktopViewOptions,
  connectDesktopView,
  DesktopViewClient,
  type LiveViewSession,
  parseEndpoint,
  readEnv,
  type ViewHostEnv,
  ViewHostError,
  type ViewProcessEnv,
  type ViewSessionEvent,
} from "./client.js";
export {
  parseContributionKeyMap,
  readContributionKeysEnv,
  resolveContributionKey,
} from "./contribution.js";
export {
  describeBudgetViolations,
  frameBudgetViolations,
  hasRejectableViolation,
  measureViewTree,
  type ViewBudgetLimits,
  type ViewBudgetViolation,
  type ViewTreeBudget,
} from "./limits.js";
export {
  type PlayNotificationFailureReason,
  type PlayNotificationOptions,
  type PlayNotificationOutcome,
  type PlayNotificationScenario,
  type PlayNotificationSound,
  type PlayNotificationToast,
  playNotification,
} from "./notification.js";
// Test-only entry points (`__resetProcessViewClientForTests`,
// `__resetSlotLeasesForTests`) and the loopback host live in `./testing.js`:
// 准则 §6 forbids test hooks from becoming part of the consumer contract.
export {
  acquireProcessViewClient,
  disposeProcessViewClient,
  getProcessViewClient,
  processViewClientRefCount,
  releaseProcessViewClient,
} from "./processClient.js";
export {
  type CoalescedFrameMeta,
  type CoalescedViewWriter,
  createViewFrameScheduler,
  DEFAULT_VIEW_FRAME_INTERVAL_MS,
  type ViewFrameScheduler,
  type ViewFrameSchedulerOptions,
} from "./scheduler.js";
export {
  DEFAULT_SLOT_REPROBE_MS,
  DEFAULT_SLOT_RETRY_DELAYS_MS,
  type SlotLifecycleStatus,
  type SlotSupervisor,
  type SlotSupervisorSnapshot,
  type SuperviseAccessModeOptions,
  type SuperviseSlotOptions,
  superviseAccessMode,
  superviseSlot,
} from "./slot.js";
export {
  type HeaderSide,
  IMPLEMENTED_VIEW_PLACEMENTS,
  SLOTTED_VIEW_PLACEMENTS,
  VIEW_HOST_CAPABILITIES,
  VIEW_LIMITS,
  VIEW_PROTOCOL_VERSION,
  type ViewAction,
  type ViewClosedPayload,
  type ViewClosedReason,
  type ViewClosePayload,
  type ViewEnvelope,
  type ViewErrorCode,
  type ViewErrorPayload,
  type ViewEvent,
  type ViewHelloPayload,
  type ViewHostCapability,
  type ViewLimits,
  type ViewModeAccent,
  type ViewModeDescriptor,
  type ViewNode,
  type ViewNotificationScenarioId,
  type ViewNotificationSoundId,
  type ViewNotifiedPayload,
  type ViewNotifyPayload,
  type ViewNotifyToastPayload,
  type ViewOpenedPayload,
  type ViewOpenPayload,
  type ViewOption,
  type ViewPatchOp,
  type ViewPatchPayload,
  type ViewPlacement,
  type ViewPlacementHint,
  type ViewResult,
  type ViewSpec,
  type ViewTab,
  type ViewTableColumn,
  type ViewTableRow,
  type ViewUpdatePayload,
} from "./types.js";
export {
  ACCESS_MODE_ACTIONS,
  type AccessModeHandle,
  card,
  column,
  headerSpec,
  type OpenHeaderOptions,
  type OpenPanelOptions,
  type OpenSettingsViewOptions,
  type OpenSidebarOptions,
  type OpenWidgetOptions,
  openHeader,
  openPanel,
  openPanelResult,
  openSettingsView,
  openSettingsViewResult,
  openSidebar,
  openSidebarResult,
  openWidget,
  type RegisterAccessModeOptions,
  registerAccessMode,
  row,
  type SlotRegisterFailure,
  type SlotRegisterOutcome,
  tryRegisterAccessMode,
  type ViewCallOptions,
  type ViewOpenFailure,
  type ViewOpenFailureCode,
  type ViewOpenResult,
  viewOnDesktop,
  widgetSpec,
} from "./view.js";
