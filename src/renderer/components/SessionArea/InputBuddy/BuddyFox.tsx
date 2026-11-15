import { BuddyAnimal } from "./BuddyAnimal";
import styles from "./BuddyAnimal.module.css";
import type { BuddyArtworkProps } from "./BuddySvg";

/** 赤狐：尖耳、奶油色颊毛与白尾尖，轮廓在输入栏的小尺寸下仍能辨认。 */
export function BuddyFox({ pose, animated }: BuddyArtworkProps) {
  return (
    <BuddyAnimal
      pose={pose}
      animated={animated}
      className={styles.fox}
      snack="berry"
      tail={
        <g>
          <path
            className={styles.coat}
            d="M 230 201 C 296 204 318 151 291 114 C 286 146 250 140 244 167 Z"
          />
          <path
            className={styles.bib}
            d="M 291 114 C 306 136 308 160 292 179 L 286 162 L 274 164 L 279 149 L 268 148 Q 287 137 291 114 Z"
            stroke="none"
          />
        </g>
      }
      head={
        <>
          <g data-part="ear-left">
            <path className={styles.coat} d="M 119 79 Q 105 48 115 15 Q 144 27 157 56 Z" />
            <path className={styles.inner} d="M 123 60 L 121 31 Q 139 42 143 59 Z" stroke="none" />
          </g>
          <g data-part="ear-right">
            <path className={styles.coat} d="M 241 79 Q 255 48 245 15 Q 216 27 203 56 Z" />
            <path className={styles.inner} d="M 237 60 L 239 31 Q 221 42 217 59 Z" stroke="none" />
          </g>
          <path
            className={styles.coat}
            d="M 180 46 C 145 44 124 63 117 89 L 103 102 L 121 106 L 112 117 Q 141 141 180 150 Q 219 141 248 117 L 239 106 L 257 102 L 243 89 C 236 63 215 44 180 46 Z"
          />
          <path
            className={styles.bib}
            d="M 118 100 Q 142 98 180 117 Q 218 98 242 100 L 233 112 L 241 117 Q 214 137 180 145 Q 146 137 119 117 L 127 112 Z"
            stroke="none"
          />
        </>
      }
    />
  );
}
