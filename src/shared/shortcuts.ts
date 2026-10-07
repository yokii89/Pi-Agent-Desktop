/**
 * 键盘快捷键机制层（参数化，主/渲共用）。
 * 可绑定的动作清单由渲染层注册表提供（src/renderer/actions/actionRegistry.ts），
 * 本文件只承载与清单无关的机制：canonical 组合解析、事件归一、冲突检测、
 * 读盘归一与结构校验——新增动作不需要改这里。
 *
 * 组合串为 canonical 形式 `Ctrl+Alt+Shift+<主键>`；主键支持字母 / 数字 / F1-F12 /
 * 方向键（ArrowUp/Down/Left/Right，供"上/下一个会话"这类导航语义）。
 */

/** 绑定清单条目（注册表投影；defaultCombo 为 null 表示仅面板命令、不可绑定）。 */
export interface ShortcutBinding {
  readonly id: string;
  readonly defaultCombo: string | null;
}

/** 键位映射的传输形态（settings.json / IPC）；合法性由注册表驱动的归一保证。 */
export type ShortcutsMap = Record<string, string>;

const MODIFIER_EVENT_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "OS", "AltGraph"]);
const CANONICAL_MAIN = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Arrow(?:Up|Down|Left|Right))$/;
const ARROW_MAIN = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/**
 * 禁止占用的系统编辑/浏览器组合（录入与读盘一律拒绝）。
 * 用户若绑到 Ctrl+C 等会直接打断复制粘贴，性价比极低。
 * Ctrl+R / Ctrl+Shift+R 额外对应 Electron 默认菜单的 reload / forceReload 角色：
 * 键可能在浏览器进程层被吞或误触强制刷新，绝不绑定。
 * 注意方向键不在此列：绑定动作均不在输入框内触发（allowInEditable=false），
 * 与文本编辑语义（Ctrl+Left/Right 词跳转）天然错开。
 */
const RESERVED_COMBOS = new Set<string>([
  "Ctrl+C",
  "Ctrl+V",
  "Ctrl+X",
  "Ctrl+A",
  "Ctrl+Z",
  "Ctrl+Y",
  "Ctrl+Shift+Z",
  "Ctrl+W",
  "Ctrl+R",
  "Ctrl+Shift+R",
  "Ctrl+F",
]);

/** 键盘事件最小字段（不依赖 DOM lib，主/渲共用）。 */
export interface ShortcutKeyEvent {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  key: string;
  /** 物理键位；录入/匹配优先用它，避免 Shift+1 → `!` 这类布局符号。 */
  code?: string;
}

/** 录入解析结果：可写入 / 系统保留 / 缺修饰或非法 / 纯修饰键（静默等待）。 */
export type ParseEventCombo =
  | { type: "combo"; combo: string }
  | { type: "reserved"; combo: string }
  | { type: "invalid" }
  | { type: "modifier" };

/** 是否为合法 canonical 组合（至少含 Ctrl 或 Alt，主键在白名单内，非保留键）。 */
export function isCanonicalCombo(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (RESERVED_COMBOS.has(value)) return false;
  const parts = value.split("+");
  if (parts.length < 2) return false;
  const main = parts.at(-1);
  if (!main || !CANONICAL_MAIN.test(main)) return false;
  const mods = parts.slice(0, -1);
  if (mods.some((m) => m !== "Ctrl" && m !== "Alt" && m !== "Shift")) return false;
  if (!mods.includes("Ctrl") && !mods.includes("Alt")) return false;
  if (mods.length !== new Set(mods).size) return false;
  return true;
}

/** 仅校验语法与主键，不拦保留组合（供录入区分 reserved / invalid）。 */
function isSyntacticCombo(value: string): boolean {
  if (RESERVED_COMBOS.has(value)) return false;
  const parts = value.split("+");
  if (parts.length < 2) return false;
  const main = parts.at(-1);
  if (!main || !CANONICAL_MAIN.test(main)) return false;
  const mods = parts.slice(0, -1);
  if (mods.some((m) => m !== "Ctrl" && m !== "Alt" && m !== "Shift")) return false;
  if (!mods.includes("Ctrl") && !mods.includes("Alt")) return false;
  if (mods.length !== new Set(mods).size) return false;
  return true;
}

function isReservedCombo(value: string): boolean {
  return RESERVED_COMBOS.has(value);
}

/** 主键：优先 `event.code`（KeyA / Digit1 / F5 / ArrowDown），回退 `event.key`。 */
function resolveMainKey(event: ShortcutKeyEvent): string | null {
  const code = event.code;
  if (code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^F(?:[1-9]|1[0-2])$/.test(code)) return code;
    if (ARROW_MAIN.has(code)) return code;
  }
  if (event.key.length === 1) {
    const upper = event.key.toUpperCase();
    return /^[A-Z0-9]$/.test(upper) ? upper : null;
  }
  if (/^F(?:[1-9]|1[0-2])$/.test(event.key)) return event.key;
  if (ARROW_MAIN.has(event.key)) return event.key;
  return null;
}

function buildComboParts(event: ShortcutKeyEvent): string[] {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  const main = resolveMainKey(event);
  if (main) parts.push(main);
  return parts;
}

/** 解析键盘事件：录入面板用完整原因；匹配路径见 eventToCombo。 */
export function parseEventCombo(event: ShortcutKeyEvent): ParseEventCombo {
  if (event.metaKey) return { type: "invalid" };
  if (MODIFIER_EVENT_KEYS.has(event.key)) return { type: "modifier" };
  if (!event.ctrlKey && !event.altKey) return { type: "invalid" };

  const main = resolveMainKey(event);
  if (!main) return { type: "invalid" };

  const parts = buildComboParts(event);
  const combo = parts.join("+");
  if (isReservedCombo(combo)) return { type: "reserved", combo };
  if (!isSyntacticCombo(combo)) return { type: "invalid" };
  return { type: "combo", combo };
}

/**
 * 从键盘事件生成 canonical 组合；纯修饰键、缺 Ctrl/Alt、含 Meta(Win)、
 * 主键不在白名单或属于保留组合时返回 null（匹配侧静默忽略）。
 */
export function eventToCombo(event: ShortcutKeyEvent): string | null {
  const parsed = parseEventCombo(event);
  return parsed.type === "combo" ? parsed.combo : null;
}

/** 事件是否触发指定组合（主键已由 eventToCombo / code 归一）。 */
export function matchesCombo(combo: string, event: ShortcutKeyEvent): boolean {
  if (!isCanonicalCombo(combo)) return false;
  return eventToCombo(event) === combo;
}

/** 当前映射中占用 combo 的命令；无冲突返回 null。 */
export function findConflict(
  bindings: readonly ShortcutBinding[],
  shortcuts: ShortcutsMap,
  combo: string,
  exceptId?: string,
): string | null {
  for (const binding of bindings) {
    if (binding.defaultCombo === null) continue;
    if (binding.id === exceptId) continue;
    if (shortcuts[binding.id] === combo) return binding.id;
  }
  return null;
}

/**
 * 读盘/IPC 归一（注册表驱动）：非法项回退默认；组合冲突时保留先登记的命令，
 * 后者回退默认（默认仍被占用则接受重复——UI 录入已拦截，手改文件才可能走到）。
 * 绑定数组的顺序即归一优先级，注册表必须把存量动作排在前位。
 */
export function normalizeShortcutsMap(
  bindings: readonly ShortcutBinding[],
  defaults: ShortcutsMap,
  value: unknown,
): ShortcutsMap {
  const out: ShortcutsMap = {};
  for (const binding of bindings) {
    if (binding.defaultCombo === null) continue;
    out[binding.id] = defaults[binding.id] ?? binding.defaultCombo;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return out;

  const raw = value as Record<string, unknown>;
  const claimed = new Set<string>();
  const overrides = new Map<string, string>();
  for (const binding of bindings) {
    if (binding.defaultCombo === null) continue;
    const combo = raw[binding.id];
    if (isCanonicalCombo(combo) && !claimed.has(combo)) {
      overrides.set(binding.id, combo);
      claimed.add(combo);
    }
  }

  for (const binding of bindings) {
    if (binding.defaultCombo === null) continue;
    const override = overrides.get(binding.id);
    if (override) {
      out[binding.id] = override;
      continue;
    }
    const fallback = out[binding.id];
    if (!claimed.has(fallback)) claimed.add(fallback);
  }
  return out;
}

/** 结构校验（主进程 settings 读写用）：只保留 string → string 键值，合法性由渲染层归一兜底。 */
export function sanitizeShortcutsRecord(value: unknown): ShortcutsMap {
  const out: ShortcutsMap = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return out;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}
