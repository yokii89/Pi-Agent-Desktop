import { AGENT_PADDING } from "./agentGraphLayout";

interface Size {
  width: number;
  height: number;
}

/** Full-graph overview must include large snapshots even below the usual readable zoom. */
export function fitAgentGraphScale(graph: Size, viewport: Size): number {
  if (
    ![graph.width, graph.height, viewport.width, viewport.height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return 1;
  return Math.min(
    1,
    Math.max(1, viewport.width - AGENT_PADDING) / graph.width,
    Math.max(1, viewport.height - AGENT_PADDING) / graph.height,
  );
}

/** Zooming out from an overview must never jump in to the default minimum. */
export function zoomAgentGraphScale(
  current: number,
  factor: number,
  overviewScale: number,
): number {
  return Math.max(Math.min(0.05, overviewScale, current), Math.min(2, current * factor));
}

/** Keep very small overviews distinguishable from 0%. */
export function agentGraphZoomPercent(scale: number): number {
  return scale < 0.01 ? Number((scale * 100).toFixed(2)) : Math.round(scale * 100);
}
