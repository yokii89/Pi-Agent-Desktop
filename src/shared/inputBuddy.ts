/**
 * 输入栏伙伴的持久化标识；设置选项、IPC 校验与渲染注册表共用这份清单。
 * 纯装饰：不进会话数据、不参与发送，只把用户偏好持久化到 settings.json。
 */
export const INPUT_BUDDY_KINDS = [
  "none",
  "dog",
  "cat",
  "parrot",
  "capy",
  "pea",
  "steve",
  "fox",
  "rabbit",
  "panda",
  "raccoon",
  "hamster",
  "bear",
  "koala",
] as const;

export type InputBuddyKind = (typeof INPUT_BUDDY_KINDS)[number];
/** 有插画的形象；none 仅表示关闭，不需要在插画注册表中提供空组件。 */
export type InputBuddyCharacter = Exclude<InputBuddyKind, "none">;

/** 默认小狗：设计稿里的第一款形象。 */
export const DEFAULT_INPUT_BUDDY: InputBuddyKind = "dog";

/** 判断外部设置值是否属于受支持的形象。 */
export function isInputBuddyKind(value: unknown): value is InputBuddyKind {
  return typeof value === "string" && (INPUT_BUDDY_KINDS as readonly string[]).includes(value);
}

/** 校验设置值；未知值回退默认（与 railStyle / fontPresets 同一规则）。 */
export function normalizeInputBuddy(value: unknown): InputBuddyKind {
  return isInputBuddyKind(value) ? value : DEFAULT_INPUT_BUDDY;
}
