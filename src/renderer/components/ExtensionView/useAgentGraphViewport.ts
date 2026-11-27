import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AGENT_NODE_WIDTH, AGENT_PADDING, type AgentGraphPosition } from "./agentGraphLayout";
import { fitAgentGraphScale, zoomAgentGraphScale } from "./agentGraphViewportGeometry";

/** Owns scroll and zoom geometry without rebuilding the delegation layout on resize. */
export function useAgentGraphViewport(width: number, height: number) {
  const viewport = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const dimensions = useRef({ width, height });
  dimensions.current = { width, height };
  const scale = useRef(1);
  const origin = useRef(0);
  const overview = useRef(false);
  const [bounds, setBounds] = useState({
    top: 0,
    width: 0,
    height: 0,
    paneWidth: 0,
    paneHeight: 0,
    scale: 1,
    origin: 0,
  });
  const measure = useCallback((): void => {
    const element = viewport.current;
    if (!element) return;
    if (ruler.current) ruler.current.scrollLeft = element.scrollLeft;
    const next = {
      top: element.scrollTop / scale.current,
      width: element.clientWidth,
      height: element.clientHeight / scale.current,
      paneWidth: element.offsetWidth,
      paneHeight: element.offsetHeight,
      scale: scale.current,
      origin: origin.current,
    };
    setBounds((previous) =>
      Object.keys(next).every(
        (key) => previous[key as keyof typeof next] === next[key as keyof typeof next],
      )
        ? previous
        : next,
    );
  }, []);
  const applyScale = useCallback(
    (next: number): void => {
      const element = viewport.current;
      if (!element || !surface.current || !plane.current) return;
      const current = dimensions.current;
      const scaledWidth = current.width * next;
      origin.current = Math.max(0, (element.clientWidth - scaledWidth) / 2);
      scale.current = next;
      surface.current.style.width = `${Math.max(element.clientWidth, scaledWidth)}px`;
      surface.current.style.height = `${Math.max(element.clientHeight, current.height * next)}px`;
      plane.current.style.transform = `translateX(${origin.current}px) scale(${next})`;
      measure();
    },
    [measure],
  );
  const fitGraph = useCallback((): void => {
    const element = viewport.current;
    if (!element?.clientWidth || !element.clientHeight) return;
    overview.current = true;
    applyScale(
      fitAgentGraphScale(dimensions.current, {
        width: element.clientWidth,
        height: element.clientHeight,
      }),
    );
    element.scrollTo(0, 0);
    measure();
  }, [applyScale, measure]);
  const reset = useCallback((): void => {
    overview.current = false;
    applyScale(1);
    viewport.current?.scrollTo(0, 0);
    measure();
  }, [applyScale, measure]);
  const zoom = useCallback(
    (factor: number, x?: number, y?: number): void => {
      const element = viewport.current;
      if (!element) return;
      const before = scale.current;
      const anchorX = x ?? element.clientWidth / 2;
      const anchorY = y ?? element.clientHeight / 2;
      const graphX = (element.scrollLeft + anchorX - origin.current) / before;
      const graphY = (element.scrollTop + anchorY) / before;
      const minimum = fitAgentGraphScale(dimensions.current, {
        width: element.clientWidth,
        height: element.clientHeight,
      });
      const next = zoomAgentGraphScale(before, factor, minimum);
      overview.current = false;
      applyScale(next);
      element.scrollLeft = graphX * next + origin.current - anchorX;
      element.scrollTop = graphY * next - anchorY;
      measure();
    },
    [applyScale, measure],
  );

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const resize = (): void => {
      if (overview.current) fitGraph();
      else applyScale(scale.current);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [applyScale, fitGraph]);
  useLayoutEffect(() => {
    // Layout changes refresh native scroll bounds; status and metadata updates do not refit.
    if (width && height) {
      if (overview.current) fitGraph();
      else applyScale(scale.current);
    }
  }, [width, height, applyScale, fitGraph]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let drag: { id: number; x: number; y: number; left: number; top: number } | null = null;
    const finish = (): void => {
      const id = drag?.id;
      drag = null;
      delete element.dataset.dragging;
      if (id !== undefined && element.hasPointerCapture(id)) element.releasePointerCapture(id);
    };
    const down = (event: PointerEvent): void => {
      if (
        event.button !== 0 ||
        !(event.target instanceof Element) ||
        event.target.closest("button")
      )
        return;
      const rect = element.getBoundingClientRect();
      if (
        event.clientX - rect.left >= element.clientWidth ||
        event.clientY - rect.top >= element.clientHeight
      )
        return;
      event.preventDefault();
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: element.scrollLeft,
        top: element.scrollTop,
      };
      element.setPointerCapture(event.pointerId);
      element.dataset.dragging = "true";
    };
    const move = (event: PointerEvent): void => {
      if (!drag || drag.id !== event.pointerId) return;
      overview.current = false;
      element.scrollLeft = drag.left + drag.x - event.clientX;
      element.scrollTop = drag.top + drag.y - event.clientY;
    };
    const up = (event: PointerEvent): void => {
      if (drag?.id === event.pointerId) finish();
    };
    const wheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoom(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
    };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    element.addEventListener("lostpointercapture", up);
    element.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("blur", finish);
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      element.removeEventListener("lostpointercapture", up);
      element.removeEventListener("wheel", wheel);
      window.removeEventListener("blur", finish);
      finish();
    };
  }, [zoom]);

  const reveal = useCallback(
    (node: Pick<AgentGraphPosition, "x" | "y" | "height">, center: boolean): void => {
      const element = viewport.current;
      if (!element || (overview.current && !center)) return;
      overview.current = false;
      const currentScale = scale.current;
      const x = origin.current + node.x * currentScale;
      const y = node.y * currentScale;
      const nodeWidth = AGENT_NODE_WIDTH * currentScale;
      const nodeHeight = node.height * currentScale;
      const padX = Math.min(
        AGENT_PADDING * currentScale,
        Math.max(0, (element.clientWidth - nodeWidth) / 2),
      );
      const padY = Math.min(
        AGENT_PADDING * currentScale,
        Math.max(0, (element.clientHeight - nodeHeight) / 2),
      );
      let left = element.scrollLeft;
      let top = element.scrollTop;
      if (center) {
        left = x - (element.clientWidth - nodeWidth) / 2;
        top = y - (element.clientHeight - nodeHeight) / 2;
      } else {
        if (x < left + padX) left = x - padX;
        else if (x + nodeWidth + padX > left + element.clientWidth)
          left = x + nodeWidth + padX - element.clientWidth;
        if (nodeHeight >= element.clientHeight || y < top + padY) top = y - padY;
        else if (y + nodeHeight + padY > top + element.clientHeight)
          top = y + nodeHeight + padY - element.clientHeight;
      }
      element.scrollTo({ left: Math.max(0, left), top: Math.max(0, top), behavior: "instant" });
      measure();
    },
    [measure],
  );
  return { viewport, surface, plane, ruler, bounds, measure, zoom, fitGraph, reset, reveal };
}
