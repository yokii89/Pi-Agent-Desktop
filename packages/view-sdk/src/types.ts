/**
 * Protocol types for view/v1.
 *
 * GENERATED FILE — do not edit by hand.
 * Source of truth: PiDesk `src/shared/view.ts` (// #begin view-sdk-protocol … // #end view-sdk-protocol).
 * Regenerate: `node scripts/sync-view-sdk-types.mjs`
 * Verify:      `node scripts/sync-view-sdk-types.mjs --check`
 *
 * Self-contained so extensions can depend on `@pidesk/view-sdk` without
 * pulling Electron / renderer code.
 */

export const VIEW_PROTOCOL_VERSION = "view/v1";

/**
 * 挂载点。缺省 "modal"。
 * P1：modal/stream/widget/panel；P2：sidebar/header/settings；P3：access-mode（docs/design/14）。
 *
 * 注册槽（resident registration slot）语义见 @pidesk/view-sdk `superviseSlot`：
 * 常驻注册 + 进程级生命周期由 SDK 内建，扩展不再手写 supervisor。
 */
export type ViewPlacement =
  | "modal"
  | "stream"
  | "widget"
  | "panel"
  | "sidebar"
  | "header"
  | "settings"
  | "access-mode";

export interface ViewResult {
  action?: string;
  values: Record<string, unknown>;
}

export interface ViewOption {
  value: string;
  label: string;
  description?: string;
}

/** tabs 节点的单个页签：children 始终属于同一棵树（非激活页仅隐藏不卸载）。 */
export interface ViewTab {
  id: string;
  label: string;
  /** chip 角标：answered=✓（成功色）/ attention=!（警示色）；缺省=未作答（空心点）。 */
  status?: "answered" | "attention";
  children: ViewNode[];
}

/** table 的列定义（docs/design/19 §3.2.1）。 */
export interface ViewTableColumn {
  /** 行 `cells` 的索引键。 */
  key: string;
  label: string;
  /** 列宽权重；缺省等分。渲染层映射为百分比列宽，不接受任意样式。 */
  width?: number;
  /** 单元格文本对齐；缺省 left。 */
  align?: "left" | "center" | "right";
}

/**
 * table 的数据行。Host 只保留协议声明的原始值（`string` / 有限 `number` / `boolean` /
 * `null`），其余归一为 `null`；未声明列的 key 一律丢弃。渲染层负责文本化：数字用
 * 等宽字形对齐，`null` 渲染为空。
 */
export interface ViewTableRow {
  /** 行稳定 id：整树 update 时用于保持行身份。 */
  id: string;
  cells: Record<string, string | number | boolean | null>;
}

export type ViewNode =
  | { type: "text"; content: string; variant?: "body" | "caption" | "heading" }
  | { type: "markdown"; content: string }
  | { type: "divider" }
  | { type: "column"; children: ViewNode[]; gap?: number }
  | { type: "row"; children: ViewNode[]; gap?: number }
  | { type: "card"; title?: string; children: ViewNode[] }
  | {
      type: "button";
      id: string;
      label: string;
      variant?: "primary" | "danger" | "ghost";
      disabled?: boolean;
    }
  | {
      type: "input";
      id: string;
      label?: string;
      placeholder?: string;
      value?: string;
      multiline?: boolean;
    }
  | { type: "select"; id: string; label?: string; options: ViewOption[]; value?: string }
  | { type: "checkbox"; id: string; label: string; checked?: boolean }
  | {
      type: "list";
      id: string;
      items: ViewOption[];
      value?: string | string[];
      multiple?: boolean;
    }
  | { type: "progress"; value?: number; label?: string }
  /**
   * 页签容器。语义（docs/design/08 §5.1）：
   * - 非激活页签的 children 仍属于树本身：表单值收集/保留必须覆盖全部页签，
   *   渲染层建议全挂载 + 隐藏（保输入法/焦点/值）。
   * - activeTab 是视图状态，不进表单 values。缺省或与上次相同时 Host 维持
   *   本地切换（点击 / ←→）；变更时视为扩展显式接管（如答完自动前进）。
   * - 页签切换不产生 change 事件。
   */
  | { type: "tabs"; id: string; tabs: ViewTab[]; activeTab?: string }
  /**
   * 表格（docs/design/19 §3.2.1）：多行多列只读状态。语义边界——
   * - **只呈现**：不排序、不筛选、不分页，过滤由扩展侧重算后整体 update；
   * - 行按 1 个节点计入 `maxNodes` 预算（单元格不单独计），列数受 `maxTableColumns` 约束；
   * - `maxRows` 是作者声明的渲染上限：Host 截断并在表尾显示「显示 N / 共 M」，
   *   行数硬上限另有 `maxTableRows`（协议预算，先于 maxRows 生效）；
   * - **不是表单控件**：不进 `values`，`id` 只用于渲染层行身份。
   * 旧 Host 未广告 `view-table` 能力时会降级为 `unknown` 占位，扩展必须据此
   * 回退到 `row`/`column` 组合，不得依赖占位完成关键操作（docs/design/19 §7.1）。
   */
  | {
      type: "table";
      id: string;
      columns: ViewTableColumn[];
      rows: ViewTableRow[];
      /** 空态文案；缺省用宿主通用空态。 */
      emptyText?: string;
      /** 最大渲染行数；超出由 Host 截断并显示统计。 */
      maxRows?: number;
    }
  /**
   * Host 生成：Client 发送了未知 type 时降级为诊断占位（P1）。
   * Client 不得主动构造此节点。
   */
  | { type: "unknown"; originalType: string };

export interface ViewAction {
  id: string;
  label: string;
  variant?: "primary" | "danger" | "ghost";
  /**
   * submit：提交/确认类（实时模式仍由 Client close）。
   * event：只发事件，不关闭。
   * 缺省 submit。
   */
  kind?: "submit" | "event";
  disabled?: boolean;
}

export interface ViewPlacementHint {
  /** stream：插到该条目之后；缺省追加到会话流末尾 */
  afterEntryId?: string;
  /** widget：编辑器上方/下方；缺省 "aboveEditor" */
  side?: "aboveEditor" | "belowEditor";
  /**
   * widget：true = 覆盖层悬浮（对齐输入栏 @ 菜单），不参与输入栈布局；
   * false/缺省 = 停靠条（≤96px）。表单类内容应设 true 以获得更高滚动区。
   */
  floating?: boolean;
  /**
   * panel / sidebar / settings 的稳定槽位 id。
   * 同 connection 同 id 新 open 顶替旧视图；缺省 Host 生成 `ext-<viewId>`。
   * settings 页上多个不同 id 的视图以卡片形式纵向堆叠。
   */
  panelId?: string;
  /** header：嵌入顶栏左侧（缺省）/ 中央 / 右侧动作区，与正文三栏对齐。 */
  headerSide?: HeaderSide;
  /**
   * access-mode：模式注册元数据（docs/design/14）。
   * update 时整体替换；扩展为 `active` 的真值源。
   */
  mode?: ViewModeDescriptor;
}

/** header 三端：与正文 nav | main | aside 对齐。 */
export type HeaderSide = "left" | "center" | "right";

/** access-mode 模式的激活态强调色。 */
export type ViewModeAccent = "default" | "warning" | "success" | "danger";

/**
 * access-mode 注册槽的模式描述符（docs/design/14）。
 * 模式语义（工具门禁等）完全由扩展实现；Host 只呈现该描述符并转发激活指令。
 * 随 placementHint 整体替换更新；`active` 以扩展上报为真值源。
 */
export interface ViewModeDescriptor {
  /** 稳定模式 id（同 connection 去重键；渲染行 key）。 */
  id: string;
  /** 面板行标题。 */
  title: string;
  /** 面板行描述。 */
  description?: string;
  /** 宿主内置图标名（如 "clipboard"）；缺省 shield。不允许扩展传任意 UI。 */
  icon?: string;
  /** 激活态强调色；缺省 default。 */
  accent?: ViewModeAccent;
  /** 当前是否激活。 */
  active?: boolean;
  /** 激活态副文案（行内 detail）。 */
  detail?: string;
}

export interface ViewSpec {
  title?: string;
  root: ViewNode;
  actions?: ViewAction[];
  placement?: ViewPlacement;
  /**
   * true：显式要求的 placement 给不了时**不降级 modal**，直接 error + closed。
   * 「给不了」= 槽位名不在 `ViewPlacement` 枚举内（含拼错），或在枚举内但 Host 未实现完整 UI。
   * 缺省不写 `placement` 是合法的 modal 请求，不会被这条拒绝。缺省 false。
   */
  placementRequired?: boolean;
  placementHint?: ViewPlacementHint;
  /** Host 侧空闲超时（毫秒）；缺省不超时。与 open payload 同义。 */
  timeoutMs?: number;
  /** 稳定 Contribution key（docs/design/16）；与 Catalog 合并投影的主键。 */
  contributionKey?: string;
}

export type ViewEvent =
  | { type: "change"; nodeId: string; value: unknown }
  | { type: "action"; actionId: string; values?: Record<string, unknown> }
  | { type: "dismiss" };

/** 旁路消息信封（Client ↔ Host）。`hello` 仅 Host→Client，鉴权成功后推送。 */
export interface ViewEnvelope {
  v: typeof VIEW_PROTOCOL_VERSION;
  /** 视图会话 id（Client 生成，UUID）；hello 可为空串；notify/notified 用请求 id。 */
  id: string;
  type:
    | "hello"
    | "open"
    | "opened"
    | "event"
    | "update"
    | "patch"
    | "close"
    | "closed"
    | "error"
    | "notify"
    | "notified";
  payload: unknown;
}

/** open ack（Host → Client）：最终槽位与 panelId。老 Client 可忽略。 */
export interface ViewOpenedPayload {
  placement: ViewPlacement;
  panelId?: string;
  /** placement 为 header 时：最终落点侧别（非法/缺省已归一为 left）。 */
  headerSide?: HeaderSide;
}

/** hello payload（Host → Client）：capability 广告（docs/design/08 §12.7）。 */
export interface ViewHelloPayload {
  /** 协议标识；SDK 侧按 string 接收以便兼容旧 Host 的宽松实现。 */
  protocol: string;
  placements: ViewPlacement[];
  /** Host 支持的可选能力（docs/design/16 §7.1）；老 Host 不发送时 SDK 软降级。 */
  capabilities?: ViewHostCapability[];
  /**
   * 运行时生效的协议预算（docs/design/20 O3）。旧 Host 省略时，SDK 回落到
   * 编译期 `VIEW_LIMITS`——扩展作者因此总能拿到一个值，而新 Host 可以把
   * 真实预算（而非 README 散文）交给客户端。
   */
  limits?: ViewLimits;
}

/** Host 广告的可选协议能力。 */
export type ViewHostCapability =
  | "contribution-binding"
  | "notification"
  | "system-toast"
  | "view-table"
  | "view-patch";

/**
 * 本 Host 实际实现的能力集，`hello.capabilities` 的唯一来源。
 * 测试替身必须引用它而不是手抄一份（docs/design/20 O5：桩与真 Host 的漂移
 * 就是这么发生的）。新增能力只改这一行，SDK 侧的降级断言会跟着转红。
 */
export const VIEW_HOST_CAPABILITIES: readonly ViewHostCapability[] = [
  "contribution-binding",
  "notification",
  "system-toast",
  "view-table",
  "view-patch",
];

/**
 * 协议预算（docs/design/08 §8）。放在协议区内而不是宿主专用区，是为了让扩展
 * 作者不必抄一份 Host 的裁剪规则（准则 §7.1 单一类型源、docs/design/20 O3）：
 * 数值本身仍由 Host 在 `hello.limits` 里广告，SDK 侧只做本地预检。
 */
export interface ViewLimits {
  maxDepth: number;
  maxNodes: number;
  maxStringBytes: number;
  maxOptionItems: number;
  maxOpenViewsPerConnection: number;
  maxMessageBytes: number;
  /** table 行数硬上限（docs/design/19 §3.2.1 预算：200 行 ≈ 200 节点，仍在 maxNodes 内）。 */
  maxTableRows: number;
  /** 列数上限：表格列是布局输入而非数据，不与 maxOptionItems 共用宽松预算。 */
  maxTableColumns: number;
  /** 单次 patch 的最大操作数（docs/design/19 §10.3）。 */
  maxPatchOps: number;
}

/** 编译期默认预算；`hello.limits` 缺省时 SDK 回落到这里。 */
export const VIEW_LIMITS = {
  maxDepth: 32,
  maxNodes: 512,
  maxStringBytes: 64 * 1024,
  maxOptionItems: 1000,
  maxOpenViewsPerConnection: 8,
  maxMessageBytes: 1024 * 1024,
  maxTableRows: 200,
  maxTableColumns: 12,
  maxPatchOps: 32,
} as const satisfies ViewLimits;

/** 系统提示音：SDK 可声明的场景（docs/design/18；不含仅内建的 terminalExit）。 */
export type ViewNotificationScenarioId =
  | "completed"
  | "failed"
  | "needsAttention"
  | "interrupted"
  | "custom";

/** 内置提示音 id（宿主 assets，禁止任意路径）。 */
export type ViewNotificationSoundId = "1" | "2" | "3" | "4" | "5";

/** 系统桌面 toast 文案（纯文本；Host 截断，docs/design/24）。 */
export interface ViewNotifyToastPayload {
  /** 标题（必填）。 */
  title: string;
  /** 正文，可省略。 */
  body?: string;
}

/** Client → Host：请求播放系统提示音（可选同时弹桌面 toast）。 */
export interface ViewNotifyPayload {
  /** 使用宿主场景映射的默认音色；与 sound 同时给出时 sound 覆盖场景默认。 */
  scenario?: ViewNotificationScenarioId;
  /** 点名内置音色；缺省时 Host 按场景配置解析。 */
  sound?: ViewNotificationSoundId;
  /** 归属会话；缺省继承连接 auth 时的 sessionId。 */
  sessionId?: string;
  /** 短说明（宿主日志/诊断用，不保证展示）。 */
  reason?: string;
  /**
   * 同时弹系统桌面 toast。需 capability `system-toast`；仅主窗口未聚焦时展示，
   * 聚焦时抑制不视为失败（docs/design/24）。
   */
  toast?: ViewNotifyToastPayload;
}

/** Host → Client：notify 处理结果。 */
export interface ViewNotifiedPayload {
  ok: boolean;
  /** ok=false 时的原因；老 Host 协议错误由 SDK 映射为 unsupported。 */
  reason?: string;
}

/** open payload（Client → Host）。 */
export interface ViewOpenPayload {
  title?: string;
  root: ViewNode;
  actions?: ViewAction[];
  placement?: ViewPlacement;
  placementRequired?: boolean;
  placementHint?: ViewPlacementHint;
  timeoutMs?: number;
  /** 归属的 pi 会话运行时 SessionId；缺省继承连接 auth 时的 sessionId。 */
  sessionId?: string;
  /**
   * 稳定 Contribution key（docs/design/16 §5.3）。
   * 与 Catalog 条目对应；缺省时按 legacy live View 处理。
   */
  contributionKey?: string;
}

/** update payload（Client → Host）。整树替换；不得改 placement。 */
export interface ViewUpdatePayload {
  root?: ViewNode;
  title?: string;
  actions?: ViewAction[];
  placementHint?: ViewPlacementHint;
}

/**
 * 单条 patch 操作：沿 `path`（从 root 起的 children 下标；`tabs` 进入
 * `tabs[i].children`）替换子树。`path: []` 表示替换整棵 root。
 * Host 对每次 patch 做整树 sanitize，失败则**整次拒绝**、不部分应用
 * （docs/design/19 §10.3）。
 */
export interface ViewPatchOp {
  path: number[];
  node: ViewNode;
}

/**
 * patch payload（Client → Host）。部分更新；成功后 Host 向渲染层仍推
 * 合并后的整树 `update`——patch 只存在于 Client↔Host 线缆。
 * 需 Host 广告 `view-patch`；未广告时 SDK `session.patch()` 软失败。
 */
export interface ViewPatchPayload {
  ops: ViewPatchOp[];
  title?: string;
  actions?: ViewAction[];
  placementHint?: ViewPlacementHint;
}

/** close payload（Client → Host）。 */
export interface ViewClosePayload {
  result?: ViewResult;
}

/** closed payload（Host → Client）。 */
export type ViewClosedReason =
  | "user"
  | "session"
  | "replaced"
  | "placement"
  | "timeout"
  | "abort"
  | "dispose"
  | "limit"
  /** SDK 本地：`setSessionId()` 主动拆线（Host 从不发送，docs/design/15 P1-2）。 */
  | "rebind";

/**
 * `| (string & {})` 保留前向兼容（新 Host 可加 reason 而不破坏旧 SDK 编译），
 * 同时让 IDE 补全与 `ViewClosedReason` 穷尽检查继续生效——裸 `| string` 会把
 * 整个 union 折叠成 `string`，拼错的 reason 也能通过类型检查。
 */
export interface ViewClosedPayload {
  reason?: ViewClosedReason | (string & {});
}

/** error payload（双向）。 */
export type ViewErrorCode = "protocol" | "limit" | "placement" | "internal";

export interface ViewErrorPayload {
  message: string;
  code: ViewErrorCode;
}

/**
 * access-mode 激活/停用指令（docs/design/14）。
 * 宿主渲染层点击模式行 → sendEvent(action) → 扩展真实生效后 update 上报新状态。
 */
export const ACCESS_MODE_ACTIONS = {
  activate: "mode:activate",
  deactivate: "mode:deactivate",
} as const;

/**
 * 已实现完整 UI 的槽位（宿主 hello 广告；SDK 侧用于 placement 预检与降级决策）。
 * 放在协议区内，Host 与扩展共用同一份，改预算不再只存在于 README 散文里。
 */
export const IMPLEMENTED_VIEW_PLACEMENTS: ReadonlySet<ViewPlacement> = new Set([
  "modal",
  "stream",
  "widget",
  "panel",
  "sidebar",
  "header",
  "settings",
  "access-mode",
]);

/** 使用稳定 slotId（placementHint.panelId）的槽位：同 connection 同 id 顶替。 */
export const SLOTTED_VIEW_PLACEMENTS: ReadonlySet<ViewPlacement> = new Set([
  "panel",
  "sidebar",
  "settings",
]);
