import styles from "./InputBuddy.module.css";

interface BuddySpecialEyesProps {
  left: number;
  right: number;
  y: number;
  /** 常态眼的水平半径。特殊表情按它等比放大，免得一换情绪就像换了个物种。 */
  size: number;
}

/** 四款角色共用的特殊五官；可见性由 SVG 的 data-pose 统一控制。 */
export function BuddySpecialEyes({ left, right, y, size }: BuddySpecialEyesProps) {
  const brow = size * 1.7;
  const droop = size * 1.5;
  const tearY = y + size * 1.67;
  return (
    <>
      {/* 思考：眼球上移、高光压在上缘，读作「眼神看向斜上方」 */}
      <g data-part="eyes-thinking">
        {[left, right].map((x) => (
          <g key={x} transform={`translate(${x} ${y})`}>
            <ellipse
              cx={size * 0.17}
              cy={-size * 0.17}
              rx={size}
              ry={size * 1.17}
              fill="currentColor"
              stroke="none"
            />
            <circle
              className={styles.glint}
              cx={size * 0.5}
              cy={-size * 0.67}
              r={size * 0.37}
              stroke="none"
            />
          </g>
        ))}
      </g>

      {/* 生气：眉毛向中间压成倒八字，眼形眯成下弧 */}
      <g data-part="eyes-angry" fill="none" strokeWidth={size * 0.75}>
        <path d={`M ${left - brow} ${y - droop * 0.55} L ${left + brow * 0.9} ${y}`} />
        <path d={`M ${right - brow * 0.9} ${y} L ${right + brow} ${y - droop * 0.55}`} />
        <path
          d={`M ${left - brow * 0.8} ${y + droop * 0.7} Q ${left} ${y + droop * 0.3} ${left + brow * 0.8} ${y + droop * 0.7}`}
        />
        <path
          d={`M ${right - brow * 0.8} ${y + droop * 0.7} Q ${right} ${y + droop * 0.3} ${right + brow * 0.8} ${y + droop * 0.7}`}
        />
      </g>

      {/* 委屈：眼睛放大、双高光水汪汪，外眼角挂一颗泪珠 */}
      <g data-part="eyes-sad">
        {[left, right].map((x) => (
          <g key={x}>
            <ellipse
              cx={x}
              cy={y}
              rx={size * 1.08}
              ry={size * 1.42}
              fill="currentColor"
              stroke="none"
            />
            <circle
              className={styles.glint}
              cx={x - size * 0.33}
              cy={y - size * 0.5}
              r={size * 0.47}
              stroke="none"
            />
            <circle
              className={styles.glint}
              cx={x + size * 0.42}
              cy={y + size * 0.33}
              r={size * 0.23}
              stroke="none"
            />
            <g transform={`translate(${x + size * 1.17} ${tearY}) scale(${size / 6})`}>
              <path
                className={`${styles.capySweat} ${styles.tearDrop}`}
                d="M 0 -3 C -5 4, -5 10, 0 12 C 5 10, 5 4, 0 -3 Z"
                stroke="none"
              />
            </g>
          </g>
        ))}
      </g>

      {/* 头晕：蚊香圈，逐只自转 */}
      <g data-part="eyes-dizzy" fill="none" strokeWidth={size * 0.58}>
        {[left, right].map((x) => (
          <g key={x} transform={`translate(${x} ${y}) scale(${size / 6})`}>
            <path
              className={styles.dizzySpiral}
              d="M 0 0 C 6 -6, 12 0, 9 6 C 5 14, -8 11, -10 2 C -13 -10, 1 -17, 11 -10 C 22 -3, 18 14, 6 17"
            />
          </g>
        ))}
      </g>
    </>
  );
}

interface BuddyPuffCheeksProps {
  left: number;
  right: number;
  y: number;
}

/** 生气时鼓起的腮帮子；每个脸颊独立缩放，不会整组向中间漂移。 */
export function BuddyPuffCheeks({ left, right, y }: BuddyPuffCheeksProps) {
  return (
    <g data-part="puff-cheeks" stroke="none">
      {[left, right].map((x) => (
        <circle key={x} className={styles.puffCheek} cx={x} cy={y} r="12" />
      ))}
    </g>
  );
}
