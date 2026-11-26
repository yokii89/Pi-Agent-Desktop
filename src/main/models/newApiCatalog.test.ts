import { describe, expect, it, vi } from "vitest";
import type { RuntimeModelConfig } from "../../shared/durableProtocol";
import { NEWAPI_CACHE_TTL, NEWAPI_FAILURE_TTL } from "../../shared/newApi";
import {
  discoverGatewayModels,
  type GatewayCache,
  GatewayModelCatalog,
  gatewayCredentialSignature,
} from "./newApiCatalog";

const config: RuntimeModelConfig = {
  baseUrl: "https://gateway.example/v1",
  apiKey: "test-secret",
  modelId: "preferred",
  api: "openai-responses",
  contextWindow: 1000000,
  maxTokens: 65536,
  reasoning: true,
};
const rows = [{ id: "model-a", name: "A" }];
function fixture() {
  let saved: GatewayCache | undefined;
  let now = 1000;
  const storage = {
    read: () => saved,
    write: vi.fn((value: GatewayCache) => {
      saved = value;
    }),
    clear: vi.fn(() => {
      saved = undefined;
    }),
  };
  const discover = vi.fn(async () => rows);
  return {
    storage,
    discover,
    catalog: new GatewayModelCatalog(storage, discover, () => now),
    advance: (ms: number) => {
      now += ms;
    },
    saved: () => saved,
  };
}

describe("New API discovery and cache", () => {
  it("reuses fresh cached data across service instances and coalesces concurrent forced refreshes", async () => {
    const f = fixture();
    const [first, second] = await Promise.all([f.catalog.load(config), f.catalog.load(config)]);
    expect(first).toEqual(second);
    expect(f.discover).toHaveBeenCalledTimes(1);
    await new GatewayModelCatalog(f.storage, f.discover, () => 1001).load(config);
    expect(f.discover).toHaveBeenCalledTimes(1);
    await Promise.all([f.catalog.load(config, true), f.catalog.load(config, true)]);
    expect(f.discover).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(f.saved())).not.toContain(config.apiKey);
  });
  it("refreshes after expiry, keeps the last success timestamp and rows on failure, and bypasses failure cooldown explicitly", async () => {
    const f = fixture();
    await f.catalog.load(config);
    f.advance(NEWAPI_CACHE_TTL + 1);
    f.discover.mockRejectedValue(new Error("network URL includes secret"));
    const failure = await f.catalog.load(config);
    expect(failure).toMatchObject({ models: rows, fetchedAt: 1000, stale: true });
    expect(failure.error).not.toContain("secret");
    await f.catalog.load(config);
    expect(f.discover).toHaveBeenCalledTimes(2);
    f.advance(NEWAPI_FAILURE_TTL + 1);
    await f.catalog.load(config);
    expect(f.discover).toHaveBeenCalledTimes(3);
    f.discover.mockResolvedValue([{ id: "new-model", name: "New" }]);
    expect((await f.catalog.load(config, true)).models[0].id).toBe("new-model");
  });
  it("never reuses model lists across keys, protocols or endpoints", async () => {
    const f = fixture();
    await f.catalog.load(config);
    const canonical = gatewayCredentialSignature(config);
    expect(gatewayCredentialSignature({ ...config, baseUrl: "https://gateway.example/v1/" })).toBe(
      canonical,
    );
    f.discover.mockRejectedValue(new Error("offline"));
    for (const changed of [
      { ...config, apiKey: "another" },
      { ...config, api: "openai-completions" as const },
      { ...config, baseUrl: "https://other.example" },
    ]) {
      expect(gatewayCredentialSignature(changed)).not.toBe(canonical);
      expect((await f.catalog.load(changed)).models).toEqual([]);
    }
  });
  it("does not resurrect cache after clear or publish a late result over a newer credential context", async () => {
    const f = fixture();
    let release!: (value: typeof rows) => void;
    f.discover.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = f.catalog.load(config);
    f.catalog.clear();
    release(rows);
    await expect(pending).rejects.toThrow("configuration changed");
    expect(f.saved()).toBeUndefined();
    f.discover.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const old = f.catalog.load(config);
    await f.catalog.load({ ...config, apiKey: "new-key" });
    release([{ id: "stale", name: "Stale" }]);
    await expect(old).rejects.toThrow("configuration changed");
    expect(f.saved()?.models).toEqual(rows);
  });
  it("uses only /v1/models with redirects disabled and never includes raw gateway errors", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ id: "a", supported_endpoint_types: ["anthropic"] }] }),
          { headers: { "Content-Type": "application/json" } },
        ),
      );
    expect(await discoverGatewayModels(config, fetcher)).toEqual([
      { id: "a", name: "a", supportedEndpointTypes: ["anthropic"] },
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://gateway.example/v1/models",
      expect.objectContaining({
        redirect: "manual",
        headers: { Authorization: "Bearer test-secret", Accept: "application/json" },
      }),
    );
    for (const response of [
      new Response("secret", { status: 401 }),
      new Response(null, {
        status: 302,
        headers: { Location: "https://other.example?secret=key" },
      }),
      new Response("secret", { headers: { "Content-Type": "text/html" } }),
      new Response("secret"),
    ]) {
      fetcher.mockResolvedValueOnce(response);
      await expect(discoverGatewayModels(config, fetcher)).rejects.not.toThrow("secret");
    }
    fetcher.mockResolvedValueOnce(new Response("x".repeat(2 * 1024 * 1024 + 1)));
    await expect(discoverGatewayModels(config, fetcher)).rejects.toThrow("too large");
  });
});
