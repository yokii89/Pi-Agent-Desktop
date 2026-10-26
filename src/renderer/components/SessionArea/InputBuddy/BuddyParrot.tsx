import { BuddyEffects } from "./BuddyEffects";
import { BuddySpecialEyes } from "./BuddyExpression";
import { BuddySnack } from "./BuddySnack";
import type { BuddyPose } from "./buddyPose";
import styles from "./InputBuddy.module.css";

/**
 * 鹦鹉（docs/动物形象/鹦鹉.html）：翠绿羽毛 + 黄羽冠 + 珊瑚红项圈，
 * 双翅 / 羽冠 / 双喙 / 爪子可独立摆动。裁切区与小狗、橘猫一致。
 */
export function BuddyParrot({ pose }: { pose: BuddyPose }) {
  return (
    <svg
      className={`${styles.art} ${styles.parrot}`}
      data-pose={pose}
      viewBox="50 0 290 203"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round">
        <g data-part="character">
          {/* 1. 身体与翅膀层 */}
          <g>
            <g data-part="wing-left">
              <path
                className={styles.parrotWing}
                d="M 134 142 C 98 148, 84 182, 102 198 C 114 206, 128 192, 134 175 Z"
              />
              <path d="M 106 182 C 114 180, 122 174, 126 168" fill="none" strokeWidth={4.5} />
            </g>
            <g data-part="wing-right">
              <path
                className={styles.parrotWing}
                d="M 226 142 C 262 148, 276 182, 258 198 C 246 206, 232 192, 226 175 Z"
              />
              <path d="M 254 182 C 246 180, 238 174, 234 168" fill="none" strokeWidth={4.5} />
            </g>

            <path
              className={styles.parrotCoat}
              d="M 122 202 C 122 175, 130 155, 136 140 L 224 140 C 230 155, 238 175, 238 202 Z"
              stroke="none"
            />
            <path
              className={styles.parrotFace}
              d="M 144 152 C 144 195, 165 202, 180 202 C 195 202, 216 195, 216 152 Z"
              stroke="none"
            />
            <g className={styles.parrotFeather} strokeWidth={4}>
              <path d="M 166 182 Q 173 187 180 182 Q 187 187 194 182" />
              <path d="M 172 193 Q 180 198 188 193" />
            </g>

            <path d="M 122 202 C 122 175, 130 155, 136 140" fill="none" />
            <path d="M 238 202 C 238 175, 230 155, 224 140" fill="none" />

            <path
              className={styles.parrotCollar}
              d="M 134 134 C 156 148, 204 148, 226 134 L 227 150 C 204 164, 156 164, 133 150 Z"
            />

            <g data-part="seed-tag">
              <path d="M 180 160 L 180 166" strokeWidth={5.5} />
              <path
                className={styles.gold}
                d="M 180 165 C 167 168, 167 188, 180 192 C 193 188, 193 168, 180 165 Z"
                strokeWidth={4.5}
              />
              <path d="M 180 171 L 180 185" strokeWidth={3.5} />
            </g>
          </g>

          {/* 2. 头部层 */}
          <g data-part="head">
            <g data-part="crest">
              <path
                className={styles.gold}
                d="M 182 38 C 192 22, 208 18, 204 30 C 201 38, 190 42, 184 42 Z"
              />
              <path
                className={styles.gold}
                d="M 178 40 C 165 14, 185 -2, 195 14 C 202 25, 190 36, 184 40 Z"
              />
            </g>

            <path
              className={styles.parrotCoat}
              d="M 180 35 C 218 35, 240 60, 240 96 C 240 130, 215 145, 180 145 C 145 145, 120 130, 120 96 C 120 60, 142 35, 180 35 Z"
            />
            <path
              className={styles.parrotFace}
              d="M 180 42 C 208 42, 226 62, 224 92 C 222 115, 202 126, 180 126 C 158 126, 138 115, 136 92 C 134 62, 152 42, 180 42 Z"
              stroke="none"
            />

            <g className={styles.parrotCheek} stroke="none">
              <circle cx="137" cy="96" r="12" />
              <circle cx="223" cy="96" r="12" />
            </g>

            <g data-part="eyes-normal">
              <circle cx="152" cy="76" r="6" fill="currentColor" stroke="none" />
              <circle cx="208" cy="76" r="6" fill="currentColor" stroke="none" />
              <circle className={styles.glint} cx="150" cy="74" r="2.2" stroke="none" />
              <circle className={styles.glint} cx="206" cy="74" r="2.2" stroke="none" />
            </g>
            <g data-part="eyes-happy" fill="none" strokeWidth={5}>
              <path d="M 143 78 Q 152 66 161 78" />
              <path d="M 199 78 Q 208 66 217 78" />
            </g>
            <g data-part="eyes-sleep" fill="none" strokeWidth={4.5}>
              <path d="M 143 76 Q 152 85 161 76" />
              <path d="M 199 76 Q 208 85 217 76" />
            </g>
            <g data-part="eyes-alert">
              <circle className={styles.glint} cx="152" cy="76" r="7.5" strokeWidth={4} />
              <circle className={styles.glint} cx="208" cy="76" r="7.5" strokeWidth={4} />
              <circle cx="152" cy="76" r="3" fill="currentColor" stroke="none" />
              <circle cx="208" cy="76" r="3" fill="currentColor" stroke="none" />
            </g>
            <BuddySpecialEyes left={152} right={208} y={76} size={6} />

            <g data-part="beak-lower">
              <path
                className={styles.tongue}
                d="M 169 102 C 169 124, 191 124, 191 102 Z"
                strokeWidth={4.5}
              />
              <path
                className={styles.parrotBeakLower}
                d="M 167 100 C 167 119, 193 119, 193 100 Z"
                strokeWidth={5}
              />
            </g>

            <path
              className={styles.parrotBeak}
              d="M 180 78 C 160 78, 160 104, 180 110 C 200 104, 200 78, 180 78 Z"
              strokeWidth={5}
            />
            <circle cx="175" cy="84" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="185" cy="84" r="1.5" fill="currentColor" stroke="none" />
          </g>

          <BuddySnack kind="parrot" />

          {/* 3. 鸟爪层 */}
          <g data-part="claw-left" className={styles.parrotBeak} strokeWidth={4.5}>
            <path d="M 122 203 C 122 190, 132 190, 132 203 Z" />
            <path d="M 131 203 C 131 188, 141 188, 141 203 Z" />
            <path d="M 140 203 C 140 190, 150 190, 150 203 Z" />
          </g>
          <g data-part="claw-right" className={styles.parrotBeak} strokeWidth={4.5}>
            <path d="M 210 203 C 210 190, 220 190, 220 203 Z" />
            <path d="M 219 203 C 219 188, 229 188, 229 203 Z" />
            <path d="M 228 203 C 228 190, 238 190, 238 203 Z" />
          </g>
        </g>

        {/* 4. 氛围特效层 */}
        <g data-part="question" className={styles.mark} strokeWidth={5} fill="none">
          <path d="M 285 38 C 285 22, 312 22, 312 38 C 312 48, 298 50, 298 60" />
          <circle className={styles.markFill} cx="298" cy="73" r="3" stroke="none" />
        </g>

        {/* 音符：位置靠 SVG transform 属性，动画放在内层组，避免 CSS transform 覆盖定位 */}
        <g transform="translate(268, 28) rotate(12)">
          <g data-part="notes" className={styles.mark} strokeWidth={4.5} fill="none">
            <ellipse className={styles.markFill} cx="8" cy="32" rx="5.5" ry="4" stroke="none" />
            <ellipse className={styles.markFill} cx="28" cy="28" rx="5.5" ry="4" stroke="none" />
            <path d="M 12 31 L 12 8 L 32 4 L 32 27" />
          </g>
        </g>

        <g data-part="zzz" className={styles.mark} strokeWidth={4} fill="none">
          <path d="M 265 45 L 283 45 L 265 63 L 283 63" />
          <path d="M 292 25 L 305 25 L 292 38 L 305 38" strokeWidth={3.5} />
        </g>

        <g data-part="shock" className={styles.mark} strokeWidth={5} fill="none">
          <path d="M 148 16 L 140 4" />
          <path d="M 218 16 L 226 4" />
          <path d="M 236 32 L 248 24" />
        </g>
        <BuddyEffects />
      </g>
    </svg>
  );
}
