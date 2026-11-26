import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import {
  type BuiltinToolsConfig,
  defaultBuiltinToolsConfig,
  mergeBuiltinToolsConfig,
  parseBuiltinToolsConfig,
  publicBuiltinToolsConfig,
  type RuntimeBuiltinToolsConfig,
} from "../../shared/builtinTools";

const configFile = () => path.join(app.getPath("userData"), "durable", "v1", "builtin-tools.bin");

/** Only the main process reads decrypted tool credentials. Never return them through renderer IPC. */
export function readBuiltinTools(): RuntimeBuiltinToolsConfig {
  let encrypted: Buffer;
  try {
    encrypted = fs.readFileSync(configFile());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultBuiltinToolsConfig();
    throw error;
  }
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("OS credential encryption is unavailable.");
  const config = parseBuiltinToolsConfig(JSON.parse(safeStorage.decryptString(encrypted)));
  if (!config) throw new Error("Invalid encrypted built-in tool configuration.");
  return config;
}
export function publicBuiltinTools(): BuiltinToolsConfig {
  return publicBuiltinToolsConfig(readBuiltinTools());
}
/** Validate before atomically replacing the encrypted configuration. Blank keys preserve saved keys. */
export function saveBuiltinTools(value: unknown): BuiltinToolsConfig {
  const config = mergeBuiltinToolsConfig(value, readBuiltinTools());
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("OS credential encryption is unavailable.");
  const file = configFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(config)));
  fs.renameSync(temporary, file);
  return publicBuiltinToolsConfig(config);
}
