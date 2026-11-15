import { BuddyAnimal } from "./BuddyAnimal";
import styles from "./BuddyAnimal.module.css";
import type { BuddyArtworkProps } from "./BuddySvg";

/** 仓鼠：大腮帮、小圆耳与奶油色中线，沿用葵花籽道具。 */
export function BuddyHamster({ pose, animated }: BuddyArtworkProps) {
  return (
    <BuddyAnimal
      pose={pose}
      animated={animated}
      className={styles.hamster}
      snack="seed"
      head={
        <>
          <g data-part="ear-left">
            <circle className={styles.coat} cx={131} cy={53} r={19} />
            <circle className={styles.inner} cx={131} cy={53} r={10} stroke="none" />
          </g>
          <g data-part="ear-right">
            <circle className={styles.coat} cx={229} cy={53} r={19} />
            <circle className={styles.inner} cx={229} cy={53} r={10} stroke="none" />
          </g>
          <path
            className={styles.coat}
            d="M 180 48 C 143 48 123 64 120 86 C 96 96 96 132 123 147 Q 146 159 180 154 Q 214 159 237 147 C 264 132 264 96 240 86 C 237 64 217 48 180 48 Z"
          />
          <path
            className={styles.bib}
            d="M 170 50 Q 180 47 190 50 L 188 92 Q 213 96 230 113 Q 246 130 228 143 Q 208 155 180 149 Q 152 155 132 143 Q 114 130 130 113 Q 147 96 172 92 Z"
            stroke="none"
          />
          <ellipse className={styles.inner} cx={128} cy={113} rx={13} ry={8} stroke="none" />
          <ellipse className={styles.inner} cx={232} cy={113} rx={13} ry={8} stroke="none" />
          <path
            d="M 115 116 L 103 114 M 115 123 L 104 126 M 245 116 L 257 114 M 245 123 L 256 126"
            fill="none"
            strokeWidth={3}
          />
          <path
            data-part="teeth"
            className={styles.bib}
            d="M 174 124 L 174 137 Q 180 140 186 137 L 186 124 M 180 126 L 180 138"
            strokeWidth={2.5}
          />
        </>
      }
    />
  );
}
