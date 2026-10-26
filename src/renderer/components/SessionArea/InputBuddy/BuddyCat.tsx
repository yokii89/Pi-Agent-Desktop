import { BuddyEffects } from "./BuddyEffects";
import { BuddyPuffCheeks, BuddySpecialEyes } from "./BuddyExpression";
import { BuddySnack } from "./BuddySnack";
import type { BuddyPose } from "./buddyPose";
import styles from "./InputBuddy.module.css";

/**
 * 橘猫（docs/动物形象/橘猫.html）：橘色虎斑 + 薄荷绿项圈与金铃铛，
 * 尾巴 / 双耳 / 双爪 / 胡须可独立摆动。裁切区与小狗一致。
 */
export function BuddyCat({ pose }: { pose: BuddyPose }) {
  return (
    <svg
      className={`${styles.art} ${styles.cat}`}
      data-pose={pose}
      viewBox="50 0 290 203"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round">
        <g data-part="character">
          {/* 0. 尾巴层（身体后方） */}
          <g data-part="tail">
            <path
              className={styles.catCoat}
              d="M 228 195 C 275 190, 298 145, 282 105 C 272 82, 250 92, 258 115 C 265 138, 250 172, 222 182 Z"
            />
            <g className={styles.catStripe} strokeWidth={5}>
              <path d="M 277 100 C 269 104, 265 106, 259 105" />
              <path d="M 284 120 C 274 122, 269 124, 262 122" />
              <path d="M 280 142 C 270 142, 264 142, 257 140" />
            </g>
          </g>

          {/* 1. 身体层 */}
          <g>
            <path
              className={styles.catCoat}
              d="M 122 202 C 126 182, 134 165, 138 148 L 222 148 C 226 165, 234 182, 238 202 Z"
              stroke="none"
            />
            <path
              className={styles.catBib}
              d="M 152 160 C 152 192, 180 200, 180 200 C 180 200, 208 192, 208 160 Z"
              stroke="none"
            />
            <path d="M 122 202 C 126 182, 134 165, 138 148" fill="none" />
            <path d="M 238 202 C 234 182, 226 165, 222 148" fill="none" />

            <path
              className={styles.catCollar}
              d="M 135 136 C 156 150, 204 150, 225 136 L 226 154 C 204 168, 156 168, 134 154 Z"
            />

            <g data-part="bell">
              <circle className={styles.gold} cx="180" cy="177" r="12.5" />
              <path d="M 172 175 L 188 175" strokeWidth={4} />
              <circle cx="180" cy="182" r="2.5" fill="currentColor" stroke="none" />
            </g>
          </g>

          {/* 2. 头部层 */}
          <g data-part="head">
            <g data-part="ear-left">
              <path
                className={styles.catCoat}
                d="M 118 72 C 102 45, 104 18, 118 14 C 132 10, 154 28, 162 44 Z"
              />
              <path
                className={styles.catInner}
                d="M 122 60 C 114 42, 115 26, 122 24 C 130 22, 144 33, 150 44 Z"
                stroke="none"
              />
            </g>
            <g data-part="ear-right">
              <path
                className={styles.catCoat}
                d="M 242 72 C 258 45, 256 18, 242 14 C 228 10, 206 28, 198 44 Z"
              />
              <path
                className={styles.catInner}
                d="M 238 60 C 246 42, 245 26, 238 24 C 230 22, 216 33, 210 44 Z"
                stroke="none"
              />
            </g>

            <path
              className={styles.catCoat}
              d="M 180 34 C 218 34, 242 58, 244 96 C 246 130, 218 146, 180 146 C 142 146, 114 130, 116 96 C 118 58, 142 34, 180 34 Z"
            />

            <path
              className={styles.catBib}
              d="M 146 105 C 142 132, 162 143, 180 143 C 198 143, 218 132, 214 105 C 202 92, 158 92, 146 105 Z"
              stroke="none"
            />

            <g className={styles.catStripe} strokeWidth={5}>
              <path d="M 180 37 L 180 57" />
              <path d="M 164 40 C 166 48, 168 53, 171 57" />
              <path d="M 196 40 C 194 48, 192 53, 189 57" />
              <path d="M 120 88 L 132 90" />
              <path d="M 119 100 L 134 100" />
              <path d="M 240 88 L 228 90" />
              <path d="M 241 100 L 226 100" />
            </g>

            <g data-part="eyes-normal">
              <ellipse cx="154" cy="78" rx="5.5" ry="6.5" fill="currentColor" stroke="none" />
              <ellipse cx="206" cy="78" rx="5.5" ry="6.5" fill="currentColor" stroke="none" />
              <circle className={styles.glint} cx="152" cy="75" r="2" stroke="none" />
              <circle className={styles.glint} cx="204" cy="75" r="2" stroke="none" />
            </g>
            <g data-part="eyes-happy" fill="none" strokeWidth={5}>
              <path d="M 144 80 Q 154 68 164 80" />
              <path d="M 196 80 Q 206 68 216 80" />
            </g>
            <g data-part="eyes-sleep" fill="none" strokeWidth={4.5}>
              <path d="M 144 77 Q 154 86 164 77" />
              <path d="M 196 77 Q 206 86 216 77" />
            </g>
            <g data-part="eyes-alert">
              <ellipse cx="154" cy="78" rx="2.5" ry="7.5" fill="currentColor" stroke="none" />
              <ellipse cx="206" cy="78" rx="2.5" ry="7.5" fill="currentColor" stroke="none" />
            </g>
            <BuddySpecialEyes left={154} right={206} y={78} size={5.5} />
            <BuddyPuffCheeks left={138} right={222} y={111} />

            <path
              data-part="mouth-open"
              className={styles.tongue}
              d="M 171 114 C 171 134, 189 134, 189 114 Z"
              strokeWidth={4.5}
            />

            <path
              className={styles.catInner}
              d="M 180 98 L 171 89 C 175 86, 185 86, 189 89 Z"
              strokeWidth={4.5}
            />
            <path d="M 180 98 L 180 107" strokeWidth={5} />
            <path
              className={styles.catBib}
              d="M 162 110 C 166 119, 178 119, 180 107 C 182 119, 194 119, 198 110"
              strokeWidth={5}
            />

            <g data-part="whiskers-left" className={styles.mark} strokeWidth={4}>
              <path d="M 122 98 L 94 93" />
              <path d="M 120 108 L 90 110" />
              <path d="M 124 118 L 97 125" />
            </g>
            <g data-part="whiskers-right" className={styles.mark} strokeWidth={4}>
              <path d="M 238 98 L 266 93" />
              <path d="M 240 108 L 270 110" />
              <path d="M 236 118 L 263 125" />
            </g>
          </g>

          <BuddySnack kind="cat" />

          {/* 3. 爪子层 */}
          <g data-part="paw-left">
            <path
              className={styles.catBib}
              d="M 98 203 C 106 186, 132 186, 138 203 Z"
              stroke="none"
            />
            <path d="M 98 203 C 106 186, 132 186, 138 203" fill="none" />
            <path d="M 113 195 L 113 203" strokeWidth={4} />
            <path d="M 123 195 L 123 203" strokeWidth={4} />
          </g>
          <g data-part="paw-right">
            <path
              className={styles.catBib}
              d="M 222 203 C 228 186, 254 186, 262 203 Z"
              stroke="none"
            />
            <path d="M 222 203 C 228 186, 254 186, 262 203" fill="none" />
            <path d="M 237 195 L 237 203" strokeWidth={4} />
            <path d="M 247 195 L 247 203" strokeWidth={4} />
          </g>
        </g>

        {/* 4. 氛围特效层 */}
        <g data-part="question" className={styles.mark} strokeWidth={5} fill="none">
          <path d="M 285 38 C 285 22, 312 22, 312 38 C 312 48, 298 50, 298 60" />
          <circle className={styles.markFill} cx="298" cy="73" r="3" stroke="none" />
        </g>

        {/* 小鱼干：位置靠 SVG transform 属性，动画放在内层组，避免 CSS transform 覆盖定位 */}
        <g transform="translate(275, 25) rotate(-15)">
          <g data-part="fish">
            <path
              className={styles.catCoat}
              d="M 0 20 C 12 6, 32 6, 45 20 L 56 10 L 54 30 L 45 20 C 32 34, 12 34, 0 20 Z"
              strokeWidth={4}
            />
            <circle cx="14" cy="18" r="2" fill="currentColor" stroke="none" />
          </g>
        </g>

        <g data-part="zzz" className={styles.mark} strokeWidth={4} fill="none">
          <path d="M 265 45 L 283 45 L 265 63 L 283 63" />
          <path d="M 292 25 L 305 25 L 292 38 L 305 38" strokeWidth={3.5} />
        </g>

        <g data-part="shock" className={styles.mark} strokeWidth={5} fill="none">
          <path d="M 180 18 L 180 4" />
          <path d="M 155 22 L 148 10" />
          <path d="M 205 22 L 212 10" />
        </g>
        <BuddyEffects />
      </g>
    </svg>
  );
}
