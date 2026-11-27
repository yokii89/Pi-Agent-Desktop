import { useEffect, useRef } from "react";
import type { ViewAgentState } from "../../../shared/view";
import { type Gsap, loadGsap } from "../../utils/animation";
import { AGENT_GRAPH_MOTION } from "../../utils/motionTokens";
import styles from "./AgentGraph.module.css";

const STATE_MOTION = AGENT_GRAPH_MOTION.state;

/** Decorative state motion pauses outside the viewport and respects live motion preferences. */
export function AgentGraphStateFrame({ state }: { state: ViewAgentState }) {
  const frame = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = frame.current;
    if (!element || !["running", "error", "queued"].includes(state)) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    let disposed = false;
    let engine: Gsap | undefined;
    let tween: ReturnType<Gsap["to"]> | undefined;
    const light = element.firstElementChild;
    const reset = (): void => {
      tween?.kill();
      tween = undefined;
      element.style.removeProperty("opacity");
      if (light instanceof HTMLElement) light.style.removeProperty("transform");
    };
    const sync = (): void => {
      if (!engine || disposed) return;
      if (preference.matches) {
        reset();
        return;
      }
      if (!visible || document.hidden) {
        tween?.pause();
        return;
      }
      if (tween) {
        tween.resume();
        return;
      }
      tween =
        state === "running" && light
          ? engine.fromTo(
              light,
              { rotation: 0 },
              { rotation: 360, duration: STATE_MOTION.flow, repeat: -1, ease: "none" },
            )
          : engine.fromTo(
              element,
              { opacity: state === "error" ? 0.16 : 0.2 },
              {
                opacity: 1,
                duration: STATE_MOTION[state === "error" ? "error" : "queued"],
                repeat: -1,
                yoyo: true,
                ease: "sine.inOut",
              },
            );
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    observer.observe(element);
    preference.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    // Solid state borders remain readable if the animation engine cannot load.
    void loadGsap()
      .then((loaded) => {
        if (disposed) return;
        engine = loaded;
        sync();
      })
      .catch(() => {});
    return () => {
      disposed = true;
      observer.disconnect();
      preference.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      reset();
    };
  }, [state]);
  if (!["running", "error", "queued"].includes(state)) return null;
  return (
    <span className={styles.canvasStateFrame} data-state={state} ref={frame} aria-hidden="true">
      {state === "running" ? <span className={styles.canvasStateLight} /> : null}
    </span>
  );
}
