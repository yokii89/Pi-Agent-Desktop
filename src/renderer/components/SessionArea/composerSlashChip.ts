import { SLASH_CMD_ATTR } from "../../utils/composerDom";
import styles from "./Composer.module.css";

/** pi 技能命令名带 `skill:` 前缀（如 `skill:cloudflare-email-service`）。 */
export function isSkillCommand(name: string): boolean {
  return name.startsWith("skill:");
}

/** 从隐藏克隆库取 SVG（firstChild 可能是空白文本节点，优先 querySelector）。 */
export function pickSvgIconNode(source: HTMLElement | null): Node | null {
  if (!source) return null;
  return source.querySelector("svg") ?? source.firstElementChild ?? source.firstChild;
}

/** 技能芯片的图标壳：与 @ 文件芯片同一 16px 槽位。 */
export function createSkillIconShell(skillIcon?: Node | null): HTMLElement {
  const icon = document.createElement("span");
  icon.className = styles.fileIcon;
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("data-skill-icon", "1");
  if (skillIcon) icon.appendChild(skillIcon.cloneNode(true));
  return icon;
}

/**
 * 输入栏 / 斜杠命令原子芯片：视觉与 @ 文件芯片一致（同一背景令牌）。
 * 技能带 PuzzlePiece 图标且全名不截断；普通命令保持紧凑 label。
 */
export function createSlashChip(name: string, skillIcon?: Node | null): HTMLElement {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.setAttribute(SLASH_CMD_ATTR, name);
  const skill = isSkillCommand(name);
  chip.className = skill ? `${styles.slashChip} ${styles.slashChipSkill}` : styles.slashChip;
  chip.dataset.label = name;
  chip.title = `/${name}`;

  if (skill) {
    chip.append(createSkillIconShell(skillIcon));
  }

  const label = document.createElement("span");
  label.className = skill ? styles.labelFull : styles.label;
  label.textContent = `/${name}`;

  chip.append(label);
  return chip;
}
