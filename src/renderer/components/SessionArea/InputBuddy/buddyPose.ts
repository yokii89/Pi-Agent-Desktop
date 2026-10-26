/**
 * 角色姿态：与 docs/动物形象 四份设计稿里的六个 pose class 一一对应。
 * 当前由会话状态映射 idle / tilt / wave / happy / alert，sleep 留给后续空闲计时。
 */
export type BuddyPose = "idle" | "happy" | "tilt" | "wave" | "sleep" | "alert";
