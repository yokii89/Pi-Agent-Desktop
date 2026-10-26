/**
 * 输入栏动物伙伴（docs/动物形象 中用户设计的四款形象）。
 * 纯装饰：不进会话数据、不参与发送，只把用户偏好持久化到 settings.json。
 */
export const INPUT_BUDDY_KINDS = ["none", "dog", "cat", "parrot", "capy"] as const;

export type InputBuddyKind = (typeof INPUT_BUDDY_KINDS)[number];

/** 默认小狗：设计稿里的第一款形象。 */
export const DEFAULT_INPUT_BUDDY: InputBuddyKind = "dog";

export function isInputBuddyKind(value: unknown): value is InputBuddyKind {
  return typeof value === "string" && (INPUT_BUDDY_KINDS as readonly string[]).includes(value);
}

/** 校验设置值；未知值回退默认（与 railStyle / fontPresets 同一规则）。 */
export function normalizeInputBuddy(value: unknown): InputBuddyKind {
  return isInputBuddyKind(value) ? value : DEFAULT_INPUT_BUDDY;
}
