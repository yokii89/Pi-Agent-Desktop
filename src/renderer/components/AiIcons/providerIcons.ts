import AlibabaColor from "@lobehub/icons/es/Alibaba/components/Color";
import AnthropicMono from "@lobehub/icons/es/Anthropic/components/Mono";
import AwsColor from "@lobehub/icons/es/Aws/components/Color";
import AzureColor from "@lobehub/icons/es/Azure/components/Color";
import BaiduColor from "@lobehub/icons/es/Baidu/components/Color";
import BailianColor from "@lobehub/icons/es/Bailian/components/Color";
import BedrockColor from "@lobehub/icons/es/Bedrock/components/Color";
import ByteDanceColor from "@lobehub/icons/es/ByteDance/components/Color";
import ChatGLMColor from "@lobehub/icons/es/ChatGLM/components/Color";
import ClaudeColor from "@lobehub/icons/es/Claude/components/Color";
import CloudflareColor from "@lobehub/icons/es/Cloudflare/components/Color";
import CodexColor from "@lobehub/icons/es/Codex/components/Color";
import CohereColor from "@lobehub/icons/es/Cohere/components/Color";
import DeepSeekColor from "@lobehub/icons/es/DeepSeek/components/Color";
import DoubaoColor from "@lobehub/icons/es/Doubao/components/Color";
import FireworksColor from "@lobehub/icons/es/Fireworks/components/Color";
import GeminiColor from "@lobehub/icons/es/Gemini/components/Color";
import GithubMono from "@lobehub/icons/es/Github/components/Mono";
import GithubCopilotMono from "@lobehub/icons/es/GithubCopilot/components/Mono";
import GoogleColor from "@lobehub/icons/es/Google/components/Color";
import GoogleCloudColor from "@lobehub/icons/es/GoogleCloud/components/Color";
import GrokMono from "@lobehub/icons/es/Grok/components/Mono";
import GroqMono from "@lobehub/icons/es/Groq/components/Mono";
import HuaweiColor from "@lobehub/icons/es/Huawei/components/Color";
import HuggingFaceColor from "@lobehub/icons/es/HuggingFace/components/Color";
import HunyuanColor from "@lobehub/icons/es/Hunyuan/components/Color";
import KimiColor from "@lobehub/icons/es/Kimi/components/Color";
import LongCatColor from "@lobehub/icons/es/LongCat/components/Color";
import MetaColor from "@lobehub/icons/es/Meta/components/Color";
import MinimaxColor from "@lobehub/icons/es/Minimax/components/Color";
import MistralColor from "@lobehub/icons/es/Mistral/components/Color";
import ModelScopeColor from "@lobehub/icons/es/ModelScope/components/Color";
import NewAPIColor from "@lobehub/icons/es/NewAPI/components/Color";
import NvidiaColor from "@lobehub/icons/es/Nvidia/components/Color";
import OllamaMono from "@lobehub/icons/es/Ollama/components/Mono";
import OpenAIMono from "@lobehub/icons/es/OpenAI/components/Mono";
import OpenCodeMono from "@lobehub/icons/es/OpenCode/components/Mono";
import OpenRouterColor from "@lobehub/icons/es/OpenRouter/components/Color";
import PerplexityColor from "@lobehub/icons/es/Perplexity/components/Color";
import PPIOColor from "@lobehub/icons/es/PPIO/components/Color";
import QiniuColor from "@lobehub/icons/es/Qiniu/components/Color";
import QwenColor from "@lobehub/icons/es/Qwen/components/Color";
import SiliconCloudColor from "@lobehub/icons/es/SiliconCloud/components/Color";
import StepfunMono from "@lobehub/icons/es/Stepfun/components/Mono";
import TencentColor from "@lobehub/icons/es/Tencent/components/Color";
import TogetherColor from "@lobehub/icons/es/Together/components/Color";
import type { IconType } from "@lobehub/icons/es/types";
import VercelMono from "@lobehub/icons/es/Vercel/components/Mono";
import WenxinColor from "@lobehub/icons/es/Wenxin/components/Color";
import XiaomiMiMoMono from "@lobehub/icons/es/XiaomiMiMo/components/Mono";
import YiColor from "@lobehub/icons/es/Yi/components/Color";
import ZAIMono from "@lobehub/icons/es/ZAI/components/Mono";
import ZeroOneColor from "@lobehub/icons/es/ZeroOne/components/Color";
import ZhipuColor from "@lobehub/icons/es/Zhipu/components/Color";

/**
 * pi provider id（小写）→ @lobehub/icons 品牌图标。
 * 只深引单图标组件：整包入口会把 @lobehub/ui、lucide-react 拖进依赖图。
 * 有品牌色的厂商用 Color，没有的用 Mono（currentColor，随主题自适应）。
 */
export const PROVIDER_ICONS: Record<string, IconType> = {
  alibaba: AlibabaColor,
  anthropic: AnthropicMono,
  aws: AwsColor,
  azure: AzureColor,
  "azure-openai-responses": AzureColor,
  baidu: BaiduColor,
  bailian: BailianColor,
  bedrock: BedrockColor,
  "amazon-bedrock": BedrockColor,
  bytedance: ByteDanceColor,
  chatglm: ChatGLMColor,
  claude: ClaudeColor,
  cloudflare: CloudflareColor,
  "cloudflare-ai-gateway": CloudflareColor,
  "cloudflare-workers-ai": CloudflareColor,
  cohere: CohereColor,
  deepseek: DeepSeekColor,
  doubao: DoubaoColor,
  fireworks: FireworksColor,
  "openai-codex": CodexColor,
  gemini: GeminiColor,
  github: GithubMono,
  copilot: GithubCopilotMono,
  "github-copilot": GithubCopilotMono,
  google: GoogleColor,
  googlecloud: GoogleCloudColor,
  grok: GrokMono,
  xai: GrokMono,
  groq: GroqMono,
  huawei: HuaweiColor,
  huggingface: HuggingFaceColor,
  hunyuan: HunyuanColor,
  kimi: KimiColor,
  "kimi-coding": KimiColor,
  moonshot: KimiColor,
  llama: MetaColor,
  longcat: LongCatColor,
  meta: MetaColor,
  minimax: MinimaxColor,
  mistral: MistralColor,
  modelscope: ModelScopeColor,
  newapi: NewAPIColor,
  nvidia: NvidiaColor,
  ollama: OllamaMono,
  openai: OpenAIMono,
  opencode: OpenCodeMono,
  openrouter: OpenRouterColor,
  perplexity: PerplexityColor,
  ppio: PPIOColor,
  qiniu: QiniuColor,
  qwen: QwenColor,
  "qwen-token-plan": QwenColor,
  "qwen-token-plan-cn": QwenColor,
  "qwen-token-plan-individual": QwenColor,
  siliconcloud: SiliconCloudColor,
  siliconflow: SiliconCloudColor,
  stepfun: StepfunMono,
  tencent: TencentColor,
  together: TogetherColor,
  vercel: VercelMono,
  wenxin: WenxinColor,
  mimo: XiaomiMiMoMono,
  xiaomi: XiaomiMiMoMono,
  yi: YiColor,
  "zai-coding-cn": ZAIMono,
  zai: ZAIMono,
  zeroone: ZeroOneColor,
  zhipu: ZhipuColor,
};
