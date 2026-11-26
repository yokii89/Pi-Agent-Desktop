import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  root: "",
  encrypted: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
  available: true,
}));
vi.mock("electron", () => ({
  app: { getPath: (name: string) => path.join(host.root, name) },
  safeStorage: {
    isEncryptionAvailable: () => host.available,
    encryptString: (value: string) => host.encrypted(value),
    decryptString: (value: Buffer) => value.toString().slice("encrypted:".length),
  },
}));

import { publicDurableModel, readDurableModel, saveDurableModel } from "../settings/durableStore";
import {
  gatewayCatalog,
  importCodexModel,
  loadGatewayCatalog,
  saveGatewayModel,
} from "../settings/newApiStore";

const setup = {
  baseUrl: "https://gateway.example/",
  apiKey: "test-only-key",
  api: "openai-responses",
  modelId: "hidden-model",
  contextWindow: 1000000,
  maxTokens: 65536,
  reasoning: true,
  capabilityMode: "auto",
};
beforeEach(() => {
  host.root = fs.mkdtempSync(path.join(tmpdir(), "pidesk-newapi-store-"));
  host.available = true;
  host.encrypted.mockClear();
  gatewayCatalog.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(host.root, { recursive: true, force: true });
});
function codex(config: string) {
  const directory = path.join(host.root, "home", ".codex");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "auth.json"),
    JSON.stringify({ OPENAI_API_KEY: "codex-test-key" }),
  );
  fs.writeFileSync(path.join(directory, "config.toml"), config);
}
const codexConfig = `model = "codex-hidden"\nmodel_provider = "relay"\nmodel_reasoning_effort = "high"\n[model_providers.relay]\nbase_url = "https://codex-gateway.example/v1/"\nwire_api = "responses"\n`;

describe("New API desktop storage and explicit Codex import", () => {
  it("uses OS encryption, normalizes URLs, preserves a blank key and never returns it to the renderer", () => {
    const saved = saveDurableModel(setup);
    expect(saved).not.toHaveProperty("apiKey");
    expect(saved.baseUrl).toBe("https://gateway.example/v1");
    expect(host.encrypted).toHaveBeenCalledOnce();
    expect(readDurableModel()?.apiKey).toBe("test-only-key");
    saveDurableModel({ ...saved, apiKey: "", modelId: "next" });
    expect(readDurableModel()?.apiKey).toBe("test-only-key");
    expect(() =>
      saveDurableModel({ ...saved, apiKey: "", baseUrl: "https://another.example" }),
    ).toThrow("Enter an API key");
    expect(publicDurableModel()).not.toHaveProperty("models");
    host.available = false;
    expect(() => saveDurableModel(setup)).toThrow("encryption");
  });
  it("discovers and caches a first model before saving an initially blank model ID", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "discovered" }] })));
    vi.stubGlobal("fetch", fetcher);
    expect((await saveGatewayModel({ ...setup, modelId: "" })).modelId).toBe("discovered");
    expect((await loadGatewayCatalog()).models.map((row) => row.id)).toEqual(["discovered"]);
    expect(fetcher).toHaveBeenCalledOnce();
    const cache = fs.readFileSync(
      path.join(host.root, "userData", "durable/v1/newapi-models.json"),
      "utf8",
    );
    expect(cache).not.toContain("test-only-key");
  });
  it("keeps the existing credential when blank-model discovery or import validation fails", async () => {
    saveDurableModel(setup);
    const previous = readDurableModel();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("sensitive response", { status: 401 })),
    );
    await expect(
      saveGatewayModel({
        ...setup,
        apiKey: "new-test-key",
        baseUrl: "https://new.example",
        modelId: "",
      }),
    ).rejects.toThrow("HTTP 401");
    expect(readDurableModel()).toEqual(previous);
    codex(codexConfig.replace('wire_api = "responses"', 'wire_api = "unknown"'));
    await expect(importCodexModel()).rejects.toThrow("wire_api");
    expect(readDurableModel()).toEqual(previous);
  });
  it("imports an unlisted model without network access and atomically replaces old account preferences", async () => {
    saveDurableModel(setup);
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    codex(codexConfig);
    const imported = await importCodexModel();
    expect(imported).toMatchObject({
      baseUrl: "https://codex-gateway.example/v1",
      modelId: "codex-hidden",
      preferredThinking: "high",
      capabilityMode: "auto",
    });
    expect(imported).not.toHaveProperty("apiKey");
    expect(readDurableModel()?.apiKey).toBe("codex-test-key");
    expect(fetcher).not.toHaveBeenCalled();
    codex(codexConfig.replace('model_reasoning_effort = "high"\n', ""));
    expect(await importCodexModel()).not.toHaveProperty("preferredThinking");
  });
  it("discovers a model when Codex omits its default and replaces a cache for another account", async () => {
    saveDurableModel(setup);
    codex(codexConfig.replace('model = "codex-hidden"\n', ""));
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "from-codex-gateway" }] }))),
    );
    expect((await importCodexModel()).modelId).toBe("from-codex-gateway");
  });
});
