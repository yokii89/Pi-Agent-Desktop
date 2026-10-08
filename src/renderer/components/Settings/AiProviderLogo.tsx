import { getIcon, getIconUrl, isUrlIcon } from "../../assets/ai-logos";
import styles from "./AiProviderLogo.module.css";

/**
 * pi provider id → ai-logos 图标键。
 * 优先精确命中；未列出时用 id 原样再试一次（icons 表已 lowercase）。
 */
const PROVIDER_LOGO_ALIAS: Record<string, string> = {
  anthropic: "anthropic",
  claude: "claude",
  openai: "openai",
  "openai-codex": "openai",
  google: "google",
  gemini: "gemini",
  deepseek: "deepseek",
  openrouter: "openrouter",
  xai: "grok",
  grok: "grok",
  groq: "grok",
  mistral: "mistral",
  "github-copilot": "githubcopilot",
  copilot: "githubcopilot",
  github: "github",
  azure: "azure",
  "azure-openai-responses": "azure",
  aws: "aws",
  "amazon-bedrock": "aws",
  cloudflare: "cloudflare",
  "cloudflare-ai-gateway": "cloudflare",
  "cloudflare-workers-ai": "cloudflare",
  nvidia: "nvidia",
  meta: "meta",
  llama: "meta",
  kimi: "kimi",
  "kimi-coding": "kimi",
  moonshot: "kimi",
  minimax: "minimax",
  qwen: "qwen",
  "qwen-token-plan": "qwen",
  "qwen-token-plan-individual": "qwen",
  "qwen-token-plan-cn": "qwen",
  zhipu: "zhipu",
  chatglm: "chatglm",
  zai: "zhipu",
  "zai-coding-cn": "zhipu",
  xiaomi: "xiaomimimo",
  mimo: "xiaomimimo",
  newapi: "newapi",
  doubao: "doubao",
  bytedance: "bytedance",
  baidu: "baidu",
  wenxin: "wenxin",
  alibaba: "alibaba",
  bailian: "bailian",
  tencent: "tencent",
  hunyuan: "hunyuan",
  huawei: "huawei",
  siliconflow: "siliconflow",
  together: "together",
  fireworks: "stability",
  perplexity: "perplexity",
  cohere: "cohere",
  huggingface: "huggingface",
  ollama: "ollama",
  vercel: "vercel",
  opencode: "opencode-logo-light",
};

function resolveLogoKey(providerId: string): string {
  const lower = providerId.toLowerCase();
  return PROVIDER_LOGO_ALIAS[lower] ?? lower;
}

interface AiProviderLogoProps {
  providerId: string;
  size?: number;
}

/** 凭据 / 模型行的 provider logo；无对应图标时回退首字母徽标。 */
export function AiProviderLogo({ providerId, size = 18 }: AiProviderLogoProps) {
  const key = resolveLogoKey(providerId);
  if (isUrlIcon(key)) {
    return (
      <img
        className={styles.img}
        src={getIconUrl(key)}
        alt=""
        width={size}
        height={size}
        draggable={false}
      />
    );
  }
  const svg = getIcon(key);
  if (!svg) {
    return (
      <span className={styles.fallback} style={{ width: size, height: size }} aria-hidden>
        {(providerId[0] ?? "?").toUpperCase()}
      </span>
    );
  }
  // 本地受信任 SVG：data URL 渲染，避免 dangerouslySetInnerHTML
  const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  return (
    <img className={styles.img} src={dataUrl} alt="" width={size} height={size} draggable={false} />
  );
}
