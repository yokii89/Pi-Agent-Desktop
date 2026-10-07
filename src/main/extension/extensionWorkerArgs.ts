/**
 * Worker 启动参数纯函数（便于单测；extensionWorkerManager 复用）。
 * Spike：pi 支持 `--no-extensions` + `-e <path>` 选择性加载。
 */

export function buildWorkerArgs(extensionPaths: readonly string[]): string[] {
  const args = ["--mode", "rpc", "--no-session"];
  args.push("--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes");
  for (const p of extensionPaths) {
    args.push("-e", p);
  }
  return args;
}

/** 测试导出别名。 */
export const buildWorkerArgsForTest = buildWorkerArgs;
