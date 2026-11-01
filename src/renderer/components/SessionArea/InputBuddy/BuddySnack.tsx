import type { InputBuddyKind } from "../../../../shared/inputBuddy";
import styles from "./InputBuddy.module.css";

interface BuddySnackProps {
  kind: Exclude<InputBuddyKind, "none">;
}

/** 吃零食时捧在胸前的角色专属道具。定位在外层，动画只作用于内层。 */
export function BuddySnack({ kind }: BuddySnackProps) {
  const rotation = kind === "dog" || kind === "cat" ? -8 : kind === "parrot" ? 8 : 0;
  return (
    <g transform={`translate(180 166) rotate(${rotation})`}>
      <g data-part="snack">
        {kind === "dog" && (
          <path
            className={styles.dogBone}
            d="M -22 -6 C -30 -14, -40 -4, -34 4 C -40 12, -28 22, -20 12 L 20 -12 C 28 -22, 40 -12, 34 -4 C 40 4, 30 14, 22 6 Z"
            strokeWidth={4.5}
          />
        )}
        {kind === "cat" && (
          <>
            <path
              className={styles.catCoat}
              d="M -28 0 C -16 -14, 4 -14, 17 0 L 28 -10 L 26 10 L 17 0 C 4 14, -16 14, -28 0 Z"
              strokeWidth={4}
            />
            <circle cx="-14" cy="-2" r="2.5" fill="currentColor" stroke="none" />
          </>
        )}
        {kind === "capy" && (
          <>
            <path className={styles.capyLeaf} d="M -30 -10 Q 0 32 30 -10 Z" strokeWidth={4} />
            <path className={styles.tongue} d="M -23 -7 Q 0 22 23 -7 Z" stroke="none" />
            <ellipse cx="-10" cy="1" rx="2" ry="3.5" fill="currentColor" stroke="none" />
            <ellipse cx="0" cy="8" rx="2" ry="3.5" fill="currentColor" stroke="none" />
            <ellipse cx="10" cy="1" rx="2" ry="3.5" fill="currentColor" stroke="none" />
          </>
        )}
        {kind === "parrot" && (
          <>
            <path
              className={styles.gold}
              d="M 0 -20 C -17 -16, -18 12, 0 20 C 18 12, 17 -16, 0 -20 Z"
              strokeWidth={4}
            />
            <path d="M 0 -13 L 0 13" fill="none" strokeWidth={3.5} />
          </>
        )}
        {kind === "pea" && (
          <>
            {/* 裂开的豆荚：三颗豌豆露在外面，吃相才看得懂 */}
            <path
              className={styles.peaLeafLight}
              d="M -34 4 C -28 -16, 20 -18, 32 -2 C 36 12, -28 20, -34 4 Z"
              strokeWidth={4.5}
            />
            <path className={styles.peaVein} d="M -28 2 C -8 10, 12 8, 28 -2" strokeWidth={3} />
            <circle className={styles.peaBall} cx="-15" cy="2" r="6.5" strokeWidth={3} />
            <circle className={styles.peaBall} cx="0" cy="4" r="6.5" strokeWidth={3} />
            <circle className={styles.peaBall} cx="15" cy="2" r="6.5" strokeWidth={3} />
          </>
        )}
        {kind === "steve" && (
          <>
            {/* 我的世界的苹果：切角方块 + 像素高光 + 短梗与阶梯叶 */}
            <path
              className={styles.steveApple}
              d="M -19 0 L -12 -6 L 12 -6 L 19 0 L 19 13 L 12 21 L -12 21 L -19 13 Z"
              strokeWidth={4.5}
            />
            <rect
              className={styles.steveAppleLight}
              x={-13}
              y={-1}
              width={9}
              height={7}
              stroke="none"
            />
            <rect className={styles.steveHair} x={-4} y={-17} width={8} height={13} stroke="none" />
            <path
              className={styles.steveAppleLeaf}
              d="M 4 -17 L 12 -22 L 23 -17 L 23 -13 L 12 -12 L 4 -14 Z"
              strokeWidth={3.5}
            />
          </>
        )}
      </g>
    </g>
  );
}
