import { BuddyAnimal } from "./BuddyAnimal";
import styles from "./BuddyAnimal.module.css";
import type { BuddyArtworkProps } from "./BuddySvg";

/** 熊猫：圆耳、炭灰眼圈与竹叶胸针，和白色小狗靠轮廓而非换色区分。 */
export function BuddyPanda({ pose, animated }: BuddyArtworkProps) {
  return (
    <BuddyAnimal
      pose={pose}
      animated={animated}
      className={styles.panda}
      snack="bamboo"
      accessory={
        <g className={styles.accent} strokeWidth={3.5}>
          <path d="M 174 174 Q 164 153 148 164 Q 150 180 174 174 Z" />
          <path d="M 174 174 Q 182 153 197 161 Q 198 178 174 174 Z" />
          <path d="M 174 173 L 179 187" fill="none" />
        </g>
      }
      head={
        <>
          <g data-part="ear-left">
            <circle className={styles.paw} cx={132} cy={49} r={24} />
            <circle className={styles.inner} cx={132} cy={49} r={11} stroke="none" />
          </g>
          <g data-part="ear-right">
            <circle className={styles.paw} cx={228} cy={49} r={24} />
            <circle className={styles.inner} cx={228} cy={49} r={11} stroke="none" />
          </g>
          <path
            className={styles.coat}
            d="M 180 41 C 138 41 110 64 110 101 C 110 136 142 149 180 149 C 218 149 250 136 250 101 C 250 64 222 41 180 41 Z"
          />
          <ellipse
            className={styles.paw}
            cx={151}
            cy={90}
            rx={18}
            ry={23}
            transform="rotate(28 151 90)"
            stroke="none"
          />
          <ellipse
            className={styles.paw}
            cx={209}
            cy={90}
            rx={18}
            ry={23}
            transform="rotate(-28 209 90)"
            stroke="none"
          />
        </>
      }
    />
  );
}
