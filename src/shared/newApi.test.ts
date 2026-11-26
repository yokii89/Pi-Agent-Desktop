import { describe, expect, it } from "vitest";
import { parseDurableCommand, parseRuntimeModel } from "./durableProtocol";
import {
  gatewayBaseUrl,
  gatewayModelApi,
  gatewayModelRows,
  isDegenerateGatewayResponse,
  NEWAPI_MODEL_LIMIT,
  parseCodexModel,
} from "./newApi";

const toml = `model = "gpt-5.2" # preferred
model_provider = 'gateway'
model_reasoning_effort = "max"
[model_providers.other]
base_url = "https://wrong.example"
[model_providers."gateway"] # active
base_url = "https://gateway.example/proxy/v1/" # trailing slash
wire_api = "responses"
[projects.test]
model = "must-not-leak"
`;

describe("New API shared contracts", () => {
  it("imports only the selected Codex provider and top-level model, including inline comments and literal quotes", () => {
    expect(parseCodexModel({ OPENAI_API_KEY: " key " }, toml)).toEqual({
      apiKey: "key",
      baseUrl: "https://gateway.example/proxy/v1",
      api: "openai-responses",
      modelId: "gpt-5.2",
      preferredThinking: "xhigh",
    });
    expect(
      parseCodexModel(
        { tokens: { access_token: "token" } },
        toml.replace('model_reasoning_effort = "max"', 'model_reasoning_effort = "high"'),
      ).preferredThinking,
    ).toBe("high");
    expect(
      parseCodexModel(
        { api_key: "key" },
        `[model_providers.sole]\nbase_url = 'https://gateway.example'`,
      ).modelId,
    ).toBeUndefined();
  });
  it("rejects ambiguous, missing, duplicate and unsupported Codex configuration without returning secrets in errors", () => {
    const auth = { OPENAI_API_KEY: "secret-key" };
    for (const invalid of [
      toml.replace('"responses"', '"unsupported"'),
      toml.replace("'gateway'", "'missing'"),
      toml.replace("model_provider = 'gateway'", ""),
      toml.replace('model = "gpt-5.2" # preferred', 'model = "a"\nmodel = "b"'),
    ]) {
      expect(() => parseCodexModel(auth, invalid)).toThrow();
      try {
        parseCodexModel(auth, invalid);
      } catch (error) {
        expect(String(error)).not.toContain("secret-key");
      }
    }
    expect(() => parseCodexModel({}, toml)).toThrow("No API key");
    expect(() =>
      parseCodexModel(
        auth,
        toml.replace("https://gateway.example/proxy/v1/", "https://user:secret@gateway.example"),
      ),
    ).toThrow();
  });
  it("normalizes API roots without dropping path prefixes and rejects URL credentials or nonlocal cleartext", () => {
    expect(gatewayBaseUrl(" https://example.com/prefix/v1/// ")).toBe(
      "https://example.com/prefix/v1",
    );
    expect(gatewayBaseUrl("http://127.0.0.1:1234/")).toBe("http://127.0.0.1:1234/v1");
    for (const url of [
      "http://example.com",
      "https://example.com/?key=x",
      "https://example.com/#token",
      "file:///test",
      "https://u:p@example.com",
    ])
      expect(() => gatewayBaseUrl(url)).toThrow();
  });
  it("validates, deduplicates and bounds discovered model rows and chooses per-model transport", () => {
    const rows = gatewayModelRows([
      null,
      { id: 1 },
      { id: " a ", supported_endpoint_types: ["openai", "openai", 1] },
      { id: "b", name: "B", supported_endpoint_types: ["ANTHROPIC"] },
      { id: "a" },
    ]);
    expect(rows).toEqual([
      { id: "a", name: "a" },
      { id: "b", name: "B", supportedEndpointTypes: ["anthropic"] },
    ]);
    expect(gatewayModelApi(["openai-response", "anthropic"], "openai-completions")).toBe(
      "openai-responses",
    );
    expect(gatewayModelApi(["anthropic"], "openai-responses")).toBe("openai-completions");
    expect(gatewayModelApi(["openai"], "openai-responses")).toBe("openai-responses");
    expect(() =>
      gatewayModelRows(Array.from({ length: NEWAPI_MODEL_LIMIT + 1 }, () => ({ id: "a" }))),
    ).toThrow();
  });
  it("recovers only provably empty length responses and keeps real outputs, tools and thinking", () => {
    const empty = {
      stopReason: "length",
      rawStopReason: "incomplete.max_output_tokens",
      usage: { output: 1 },
      content: [],
    };
    expect(isDegenerateGatewayResponse(empty)).toBe(true);
    expect(isDegenerateGatewayResponse({ ...empty, content: [{ type: "text", text: "  " }] })).toBe(
      true,
    );
    for (const content of [
      [{ type: "text", text: "answer" }],
      [{ type: "thinking", thinking: "reasoning" }],
      [{ type: "toolCall", id: "a" }],
      [null],
    ])
      expect(isDegenerateGatewayResponse({ ...empty, content })).toBe(false);
    expect(isDegenerateGatewayResponse({ ...empty, usage: { output: 2 } })).toBe(false);
    expect(isDegenerateGatewayResponse({ ...empty, stopReason: "error" })).toBe(false);
  });
  it("validates model DTOs and catalog command sizes", () => {
    const model = {
      baseUrl: "https://gateway.example/v1",
      apiKey: "key",
      modelId: "model",
      api: "openai-responses",
      contextWindow: 1000000,
      maxTokens: 65536,
      reasoning: true,
      capabilityMode: "auto",
      input: ["text"],
      preferredThinking: "high",
      models: [{ id: "one", name: "One" }],
    };
    expect(parseRuntimeModel(model)).toEqual(model);
    expect(parseRuntimeModel({ ...model, models: [{ id: 42 }] })).toBeNull();
    expect(parseRuntimeModel({ ...model, input: ["video"] })).toBeNull();
    expect(parseRuntimeModel({ ...model, preferredThinking: "unbounded" })).toBeNull();
    expect(parseDurableCommand({ op: "models" })).toEqual({ op: "models" });
    expect(parseDurableCommand({ op: "modelPreference", modelId: "one" })).not.toBeNull();
  });
});
