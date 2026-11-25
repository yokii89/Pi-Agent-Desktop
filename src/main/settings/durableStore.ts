import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import type { DurableModelConfig, RuntimeModelConfig } from "../../shared/durableProtocol";
import { parseRuntimeModel } from "../../shared/durableProtocol";
import type { SessionSummary } from "../../shared/ipc";
import { DURABLE_SESSION_ID, sessionRefKey } from "../../shared/sessionRef";

const root = () => path.join(app.getPath("userData"), "durable", "v1");
export const durableStorageRoot = () => path.join(root(), "sessions");
const indexFile = () => path.join(root(), "catalog.json");
const modelFile = () => path.join(root(), "model.bin");

function atomicWrite(file: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, file);
}

/** Only host metadata lives here; transcript and task authority remains in SQLite. */
export function durableCatalog(): SessionSummary[] {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(indexFile(), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (!Array.isArray(value)) throw new Error("Invalid Durable catalog.");
  return value.map((item: SessionSummary) => {
    if (
      !item ||
      !DURABLE_SESSION_ID.test(item.id) ||
      item.file !== sessionRefKey({ kind: "durable", id: item.id }) ||
      typeof item.cwd !== "string" ||
      !path.isAbsolute(item.cwd) ||
      !Number.isFinite(item.startedAt) ||
      !Number.isFinite(item.updatedAt)
    )
      throw new Error("Invalid Durable catalog entry.");
    return { ...item, ref: { kind: "durable", id: item.id } };
  });
}

export function saveDurableSummary(summary: SessionSummary): void {
  const entries = durableCatalog();
  const index = entries.findIndex((item) => item.id === summary.id);
  if (index < 0) entries.push(summary);
  else entries[index] = summary;
  atomicWrite(indexFile(), JSON.stringify(entries));
}

export function removeDurableSummary(id: string): void {
  atomicWrite(indexFile(), JSON.stringify(durableCatalog().filter((item) => item.id !== id)));
}

/** OS-encrypted credential storage owned by main. Never return this value over renderer IPC. */
export function readDurableModel(): RuntimeModelConfig | undefined {
  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(modelFile());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("OS credential encryption is unavailable.");
  const model = parseRuntimeModel(JSON.parse(safeStorage.decryptString(buffer)));
  if (!model) throw new Error("Invalid encrypted desktop model configuration.");
  return model;
}

export function publicDurableModel(): DurableModelConfig | null {
  const config = readDurableModel();
  if (!config) return null;
  const { apiKey: _key, ...publicConfig } = config;
  return { ...publicConfig, hasKey: true };
}

/** A blank key preserves the saved key. Changing endpoint requires re-entering it. */
export function saveDurableModel(value: unknown): DurableModelConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid model configuration.");
  const request = value as Record<string, unknown>;
  const previous = readDurableModel();
  if (!request.apiKey && previous && previous.baseUrl !== request.baseUrl)
    throw new Error("Enter an API key for the new endpoint.");
  const config = parseRuntimeModel({ ...request, apiKey: request.apiKey || previous?.apiKey });
  if (!config) throw new Error("Invalid model configuration. Use HTTPS or a local HTTP endpoint.");
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("OS credential encryption is unavailable.");
  atomicWrite(modelFile(), safeStorage.encryptString(JSON.stringify(config)));
  const { apiKey: _key, ...publicConfig } = config;
  return { ...publicConfig, hasKey: true };
}
