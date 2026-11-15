import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";
import type { ThinkingAnimation } from "../../../shared/thinkingAnimation";
import { PiStateMark } from "./PiStateMark";
import styles from "./ThinkingAnimationMark.module.css";
import type { ThinkingOrbOptions } from "./thinkingOrbCore";

const ORB_VARIANTS: Record<Exclude<ThinkingAnimation, "pi">, ThinkingOrbOptions["variant"]> = {
  reasoning: "reasoning",
  twins: "twins",
  gyro: "gyro",
  lighthouse: "lighthouse",
};

interface ThinkingAnimationMarkProps {
  animation: ThinkingAnimation;
  size?: number;
}

/** The running-session marker selected in Settings → Personalization. */
export function ThinkingAnimationMark({ animation, size = 16 }: ThinkingAnimationMarkProps) {
  if (animation === "pi") {
    return <PiStateMark status="running" size={size} showLabel={false} />;
  }
  return <ThinkingOrbMark variant={ORB_VARIANTS[animation]} size={size} />;
}

interface ThinkingOrbMarkProps {
  variant: ThinkingOrbOptions["variant"];
  size?: number;
}

export function ThinkingOrbMark({ variant, size = 16 }: ThinkingOrbMarkProps) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let disposed = false;
    let destroy: (() => void) | null = null;
    const svg = ref.current;
    if (!svg) return;
    void import("./thinkingOrbCore")
      .then(({ mountThinkingOrb }) => {
        if (!disposed) destroy = mountThinkingOrb(svg, { variant, size });
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      destroy?.();
    };
  }, [size, variant]);

  return (
    <svg
      ref={ref}
      className={styles.orb}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ "--thinking-animation-size": `${size}px` } as CSSProperties}
      aria-hidden="true"
      focusable="false"
    />
  );
}
