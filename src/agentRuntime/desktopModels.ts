import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { createModels, createProvider } from "@earendil-works/pi-ai/models";
import type { RuntimeModelConfig } from "../shared/durableProtocol.js";
import { type GatewayModelInfo, gatewayModelApi } from "../shared/newApi.js";
import { builtinCapabilityIndex } from "./models/capabilities.js";

export const DESKTOP_PROVIDER = "pidesk-openai";
const visionHint =
  /(?:^|[-_/.:])(?:gpt-4o|gpt-4\.1|gpt-5|claude-3|claude-4|gemini|vision|vl)(?:$|[-_/.:])/i;

/** Catalog and credentials are supplied by the host; no CLI auth files or shell key commands. */
export function desktopModels() {
  const models = createModels();
  let catalog: GatewayModelInfo[] = [];
  let binding = "";
  let retained: GatewayModelInfo[] = [];
  let currentConfig: RuntimeModelConfig | undefined;
  const service = {
    models,
    catalog: () => catalog,
    async ensure(modelId: string): Promise<void> {
      if (!currentConfig || models.getModel(DESKTOP_PROVIDER, modelId)) return;
      await service.configure({
        ...currentConfig,
        models: [...(currentConfig.models ?? []), { id: modelId, name: modelId }],
      });
    },
    async configure(config: RuntimeModelConfig): Promise<void> {
      const index = await builtinCapabilityIndex();
      currentConfig = config;
      const rows = new Map((config.models ?? []).map((row) => [row.id, row]));
      if (!rows.has(config.modelId))
        rows.set(config.modelId, { id: config.modelId, name: config.modelId });
      catalog = [...rows.values()].map((row) => {
        const capability = index.get(row.id.toLowerCase());
        const active = row.id === config.modelId;
        const manual = active && config.capabilityMode !== "auto";
        const context = active ? config.contextWindow : 1_000_000;
        return {
          ...row,
          api: gatewayModelApi(row.supportedEndpointTypes, config.api),
          reasoning: manual ? config.reasoning : (capability?.reasoning ?? true),
          input: manual
            ? (config.input ?? ["text", "image"])
            : (capability?.input ?? (visionHint.test(row.id) ? ["text", "image"] : ["text"])),
          contextWindow: manual ? context : Math.min(context, capability?.contextWindow ?? context),
          maxTokens: Math.min(
            active ? config.maxTokens : 65_536,
            context,
            manual ? context : (capability?.contextWindow ?? context),
          ),
        };
      });
      const nextBinding = JSON.stringify([config.baseUrl, config.api, config.apiKey]);
      if (binding !== nextBinding) retained = [];
      binding = nextBinding;
      const registered = new Map(retained.map((row) => [row.id, row]));
      for (const row of catalog) registered.set(row.id, row);
      retained = [...registered.values()];
      models.setProvider(
        createProvider({
          id: DESKTOP_PROVIDER,
          name: "New API / OpenAI compatible",
          auth: {
            apiKey: { name: "PiDesk", resolve: async () => ({ auth: { apiKey: config.apiKey } }) },
          },
          models: retained.map((row) => ({
            id: row.id,
            name: row.name,
            provider: DESKTOP_PROVIDER,
            api: row.api,
            baseUrl: config.baseUrl,
            contextWindow: row.contextWindow,
            maxTokens: row.maxTokens,
            reasoning: row.reasoning,
            input: row.input,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          })),
          api: {
            "openai-responses": openAIResponsesApi(),
            "openai-completions": openAICompletionsApi(),
          },
        }),
      );
    },
  };
  return service;
}
