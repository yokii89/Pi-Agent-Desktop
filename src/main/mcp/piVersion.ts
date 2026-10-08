/**
 * pi 版本解析与内置 MCP 支持判定（docs/design/39 优雅降级）。
 *
 * pi v0.99.0 起才内置 MCP 扩展并读取 mcp.json；更旧的 pi 下配置编辑是静默空操作，
 * 必须在面板层降级提示。本模块保持纯函数（不引 Node API），供 vitest 直测。
 */

/** 内置 MCP 扩展的最低 pi 版本（pi v0.99.0，2026-09-29）。 */
export const MCP_MIN_PI_VERSION = "0.99.0";

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/** 从 `pi --version` 输出中提取首个 semver（容忍前缀 / 构建信息）；无版本号返回 null。 */
export function parsePiVersion(output: string): SemVer | null {
  const match = output.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  const [major, minor, patch] = match.slice(1).map(Number);
  return { major, minor, patch };
}

/** 逐位数值比较：version 是否 ≥ minimum。 */
export function isVersionAtLeast(version: SemVer, minimum: SemVer): boolean {
  if (version.major !== minimum.major) return version.major > minimum.major;
  if (version.minor !== minimum.minor) return version.minor > minimum.minor;
  return version.patch >= minimum.patch;
}

/**
 * pi 是否支持内置 MCP。
 * 返回 null 表示版本未知（`pi --version` 失败或输出无法解析），由调用方决定
 * 是否降级——未知时不降级，避免把「探测不到」误判成「不支持」。
 */
export function supportsBuiltinMcp(piVersionOutput: string | null): boolean | null {
  if (piVersionOutput === null) return null;
  const version = parsePiVersion(piVersionOutput);
  if (!version) return null;
  const minimum = parsePiVersion(MCP_MIN_PI_VERSION);
  return minimum ? isVersionAtLeast(version, minimum) : null;
}
