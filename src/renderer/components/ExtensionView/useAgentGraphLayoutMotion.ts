import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { type Gsap, loadGsap } from "../../utils/animation";
import { AGENT_GRAPH_MOTION as GRAPH_MOTION } from "../../utils/motionTokens";

interface Position {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Animate nodes and their wire segments together; layout remains owned by React. */
export function useAgentGraphLayoutMotion(
  plane: RefObject<HTMLDivElement | null>,
  layoutKey: string,
) {
  const engine = useRef<Gsap | undefined>(undefined);
  const positions = useRef(new Map<string, Position>());
  const lastKey = useRef(layoutKey);
  const tweens = useRef(new Map<HTMLElement, ReturnType<Gsap["fromTo"]>>());
  useEffect(() => {
    let disposed = false;
    void loadGsap()
      .then((gsap) => {
        if (!disposed) engine.current = gsap;
      })
      .catch(() => {});
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stop = (): void => {
      if (!preference.matches) return;
      for (const tween of tweens.current.values()) tween.progress(1);
    };
    preference.addEventListener("change", stop);
    return () => {
      disposed = true;
      preference.removeEventListener("change", stop);
      for (const tween of tweens.current.values()) tween.kill();
      tweens.current.clear();
    };
  }, []);
  useLayoutEffect(() => {
    const gsap = engine.current;
    const animate =
      gsap &&
      lastKey.current !== layoutKey &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, Position>();
    for (const element of plane.current?.querySelectorAll<HTMLElement>("[data-layout-key]") ?? []) {
      const key = element.dataset.layoutKey ?? "";
      const target = {
        x: Number.parseFloat(element.style.left) || 0,
        y: Number.parseFloat(element.style.top) || 0,
        width: Number.parseFloat(element.style.width) || 1,
        height: Number.parseFloat(element.style.height) || 1,
      };
      const before = positions.current.get(key);
      next.set(key, target);
      if (!animate || !before) continue;
      const x = before.x - target.x + Number(gsap.getProperty(element, "x"));
      const y = before.y - target.y + Number(gsap.getProperty(element, "y"));
      const wire = element.dataset.layoutWire === "true";
      const scaleX = wire
        ? (before.width / target.width) * Number(gsap.getProperty(element, "scaleX"))
        : 1;
      const scaleY = wire
        ? (before.height / target.height) * Number(gsap.getProperty(element, "scaleY"))
        : 1;
      tweens.current.get(element)?.kill();
      tweens.current.set(
        element,
        gsap.fromTo(
          element,
          { x, y, scaleX, scaleY },
          {
            x: 0,
            y: 0,
            scaleX: 1,
            scaleY: 1,
            duration: GRAPH_MOTION.layout,
            ease: GRAPH_MOTION.ease,
            clearProps: "transform",
            onComplete: () => {
              tweens.current.delete(element);
            },
          },
        ),
      );
    }
    for (const [element, tween] of tweens.current) {
      if (!element.isConnected) {
        tween.kill();
        tweens.current.delete(element);
      }
    }
    positions.current = next;
    lastKey.current = layoutKey;
  });
}
