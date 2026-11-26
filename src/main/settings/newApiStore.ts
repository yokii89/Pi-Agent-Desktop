import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { type DurableModelConfig, parseRuntimeModel } from "../../shared/durableProtocol";
import {
  type GatewayCatalog,
  gatewayBaseUrl,
  gatewayModelRows,
  parseCodexModel,
} from "../../shared/newApi";
import {
  type GatewayCache,
  type GatewayCacheStorage,
  GatewayModelCatalog,
} from "../models/newApiCatalog";
import { publicDurableModel, readDurableModel, saveDurableModel } from "./durableStore";

const cacheFile = () => path.join(app.getPath("userData"), "durable", "v1", "newapi-models.json");
const storage: GatewayCacheStorage = {
  read() {
    try {
      const file = cacheFile();
      if (fs.statSync(file).size > 2 * 1024 * 1024) return undefined;
      const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      if (typeof value !== "object" || value === null) return undefined;
      const row = value as Record<string, unknown>;
      if (
        row.version !== 1 ||
        typeof row.signature !== "string" ||
        !/^[a-f0-9]{64}$/.test(row.signature) ||
        typeof row.checkedAt !== "number" ||
        !Number.isSafeInteger(row.checkedAt) ||
        row.checkedAt < 0 ||
        (row.fetchedAt !== null &&
          (typeof row.fetchedAt !== "number" ||
            !Number.isSafeInteger(row.fetchedAt) ||
            row.fetchedAt < 0)) ||
        typeof row.stale !== "boolean" ||
        (row.error !== null && (typeof row.error !== "string" || row.error.length > 512))
      )
        return undefined;
      const models = gatewayModelRows(row.models, true);
      if (!Array.isArray(row.models) || models.length !== row.models.length) return undefined;
      return { ...row, models } as GatewayCache;
    } catch {
      return undefined;
    }
  },
  write(cache) {
    const file = cacheFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(cache));
    fs.renameSync(`${file}.tmp`, file);
  },
  clear() {
    fs.rmSync(cacheFile(), { force: true });
  },
};
export const gatewayCatalog = new GatewayModelCatalog(storage);

/** Empty setup has no network access; all other calls use the encrypted desktop credential. */
export function loadGatewayCatalog(force = false): Promise<GatewayCatalog> {
  const config = readDurableModel();
  return config
    ? gatewayCatalog.load(config, force)
    : Promise.resolve({ models: [], fetchedAt: null, stale: false, error: null });
}

/** Discover before writing when the user leaves the preferred model blank. Failed setup preserves saved credentials. */
export async function saveGatewayModel(
  request: Record<string, unknown>,
): Promise<DurableModelConfig> {
  const previous = readDurableModel();
  if (typeof request.baseUrl !== "string") throw new Error("Invalid gateway endpoint.");
  const baseUrl = gatewayBaseUrl(request.baseUrl);
  if (!request.apiKey && previous && gatewayBaseUrl(previous.baseUrl) !== baseUrl)
    throw new Error("Enter an API key for the new endpoint.");
  const modelId = typeof request.modelId === "string" ? request.modelId.trim() : "";
  const config = parseRuntimeModel({
    ...request,
    baseUrl,
    modelId: modelId || "discovery",
    apiKey: request.apiKey || previous?.apiKey,
    models: undefined,
  });
  if (!config) throw new Error("Invalid model configuration.");
  if (!modelId) {
    const catalog = await gatewayCatalog.load(config, true);
    if (!catalog.models.length) throw new Error(catalog.error ?? "The gateway returned no models.");
    config.modelId = catalog.models[0].id;
  }
  return saveDurableModel(config);
}

/** Explicit user action only. Codex secrets remain in main and are saved with OS encryption. */
export async function importCodexModel(): Promise<DurableModelConfig> {
  const directory = path.join(app.getPath("home"), ".codex");
  let auth: unknown;
  let config: string;
  try {
    const authFile = path.join(directory, "auth.json");
    const configFile = path.join(directory, "config.toml");
    if (fs.statSync(authFile).size > 1024 * 1024 || fs.statSync(configFile).size > 1024 * 1024)
      throw new Error();
    auth = JSON.parse(fs.readFileSync(authFile, "utf8"));
    config = fs.readFileSync(configFile, "utf8");
  } catch {
    throw new Error("Could not read Codex auth.json and config.toml.");
  }
  const imported = parseCodexModel(auth, config);
  const previous = publicDurableModel();
  const saved = await saveGatewayModel({
    ...imported,
    modelId: imported.modelId ?? (previous?.baseUrl === imported.baseUrl ? previous.modelId : ""),
    contextWindow: 1_000_000,
    maxTokens: 65_536,
    reasoning: true,
    capabilityMode: "auto",
  });
  gatewayCatalog.clear();
  return saved;
}
