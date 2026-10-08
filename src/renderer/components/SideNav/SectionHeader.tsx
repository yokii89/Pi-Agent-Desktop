import { CaretDown } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef } from "react";
import { loadGsap, prefersReducedMotion } from "../../utils/animation";
import { NAV_MOTION } from "../../utils/motionTokens";
import styles from "./SideNav.module.css";

interface SectionHeaderProps {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  /** 头部右侧动作按钮（如"添加项目"）；缺省时只有标题。 */
  action?: ReactNode;
}

/**
 * 侧栏分区头（项目 / 任务）：点击标题切换分区展开，箭头跟随展开态。
 * 箭头用 GSAP 旋转而非 CSS transform，是为了拿到回弹曲线（折角"啪"一下打开的手感）。
 */
export function SectionHeader({ label, expanded, onToggle, action }: SectionHeaderProps) {
  const caretRef = useRef<HTMLSpanElement>(null);
  const firstRun = useRef(true);

  useEffect(() => {
    const caret = caretRef.current;
    if (!caret) return;
    const target = expanded ? 0 : -90;
    if (firstRun.current) {
      firstRun.current = false;
      caret.style.transform = `rotate(${target}deg)`;
      return;
    }
    if (prefersReducedMotion()) {
      caret.style.transform = `rotate(${target}deg)`;
      return;
    }
    let cancelled = false;
    void loadGsap().then((gsap) => {
      if (cancelled || !caret.isConnected) return;
      gsap.to(caret, {
        rotate: target,
        duration: NAV_MOTION.hover,
        ease: expanded ? NAV_MOTION.easeBack : NAV_MOTION.easeOut,
        transformOrigin: "50% 50%",
      });
    });
    return () => {
      cancelled = true;
    };
  }, [expanded]);

  return (
    <div className={styles.sectionHeader}>
      <button
        type="button"
        className={styles.sectionHeaderMain}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span ref={caretRef} className={styles.caretBox}>
          <CaretDown size={14} weight="regular" />
        </span>
        {label}
      </button>
      {action}
    </div>
  );
}
