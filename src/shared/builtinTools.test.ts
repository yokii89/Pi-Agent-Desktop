import { describe, expect, it } from "vitest";
import {
  defaultBuiltinToolsConfig,
  mergeBuiltinToolsConfig,
  parseBuiltinToolsConfig,
  publicBuiltinToolsConfig,
} from "./builtinTools";
import { parseDurableCommand } from "./durableProtocol";

describe("desktop built-in tool configuration", () => {
  it("projects only public metadata and keeps provider secrets independent", () => {
    const config = defaultBuiltinToolsConfig();
    config.web.providers.brave = { baseUrl: "", apiKey: "search-test-secret" };
    config.web.providers.tavily = { baseUrl: "", apiKey: "other-test-secret" };
    config.image.apiKey = "image-test-secret";
    const metadata = publicBuiltinToolsConfig(config);
    expect(metadata.web.providers.brave).toEqual({ baseUrl: "", hasKey: true });
    expect(metadata.image.hasKey).toBe(true);
    expect(JSON.stringify(metadata)).not.toContain("secret");
    const next = mergeBuiltinToolsConfig(defaultBuiltinToolsConfig(), config);
    expect(next.web.providers).toEqual(config.web.providers);
    expect(next.image.apiKey).toBe(config.image.apiKey);
    expect(config.web.providers.brave.apiKey).toBe("search-test-secret");
  });

  it("requires a new key when a configured destination changes", () => {
    const previous = defaultBuiltinToolsConfig();
    previous.image.apiKey = "saved-test-key";
    const next = defaultBuiltinToolsConfig();
    next.image.baseUrl = "https://images.example/v1";
    expect(() => mergeBuiltinToolsConfig(next, previous)).toThrow("new image");
    next.image.apiKey = "new-test-key";
    expect(mergeBuiltinToolsConfig(next, previous).image.apiKey).toBe("new-test-key");
    previous.web.providers.ollama = { apiKey: "saved-test-key", baseUrl: "https://search.example" };
    next.web.providers.ollama = { apiKey: "", baseUrl: "https://another.example" };
    expect(() => mergeBuiltinToolsConfig(next, previous)).toThrow("new search");
  });

  it.each([
    "http://public.example/v1",
    "https://user:password@example.com",
    "file:///tmp/images",
    "https://example.com?key=secret",
    "https://example.com#secret",
  ])("rejects unsafe credential destinations: %s", (baseUrl) => {
    const config = defaultBuiltinToolsConfig();
    config.image.baseUrl = baseUrl;
    expect(parseBuiltinToolsConfig(config)).toBeNull();
  });

  it("accepts local development endpoints and rejects invalid provider values", () => {
    const config = defaultBuiltinToolsConfig();
    config.web.providers.ollama = { apiKey: "", baseUrl: "http://localhost:11434" };
    expect(parseBuiltinToolsConfig(config)).toEqual(config);
    expect(
      parseBuiltinToolsConfig({ ...config, web: { provider: "missing", providers: {} } }),
    ).toBeNull();
    expect(
      parseBuiltinToolsConfig({
        ...config,
        web: { provider: "brave", providers: { missing: { baseUrl: "", apiKey: "" } } },
      }),
    ).toBeNull();
  });

  it("validates private-port initialize and live configuration updates", () => {
    const config = defaultBuiltinToolsConfig();
    expect(
      parseDurableCommand({ op: "initialize", storageRoot: "/test", builtins: config }),
    ).toMatchObject({ builtins: config });
    expect(parseDurableCommand({ op: "builtins", config })).toEqual({ op: "builtins", config });
    expect(parseDurableCommand({ op: "builtins", config: { ...config, image: null } })).toBeNull();
    expect(
      parseDurableCommand({ op: "initialize", storageRoot: "/test", builtins: {} }),
    ).toBeNull();
  });
});
