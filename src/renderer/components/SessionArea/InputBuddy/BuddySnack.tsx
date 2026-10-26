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
      </g>
    </g>
  );
}
