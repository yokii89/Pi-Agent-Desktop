import { memo } from "react";
import styles from "./AiIcon.module.css";
import { AiProviderLogo } from "./AiProviderLogo";
import { findModelIcon } from "./modelIcons";
import { PROVIDER_ICONS } from "./providerIcons";

interface AiModelIconProps {
  provider: string;
  modelId: string;
  size?: number;
}

/**
 * 模型行 / 模型菜单的品牌图标：优先按模型家族（网关会混挂多家模型），
 * 其次按 provider，最后回退到 provider 的首字母徽标。
 *
 * memo：模型列表一次可能上百行，父级因表单输入等无关状态重渲染时图标不该跟着重建。
 */
export const AiModelIcon = memo(function AiModelIcon({
  provider,
  modelId,
  size = 16,
}: AiModelIconProps) {
  const Icon = findModelIcon(modelId) ?? PROVIDER_ICONS[provider.trim().toLowerCase()];
  if (!Icon) return <AiProviderLogo providerId={provider} size={size} />;
  return <Icon aria-hidden className={styles.logo} size={size} />;
});
