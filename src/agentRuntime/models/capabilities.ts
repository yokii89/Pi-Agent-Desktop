import type { GatewayInput } from "../../shared/newApi.js";

export interface CapabilityEntry {
  provider: string;
  id: string;
  reasoning: boolean;
  input: readonly GatewayInput[];
  contextWindow: number;
}
export interface ModelCapabilities {
  reasoning: boolean;
  input: GatewayInput[];
  contextWindow?: number;
}
const priority = [
  "anthropic",
  "openai",
  "google",
  "google-vertex",
  "deepseek",
  "xai",
  "mistral",
  "meta",
  "amazon-bedrock",
  "azure",
  "moonshotai",
  "moonshotai-cn",
  "minimax",
  "minimax-cn",
  "zai",
  "zai-coding-cn",
  "kimi-coding",
  "qwen-token-plan",
  "qwen-token-plan-cn",
  "qwen-token-plan-individual",
  "xiaomi",
  "nvidia",
  "cerebras",
  "groq",
  "together",
  "fireworks",
  "baseten",
];
const rank = (provider: string) => {
  const index = priority.indexOf(provider);
  return index < 0 ? priority.length : index;
};

/** Exact IDs only; vendor reasoning/modalities win, context is inherited only on unanimity. */
export function buildCapabilityIndex(
  entries: readonly CapabilityEntry[],
): Map<string, ModelCapabilities> {
  const groups = new Map<string, CapabilityEntry[]>();
  for (const entry of entries) {
    const key = entry.id.trim().toLowerCase();
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return new Map(
    [...groups].map(([key, group]) => {
      const first = [...group].sort((a, b) => rank(a.provider) - rank(b.provider))[0];
      return [
        key,
        {
          reasoning: first.reasoning,
          input: [...first.input],
          ...(group.every((entry) => entry.contextWindow === first.contextWindow)
            ? { contextWindow: first.contextWindow }
            : {}),
        },
      ];
    }),
  );
}

let builtins: Promise<Map<string, ModelCapabilities>> | undefined;
/** Load the fixed bundled pi-ai catalog once, only inside the ESM utility process. */
export function builtinCapabilityIndex(): Promise<Map<string, ModelCapabilities>> {
  builtins ??= import("@earendil-works/pi-ai/providers/all").then((catalog) =>
    buildCapabilityIndex(
      catalog.getBuiltinProviders().flatMap((provider) => catalog.getBuiltinModels(provider)),
    ),
  );
  return builtins;
}
