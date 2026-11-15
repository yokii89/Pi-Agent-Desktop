/*
 * Adapted from docs/ui-design/thinking-orbs-main/apps/web/registry/orb/orb-core.ts.
 * Copyright (c) 2026 Yogesh. Used under the MIT License.
 *
 * PiDesk keeps the reasoning, twins, gyro and lighthouse looks used by the
 * session marker. The larger gallery-only state machine is intentionally left
 * out so the session bundle only carries the effects users can select here.
 */

import type { ThinkingAnimation } from "../../../shared/thinkingAnimation";
import { prefersReducedMotion } from "../../utils/animation";
import { GLIDE_MOTION } from "../../utils/motionTokens";

type OrbVariant = Exclude<ThinkingAnimation, "pi">;
type Point = [number, number, number];
type Circle = SVGCircleElement;

const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const HOP_MS = 220;
const TAIL = 5;
const REACH = 24;
const TWIST = 1.4;
const LEAN = (30 * Math.PI) / 180;
const clocks = new Map<string, { time: number; last: number }>();

const ease = (x: number): number => (1 - Math.cos(Math.PI * x)) / 2;

const hash = (n: number): number => {
  const value = Math.sin(n * 127.1) * 43758.5453;
  return value - Math.floor(value);
};

const distanceSquared = (a: Point, b: Point): number =>
  (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function nearest(points: Point[], index: number, count: number): number[] {
  const indexes: number[] = [];
  const distances: number[] = [];
  const point = points[index];
  for (let candidate = 0; candidate < points.length; candidate += 1) {
    if (candidate === index) continue;
    const distance = distanceSquared(point, points[candidate]);
    let at = indexes.length;
    if (at === count) {
      if (distance >= distances[count - 1]) continue;
      at -= 1;
    }
    while (at > 0 && distances[at - 1] > distance) {
      indexes[at] = indexes[at - 1];
      distances[at] = distances[at - 1];
      at -= 1;
    }
    indexes[at] = candidate;
    distances[at] = distance;
  }
  return indexes;
}

function distribute(count: number): Point[] {
  return Array.from({ length: count }, (_, index) => {
    const y = 1 - (2 * (index + 0.5)) / count;
    const radius = Math.sqrt(1 - y * y);
    const angle = index * GOLDEN;
    return [radius * Math.cos(angle), y, radius * Math.sin(angle)] as Point;
  });
}

function advanceClock(key: string, now: number): number {
  let clock = clocks.get(key);
  if (!clock) {
    clock = { time: 0, last: now };
    clocks.set(key, clock);
  }
  if (now > clock.last) {
    clock.time += Math.min(now - clock.last, 100);
    clock.last = now;
  }
  return clock.time;
}

function spot(index: number): Point {
  const phi = index * 2.45 + hash(index) * 1.5;
  const theta = ((15 + 30 * hash(index + 0.5)) * Math.PI) / 180;
  return [Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)];
}

function movingLens(time: number): Point {
  const period = 1800;
  const index = Math.floor(time / period);
  const progress = (time / period - index) / 0.4;
  const amount = progress < 1 ? ease(progress) : 1;
  const from = spot(index);
  const to = spot(index + 1);
  const point: Point = [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ];
  const length = Math.hypot(point[0], point[1], point[2]);
  return [point[0] / length, point[1] / length, point[2] / length];
}

function mountCircle(svg: SVGSVGElement): Circle {
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("fill", "currentColor");
  svg.appendChild(circle);
  return circle;
}

function normalizedAngle(value: number): number {
  return ((((value + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

export interface ThinkingOrbOptions {
  variant: OrbVariant;
  size: number;
}

/** Mounts one selected orb look into an SVG and returns its lifecycle controls. */
export function mountThinkingOrb(svg: SVGSVGElement, options: ThinkingOrbOptions): () => void {
  const { variant, size } = options;
  const count = Math.max(32, Math.round(size * 4));
  const points = distribute(count);
  const circles = points.map(() => mountCircle(svg));
  const radius = (size / 64) ** 0.6 * 0.72 * Math.sqrt(4 / 4);
  const key = `${variant}@${size}`;
  const reasoning = variant === "reasoning" || variant === "twins";
  const near = reasoning ? points.map((_, index) => nearest(points, index, REACH)) : [];
  const walks: number[][] = Array.from({ length: variant === "twins" ? 2 : 1 }, () => []);
  let hops = 0;
  let raf = 0;
  let dead = false;
  let visible = true;
  let reduced = prefersReducedMotion();
  let lastFrame = performance.now();

  const draw = (time: number): void => {
    const yaw = (time / (variant === "gyro" ? 3000 : 6500)) * TAU;
    const gyro = variant === "gyro" ? (time / 5000) * TAU : null;
    const pitch = ((20 + (gyro === null ? 0 : 10 * Math.cos(gyro))) * Math.PI) / 180;
    const roll = gyro === null ? 0 : (12 * Math.sin(gyro) * Math.PI) / 180;
    const sinRoll = Math.sin(roll);
    const cosRoll = Math.cos(roll);
    const sinPitch = Math.sin(pitch);
    const cosPitch = Math.cos(pitch);
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);

    const facing = (index: number): number =>
      points[index][1] * sinPitch +
      (-points[index][0] * sinYaw + points[index][2] * cosYaw) * cosPitch;

    const lit = new Map<number, number>();
    if (reasoning) {
      const progress = time / HOP_MS;
      const step = Math.floor(progress);
      const fraction = progress - step;
      if (!walks[0].length) {
        const first = points.reduce(
          (best, _, index) => (facing(index) > facing(best) ? index : best),
          0,
        );
        const apart = (index: number): number =>
          facing(index) + distanceSquared(points[index], points[first]);
        walks.forEach((walk, walkIndex) => {
          walk.push(
            walkIndex === 0
              ? first
              : points.reduce((best, _, index) => (apart(index) > apart(best) ? index : best), 0),
          );
        });
      }
      for (; hops < step; hops += 1) {
        walks.forEach((walk, walkIndex) => {
          const recent = walk.slice(-8);
          const from = walk[walk.length - 1];
          const other = variant === "twins" ? walks[1 - walkIndex].at(-1) : undefined;
          let best = -1;
          let score = -Infinity;
          near[from].forEach((candidate, candidateIndex) => {
            const apart =
              other === undefined
                ? 0
                : 1.2 * Math.min(Math.sqrt(distanceSquared(points[candidate], points[other])), 0.8);
            const candidateScore =
              facing(candidate) + 0.35 * hash(hops * 31 + candidateIndex + walkIndex * 977) + apart;
            if (!recent.includes(candidate) && candidateScore > score) {
              score = candidateScore;
              best = candidate;
            }
          });
          walk.push(best < 0 ? near[from][0] : best);
          if (walk.length > 16) walk.shift();
        });
      }
      const light = (index: number | undefined, amount: number): void => {
        if (index !== undefined) lit.set(index, Math.max(lit.get(index) ?? 0, amount));
      };
      walks.forEach((walk) => {
        for (let tail = TAIL - 1; tail >= 0; tail -= 1) {
          light(
            walk[walk.length - 1 - tail],
            tail === 0 ? ease(Math.min(1, fraction * 2)) : 1 - (tail - 1 + fraction) / TAIL,
          );
        }
      });
    }

    const lens = variant === "lighthouse" ? movingLens(time) : null;
    const beamAngle = (time / 2500) * TAU - Math.PI;
    points.forEach(([x, y, z], index) => {
      const turn = yaw + (variant === "gyro" ? TWIST * Math.sin((time / 2600) * TAU) * y : 0);
      const sinTurn = Math.sin(turn);
      const cosTurn = Math.cos(turn);
      const z1 = -x * sinTurn + z * cosTurn;
      let vx = x * cosTurn + z * sinTurn;
      let vy = y * cosPitch - z1 * sinPitch;
      const vz = y * sinPitch + z1 * cosPitch;
      const depth = (vz + 1) / 2;
      let dotRadius = (0.5 + 1.4 * depth) * radius;
      let opacity = Math.max(0, (depth - 0.3) / 0.7);

      if (lens) {
        const angle = Math.acos(
          Math.min(1, (vx * lens[0] + vy * lens[1] + vz * lens[2]) / Math.hypot(vx, vy, vz)),
        );
        const strength = angle < 0.6 ? (1 - (angle / 0.6) ** 2) ** 2 : 0;
        opacity *= 1 - 0.55 * (1 - strength);
        dotRadius *= 1 + 0.9 * strength;
        vx *= 1 + 0.12 * strength;
        vy *= 1 + 0.12 * strength;
        opacity += (1 - opacity) * strength;
      }

      if (variant === "gyro") {
        const progress = time % 1700;
        const ringAt = 1.3 - 2.6 * ease(Math.min(1, progress / 1200));
        const ringAxis = [
          -Math.sin(0.17) * Math.cos(0.52),
          Math.cos(0.17) * Math.cos(0.52),
          Math.sin(0.52),
        ];
        const position = vx * ringAxis[0] + vy * ringAxis[1] + vz * ringAxis[2];
        const glow = progress < 1200 ? Math.exp(-(((position - ringAt) / 0.2) ** 2)) : 0;
        dotRadius *= 1 + 0.6 * glow;
        opacity += (1 - opacity) * glow;
      }

      if (variant === "lighthouse") {
        opacity *= 0.5;
        const sinLean = Math.sin(LEAN);
        const cosLean = Math.cos(LEAN);
        const across = vx * cosLean - vy * sinLean;
        const toward = -sinPitch * (vx * sinLean + vy * cosLean) + cosPitch * vz;
        const delta = normalizedAngle(Math.atan2(across, toward) - beamAngle);
        const beam =
          delta < 0 ? Math.max(0, 1 + delta / (Math.PI / 2)) : Math.exp(-((delta / 0.45) ** 2));
        const glow = beam * (0.25 + 0.75 * Math.min(1, Math.max(0, (depth - 0.4) / 0.3)));
        dotRadius *= 1 + 0.6 * glow;
        opacity += (1 - opacity) * glow;
      }

      if (reasoning) {
        const sparkle = lit.get(index) ?? 0;
        opacity *= 0.5;
        if (sparkle) {
          dotRadius *= 1 + 0.8 * sparkle;
          opacity += (1 - opacity) * sparkle;
        }
      }

      if (roll) {
        [vx, vy] = [vx * cosRoll - vy * sinRoll, vx * sinRoll + vy * cosRoll];
      }
      const circle = circles[index];
      circle.setAttribute("cx", (size / 2 + vx * size * 0.4).toFixed(2));
      circle.setAttribute("cy", (size / 2 - vy * size * 0.4).toFixed(2));
      circle.setAttribute("r", Math.max(0.45, dotRadius).toFixed(2));
      circle.setAttribute("fill-opacity", Math.max(0, Math.min(1, opacity)).toFixed(2));
    });
  };

  draw(advanceClock(key, performance.now()));

  const frameMs = 1000 / GLIDE_MOTION.fps;
  const frame = (now: number): void => {
    if (now - lastFrame >= frameMs - 0.5) {
      lastFrame = now;
      if (visible) draw(advanceClock(key, now));
    }
    raf = requestAnimationFrame(frame);
  };
  const pause = (): void => {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
  };
  const play = (): void => {
    if (!raf && !reduced && !dead) raf = requestAnimationFrame(frame);
  };
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  const onMotionPreferenceChange = (): void => {
    reduced = prefersReducedMotion();
    if (reduced) pause();
    else play();
  };
  media.addEventListener("change", onMotionPreferenceChange);

  if (typeof IntersectionObserver !== "undefined") {
    const observer = new IntersectionObserver((entries) => {
      visible = entries[entries.length - 1]?.isIntersecting ?? true;
    });
    observer.observe(svg);
    play();
    return () => {
      dead = true;
      pause();
      observer.disconnect();
      media.removeEventListener("change", onMotionPreferenceChange);
      svg.replaceChildren();
    };
  }

  play();
  return () => {
    dead = true;
    pause();
    media.removeEventListener("change", onMotionPreferenceChange);
    svg.replaceChildren();
  };
}
