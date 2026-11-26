import { describe, expect, it } from "vitest";
import { desktopModels } from "../../agentRuntime/desktopModels";
import { buildCapabilityIndex } from "../../agentRuntime/models/capabilities";
import type { RuntimeModelConfig } from "../../shared/durableProtocol";

const config: RuntimeModelConfig = {
  baseUrl: "https://gateway.example/v1",
  apiKey: "test-key",
  modelId: "unlisted",
  api: "openai-responses",
  contextWindow: 1000000,
  maxTokens: 16384,
  reasoning: true,
  capabilityMode: "auto",
  models: [
    { id: "gpt-4o", name: "GPT" },
    { id: "custom-text-model", name: "Custom", supportedEndpointTypes: ["anthropic"] },
  ],
};

describe("New API capability matching and registration", () => {
  it("uses exact case-insensitive IDs, vendor modalities and unanimous smaller contexts", () => {
    const index = buildCapabilityIndex([
      {
        provider: "openrouter",
        id: "GPT-5",
        reasoning: false,
        input: ["text"],
        contextWindow: 1000000,
      },
      {
        provider: "openai",
        id: "gpt-5",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 272000,
      },
      {
        provider: "anthropic",
        id: "exact",
        reasoning: false,
        input: ["text", "image"],
        contextWindow: 200000,
      },
      {
        provider: "openrouter",
        id: "exact",
        reasoning: true,
        input: ["text"],
        contextWindow: 200000,
      },
    ]);
    expect(index.get("gpt-5")).toEqual({ reasoning: true, input: ["text", "image"] });
    expect(index.get("exact")).toEqual({
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 200000,
    });
    expect(index.get("gpt-5-chat")).toBeUndefined();
  });
  it("registers unlisted preferred models, resolves cached IDs again, and does not inherit API-specific output budgets", async () => {
    const catalog = desktopModels();
    await catalog.configure(config);
    expect(catalog.catalog().map((row) => row.id)).toEqual([
      "gpt-4o",
      "custom-text-model",
      "unlisted",
    ]);
    expect(catalog.models.getModel("pidesk-openai", "gpt-4o")).toMatchObject({
      reasoning: false,
      input: ["text", "image"],
      contextWindow: 128000,
      maxTokens: 65536,
    });
    expect(catalog.models.getModel("pidesk-openai", "custom-text-model")).toMatchObject({
      api: "openai-completions",
      input: ["text"],
      reasoning: true,
    });
    expect(catalog.models.getModel("pidesk-openai", "unlisted")).toMatchObject({
      maxTokens: 16384,
      contextWindow: 1000000,
    });
    await catalog.configure({
      ...config,
      modelId: "gpt-4o",
      contextWindow: 50000,
      maxTokens: 2048,
      reasoning: true,
      input: ["text"],
      capabilityMode: "manual",
    });
    expect(catalog.models.getModel("pidesk-openai", "gpt-4o")).toMatchObject({
      reasoning: true,
      input: ["text"],
      contextWindow: 50000,
      maxTokens: 2048,
    });
  });
  it("keeps a removed model registered for open conversations but drops previous-account models on credential changes", async () => {
    const catalog = desktopModels();
    await catalog.configure(config);
    await catalog.configure({ ...config, models: [] });
    expect(catalog.catalog().map((row) => row.id)).toEqual(["unlisted"]);
    expect(catalog.models.getModel("pidesk-openai", "gpt-4o")).toBeDefined();
    await catalog.configure({ ...config, apiKey: "another-account", models: [] });
    expect(catalog.models.getModel("pidesk-openai", "gpt-4o")).toBeUndefined();
  });
});
