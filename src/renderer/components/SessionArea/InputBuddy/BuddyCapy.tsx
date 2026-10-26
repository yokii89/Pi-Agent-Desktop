import { BuddyEffects } from "./BuddyEffects";
import { BuddyPuffCheeks, BuddySpecialEyes } from "./BuddyExpression";
import { BuddySnack } from "./BuddySnack";
import type { BuddyPose } from "./buddyPose";
import styles from "./InputBuddy.module.css";

/**
 * 卡皮巴拉（docs/动物形象/卡皮巴拉.html）：砂棕毛 + 米色大肚皮 + 头顶小橘子，
 * 双耳 / 吻部 / 橘子可独立摆动，打盹时还挂着鼻涕泡。裁切区与另三款一致（viewBox 50 0 290 203），
 * 底边即输入卡上沿，前爪搭在卡沿上。
 */
export function BuddyCapy({ pose }: { pose: BuddyPose }) {
  return (
    <svg
      className={`${styles.art} ${styles.capy}`}
      data-pose={pose}
      viewBox="50 0 290 203"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round">
        <g data-part="character">
          {/* 1. 身体层：矮胖轮廓向两侧包上去，与头无缝相接（设计稿刻意去掉脖子） */}
          <g>
            <path
              className={styles.capyCoat}
              d="M 82 202 C 88 172, 105 140, 126 135 L 234 135 C 255 140, 272 172, 278 202 Z"
              stroke="none"
            />
            <path
              className={styles.capyBelly}
              d="M 118 152 C 118 195, 148 202, 180 202 C 212 202, 242 195, 242 152 Z"
              stroke="none"
            />
            <path d="M 82 202 C 88 172, 105 140, 126 135" fill="none" />
            <path d="M 278 202 C 272 172, 255 140, 234 135" fill="none" />
          </g>

          {/* 2. 头部层 */}
          <g data-part="head">
            <g data-part="ear-left">
              <path
                className={styles.capyEar}
                d="M 126 48 C 110 28, 90 36, 98 54 C 102 64, 114 66, 122 62 Z"
              />
              <path d="M 116 51 C 108 42, 102 46, 106 53" fill="none" strokeWidth={4} />
            </g>
            <g data-part="ear-right">
              <path
                className={styles.capyEar}
                d="M 234 48 C 250 28, 270 36, 262 54 C 258 64, 246 66, 238 62 Z"
              />
              <path d="M 244 51 C 252 42, 258 46, 254 53" fill="none" strokeWidth={4} />
            </g>

            <path
              className={styles.capyCoat}
              d="M 180 32 C 222 32, 250 54, 252 98 C 254 138, 226 148, 180 148 C 134 148, 106 138, 108 98 C 110 54, 138 32, 180 32 Z"
            />

            {/* 头顶小橘子（连带叶子，随头部一起晃） */}
            <g data-part="orange">
              <ellipse
                className={styles.capyOrange}
                cx="180"
                cy="20"
                rx="16"
                ry="13"
                strokeWidth={5}
              />
              <path
                className={styles.capyLeaf}
                d="M 180 7 C 184 -2, 198 0, 192 8 C 188 11, 182 9, 180 7 Z"
                strokeWidth={4}
              />
              <circle className={styles.gold} cx="172" cy="16" r="2" stroke="none" />
            </g>

            <g data-part="eyes-normal">
              <path d="M 128 68 L 148 68" strokeWidth={5} />
              <path d="M 132 68 A 6 5.5 0 0 0 144 68 Z" fill="currentColor" stroke="none" />
              <path d="M 212 68 L 232 68" strokeWidth={5} />
              <path d="M 216 68 A 6 5.5 0 0 0 228 68 Z" fill="currentColor" stroke="none" />
            </g>
            <g data-part="eyes-happy" fill="none" strokeWidth={5}>
              <path d="M 129 71 Q 138 60 147 71" />
              <path d="M 213 71 Q 222 60 231 71" />
            </g>
            <g data-part="eyes-sleep" fill="none" strokeWidth={5}>
              <path d="M 129 70 Q 138 75 147 70" />
              <path d="M 213 70 Q 222 75 231 70" />
            </g>
            <g data-part="eyes-alert">
              <circle cx="138" cy="68" r="5.5" fill="currentColor" stroke="none" />
              <circle cx="222" cy="68" r="5.5" fill="currentColor" stroke="none" />
              <circle className={styles.glint} cx="136" cy="66" r="2" stroke="none" />
              <circle className={styles.glint} cx="220" cy="66" r="2" stroke="none" />
            </g>
            <BuddySpecialEyes left={138} right={222} y={68} size={5.5} />
            <BuddyPuffCheeks left={130} right={230} y={111} />

            <g data-part="snout">
              {/* 开心时嘴里叼的草：画在吻部之前，露在轮廓外的部分才看得见 */}
              <g data-part="grass">
                <path className={styles.capyGrass} d="M 184 122 C 202 127, 218 139, 224 151" />
                <path
                  className={styles.capyLeaf}
                  d="M 212 135 C 222 129, 232 132, 228 140 C 222 143, 216 139, 212 135 Z"
                  strokeWidth={4}
                />
              </g>

              <path
                className={styles.capySnout}
                d="M 180 68 C 206 68, 214 80, 214 102 C 214 124, 202 134, 180 134 C 158 134, 146 124, 146 102 C 146 80, 154 68, 180 68 Z"
                strokeWidth={5}
              />

              <ellipse
                cx="166"
                cy="83"
                rx="3.5"
                ry="5"
                transform="rotate(-15 166 83)"
                fill="currentColor"
                stroke="none"
              />
              <ellipse
                cx="194"
                cy="83"
                rx="3.5"
                ry="5"
                transform="rotate(15 194 83)"
                fill="currentColor"
                stroke="none"
              />

              <path d="M 180 88 L 180 116" strokeWidth={5} />
              <path
                d="M 165 120 C 172 122, 178 120, 180 116 C 182 120, 188 122, 195 120"
                fill="none"
                strokeWidth={5}
              />
            </g>

            {/* 打盹时鼻尖吹起来的泡：放大缩小绕原设计稿的 192,88 */}
            <g data-part="snot-bubble">
              <circle
                className={styles.capyBubble}
                cx="208"
                cy="78"
                r="14"
                fillOpacity={0.75}
                strokeWidth={4}
              />
              <path
                className={styles.capyBubbleGlint}
                d="M 202 70 A 6 6 0 0 1 212 70"
                strokeWidth={3}
              />
            </g>
          </g>

          <BuddySnack kind="capy" />

          {/* 3. 爪子层 */}
          <g data-part="paw-left">
            <path
              className={styles.capyEar}
              d="M 74 203 C 82 186, 104 186, 112 203 Z"
              stroke="none"
            />
            <path d="M 74 203 C 82 186, 104 186, 112 203" fill="none" />
            <path d="M 88 195 L 88 203" strokeWidth={4} />
            <path d="M 98 195 L 98 203" strokeWidth={4} />
          </g>
          <g data-part="paw-right">
            <path
              className={styles.capyEar}
              d="M 248 203 C 256 186, 278 186, 286 203 Z"
              stroke="none"
            />
            <path d="M 248 203 C 256 186, 278 186, 286 203" fill="none" />
            <path d="M 262 195 L 262 203" strokeWidth={4} />
            <path d="M 272 195 L 272 203" strokeWidth={4} />
          </g>
        </g>

        {/* 4. 氛围特效层 */}
        <g data-part="question" className={styles.mark} strokeWidth={5} fill="none">
          <path d="M 285 38 C 285 22, 312 22, 312 38 C 312 48, 298 50, 298 60" />
          <circle className={styles.markFill} cx="298" cy="73" r="3" stroke="none" />
        </g>
        {/* 爱心：位置写在 transform 属性上，浮动只让内层 path 走动画，
            免得动画覆盖掉属性里的位移（关掉动效时就整颗飘到原点去了） */}
        <g data-part="hearts" transform="translate(268 30) rotate(10)">
          <path
            className={styles.capyHeart}
            d="M 16 12 C 16 4, 4 4, 4 12 C 4 20, 16 26, 16 30 C 16 26, 28 20, 28 12 C 28 4, 16 4, 16 12 Z"
            strokeWidth={4}
          />
        </g>
        <g data-part="zzz" className={styles.mark} strokeWidth={4} fill="none">
          <path d="M 265 45 L 283 45 L 265 63 L 283 63" />
          <path d="M 292 25 L 305 25 L 292 38 L 305 38" strokeWidth={3.5} />
        </g>
        <g data-part="sweat">
          <path
            className={styles.capySweat}
            d="M 262 42 C 256 54, 256 62, 262 64 C 268 62, 268 54, 262 42 Z"
            strokeWidth={4}
          />
        </g>
        <BuddyEffects />
      </g>
    </svg>
  );
}
