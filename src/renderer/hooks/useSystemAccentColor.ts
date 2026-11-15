import { useEffect, useState } from "react";
import { subscribeSystemAccentColor } from "../services/themeService";

/** 系统实际色值是运行时状态，不随 uiStore 的用户偏好写盘。 */
export function useSystemAccentColor(): string | null {
  const [color, setColor] = useState<string | null>(null);
  useEffect(() => subscribeSystemAccentColor(setColor), []);
  return color;
}
