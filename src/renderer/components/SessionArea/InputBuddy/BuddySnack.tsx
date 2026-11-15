import styles from "./InputBuddy.module.css";

/** 食物按自身标识复用，新增动物不需要再向零食组件登记一个角色分支。 */
export type BuddySnackKind =
  | "bone"
  | "fish"
  | "watermelon"
  | "seed"
  | "peas"
  | "apple"
  | "berry"
  | "carrot"
  | "bamboo"
  | "cookie"
  | "honey"
  | "eucalyptus";

interface BuddySnackProps {
  kind: BuddySnackKind;
}

/** 吃零食时捧在胸前的角色专属道具。定位在外层，动画只作用于内层。 */
export function BuddySnack({ kind }: BuddySnackProps) {
  const rotation = kind === "bone" || kind === "fish" ? -8 : kind === "seed" ? 8 : 0;
  return (
    <g transform={`translate(180 166) rotate(${rotation})`}>
      <g data-part="snack">
        {kind === "cookie" && (
          <>
            <circle className={styles.snackCookie} cx={0} cy={0} r={23} strokeWidth={4} />
            <g fill="currentColor" stroke="none">
              <circle cx={-8} cy={-9} r={3.5} />
              <circle cx={10} cy={-6} r={3} />
              <circle cx={-12} cy={6} r={3} />
              <circle cx={4} cy={10} r={4} />
              <circle cx={1} cy={-1} r={2} />
            </g>
          </>
        )}
        {kind === "honey" && (
          <>
            <path
              className={styles.snackHoney}
              d="M -17 -14 L 17 -14 L 22 -3 L 20 20 Q 0 27 -20 20 L -22 -3 Z"
              strokeWidth={4}
            />
            <path
              className={styles.dogBone}
              d="M -21 -2 L 21 -2 L 20 16 Q 0 21 -20 16 Z"
              stroke="none"
            />
            <rect
              className={styles.snackLeaf}
              x={-20}
              y={-22}
              width={40}
              height={10}
              rx={4}
              strokeWidth={4}
            />
            <path
              className={styles.snackHoney}
              d="M 0 -2 C -12 9 -8 15 0 15 C 8 15 12 9 0 -2 Z"
              strokeWidth={2.5}
            />
          </>
        )}
        {kind === "eucalyptus" && (
          <>
            <path d="M -24 23 Q -4 0 22 -23" fill="none" strokeWidth={4} />
            <g className={styles.snackEucalyptus} strokeWidth={3}>
              <path d="M -10 9 C -32 11 -36 -6 -26 -10 C -15 -12 -10 -1 -10 9 Z" />
              <path d="M -3 2 C 18 1 26 14 17 19 C 7 24 0 12 -3 2 Z" />
              <path d="M 9 -10 C -11 -13 -10 -30 1 -29 C 10 -28 13 -18 9 -10 Z" />
              <path d="M 18 -17 C 36 -20 42 -8 33 -3 C 26 2 20 -8 18 -17 Z" />
            </g>
          </>
        )}
        {kind === "berry" && (
          <>
            <path
              className={styles.snackBerry}
              d="M -22 -10 Q 0 -22 22 -10 Q 26 3 0 24 Q -26 3 -22 -10 Z"
              strokeWidth={4}
            />
            <path
              className={styles.snackLeaf}
              d="M 0 -11 L -18 -21 L -7 -22 L 0 -30 L 7 -22 L 18 -21 Z"
              strokeWidth={3}
            />
            <path d="M -11 -3 L -10 0 M 7 -5 L 8 -2 M -1 8 L 0 11" fill="none" strokeWidth={2.5} />
          </>
        )}
        {kind === "carrot" && (
          <>
            <path
              className={styles.snackLeaf}
              d="M 12 -9 Q 3 -37 15 -31 L 19 -16 Q 30 -36 34 -25 Q 36 -17 20 -7 Z"
              strokeWidth={3.5}
            />
            <path
              className={styles.snackCarrot}
              d="M 13 -14 Q 29 -10 20 3 L -24 23 Q -29 24 -25 17 Z"
              strokeWidth={4}
            />
            <path d="M 3 -3 L 9 3 M -9 7 L -4 12" fill="none" strokeWidth={3} />
          </>
        )}
        {kind === "bamboo" && (
          <>
            <path
              className={styles.snackLeaf}
              d="M 6 -12 Q -10 -32 -22 -23 Q -20 -10 6 -12 M 10 -4 Q 29 -23 36 -12 Q 31 0 10 -4"
              strokeWidth={3.5}
            />
            <path
              className={styles.snackBamboo}
              d="M -25 16 L 20 -27 L 29 -18 L -16 25 Z"
              strokeWidth={4}
            />
            <path d="M -15 8 L -6 17 M -2 -4 L 7 5 M 11 -16 L 20 -7" fill="none" strokeWidth={3} />
          </>
        )}
        {kind === "bone" && (
          <path
            className={styles.dogBone}
            d="M -22 -6 C -30 -14, -40 -4, -34 4 C -40 12, -28 22, -20 12 L 20 -12 C 28 -22, 40 -12, 34 -4 C 40 4, 30 14, 22 6 Z"
            strokeWidth={4.5}
          />
        )}
        {kind === "fish" && (
          <>
            <path
              className={styles.catCoat}
              d="M -28 0 C -16 -14, 4 -14, 17 0 L 28 -10 L 26 10 L 17 0 C 4 14, -16 14, -28 0 Z"
              strokeWidth={4}
            />
            <circle cx="-14" cy="-2" r="2.5" fill="currentColor" stroke="none" />
          </>
        )}
        {kind === "watermelon" && (
          <>
            <path className={styles.capyLeaf} d="M -30 -10 Q 0 32 30 -10 Z" strokeWidth={4} />
            <path className={styles.tongue} d="M -23 -7 Q 0 22 23 -7 Z" stroke="none" />
            <ellipse cx="-10" cy="1" rx="2" ry="3.5" fill="currentColor" stroke="none" />
            <ellipse cx="0" cy="8" rx="2" ry="3.5" fill="currentColor" stroke="none" />
            <ellipse cx="10" cy="1" rx="2" ry="3.5" fill="currentColor" stroke="none" />
          </>
        )}
        {kind === "seed" && (
          <>
            <path
              className={styles.gold}
              d="M 0 -20 C -17 -16, -18 12, 0 20 C 18 12, 17 -16, 0 -20 Z"
              strokeWidth={4}
            />
            <path d="M 0 -13 L 0 13" fill="none" strokeWidth={3.5} />
          </>
        )}
        {kind === "peas" && (
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
        {kind === "apple" && (
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
