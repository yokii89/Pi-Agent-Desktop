import { BuddyEffects } from "./BuddyEffects";
import { BuddySnack } from "./BuddySnack";
import type { BuddyPose } from "./buddyPose";
import styles from "./InputBuddy.module.css";

/**
 * 史蒂夫（我的世界）：方块史蒂夫从输入卡沿后面探出来。脑袋画成一个立起来的立方体
 * （正面 + 顶面 + 右侧面），正面是 8×8 像素脸——发线 / 蓝紫瞳 / 嘴都落在 11px
 * 格子上；表情按「换一组像素」而不是曲线五官来画。青色短袖 + 双臂，手掌搭在卡沿上。
 * 裁切区与另几款一致（viewBox 50 0 290 203）。
 */
export function BuddySteve({ pose }: { pose: BuddyPose }) {
  return (
    <svg
      className={`${styles.art} ${styles.steve}`}
      data-pose={pose}
      viewBox="50 0 290 203"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round">
        <g data-part="character">
          {/* 1. 脖子与短袖躯干：底边落在卡沿上，不画横线，免得在卡沿上留一道黑边 */}
          <g>
            <rect
              className={styles.steveSkin}
              x={164}
              y={100}
              width={32}
              height={18}
              stroke="none"
            />
            <path d="M 164 104 L 164 116 M 196 104 L 196 116" fill="none" />
            <rect
              className={styles.steveShirt}
              x={140}
              y={116}
              width={80}
              height={87}
              stroke="none"
            />
            <rect
              className={styles.steveShirtShade}
              x={156}
              y={116}
              width={48}
              height={9}
              stroke="none"
            />
            <path
              d="M 140 116 L 156 116 M 204 116 L 220 116 M 140 116 L 140 203 M 220 116 L 220 203"
              fill="none"
            />
          </g>

          {/* 2. 双臂：先于头部绘制——举手时手臂的肩头藏到下巴后面，不会在脖子上留一个断口 */}
          <g data-part="arm-left">
            <rect
              className={styles.steveShirt}
              x={112}
              y={116}
              width={28}
              height={42}
              stroke="none"
            />
            <rect
              className={styles.steveShirtShade}
              x={112}
              y={150}
              width={28}
              height={8}
              stroke="none"
            />
            <rect
              className={styles.steveSkin}
              x={112}
              y={158}
              width={28}
              height={45}
              stroke="none"
            />
            <path d="M 112 116 L 112 203 M 140 116 L 140 203 M 112 116 L 140 116" fill="none" />
          </g>
          <g data-part="arm-right">
            <rect
              className={styles.steveShirt}
              x={220}
              y={116}
              width={28}
              height={42}
              stroke="none"
            />
            <rect
              className={styles.steveShirtShade}
              x={220}
              y={150}
              width={28}
              height={8}
              stroke="none"
            />
            <rect
              className={styles.steveSkin}
              x={220}
              y={158}
              width={28}
              height={45}
              stroke="none"
            />
            <path d="M 220 116 L 220 203 M 248 116 L 248 203 M 220 116 L 248 116" fill="none" />
          </g>

          {/* 苹果画在双臂之后：进食时双手从两边托住果子，而不是把果子挡在手后面 */}
          <BuddySnack kind="steve" />

          {/* 3. 头部层：立方体的顶面 / 右侧面先铺，正面像素后画，外轮廓最后收一圈 */}
          <g data-part="head">
            <polygon
              className={styles.steveHair}
              points="130,16 218,16 230,8 142,8"
              stroke="none"
            />
            <polygon
              className={styles.steveSkinShade}
              points="218,16 230,8 230,96 218,104"
              stroke="none"
            />
            <rect
              className={styles.steveSkin}
              x={130}
              y={16}
              width={88}
              height={88}
              stroke="none"
            />

            {/* 侧面的头发与耳朵：侧脸压暗一档，立方体才立得起来 */}
            <polygon
              className={styles.steveHairShade}
              points="218,16 230,8 230,34 218,42"
              stroke="none"
            />
            <rect
              className={styles.steveSkin}
              x={218}
              y={52}
              width={12}
              height={22}
              stroke="none"
            />
            <rect
              className={styles.steveSkinShade}
              x={222}
              y={57}
              width={5}
              height={12}
              stroke="none"
            />

            {/* 发线：顶两行整幅，第三行只留左侧三格（史蒂夫的侧分刘海） */}
            <rect
              className={styles.steveHair}
              x={130}
              y={16}
              width={88}
              height={22}
              stroke="none"
            />
            <rect
              className={styles.steveHair}
              x={130}
              y={38}
              width={33}
              height={11}
              stroke="none"
            />

            <g data-part="eyes-normal">
              <rect className={styles.glint} x={141} y={49} width={11} height={11} stroke="none" />
              <rect
                className={styles.steveIris}
                x={152}
                y={49}
                width={11}
                height={11}
                stroke="none"
              />
              <rect className={styles.glint} x={185} y={49} width={11} height={11} stroke="none" />
              <rect
                className={styles.steveIris}
                x={196}
                y={49}
                width={11}
                height={11}
                stroke="none"
              />
            </g>

            {/* 思考：瞳仁换到外侧那格，眼神改成向左上方飘 */}
            <g data-part="eyes-thinking">
              <rect
                className={styles.steveIris}
                x={141}
                y={49}
                width={11}
                height={11}
                stroke="none"
              />
              <rect className={styles.glint} x={152} y={49} width={11} height={11} stroke="none" />
              <rect
                className={styles.steveIris}
                x={185}
                y={49}
                width={11}
                height={11}
                stroke="none"
              />
              <rect className={styles.glint} x={196} y={49} width={11} height={11} stroke="none" />
            </g>

            {/* 委屈：眼睛整体下沉一格，外眼角挂方泪，眉梢往下耷 */}
            <g data-part="eyes-sad">
              <rect className={styles.glint} x={141} y={52} width={11} height={11} stroke="none" />
              <rect
                className={styles.steveIris}
                x={152}
                y={52}
                width={11}
                height={11}
                stroke="none"
              />
              <rect className={styles.glint} x={185} y={52} width={11} height={11} stroke="none" />
              <rect
                className={styles.steveIris}
                x={196}
                y={52}
                width={11}
                height={11}
                stroke="none"
              />
              <rect
                className={`${styles.capySweat} ${styles.tearDrop}`}
                x={136}
                y={64}
                width={7}
                height={14}
                stroke="none"
              />
              <rect
                className={`${styles.capySweat} ${styles.tearDrop}`}
                x={201}
                y={64}
                width={7}
                height={14}
                stroke="none"
              />
              <path d="M 139 50 L 162 46 M 186 46 L 209 50" fill="none" strokeWidth={5} />
            </g>

            <g data-part="eyes-happy" fill="none" strokeLinecap="square">
              <path d="M 141 58 L 152 50 L 163 58" />
              <path d="M 185 58 L 196 50 L 207 58" />
            </g>

            <g data-part="eyes-sleep" fill="none" strokeLinecap="square">
              <path d="M 141 55 L 163 55" />
              <path d="M 185 55 L 207 55" />
            </g>

            <g data-part="eyes-alert">
              <rect className={styles.glint} x={141} y={44} width={11} height={16} stroke="none" />
              <rect
                className={styles.steveIris}
                x={152}
                y={44}
                width={11}
                height={16}
                stroke="none"
              />
              <rect className={styles.glint} x={185} y={44} width={11} height={16} stroke="none" />
              <rect
                className={styles.steveIris}
                x={196}
                y={44}
                width={11}
                height={16}
                stroke="none"
              />
            </g>

            {/* 生气：方眉向内压成倒八字，眼睛眯成一条 */}
            <g data-part="eyes-angry">
              <path d="M 138 45 L 164 53" fill="none" strokeLinecap="square" strokeWidth={6} />
              <path d="M 210 45 L 184 53" fill="none" strokeLinecap="square" strokeWidth={6} />
              <rect x={141} y={55} width={22} height={7} fill="currentColor" stroke="none" />
              <rect x={185} y={55} width={22} height={7} fill="currentColor" stroke="none" />
            </g>

            <g data-part="eyes-dizzy" fill="none" strokeLinecap="square">
              <path d="M 143 51 L 161 69 M 161 51 L 143 69" />
              <path d="M 187 51 L 205 69 M 205 51 L 187 69" />
            </g>

            {/* 嘴是固定的像素块；张嘴用更大的暗块盖过去，不重画嘴型 */}
            <rect
              data-part="mouth-normal"
              className={styles.steveMouth}
              x={163}
              y={82}
              width={22}
              height={11}
              stroke="none"
            />
            <g data-part="mouth-sad" fill="none" strokeLinecap="square">
              <path d="M 163 90 L 174 84 L 185 84 L 196 90" />
            </g>
            <g data-part="mouth-open">
              <rect
                className={styles.steveMouth}
                x={163}
                y={82}
                width={22}
                height={16}
                stroke="none"
              />
              <rect className={styles.tongue} x={167} y={92} width={14} height={5} stroke="none" />
            </g>

            <path d="M 130 16 L 142 8 L 230 8 L 230 96 L 218 104 L 130 104 Z" fill="none" />
          </g>
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
        <BuddyEffects />
      </g>
    </svg>
  );
}
