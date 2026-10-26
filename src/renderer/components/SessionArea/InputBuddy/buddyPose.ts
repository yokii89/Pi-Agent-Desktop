/**
 * 角色姿态：六个基础姿态来自 docs/动物形象，另外六个是输入栏的互动与反馈动画。
 * 会话生成中使用 thinking；其余互动姿态可由点击彩蛋预览，不侵入业务状态。
 */
export type BuddyPose =
  | "idle"
  | "happy"
  | "tilt"
  | "wave"
  | "sleep"
  | "alert"
  | "thinking"
  | "angry"
  | "eating"
  | "sad"
  | "celebration"
  | "dizzy";
