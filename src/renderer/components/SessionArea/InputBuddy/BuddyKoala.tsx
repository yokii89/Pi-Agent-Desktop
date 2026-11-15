import { BuddyAnimal } from "./BuddyAnimal";
import styles from "./BuddyAnimal.module.css";
import type { BuddyArtworkProps } from "./BuddySvg";

/** 考拉：宽绒耳与长鼻形成独立轮廓；鼻子通过槽位接入共用表情骨架。 */
export function BuddyKoala({ pose, animated }: BuddyArtworkProps) {
  return (
    <BuddyAnimal
      pose={pose}
      animated={animated}
      className={styles.koala}
      snack="eucalyptus"
      nose={
        <path
          className={styles.nose}
          d="M 180 85 C 167 85 166 100 168 110 Q 180 122 192 110 C 194 100 193 85 180 85 Z"
          strokeWidth={3.5}
        />
      }
      head={
        <>
          <g data-part="ear-left">
            <path
              className={styles.coat}
              d="M 144 55 Q 124 24 104 36 L 98 32 L 95 42 Q 77 50 84 69 L 79 74 L 88 79 Q 88 101 109 106 L 115 111 L 120 103 Q 140 97 144 80 Z"
            />
            <ellipse className={styles.inner} cx={113} cy={72} rx={20} ry={24} stroke="none" />
            <path
              className={styles.bib}
              d="M 101 58 L 108 65 L 103 72 L 112 79 L 108 88 Q 94 82 96 68 Z"
              stroke="none"
            />
          </g>
          <g data-part="ear-right">
            <path
              className={styles.coat}
              d="M 216 55 Q 236 24 256 36 L 262 32 L 265 42 Q 283 50 276 69 L 281 74 L 272 79 Q 272 101 251 106 L 245 111 L 240 103 Q 220 97 216 80 Z"
            />
            <ellipse className={styles.inner} cx={247} cy={72} rx={20} ry={24} stroke="none" />
            <path
              className={styles.bib}
              d="M 259 58 L 252 65 L 257 72 L 248 79 L 252 88 Q 266 82 264 68 Z"
              stroke="none"
            />
          </g>
          <path
            className={styles.coat}
            d="M 158 50 L 170 42 L 177 48 L 187 40 L 193 50 C 224 51 240 73 240 105 C 240 137 215 149 180 149 C 145 149 120 137 120 105 C 120 75 135 57 158 50 Z"
          />
          <path
            className={styles.bib}
            d="M 144 114 Q 159 100 180 111 Q 201 100 216 114 Q 211 140 180 141 Q 149 140 144 114 Z"
            stroke="none"
          />
        </>
      }
    />
  );
}
