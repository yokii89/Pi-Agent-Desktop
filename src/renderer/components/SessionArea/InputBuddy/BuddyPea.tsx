import { BuddyEffects } from "./BuddyEffects";
import { BuddyPuffCheeks, BuddySpecialEyes } from "./BuddyExpression";
import { BuddySnack } from "./BuddySnack";
import type { BuddyPose } from "./buddyPose";
import styles from "./InputBuddy.module.css";

/**
 * 豌豆射手（植物大战僵尸）：亮绿圆脑袋 + 右侧喇叭炮口，头顶嫩芽，
 * 两片基叶像前爪一样搭在输入卡上沿。炮口、嫩芽、双叶都能独立摆，
 * 庆祝时朝右上打出两颗豌豆。裁切区与四款动物一致（viewBox 50 0 290 203）。
 */
export function BuddyPea({ pose }: { pose: BuddyPose }) {
  return (
    <svg
      className={`${styles.art} ${styles.pea}`}
      data-pose={pose}
      viewBox="50 0 290 203"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round">
        <g data-part="character">
          {/* 1. 基叶层：叶尖搭在卡沿上，等于另几款的爪子 */}
          <g data-part="leaf-left">
            <path
              className={styles.peaLeaf}
              d="M 168 178 C 145 162, 111 166, 94 188 C 108 202, 143 204, 170 192 Z"
            />
            <path
              className={styles.peaVein}
              d="M 160 187 C 140 184, 121 188, 106 196"
              strokeWidth={3.5}
            />
          </g>
          <g data-part="leaf-right">
            <path
              className={styles.peaLeaf}
              d="M 192 178 C 215 162, 249 166, 266 188 C 252 202, 217 204, 190 192 Z"
            />
            <path
              className={styles.peaVein}
              d="M 200 187 C 220 184, 239 188, 254 196"
              strokeWidth={3.5}
            />
          </g>

          {/* 2. 茎层：顶部藏进脑袋，底部没入卡沿 */}
          <g data-part="stem">
            <path
              className={styles.peaStem}
              d="M 169 140 C 172 164, 167 186, 158 203 L 204 203 C 195 186, 190 164, 191 140 Z"
            />
          </g>

          {/* 3. 头部层 */}
          <g data-part="head">
            <g data-part="sprout">
              <path d="M 180 32 C 180 22, 178 16, 176 9" fill="none" strokeWidth={4.5} />
              <path
                className={styles.peaLeafLight}
                d="M 177 18 C 168 9, 156 10, 152 18 C 161 23, 172 22, 177 18 Z"
                strokeWidth={4}
              />
              <path
                className={styles.peaLeafLight}
                d="M 183 15 C 192 6, 204 7, 208 16 C 199 21, 188 20, 183 15 Z"
                strokeWidth={4}
              />
            </g>

            <path
              className={styles.peaCoat}
              d="M 180 30 C 216 30, 242 54, 243 90 C 244 124, 218 144, 180 144 C 142 144, 116 124, 117 90 C 118 54, 144 30, 180 30 Z"
            />

            <g data-part="eyes-normal">
              <ellipse cx="156" cy="72" rx="8" ry="9.5" fill="currentColor" stroke="none" />
              <ellipse cx="204" cy="72" rx="8" ry="9.5" fill="currentColor" stroke="none" />
              <circle className={styles.glint} cx="152.8" cy="68" r="2.5" stroke="none" />
              <circle className={styles.glint} cx="200.8" cy="68" r="2.5" stroke="none" />
            </g>
            <g data-part="eyes-happy" fill="none" strokeWidth={5.5}>
              <path d="M 146 74 Q 156 60 166 74" />
              <path d="M 194 74 Q 204 60 214 74" />
            </g>
            <g data-part="eyes-sleep" fill="none" strokeWidth={4.5}>
              <path d="M 146 70 Q 156 80 166 70" />
              <path d="M 194 70 Q 204 80 214 70" />
            </g>
            <g data-part="eyes-alert">
              <ellipse cx="156" cy="72" rx="3.6" ry="10.5" fill="currentColor" stroke="none" />
              <ellipse cx="204" cy="72" rx="3.6" ry="10.5" fill="currentColor" stroke="none" />
              <circle className={styles.glint} cx="154.8" cy="66.5" r="1.9" stroke="none" />
              <circle className={styles.glint} cx="202.8" cy="66.5" r="1.9" stroke="none" />
            </g>
            <BuddyPuffCheeks left={142} right={218} y={124} />

            {/* 炮口按「填充接进头身、只描外轮廓」画：基座没有缝，读作脑袋自己鼓出来的口子。
                口沿用深绿一圈，内壁再压暗，才不会被读成第三只眼 */}
            <g data-part="muzzle">
              <path
                className={styles.peaCoat}
                d="M 206 92 C 230 70, 274 70, 302 82 C 316 89, 316 111, 302 120 C 286 126, 244 112, 206 108 Z"
                stroke="none"
              />
              <path
                className={styles.peaShade}
                d="M 238 108 C 262 114, 288 110, 300 101 C 294 112, 272 118, 246 114 Z"
                stroke="none"
              />
              <path
                d="M 238 76 C 260 70, 286 72, 302 82 C 316 89, 316 111, 302 120 C 286 126, 246 114, 236 110"
                fill="none"
              />
              <ellipse
                className={styles.peaShade}
                cx="302"
                cy="101"
                rx="14"
                ry="19"
                transform="rotate(-12 302 101)"
                strokeWidth={5}
              />
              <ellipse
                className={styles.peaMouth}
                cx="302"
                cy="101"
                rx="9.5"
                ry="14"
                transform="rotate(-12 302 101)"
                stroke="none"
              />
              <g data-part="pea">
                <circle className={styles.peaBall} cx="300" cy="106" r="6" strokeWidth={3} />
                <circle className={styles.glint} cx="298" cy="103.5" r="1.8" stroke="none" />
              </g>
            </g>

            {/* 特殊眼睛压在炮口之后：委屈的泪珠要能滚到炮口上，放前面会被填色盖掉 */}
            <BuddySpecialEyes left={156} right={204} y={72} size={7.5} />
          </g>

          <BuddySnack kind="pea" />
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
        <g data-part="shock" className={styles.mark} strokeWidth={5} fill="none">
          <path d="M 126 24 L 114 10" />
          <path d="M 106 48 L 92 40" />
          <path d="M 254 22 L 266 8" />
        </g>
        <g data-part="pea-pops" stroke="none">
          <circle className={`${styles.peaBall} ${styles.peaShot}`} cx="308" cy="94" r="6.5" />
          <circle
            className={`${styles.peaBall} ${styles.peaShot} ${styles.peaShotLag}`}
            cx="300"
            cy="114"
            r="5"
          />
        </g>
        <BuddyEffects />
      </g>
    </svg>
  );
}
