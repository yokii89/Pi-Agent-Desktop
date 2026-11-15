import type { ReactNode } from "react";
import styles from "./BuddyAnimal.module.css";
import { BuddyEffects } from "./BuddyEffects";
import { BuddyPuffCheeks, BuddySpecialEyes } from "./BuddyExpression";
import { BuddySnack, type BuddySnackKind } from "./BuddySnack";
import { type BuddyArtworkProps, BuddySvg } from "./BuddySvg";
import motion from "./InputBuddy.module.css";

interface BuddyAnimalProps extends BuddyArtworkProps {
  className: string;
  /** 毛面、耳朵与花纹由动物自身绘制，放在共用五官之后会遮住表情。 */
  head: ReactNode;
  /** 长鼻等物种特征可替换默认鼻子，仍与眼睛、嘴共用同一层头部动画。 */
  nose?: ReactNode;
  tail?: ReactNode;
  accessory?: ReactNode;
  snack: BuddySnackKind;
}

/** 趴沿动物共用的身体、五官与双爪骨架；各款只提供自己的轮廓与配色。 */
export function BuddyAnimal({
  pose,
  animated,
  className,
  head,
  nose,
  tail,
  accessory,
  snack,
}: BuddyAnimalProps) {
  return (
    <BuddySvg
      pose={pose}
      animated={animated}
      className={`${motion.animal} ${styles.animal} ${className}`}
    >
      <g data-part="character">
        {tail}
        <path className={styles.coat} d="M 118 203 Q 121 151 145 136 L 215 136 Q 239 151 242 203" />
        <path
          className={styles.bib}
          d="M 146 146 Q 180 134 214 146 L 220 203 L 140 203 Z"
          stroke="none"
        />
        {accessory}
        <g data-part="head">
          {head}
          <g data-part="eyes-normal">
            {[156, 204].map((x) => (
              <g key={x}>
                <ellipse cx={x} cy={89} rx={6.5} ry={8} fill="currentColor" stroke="none" />
                <circle className={motion.glint} cx={x - 2} cy={86} r={2.2} stroke="none" />
              </g>
            ))}
          </g>
          <g data-part="eyes-happy" fill="none" strokeWidth={5}>
            <path d="M 147 91 Q 156 78 165 91 M 195 91 Q 204 78 213 91" />
          </g>
          <g data-part="eyes-sleep" fill="none" strokeWidth={4.5}>
            <path d="M 147 87 Q 156 97 165 87 M 195 87 Q 204 97 213 87" />
          </g>
          <BuddySpecialEyes left={156} right={204} y={89} size={6.5} />
          <BuddyPuffCheeks left={137} right={223} y={111} />
          {nose ?? (
            <path
              className={styles.nose}
              d="M 173 108 Q 180 104 187 108 Q 185 115 180 116 Q 175 115 173 108 Z"
              strokeWidth={3}
            />
          )}
          <path
            data-part="mouth-normal"
            d="M 180 116 L 180 122 M 169 122 Q 174 130 180 122 Q 186 130 191 122"
            fill="none"
            strokeWidth={3.5}
          />
          <g data-part="mouth-chew">
            <ellipse cx={180} cy={127} rx={8.5} ry={6} fill="currentColor" stroke="none" />
            <path className={motion.tongue} d="M 175 129 Q 180 135 185 129" stroke="none" />
          </g>
        </g>
        <BuddySnack kind={snack} />
        <g data-part="paw-left">
          <path className={styles.paw} d="M 92 203 C 94 177 134 177 136 203" />
          <path d="M 108 198 L 108 203 M 119 198 L 119 203" fill="none" strokeWidth={3} />
        </g>
        <g data-part="paw-right">
          <path className={styles.paw} d="M 224 203 C 226 177 266 177 268 203" />
          <path d="M 241 198 L 241 203 M 252 198 L 252 203" fill="none" strokeWidth={3} />
        </g>
      </g>
      <g data-part="sweat" className={motion.mark} strokeWidth={5} fill="none">
        <path d="M 276 25 L 281 12 M 289 38 L 301 31 M 293 54 L 307 54" />
      </g>
      <BuddyEffects />
    </BuddySvg>
  );
}
