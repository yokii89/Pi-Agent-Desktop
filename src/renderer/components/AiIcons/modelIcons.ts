import Ai21Mono from "@lobehub/icons/es/Ai21/components/Mono";
import BaichuanColor from "@lobehub/icons/es/Baichuan/components/Color";
import BaiduColor from "@lobehub/icons/es/Baidu/components/Color";
import ByteDanceColor from "@lobehub/icons/es/ByteDance/components/Color";
import ClaudeColor from "@lobehub/icons/es/Claude/components/Color";
import CohereColor from "@lobehub/icons/es/Cohere/components/Color";
import DeepSeekColor from "@lobehub/icons/es/DeepSeek/components/Color";
import DoubaoColor from "@lobehub/icons/es/Doubao/components/Color";
import GeminiColor from "@lobehub/icons/es/Gemini/components/Color";
import GemmaColor from "@lobehub/icons/es/Gemma/components/Color";
import GrokMono from "@lobehub/icons/es/Grok/components/Mono";
import HunyuanColor from "@lobehub/icons/es/Hunyuan/components/Color";
import InternLMColor from "@lobehub/icons/es/InternLM/components/Color";
import KimiColor from "@lobehub/icons/es/Kimi/components/Color";
import LongCatColor from "@lobehub/icons/es/LongCat/components/Color";
import MetaColor from "@lobehub/icons/es/Meta/components/Color";
import MicrosoftColor from "@lobehub/icons/es/Microsoft/components/Color";
import MinimaxColor from "@lobehub/icons/es/Minimax/components/Color";
import MistralColor from "@lobehub/icons/es/Mistral/components/Color";
import NousResearchMono from "@lobehub/icons/es/NousResearch/components/Mono";
import NvidiaColor from "@lobehub/icons/es/Nvidia/components/Color";
import OpenAIMono from "@lobehub/icons/es/OpenAI/components/Mono";
import PerplexityColor from "@lobehub/icons/es/Perplexity/components/Color";
import QwenColor from "@lobehub/icons/es/Qwen/components/Color";
import SparkColor from "@lobehub/icons/es/Spark/components/Color";
import StepfunMono from "@lobehub/icons/es/Stepfun/components/Mono";
import TIIColor from "@lobehub/icons/es/TII/components/Color";
import type { IconType } from "@lobehub/icons/es/types";
import UpstageColor from "@lobehub/icons/es/Upstage/components/Color";
import WenxinColor from "@lobehub/icons/es/Wenxin/components/Color";
import XiaomiMiMoMono from "@lobehub/icons/es/XiaomiMiMo/components/Mono";
import YiColor from "@lobehub/icons/es/Yi/components/Color";
import ZhipuColor from "@lobehub/icons/es/Zhipu/components/Color";

interface ModelIconRule {
  /** 在 lowercase 的模型 id 上匹配；顺序即优先级，具体家族放在通用规则之前。 */
  pattern: RegExp;
  Icon: IconType;
}

/**
 * 模型 id → 模型品牌图标，对齐 @lobehub/icons 的 ModelIcon 关键词表（只保留常用家族）。
 * 网关（newapi 等）会同时提供多家的模型，因此列表要按模型而不是 provider 取图标。
 */
const MODEL_ICON_RULES: ModelIconRule[] = [
  // OpenAI：gpt / o 系列 / codex / DALL·E 等
  {
    pattern:
      /(^|\/)(gpt-|chatgpt|o[134](-|$)|codex|dall-?e|davinci|babbage|text-embedding|whisper|tts-)|openai/,
    Icon: OpenAIMono,
  },
  { pattern: /claude/, Icon: ClaudeColor },
  { pattern: /gemini|nano-banana/, Icon: GeminiColor },
  { pattern: /gemma/, Icon: GemmaColor },
  { pattern: /deepseek/, Icon: DeepSeekColor },
  { pattern: /qwen|qwq|qvq|tongyi|wanx|(^|\/)wan\d/, Icon: QwenColor },
  { pattern: /kimi|moonshot/, Icon: KimiColor },
  { pattern: /glm|chatglm|zhipu/, Icon: ZhipuColor },
  { pattern: /minimax|abab/, Icon: MinimaxColor },
  {
    pattern: /mistral|mixtral|codestral|pixtral|magistral|devstral|mathstral|ministral|voxtral/,
    Icon: MistralColor,
  },
  { pattern: /grok/, Icon: GrokMono },
  { pattern: /llama|(^|\/)l3|meta-llama/, Icon: MetaColor },
  { pattern: /doubao|(^|\/)ep-/, Icon: DoubaoColor },
  { pattern: /seed-|skylark|bytedance/, Icon: ByteDanceColor },
  { pattern: /ernie|wenxin/, Icon: WenxinColor },
  { pattern: /hunyuan|(^|\/)hy[34]/, Icon: HunyuanColor },
  { pattern: /(^|\/)yi-|(^|\/)yi$|-yi-/, Icon: YiColor },
  { pattern: /(^|\/)step-/, Icon: StepfunMono },
  { pattern: /(^|\/)mimo-/, Icon: XiaomiMiMoMono },
  { pattern: /pplx|sonar/, Icon: PerplexityColor },
  { pattern: /command/, Icon: CohereColor },
  { pattern: /(^|\/)phi-|-phi-|wizardlm/, Icon: MicrosoftColor },
  { pattern: /baidu|qianfan/, Icon: BaiduColor },
  { pattern: /baichuan/, Icon: BaichuanColor },
  { pattern: /nemotron/, Icon: NvidiaColor },
  { pattern: /internlm|internvl/, Icon: InternLMColor },
  { pattern: /(^|\/)solar-|(^|\/)solar$/, Icon: UpstageColor },
  { pattern: /spark/, Icon: SparkColor },
  { pattern: /hermes/, Icon: NousResearchMono },
  { pattern: /jamba/, Icon: Ai21Mono },
  { pattern: /falcon/, Icon: TIIColor },
  { pattern: /longcat/, Icon: LongCatColor },
];

/** 模型 id 重复度高（列表上百行、每次打开菜单都会重建），解析结果按 id 缓存。 */
const modelIconCache = new Map<string, IconType | null>();

/** 按模型 id 解析品牌图标；未命中返回 null，由调用方回退到 provider。 */
export function findModelIcon(modelId: string): IconType | null {
  const id = modelId.trim().toLowerCase();
  if (!id) return null;
  const cached = modelIconCache.get(id);
  if (cached !== undefined) return cached;
  let found: IconType | null = null;
  for (const rule of MODEL_ICON_RULES) {
    if (rule.pattern.test(id)) {
      found = rule.Icon;
      break;
    }
  }
  modelIconCache.set(id, found);
  return found;
}
