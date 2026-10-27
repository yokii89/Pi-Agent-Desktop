import { memo } from "react";
import styles from "./AiIcon.module.css";
import { PROVIDER_ICONS } from "./providerIcons";

interface AiProviderLogoProps {
  providerId: string;
  size?: number;
}

/** 凭据 / provider 行的品牌 logo；无对应图标时回退首字母徽标。 */
export const AiProviderLogo = memo(function AiProviderLogo({
  providerId,
  size = 18,
}: AiProviderLogoProps) {
  const Icon = PROVIDER_ICONS[providerId.trim().toLowerCase()];
  if (!Icon) {
    return (
      <span className={styles.fallback} style={{ width: size, height: size }} aria-hidden>
        {(providerId[0] ?? "?").toUpperCase()}
      </span>
    );
  }
  return <Icon aria-hidden className={styles.logo} size={size} />;
});
