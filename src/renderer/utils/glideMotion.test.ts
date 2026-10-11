import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { glide, makeCubicBezier, mix } from "./glideMotion";
import { GLIDE_MOTION } from "./motionTokens";

/**
 * 定帧时间轴（封顶 60fps）与贝塞尔曲线的纯逻辑验证（vitest 只跑无 DOM 的部分，见 AGENTS.md「测试」）。
 * 帧率不是"配了个 60"就算数：调度器靠 rAF 取整，容差不对就会在 60Hz 上掉到 30fps，
 * 所以这里用假时钟按真实刷新率喂帧，数实际派发的帧数。
 */

type Frame = (now: number) => void;

function installFakeClock(): { tick: (ms: number) => void } {
  let queue: Frame[] = [];
  let now = 0;
  vi.stubGlobal("performance", { now: () => now });
  vi.stubGlobal("requestAnimationFrame", (cb: Frame) => queue.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {
    queue = [];
  });
  return {
    tick: (deltaMs: number) => {
      now += deltaMs;
      const pending = queue;
      queue = [];
      for (const frame of pending) frame(now);
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("makeCubicBezier", () => {
  const ease = makeCubicBezier(0.23, 1, 0.32, 1);

  it("锚点精确，区间外夹住", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(-0.5)).toBe(0);
    expect(ease(1.5)).toBe(1);
  });

  it("单调不回退", () => {
    let previous = 0;
    for (let x = 0; x <= 1.0001; x += 0.02) {
      const value = ease(x);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = value;
    }
  });

  it("ease-out 前段快：半程已完成九成", () => {
    expect(ease(0.5)).toBeGreaterThan(0.85);
    expect(ease(0.1)).toBeGreaterThan(0.3);
  });

  it("(0,0,1,1) 退化为线性", () => {
    const linear = makeCubicBezier(0, 0, 1, 1);
    for (const x of [0.1, 0.35, 0.5, 0.7, 0.9]) expect(linear(x)).toBeCloseTo(x, 5);
  });
});

describe("glide 60fps 调度", () => {
  it("60Hz 取帧逐帧推进：派发 60 帧/秒", () => {
    const clock = installFakeClock();
    let updates = 0;
    let done = 0;
    glide({ duration: 1, onUpdate: () => updates++, onComplete: () => done++ });

    // 16.666…ms 一帧，跑满 1 秒：每一帧都该推进一步
    for (let i = 0; i < 60; i++) clock.tick(1000 / 60);

    expect(updates).toBe(60);
    expect(done).toBe(1);
  });

  it("144Hz 取帧不会超发（封顶 60fps）", () => {
    const clock = installFakeClock();
    let updates = 0;
    glide({ duration: 1, onUpdate: () => updates++ });

    for (let i = 0; i < 144; i++) clock.tick(1000 / 144);

    expect(updates).toBeLessThanOrEqual(62);
    expect(updates).toBeGreaterThanOrEqual(58);
  });

  it("补间按固定步长推进，被打断时不越界", () => {
    const clock = installFakeClock();
    const seen: number[] = [];
    const cancel = glide({ duration: GLIDE_MOTION.glide, onUpdate: (p) => seen.push(p) });
    // 60fps 下 220ms ≈ 13.2 帧
    for (let i = 0; i < 4; i++) clock.tick(1000 / 60);
    cancel();
    for (let i = 0; i < 4; i++) clock.tick(1000 / 60);
    expect(seen.length).toBe(4);
    expect(seen.every((p) => p > 0 && p <= 1)).toBe(true);
  });

  it("时长为 0 直接落终态", () => {
    installFakeClock();
    let final = -1;
    let completed = 0;
    glide({ duration: 0, onUpdate: (p) => (final = p), onComplete: () => completed++ });
    expect(final).toBe(1);
    expect(completed).toBe(1);
  });
});

describe("mix", () => {
  it("端点与中点插值", () => {
    expect(mix(0.95, 1, 0)).toBe(0.95);
    expect(mix(0.95, 1, 1)).toBe(1);
    expect(mix(0, -120, 0.5)).toBe(-60);
  });
});
