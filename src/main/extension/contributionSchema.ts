/**
 * Contribution Catalog 构建与校验（docs/design/16 §5）。
 * 纯函数层：不读磁盘、不 import Electron，便于单测。
 */

import { createHash } from "node:crypto";
import os from "node:os";
import type {
  ContributionAccent,
  ContributionActivation,
  ContributionDiagnostic,
  ContributionPlacement,
  ExtensionContribution,
} from "../../shared/contribution";
import { CONTRIBUTION_ICONS, CONTRIBUTION_LIMITS } from "../../shared/contribution";

/** package.json `pidesk` 字段的归一形态（manifest 解析结果）。 */
export interface ParsedPideskManifest {
  accessModes: ManifestContributionItem[];
  settingsViews: ManifestContributionItem[];
  panels: ManifestContributionItem[];
  workerSafe: boolean;
}

export interface ManifestContributionItem {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  accent?: ContributionAccent;
  activation?: ContributionActivation;
}

export interface PackageManifestInput {
  /** 展示身份：npm 名 / git host/path / local basename。 */
  packageId: string;
  /** 规范化 package source identity（key 材料；local 用 basename+hash）。 */
  sourceIdentity: string;
  scope: "user" | "project";
  projectDir?: string;
  packageVersion?: string;
  /** package.json 或 sidecar 中的 pidesk 字段原始对象。 */
  pideskField: unknown;
  /** 包是否整体启用；false 时不产出任何 contribution。 */
  enabled: boolean;
}

export interface CatalogBuildResult {
  entries: ExtensionContribution[];
  diagnostics: ContributionDiagnostic[];
}

/** 规范化项目根：小写盘符 + 正斜杠 + 去尾分隔符（Windows 路径稳定 contextId）。 */
export function normalizeProjectDir(projectDir: string | null | undefined): string | null {
  if (!projectDir) return null;
  let p = projectDir.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(p)) {
    p = p[0].toLowerCase() + p.slice(1);
  }
  p = p.replace(/\/+$/, "");
  // 未选项目的进程以 home 为 cwd，与冷态 user 目录必须使用相同身份。
  if (p.toLowerCase() === os.homedir().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase())
    return null;
  return p || null;
}

/**
 * Catalog contextId：user + 规范化项目根。
 * 不直接把原始绝对路径作为对外身份；用短 hash，避免渲染层拿到未清洗路径语义。
 */
export function computeContextId(projectDir: string | null | undefined): string {
  const normalized = normalizeProjectDir(projectDir);
  if (!normalized) return "user";
  const hash = createHash("sha256")
    .update(process.platform === "win32" ? normalized.toLowerCase() : normalized)
    .digest("hex")
    .slice(0, 16);
  return `proj_${hash}`;
}

/**
 * package source identity 的 key 材料。
 * npm/git 使用 identity；local 路径用 basename + path hash，避免 key 暴露绝对路径。
 */
export function packageKeyIdentity(kind: string, identity: string): string {
  if (kind === "local" || /^[a-zA-Z]:[\\/]/.test(identity) || identity.startsWith("/")) {
    const base = identity.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? identity;
    const hash = createHash("sha256").update(identity).digest("hex").slice(0, 12);
    return `local:${base}:${hash}`;
  }
  return `${kind}:${identity}`;
}

/** 稳定 contributionKey（docs/design/16 §5.3）。 */
export function buildContributionKey(parts: {
  contextId: string;
  scope: "user" | "project";
  packageKey: string;
  placement: ContributionPlacement;
  id: string;
}): string {
  return ["ck", parts.contextId, parts.scope, parts.packageKey, parts.placement, parts.id].join(
    ":",
  );
}

function asString(raw: unknown, maxLen: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function parseAccent(raw: unknown): ContributionAccent | undefined {
  if (raw === "default" || raw === "warning" || raw === "success" || raw === "danger") {
    return raw;
  }
  return undefined;
}

function parseActivation(raw: unknown, placement: ContributionPlacement): ContributionActivation {
  if (raw === "onAccessMode" || raw === "onSettingsView" || raw === "onSessionView") {
    return raw;
  }
  if (placement === "access-mode") return "onAccessMode";
  if (placement === "settings") return "onSettingsView";
  // panel 及其它会话级入口：冷态经 ensureSession + live 注册激活（docs/design/19 §10.1）
  return "onSessionView";
}

function parseItem(
  raw: unknown,
  placement: ContributionPlacement,
): { item: ManifestContributionItem | null; error: string | null } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { item: null, error: "贡献项不是对象" };
  }
  const record = raw as Record<string, unknown>;
  const id = asString(record.id, CONTRIBUTION_LIMITS.maxIdLength);
  const title = asString(record.title, CONTRIBUTION_LIMITS.maxTitleLength);
  if (!id) return { item: null, error: "缺少 id" };
  if (!title) return { item: null, error: "缺少 title" };

  const description = asString(record.description, CONTRIBUTION_LIMITS.maxDescriptionLength);
  let icon = asString(record.icon, CONTRIBUTION_LIMITS.maxIconLength);
  if (icon && !CONTRIBUTION_ICONS.has(icon)) {
    // 非法 icon：跳过该项字段，不阻断条目
    icon = undefined;
  }

  return {
    item: {
      id,
      title,
      description,
      icon,
      accent: parseAccent(record.accent),
      activation: parseActivation(record.activation, placement),
    },
    error: null,
  };
}

/** 解析 package.json / sidecar 的 `pidesk` 字段。 */
export function parsePideskManifest(pideskField: unknown): ParsedPideskManifest {
  const empty: ParsedPideskManifest = {
    accessModes: [],
    settingsViews: [],
    panels: [],
    workerSafe: false,
  };
  if (!pideskField || typeof pideskField !== "object" || Array.isArray(pideskField)) {
    return empty;
  }
  const pidesk = pideskField as Record<string, unknown>;
  const contributes =
    pidesk.contributes && typeof pidesk.contributes === "object"
      ? (pidesk.contributes as Record<string, unknown>)
      : {};

  const parseList = (
    raw: unknown,
    placement: ContributionPlacement,
  ): ManifestContributionItem[] => {
    if (!Array.isArray(raw)) return [];
    const out: ManifestContributionItem[] = [];
    for (const entry of raw.slice(0, CONTRIBUTION_LIMITS.maxPerPackage)) {
      const { item } = parseItem(entry, placement);
      if (item) out.push(item);
    }
    return out;
  };

  const worker =
    pidesk.worker && typeof pidesk.worker === "object"
      ? (pidesk.worker as Record<string, unknown>)
      : null;

  return {
    accessModes: parseList(contributes.accessModes, "access-mode"),
    settingsViews: parseList(contributes.settingsViews, "settings"),
    panels: parseList(contributes.panels, "panel"),
    workerSafe: worker?.safe === true,
  };
}

/** 从单个已启用包构建 contribution 条目 + 诊断。 */
export function contributionsFromPackage(
  input: PackageManifestInput,
  contextId: string,
): CatalogBuildResult {
  const entries: ExtensionContribution[] = [];
  const diagnostics: ContributionDiagnostic[] = [];

  if (!input.enabled) {
    return { entries, diagnostics };
  }

  const manifest = parsePideskManifest(input.pideskField);
  const diagnose = (message: string, field?: string): void => {
    diagnostics.push({ packageId: input.packageId, scope: input.scope, message, field });
  };
  if (input.pideskField == null) {
    diagnose("未声明桌面能力，扩展 View 将在会话启动后出现");
  } else if (typeof input.pideskField !== "object" || Array.isArray(input.pideskField)) {
    diagnose("pidesk 声明必须是 JSON 对象", "pidesk");
  } else {
    const contributes = (input.pideskField as Record<string, unknown>).contributes;
    if (contributes && typeof contributes === "object" && !Array.isArray(contributes)) {
      for (const [field, placement] of [
        ["accessModes", "access-mode"],
        ["settingsViews", "settings"],
        ["panels", "panel"],
      ] as const) {
        const raw = (contributes as Record<string, unknown>)[field];
        if (raw === undefined) continue;
        if (!Array.isArray(raw)) {
          diagnose("贡献列表必须是数组", field);
          continue;
        }
        if (raw.length > CONTRIBUTION_LIMITS.maxPerPackage)
          diagnose("贡献数量超过上限，已截断", field);
        for (const [index, value] of raw.slice(0, CONTRIBUTION_LIMITS.maxPerPackage).entries()) {
          const { error } = parseItem(value, placement);
          const itemField = `${field}[${index}]`;
          if (error) {
            diagnose(error, itemField);
            continue;
          }
          const item = value as Record<string, unknown>;
          if (typeof item.icon === "string" && !CONTRIBUTION_ICONS.has(item.icon))
            diagnose("图标不受支持，已使用默认图标", `${itemField}.icon`);
          for (const [name, limit] of [
            ["id", CONTRIBUTION_LIMITS.maxIdLength],
            ["title", CONTRIBUTION_LIMITS.maxTitleLength],
            ["description", CONTRIBUTION_LIMITS.maxDescriptionLength],
          ] as const) {
            if (typeof item[name] === "string" && item[name].length > limit)
              diagnose(`字段超过 ${limit} 字符，已截断`, `${itemField}.${name}`);
          }
        }
      }
    } else if (contributes !== undefined) diagnose("contributes 必须是对象", "contributes");
  }
  // sourceIdentity 已是规范化 key 材料（npm:/git:/local:）；裸名再包一层 pkg:
  const packageKey = input.sourceIdentity.includes(":")
    ? input.sourceIdentity
    : packageKeyIdentity("pkg", input.sourceIdentity);

  const pushItems = (items: ManifestContributionItem[], placement: ContributionPlacement): void => {
    for (const item of items) {
      if (entries.length >= CONTRIBUTION_LIMITS.maxPerPackage) {
        diagnostics.push({
          packageId: input.packageId,
          scope: input.scope,
          message: `贡献数量超过上限 ${CONTRIBUTION_LIMITS.maxPerPackage}，已截断`,
        });
        return;
      }
      const key = buildContributionKey({
        contextId,
        scope: input.scope,
        packageKey,
        placement,
        id: item.id,
      });
      // 同包同 placement 同 id 去重（manifest 重复时保留先出现的）
      if (entries.some((e) => e.key === key)) {
        diagnostics.push({
          packageId: input.packageId,
          scope: input.scope,
          message: `重复的 contribution id "${item.id}"（${placement}），已忽略后续项`,
          field: item.id,
        });
        continue;
      }
      entries.push({
        key,
        catalogContextId: contextId,
        packageId: input.packageId,
        scope: input.scope,
        projectDir: input.scope === "project" ? input.projectDir : undefined,
        placement,
        id: item.id,
        title: item.title,
        description: item.description,
        icon: item.icon,
        accent: item.accent ?? "default",
        activation: item.activation ?? parseActivation(undefined, placement),
        workerSafe: manifest.workerSafe,
        packageVersion: input.packageVersion,
      });
    }
  };

  pushItems(manifest.accessModes, "access-mode");
  pushItems(manifest.settingsViews, "settings");
  pushItems(manifest.panels, "panel");

  return { entries, diagnostics };
}

/** 由 entries 生成 Catalog fingerprint（用于 stale 检测）。 */
export function computeCatalogFingerprint(
  entries: ReadonlyArray<Pick<ExtensionContribution, "key" | "packageVersion" | "title">>,
): string {
  const sorted = [...entries]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((e) => JSON.stringify(e));
  return createHash("sha256").update(sorted.join("\n")).digest("hex").slice(0, 16);
}
