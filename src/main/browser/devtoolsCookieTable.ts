import type { ImportCookie } from "./browserDataImportRules";

/**
 * 解析 Chrome / Edge DevTools 「Cookie 表格」的复制内容（纯逻辑，便于单测）。
 *
 * 为什么需要这条路（docs/design/42 §6.7）：Chrome 127+ 的 App-Bound（`v20`）加密只有
 * **SYSTEM 级**进程解得开，第三方程序（含 pidesk）读不了 Cookie 库；但 DevTools 的
 * Application → Cookies 面板本身就能显示明文，且选中多行复制得到 TSV（Domain / Path /
 * Expires 都在里面）。于是「用户手动搬一次」成为不依赖提权即可承接登录态的路径。
 *
 * 解析原则：**宁可少解析，也不要写错**。域 Cookie（`domain` 带前导点）与 host-only 必须
 * 如实还原——上一轮 §6.1 的教训就是作用域写错的半套会话比没有更糟。
 */

/** DevTools 的布尔单元格：勾选态渲染为 ✓，新版本也可能是 true / 1。 */
const TRUE_CELLS = new Set(["✓", "✔", "true", "yes", "1"]);

/** `SameSite` 单元格 → Electron 词表。 */
function parseSameSiteCell(cell: string | undefined): ImportCookie["sameSite"] {
  const value = (cell ?? "").trim().toLowerCase();
  if (value === "strict") return "strict";
  if (value === "lax") return "lax";
  if (value === "none") return "no_restriction";
  return "unspecified";
}

function parseBoolCell(cell: string | undefined): boolean {
  return TRUE_CELLS.has((cell ?? "").trim().toLowerCase());
}

/**
 * Expires 列 → unix 秒。
 *
 * DevTools 在会话 Cookie 上显示 `Session`；其余是本地化/ISO 时间串。解不出时间就按会话
 * Cookie 处理（导入侧会落 400 天），不要因为一个格式差异把整行丢掉。
 */
function parseExpiresCell(cell: string | undefined): number | undefined {
  const value = (cell ?? "").trim();
  if (!value || /^session$/i.test(value)) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  const seconds = Math.floor(parsed / 1000);
  return seconds > 0 ? seconds : undefined;
}

function isHeaderRow(cells: string[]): boolean {
  const lower = cells.map((cell) => cell.trim().toLowerCase());
  return lower.includes("name") && lower.includes("value") && lower.includes("domain");
}

function isPathCell(cell: string | undefined): boolean {
  const value = (cell ?? "").trim();
  return value.startsWith("/") && !/\s/.test(value);
}

function isDomainCell(cell: string | undefined): boolean {
  const value = (cell ?? "").trim();
  return value.length > 0 && !/\s/.test(value) && !value.startsWith("/");
}

/** 按下标取值（下标缺省时返回 undefined，不抛错）。 */
function cellAt(cells: string[], index: number | undefined): string | undefined {
  if (index === undefined) return undefined;
  return cells[index];
}

/** 一行的解析结果；`null` 表示这条行不可用（宁可跳过也不猜）。 */
function rowToCookie(cells: string[], indexes: RowIndexes): ImportCookie | null {
  const name = (cellAt(cells, indexes.name) ?? "").trim();
  const value = cellAt(cells, indexes.value) ?? "";
  const domain = (cellAt(cells, indexes.domain) ?? "").trim();
  if (!name || !domain || /[\s;,]/.test(name)) return null;
  if (!isDomainCell(domain)) return null;

  const pathCell = (cellAt(cells, indexes.path) ?? "").trim();
  const path = isPathCell(pathCell) ? pathCell : "/";
  const expires = parseExpiresCell(cellAt(cells, indexes.expires));

  return {
    name,
    value,
    domain,
    path,
    secure: parseBoolCell(cellAt(cells, indexes.secure)),
    httpOnly: parseBoolCell(cellAt(cells, indexes.httpOnly)),
    expires,
    sameSite: parseSameSiteCell(cellAt(cells, indexes.sameSite)),
  };
}

interface RowIndexes {
  name: number;
  value: number;
  domain: number;
  path: number;
  expires?: number;
  httpOnly?: number;
  secure?: number;
  sameSite?: number;
}

/**
 * 表头行（DevTools 复制时**不会**带表头，但用户可能连表头一起拷）→ 列下标。
 * 认不出的列一律不给下标，映射时按缺省值处理。
 */
function indexesFromHeader(cells: string[]): RowIndexes | null {
  if (!isHeaderRow(cells)) return null;
  const find = (pattern: RegExp): number | undefined => {
    const index = cells.findIndex((cell) => pattern.test(cell.trim().toLowerCase()));
    return index >= 0 ? index : undefined;
  };
  const name = find(/^name$/);
  const value = find(/^value$/);
  const domain = find(/^domain$/);
  if (name === undefined || value === undefined || domain === undefined) return null;
  return {
    name,
    value,
    domain,
    path: find(/^path$/) ?? domain + 1,
    expires: find(/^expires/),
    httpOnly: find(/http\s*only|^httponly$/),
    secure: find(/^secure$/),
    sameSite: find(/same\s*site/),
  };
}

/**
 * 无表头时按列内容定位（DevTools 的列顺序在不同版本间会增减，硬编码下标会在少一列时
 * 整体错位，把 Expires 当 HttpOnly 写进分区）。
 *
 * 做法：先找 Path 列（唯一以 `/` 开头且无空白的单元格），Domain 必在它左边、Expires 在它
 * 右边；`Name` 固定第 0 列，`Value` 取 1..Domain 之间的内容（值里含制表符时不会被切断）。
 */
function indexesFromContent(cells: string[]): RowIndexes | null {
  const path = cells.findIndex((cell, index) => index >= 2 && isPathCell(cell));
  if (path < 0) return null;
  const domain = path - 1;
  if (domain < 1) return null;
  const tail = cells.slice(path + 1);
  const expiresOffset = 0; // Expires 紧邻 Path 之后
  // Size 列是纯数字，不能当布尔列（否则 HttpOnly / Secure 的下标会整体前移一格）
  const boolCells = tail
    .map((cell, offset) => ({ cell: (cell ?? "").trim(), offset }))
    .filter(({ cell }) => !isNumericCell(cell) && isBoolCell(cell));
  const sameSiteOffset = tail.findIndex((cell) =>
    /^(strict|lax|none|unspecified)$/i.test((cell ?? "").trim()),
  );
  const toIndex = (offset: number): number | undefined =>
    offset >= 0 ? path + 1 + offset : undefined;
  return {
    name: 0,
    value: 1,
    domain,
    path,
    expires: toIndex(expiresOffset),
    httpOnly: toIndex(boolCells[0]?.offset ?? -1),
    secure: toIndex(boolCells[1]?.offset ?? -1),
    sameSite: toIndex(sameSiteOffset),
  };
}

function isNumericCell(cell: string): boolean {
  return /^\d+$/.test(cell);
}

function isBoolCell(cell: string): boolean {
  const value = cell.toLowerCase();
  return value === "" || TRUE_CELLS.has(value) || value === "✗" || value === "false";
}

/**
 * DevTools Cookie 表格 → 归一 Cookie 列表。
 *
 * 返回 `null` 表示「这段文本不是表格」（例如 `name=value; ...` 或右侧 Copy as cURL 的
 * `Cookie:` 头），调用方据此回退到原有的 `name=value` 粘贴路径。表格里解析不出来的单行
 * 直接跳过：一行错写进分区，就可能造成一条作用域错误的 Cookie。
 */
export function parseDevtoolsCookieTable(text: string): ImportCookie[] | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;

  const rows = lines.filter((line) => line.includes("\t")).map((line) => line.split("\t"));
  // 至少要有「像表格」的行：>=4 列且含 path 列；否则交给 pairs 路径
  if (rows.length === 0 || !rows.some((cells) => cells.length >= 4)) return null;

  const headerIndexes = rows[0] ? indexesFromHeader(rows[0]) : null;
  const cookies: ImportCookie[] = [];
  for (const [index, cells] of rows.entries()) {
    // 表头行本身不是 Cookie（DevTools 默认不带表头，但用户可能连表头一起拷）
    if (index === 0 && headerIndexes) continue;
    const indexes = headerIndexes ?? indexesFromContent(cells);
    if (!indexes) continue;
    const cookie = rowToCookie(cells, indexes);
    if (cookie) cookies.push(cookie);
  }
  return cookies.length > 0 ? cookies : null;
}
