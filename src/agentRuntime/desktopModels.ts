import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { createModels, createProvider } from "@earendil-works/pi-ai/models";
import type { RuntimeModelConfig } from "../shared/durableProtocol.js";

export const DESKTOP_PROVIDER = "pidesk-openai";

/** Catalog and credentials are supplied by the host; no env, CLI auth files or shell key commands. */
export function desktopModels() {
  const models = createModels();
  return {
    models,
    configure(config: RuntimeModelConfig): void {
      const { apiKey, ...catalog } = config;
      models.setProvider(
        createProvider({
          id: DESKTOP_PROVIDER,
          name: "PiDesk OpenAI compatible",
          auth: { apiKey: { name: "PiDesk", resolve: async () => ({ auth: { apiKey } }) } },
          models: [
            {
              id: catalog.modelId,
              name: catalog.modelId,
              provider: DESKTOP_PROVIDER,
              api: catalog.api,
              baseUrl: catalog.baseUrl,
              contextWindow: catalog.contextWindow,
              maxTokens: catalog.maxTokens,
              reasoning: catalog.reasoning,
              input: ["text", "image"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
          api: catalog.api === "openai-responses" ? openAIResponsesApi() : openAICompletionsApi(),
        }),
      );
    },
  };
}
