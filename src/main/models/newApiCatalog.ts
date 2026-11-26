import { createHash } from "node:crypto";
import type { RuntimeModelConfig } from "../../shared/durableProtocol";
import {
  type GatewayCatalog,
  type GatewayModel,
  gatewayBaseUrl,
  gatewayModelRows,
  NEWAPI_CACHE_TTL,
  NEWAPI_FAILURE_TTL,
} from "../../shared/newApi";

export interface GatewayCache extends GatewayCatalog {
  version: 1;
  signature: string;
  checkedAt: number;
}
export interface GatewayCacheStorage {
  read(): GatewayCache | undefined;
  write(cache: GatewayCache): void;
  clear(): void;
}

/** Bind all cached data, including failures, to the complete credential context. */
export function gatewayCredentialSignature(
  config: Pick<RuntimeModelConfig, "baseUrl" | "api" | "apiKey">,
): string {
  return createHash("sha256")
    .update(JSON.stringify([gatewayBaseUrl(config.baseUrl), config.api, config.apiKey]))
    .digest("hex");
}

/** Bounded discovery. Redirects and raw response bodies never become credential-bearing UI errors. */
export async function discoverGatewayModels(
  config: Pick<RuntimeModelConfig, "baseUrl" | "apiKey">,
  fetcher = fetch,
): Promise<GatewayModel[]> {
  const response = await fetcher(`${gatewayBaseUrl(config.baseUrl)}/models`, {
    headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      response.status >= 300 && response.status < 400
        ? "The gateway redirected model discovery. Use its API endpoint."
        : `Gateway model discovery failed (HTTP ${response.status}).`,
    );
  }
  if (response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
    await response.body?.cancel();
    throw new Error("The gateway returned HTML. Use its API endpoint.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The gateway returned an empty response.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error("The gateway model response is too large.");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("The gateway returned invalid JSON.");
  }
  const models = gatewayModelRows(
    typeof value === "object" && value !== null && "data" in value ? value.data : undefined,
  );
  if (!models.length) throw new Error("The gateway returned no models. Check API key permissions.");
  return models;
}

/** One application-scoped cache; generation checks prevent clears or account changes resurrecting stale results. */
export class GatewayModelCatalog {
  private generation = 0;
  private signature?: string;
  private flight?: { signature: string; generation: number; result: Promise<GatewayCatalog> };
  constructor(
    private readonly storage: GatewayCacheStorage,
    private readonly discover = discoverGatewayModels,
    private readonly now = Date.now,
  ) {}

  clear(): void {
    this.storage.clear();
    this.generation++;
    this.flight = undefined;
  }

  load(config: RuntimeModelConfig, force = false): Promise<GatewayCatalog> {
    const signature = gatewayCredentialSignature(config);
    if (signature !== this.signature) {
      this.signature = signature;
      this.generation++;
    }
    const generation = this.generation;
    if (this.flight?.signature === signature && this.flight.generation === generation)
      return this.flight.result;
    const saved = this.storage.read();
    const cache = saved?.signature === signature ? saved : undefined;
    const fresh =
      cache &&
      this.now() >= cache.checkedAt &&
      this.now() - cache.checkedAt < (cache.error ? NEWAPI_FAILURE_TTL : NEWAPI_CACHE_TTL);
    if (!force && fresh) return Promise.resolve(this.publicCache(cache));
    const result = (async (): Promise<GatewayCatalog> => {
      let next: GatewayCache;
      try {
        const models = await this.discover(config);
        next = {
          version: 1,
          signature,
          checkedAt: this.now(),
          fetchedAt: this.now(),
          models,
          stale: false,
          error: null,
        };
      } catch (error) {
        // Network libraries can include URLs or headers in errors. Only our discovery errors are public.
        const message =
          error instanceof Error && /^(?:The gateway|Gateway model discovery)/.test(error.message)
            ? error.message
            : "Gateway model discovery failed. Check the endpoint and connection.";
        next = {
          version: 1,
          signature,
          checkedAt: this.now(),
          fetchedAt: cache?.fetchedAt ?? null,
          models: cache?.models ?? [],
          stale: true,
          error: message,
        };
      }
      if (this.generation !== generation || this.signature !== signature)
        throw new Error("Gateway configuration changed during discovery. Retry the operation.");
      this.storage.write(next);
      return this.publicCache(next);
    })().finally(() => {
      if (this.flight?.result === result) this.flight = undefined;
    });
    this.flight = { signature, generation, result };
    return result;
  }

  private publicCache(cache: GatewayCache): GatewayCatalog {
    return {
      models: cache.models,
      fetchedAt: cache.fetchedAt,
      stale:
        cache.stale || cache.fetchedAt === null || this.now() - cache.fetchedAt >= NEWAPI_CACHE_TTL,
      error: cache.error,
    };
  }
}
