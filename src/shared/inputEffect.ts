/** 输入栏背景特效的持久化标识；默认保留原有最高思考档星火。 */
export const INPUT_EFFECTS = ["none", "ember", "aurora", "triforce", "nebula"] as const;
export type InputEffect = (typeof INPUT_EFFECTS)[number];
export type InputEffectEngine = Exclude<InputEffect, "none">;
export const DEFAULT_INPUT_EFFECT: InputEffect = "ember";

/** IPC 与磁盘读取共用同一份合法值清单。 */
export function isInputEffect(value: unknown): value is InputEffect {
  return typeof value === "string" && (INPUT_EFFECTS as readonly string[]).includes(value);
}

/** 旧设置或未知值沿用原有特效。 */
export function normalizeInputEffect(value: unknown): InputEffect {
  return isInputEffect(value) ? value : DEFAULT_INPUT_EFFECT;
}
