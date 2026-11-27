import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ViewAgentNode, ViewAgentState } from "../../../shared/view";
import { type Gsap, loadGsap } from "../../utils/animation";
import { AGENT_GRAPH_MOTION } from "../../utils/motionTokens";
import styles from "./AgentGraph.module.css";
import {
  type AgentGraphSignal,
  agentGraphTransfers,
  retainAgentGraphSignals,
} from "./agentGraphTransfers";

/** Selection and frequent metadata refreshes must never restart a state packet. */
export function useAgentGraphSignals(agents: ViewAgentNode[]) {
  const previous = useRef<Map<string, ViewAgentState> | undefined>(undefined);
  const sequence = useRef(0);
  const [signals, setSignals] = useState<AgentGraphSignal[]>([]);
  useEffect(() => {
    const changes = agentGraphTransfers(previous.current, agents);
    const states = new Map(agents.map((agent) => [agent.id, agent.state]));
    previous.current = states;
    const now = Date.now();
    const next = changes.map((change, index): AgentGraphSignal => {
      const delay = Math.min(index, 6) * AGENT_GRAPH_MOTION.stagger;
      return {
        ...change,
        key: ++sequence.current,
        delay,
        expiresAt: now + (delay + AGENT_GRAPH_MOTION.transfer + AGENT_GRAPH_MOTION.layout) * 1000,
      };
    });
    setSignals((current) => {
      const retained = retainAgentGraphSignals(current, states, Date.now());
      return next.length || retained.length !== current.length ? [...retained, ...next] : current;
    });
  }, [agents]);
  useEffect(() => {
    if (!signals.length) return;
    const deadline = Math.min(...signals.map((signal) => signal.expiresAt));
    const timer = window.setTimeout(
      () => setSignals((current) => current.filter((signal) => signal.expiresAt > Date.now())),
      Math.max(0, deadline - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [signals]);
  const complete = useCallback((key: number): void => {
    setSignals((current) => current.filter((signal) => signal.key !== key));
  }, []);
  return { signals, complete };
}

/** A single packet follows the existing orthogonal wire, then releases its tween. */
export function AgentGraphConnectionSignal({
  signal,
  path,
  onComplete,
}: {
  signal: AgentGraphSignal;
  path: string;
  onComplete: (key: number) => void;
}) {
  const dot = useRef<HTMLSpanElement>(null);
  const initialPath = useRef(path);
  // Wires tween from their old positions; a packet must not jump to the final path ahead of them.
  useLayoutEffect(() => {
    if (path !== initialPath.current) onComplete(signal.key);
  }, [path, signal.key, onComplete]);
  useEffect(() => {
    const element = dot.current;
    if (!element) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let tween: ReturnType<Gsap["fromTo"]> | undefined;
    let disposed = false;
    let finished = false;
    const finish = (): void => {
      if (disposed || finished) return;
      finished = true;
      tween?.kill();
      onComplete(signal.key);
    };
    const sync = (): void => {
      if (preference.matches) finish();
      else if (document.hidden) tween?.pause();
      else tween?.resume();
    };
    preference.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    if (preference.matches) finish();
    else
      void loadGsap()
        .then((engine) => {
          if (disposed || finished) return;
          const returning = signal.direction === "return";
          tween = engine.fromTo(
            element,
            { offsetDistance: returning ? "100%" : "0%", opacity: 0 },
            {
              offsetDistance: returning ? "0%" : "100%",
              opacity: 1,
              delay: signal.delay,
              duration: AGENT_GRAPH_MOTION.transfer,
              ease: "none",
              onComplete: finish,
            },
          );
          sync();
        })
        .catch(finish);
    return () => {
      disposed = true;
      tween?.kill();
      preference.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [signal, onComplete]);
  return (
    <span
      ref={dot}
      className={styles.wireSignal}
      data-direction={signal.direction}
      style={{ offsetPath: path }}
      hidden={path !== initialPath.current}
      aria-hidden="true"
    />
  );
}
