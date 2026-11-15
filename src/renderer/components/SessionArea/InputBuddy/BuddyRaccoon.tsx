import { BuddyAnimal } from "./BuddyAnimal";
import styles from "./BuddyAnimal.module.css";
import type { BuddyArtworkProps } from "./BuddySvg";

/** 小浣熊：灰绒毛、连在一起的眼罩与环纹尾巴，进食时捧曲奇。 */
export function BuddyRaccoon({ pose, animated }: BuddyArtworkProps) {
  return (
    <BuddyAnimal
      pose={pose}
      animated={animated}
      className={styles.raccoon}
      snack="cookie"
      tail={
        <g>
          <path
            className={styles.coat}
            d="M 230 199 C 280 210 309 187 306 153 C 305 139 294 126 282 121 C 291 146 268 152 251 161 C 232 171 223 184 230 199 Z"
          />
          <path
            className={styles.paw}
            d="M 282 121 C 294 126 305 139 306 153 L 286 151 Q 291 137 282 121 Z M 270 152 L 306 164 Q 305 175 299 182 L 253 161 Z M 239 171 L 285 195 Q 274 202 262 203 L 229 186 Q 231 177 239 171 Z"
            stroke="none"
          />
        </g>
      }
      head={
        <>
          <g data-part="ear-left">
            <path className={styles.coat} d="M 117 78 Q 100 56 112 29 Q 139 31 150 55 Z" />
            <path
              className={styles.inner}
              d="M 121 60 Q 114 46 118 40 Q 131 44 135 54 Z"
              stroke="none"
            />
          </g>
          <g data-part="ear-right">
            <path className={styles.coat} d="M 243 78 Q 260 56 248 29 Q 221 31 210 55 Z" />
            <path
              className={styles.inner}
              d="M 239 60 Q 246 46 242 40 Q 229 44 225 54 Z"
              stroke="none"
            />
          </g>
          <path
            className={styles.coat}
            d="M 180 46 C 146 43 123 62 116 87 L 104 102 L 116 105 L 108 117 Q 136 145 180 150 Q 224 145 252 117 L 244 105 L 256 102 L 244 87 C 237 62 214 43 180 46 Z"
          />
          <path
            className={styles.bib}
            d="M 118 113 Q 135 104 154 108 L 180 102 L 206 108 Q 225 104 242 113 Q 220 141 180 145 Q 140 141 118 113 Z"
            stroke="none"
          />
          <path
            className={styles.paw}
            d="M 123 87 Q 141 65 161 78 Q 180 91 199 78 Q 219 65 237 87 L 233 105 Q 216 116 200 105 Q 180 92 160 105 Q 144 116 127 105 Z"
            stroke="none"
          />
          <path
            className={styles.bib}
            d="M 172 50 Q 180 46 188 50 L 184 77 Q 180 83 176 77 Z"
            stroke="none"
          />
        </>
      }
    />
  );
}
