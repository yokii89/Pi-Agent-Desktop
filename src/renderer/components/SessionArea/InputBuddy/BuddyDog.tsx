import type { BuddyPose } from "./buddyPose";
import styles from "./InputBuddy.module.css";

/**
 * 小狗（docs/动物形象/小狗.html）：白毛 + 黄色吊牌，双耳 / 双爪 / 吊牌可独立摆动。
 * 裁切区与另两款一致（viewBox 50 0 290 203），底边即输入卡上沿，爪子搭在卡沿上。
 */
export function BuddyDog({ pose }: { pose: BuddyPose }) {
  return (
    <svg
      className={`${styles.art} ${styles.dog}`}
      data-pose={pose}
      viewBox="50 0 290 203"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round">
        {/* 1. 身体层 */}
        <g>
          <path
            className={styles.dogCoat}
            d="M 118 202 C 122 182, 130 165, 134 150 L 226 150 C 230 165, 238 182, 242 202 Z"
            stroke="none"
          />
          <path d="M 118 202 C 122 182, 130 165, 134 150" fill="none" />
          <path d="M 242 202 C 238 182, 230 165, 226 150" fill="none" />

          {/* 黄色吊牌 */}
          <g data-part="tag">
            <circle className={styles.gold} cx="180" cy="186" r="14" stroke="none" />
            <path d="M 180 168 L 180 176" strokeWidth={6.5} />
          </g>

          {/* 项圈 */}
          <path
            className={styles.dogCoat}
            d="M 132 135 C 155 152, 205 152, 228 135 L 229 156 C 205 173, 155 173, 131 156 Z"
          />
        </g>

        {/* 2. 头部层 */}
        <g data-part="head">
          <path
            data-part="tongue"
            className={styles.tongue}
            d="M 168 131 C 168 162, 192 162, 192 131 Z"
            strokeWidth={5}
          />

          <path
            className={styles.dogCoat}
            d="M 132 28 C 146 24, 162 12, 180 12 C 198 12, 214 24, 228 28 C 235 60, 239 108, 233 124 C 225 144, 192 148, 180 132 C 168 148, 135 144, 127 124 C 121 108, 125 60, 132 28 Z"
            stroke="none"
          />

          <g data-part="ear-left">
            <path
              className={styles.dogCoat}
              d="M 138 26 C 128 26, 122 26, 112 28 C 82 32, 71 65, 76 98 C 80 125, 106 125, 112 108 C 118 90, 122 65, 129 60"
            />
          </g>
          <g data-part="ear-right">
            <path
              className={styles.dogCoat}
              d="M 222 26 C 232 26, 238 26, 248 28 C 278 32, 289 65, 284 98 C 280 125, 254 125, 248 108 C 242 90, 238 65, 231 60"
            />
          </g>

          <path
            d="M 136 26 C 142 26, 145 25, 146 24 C 162 12, 198 12, 214 24 C 215 25, 218 26, 224 26"
            fill="none"
          />
          <path
            d="M 129 60 C 123 82, 121 108, 127 124 C 135 144, 168 148, 180 132 C 192 148, 225 144, 233 124 C 239 108, 237 82, 231 60"
            fill="none"
          />

          <g data-part="eyes-normal">
            <ellipse cx="156" cy="69" rx="4.5" ry="5.5" fill="currentColor" stroke="none" />
            <ellipse cx="196" cy="68" rx="4.5" ry="5.5" fill="currentColor" stroke="none" />
          </g>
          <g data-part="eyes-happy" fill="none" strokeWidth={5}>
            <path d="M 147 71 Q 156 59 165 71" />
            <path d="M 187 70 Q 196 58 205 70" />
          </g>
          <g data-part="eyes-sleep" fill="none" strokeWidth={4.5}>
            <path d="M 147 68 Q 156 77 165 68" />
            <path d="M 187 67 Q 196 76 205 67" />
          </g>

          <path
            className={styles.dogCoat}
            d="M 180 86 C 152 86, 150 112, 178 120 C 180 121, 180 121, 182 120 C 210 112, 208 86, 180 86 Z"
            strokeWidth={5}
          />
          <path d="M 180 120 L 180 133" strokeWidth={5.5} />
        </g>

        {/* 3. 爪子层 */}
        <g data-part="paw-left">
          <path
            className={styles.dogCoat}
            d="M 92 203 C 102 188, 128 188, 136 203 Z"
            stroke="none"
          />
          <path d="M 92 203 C 102 188, 128 188, 136 203" fill="none" />
        </g>
        <g data-part="paw-right">
          <path
            className={styles.dogCoat}
            d="M 224 203 C 232 188, 258 188, 268 203 Z"
            stroke="none"
          />
          <path d="M 224 203 C 232 188, 258 188, 268 203" fill="none" />
        </g>

        {/* 4. 氛围特效层 */}
        <g data-part="question" className={styles.mark} strokeWidth={5} fill="none">
          <path d="M 285 38 C 285 22, 312 22, 312 38 C 312 48, 298 50, 298 60" />
          <circle className={styles.markFill} cx="298" cy="73" r="3" stroke="none" />
        </g>
        <g data-part="zzz" className={styles.mark} strokeWidth={4} fill="none">
          <path d="M 265 45 L 283 45 L 265 63 L 283 63" />
          <path d="M 292 25 L 305 25 L 292 38 L 305 38" strokeWidth={3.5} />
        </g>
        <g data-part="sweat" className={styles.mark} strokeWidth={5} fill="none">
          <path d="M 180 2 L 180 -12" />
          <path d="M 155 6 L 148 -6" />
          <path d="M 205 6 L 212 -6" />
        </g>
      </g>
    </svg>
  );
}
