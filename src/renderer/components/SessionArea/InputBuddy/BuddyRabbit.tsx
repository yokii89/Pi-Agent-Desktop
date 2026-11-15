import { BuddyAnimal } from "./BuddyAnimal";
import styles from "./BuddyAnimal.module.css";
import type { BuddyArtworkProps } from "./BuddySvg";

/** 垂耳兔：奶白毛、长垂耳与丁香色围巾，进食时捧一根胡萝卜。 */
export function BuddyRabbit({ pose, animated }: BuddyArtworkProps) {
  return (
    <BuddyAnimal
      pose={pose}
      animated={animated}
      className={styles.rabbit}
      snack="carrot"
      accessory={
        <g>
          <path
            className={styles.accent}
            d="M 138 137 Q 180 149 222 137 L 222 155 Q 180 166 138 155 Z"
            strokeWidth={4}
          />
          <path
            className={styles.accent}
            d="M 202 155 L 219 155 L 225 181 L 207 178 Z"
            strokeWidth={4}
          />
        </g>
      }
      head={
        <>
          <g data-part="ear-left">
            <path
              className={styles.coat}
              d="M 147 51 C 137 21 114 17 101 39 C 88 63 84 111 99 123 C 115 135 125 115 123 96 L 128 63 Z"
            />
            <path
              className={styles.inner}
              d="M 126 42 C 109 38 101 77 103 107 Q 111 120 113 103 C 112 78 117 57 126 50 Z"
              stroke="none"
            />
          </g>
          <g data-part="ear-right">
            <path
              className={styles.coat}
              d="M 213 51 C 223 21 246 17 259 39 C 272 63 276 111 261 123 C 245 135 235 115 237 96 L 232 63 Z"
            />
            <path
              className={styles.inner}
              d="M 234 42 C 251 38 259 77 257 107 Q 249 120 247 103 C 248 78 243 57 234 50 Z"
              stroke="none"
            />
          </g>
          <path
            className={styles.coat}
            d="M 180 44 C 142 44 119 66 119 102 C 119 133 145 146 180 146 C 215 146 241 133 241 102 C 241 66 218 44 180 44 Z"
          />
          <path
            className={styles.bib}
            d="M 143 116 Q 144 103 158 104 Q 174 104 180 112 Q 186 104 202 104 Q 216 103 217 116 Q 210 139 180 139 Q 150 139 143 116 Z"
            stroke="none"
          />
          <ellipse className={styles.inner} cx={137} cy={108} rx={10} ry={6} stroke="none" />
          <ellipse className={styles.inner} cx={223} cy={108} rx={10} ry={6} stroke="none" />
          <path
            data-part="teeth"
            className={styles.bib}
            d="M 174 123 L 174 135 Q 180 139 186 135 L 186 123 M 180 125 L 180 136"
            strokeWidth={2.5}
          />
        </>
      }
    />
  );
}
