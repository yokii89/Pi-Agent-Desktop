import styles from "./InputBuddy.module.css";

/**
 * 与角色无关的氛围特效：加载、生气、食物碎屑、汗珠、礼花和头晕星星。
 *
 * 一律「外层定位、内层动画」：CSS transform 会盖掉同一元素上的 transform 属性，
 * 所以定位与动画必须分居两层。需要圆心的特效直接写绝对坐标——viewBox 从 x=50 起，
 * 故 CSS 里的圆心 = 设计坐标 - 50。
 */
export function BuddyEffects() {
  return (
    <>
      {/* 思考中：缺一小口的圆环（转起来就是加载圈）。位置必须在角色轮廓之外——
          这一色是「应用背景上的记号色」，压到浅色毛面上会整圈消失（狗耳右侧的空档刚好四款共用）。 */}
      <g data-part="thinking" className={styles.mark} fill="none" strokeWidth={5.5}>
        <g data-part="thinking-spinner">
          {/* 缺口摆到左上：正右方的缺口在静止帧里会被读成一个字母 C */}
          <circle cx="286" cy="4" r="14" strokeDasharray="72 16" transform="rotate(-90 286 4)" />
        </g>
      </g>

      <g data-part="anger" className={styles.angerMark} fill="none" strokeWidth={4.5}>
        <path d="M 270 29 L 270 19 M 270 29 L 260 29" />
        <path d="M 278 29 L 278 19 M 278 29 L 288 29" />
        <path d="M 270 39 L 270 49 M 270 39 L 260 39" />
        <path d="M 278 39 L 278 49 M 278 39 L 288 39" />
      </g>

      <g data-part="crumbs" stroke="none">
        <circle className={`${styles.gold} ${styles.crumb}`} cx="143" cy="151" r="4" />
        <circle className={`${styles.gold} ${styles.crumb}`} cx="218" cy="157" r="3.5" />
        <rect
          className={`${styles.catCoat} ${styles.crumb}`}
          x="151"
          y="174"
          width="7"
          height="7"
          rx="2"
        />
        <path
          className={`${styles.capyHeart} ${styles.crumb}`}
          d="M 218 176 C 218 170, 210 170, 210 176 C 210 182, 218 186, 218 190 C 218 186, 226 182, 226 176 C 226 170, 218 170, 218 176 Z"
        />
      </g>

      <g data-part="sweat-drops">
        <g transform="translate(105 36)">
          <path
            className={`${styles.capySweat} ${styles.sweatDrop}`}
            d="M 0 -10 C -7 2, -7 10, 0 12 C 7 10, 7 2, 0 -10 Z"
            strokeWidth={3.5}
          />
        </g>
        <g transform="translate(253 48)">
          <path
            className={`${styles.capySweat} ${styles.sweatDrop}`}
            d="M 0 -8 C -6 2, -6 8, 0 10 C 6 8, 6 2, 0 -8 Z"
            strokeWidth={3.5}
          />
        </g>
      </g>

      <g data-part="confetti" stroke="none">
        <rect
          className={`${styles.confettiA} ${styles.confettiPiece}`}
          x="104"
          y="35"
          width="7"
          height="13"
          rx="2"
        />
        <rect
          className={`${styles.confettiB} ${styles.confettiPiece}`}
          x="129"
          y="14"
          width="6"
          height="11"
          rx="2"
        />
        <circle className={`${styles.confettiC} ${styles.confettiPiece}`} cx="157" cy="28" r="5" />
        <rect
          className={`${styles.confettiD} ${styles.confettiPiece}`}
          x="207"
          y="20"
          width="7"
          height="13"
          rx="2"
        />
        <circle className={`${styles.confettiB} ${styles.confettiPiece}`} cx="239" cy="40" r="5" />
        <rect
          className={`${styles.confettiC} ${styles.confettiPiece}`}
          x="252"
          y="67"
          width="6"
          height="12"
          rx="2"
        />
        <path
          className={`${styles.confettiA} ${styles.sparkle}`}
          d="M 91 78 L 94 86 L 102 89 L 94 92 L 91 100 L 88 92 L 80 89 L 88 86 Z"
        />
        <path
          className={`${styles.confettiA} ${styles.sparkle}`}
          d="M 267 16 L 270 23 L 277 26 L 270 29 L 267 36 L 264 29 L 257 26 L 264 23 Z"
        />
        <path
          className={`${styles.confettiB} ${styles.sparkle}`}
          d="M 230 91 L 232 97 L 238 99 L 232 101 L 230 107 L 228 101 L 222 99 L 228 97 Z"
        />
      </g>

      <g data-part="dizzy-stars" className={styles.gold} stroke="none">
        <path d="M 143 12 L 147 22 L 157 26 L 147 30 L 143 40 L 139 30 L 129 26 L 139 22 Z" />
        <path d="M 180 -5 L 184 5 L 194 9 L 184 13 L 180 23 L 176 13 L 166 9 L 176 5 Z" />
        <path d="M 217 12 L 221 22 L 231 26 L 221 30 L 217 40 L 213 30 L 203 26 L 213 22 Z" />
      </g>
    </>
  );
}
