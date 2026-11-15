import { BuddyAnimal } from "./BuddyAnimal";
import styles from "./BuddyAnimal.module.css";
import type { BuddyArtworkProps } from "./BuddySvg";

/** 小熊：焦糖色毛面、奶油吻部与蓝围巾，进食时抱蜂蜜罐。 */
export function BuddyBear({ pose, animated }: BuddyArtworkProps) {
  return (
    <BuddyAnimal
      pose={pose}
      animated={animated}
      className={styles.bear}
      snack="honey"
      accessory={
        <g>
          <path
            className={styles.accent}
            d="M 137 138 Q 180 151 223 138 L 223 157 Q 180 170 137 157 Z"
            strokeWidth={4}
          />
          <path
            className={styles.accent}
            d="M 151 158 L 168 161 L 164 187 L 145 182 Z"
            strokeWidth={4}
          />
          <path d="M 148 175 L 164 179" fill="none" strokeWidth={3} />
        </g>
      }
      head={
        <>
          <g data-part="ear-left">
            <circle className={styles.coat} cx={130} cy={49} r={24} />
            <circle className={styles.inner} cx={130} cy={49} r={12} stroke="none" />
          </g>
          <g data-part="ear-right">
            <circle className={styles.coat} cx={230} cy={49} r={24} />
            <circle className={styles.inner} cx={230} cy={49} r={12} stroke="none" />
          </g>
          <path
            className={styles.coat}
            d="M 180 44 C 141 44 115 65 115 102 C 115 136 140 149 180 149 C 220 149 245 136 245 102 C 245 65 219 44 180 44 Z"
          />
          <ellipse className={styles.bib} cx={180} cy={117} rx={32} ry={24} stroke="none" />
          <path
            className={styles.inner}
            d="M 170 52 Q 180 43 191 53 Q 181 50 180 60 Z"
            stroke="none"
          />
        </>
      }
    />
  );
}
