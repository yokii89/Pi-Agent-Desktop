import os from "node:os";
import path from "node:path";

/** Shared resource location; retaining existing files does not enable the retired CLI. */
export function getPiAgentDir(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR;
  if (envDir && envDir.trim().length > 0) {
    const expanded = envDir.startsWith("~") ? path.join(os.homedir(), envDir.slice(1)) : envDir;
    return path.resolve(expanded);
  }
  return path.join(os.homedir(), ".pi", "agent");
}
