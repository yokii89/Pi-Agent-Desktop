/** Visual treatment for the running agent marker; `pi` preserves the original indicator. */
export const THINKING_ANIMATIONS = ["pi", "reasoning", "twins", "gyro", "lighthouse"] as const;

export type ThinkingAnimation = (typeof THINKING_ANIMATIONS)[number];

export const DEFAULT_THINKING_ANIMATION: ThinkingAnimation = "pi";

export function isThinkingAnimation(value: unknown): value is ThinkingAnimation {
  return typeof value === "string" && (THINKING_ANIMATIONS as readonly string[]).includes(value);
}

export function normalizeThinkingAnimation(value: unknown): ThinkingAnimation {
  return isThinkingAnimation(value) ? value : DEFAULT_THINKING_ANIMATION;
}
