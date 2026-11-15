import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Gsap } from "../../../utils/animation";
import { animateBuddyThinking } from "./buddyThinking";

const runtime = vi.hoisted(() => ({
  loadGsap: vi.fn<() => Promise<Gsap>>(),
  prefersReducedMotion: vi.fn<() => boolean>(),
}));
vi.mock("../../../utils/animation", () => runtime);

class MotionPreference extends EventTarget {
  matches = false;
  update(matches: boolean) {
    this.matches = matches;
    this.dispatchEvent(new Event("change"));
  }
}

class PageVisibility extends EventTarget {
  hidden = false;
  update(hidden: boolean) {
    this.hidden = hidden;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

function fakeGsap() {
  const timelines: { paused: ReturnType<typeof vi.fn>; to: ReturnType<typeof vi.fn> }[] = [];
  const contexts: { revert: ReturnType<typeof vi.fn> }[] = [];
  const gsap = {
    set: vi.fn(),
    timeline: vi.fn(() => {
      const timeline = { paused: vi.fn(), to: vi.fn() };
      timeline.to.mockReturnValue(timeline);
      timelines.push(timeline);
      return timeline;
    }),
    context: vi.fn((setup: () => void) => {
      const context = { revert: vi.fn() };
      contexts.push(context);
      setup();
      return context;
    }),
  };
  return { gsap: gsap as unknown as Gsap, contexts, timelines };
}

// 只模拟调度边界，不引入 DOM / 渲染层测试框架；样式与几何由真实浏览器验收。
const svg = {
  querySelector: () => null,
  querySelectorAll: () => [],
} as unknown as SVGSVGElement;
let preference: MotionPreference;
let page: PageVisibility;
let engine: ReturnType<typeof fakeGsap>;
let intersect: (entries: { target: SVGSVGElement; isIntersecting: boolean }[]) => void;
let disconnect: ReturnType<typeof vi.fn>;
let dispose: (() => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  preference = new MotionPreference();
  page = new PageVisibility();
  engine = fakeGsap();
  disconnect = vi.fn();
  runtime.loadGsap.mockResolvedValue(engine.gsap);
  runtime.prefersReducedMotion.mockImplementation(() => preference.matches);
  vi.stubGlobal("window", { matchMedia: () => preference });
  vi.stubGlobal("document", page);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: typeof intersect) {
        intersect = callback;
      }
      observe() {}
      disconnect() {
        disconnect();
      }
    },
  );
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
});

async function flushLoad() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Buddy 思考动效生命周期", () => {
  it("减少动效时不加载 GSAP，保留 CSS 静态姿态", () => {
    preference.matches = true;
    dispose = animateBuddyThinking(svg);
    expect(runtime.loadGsap).not.toHaveBeenCalled();
    expect(engine.contexts).toHaveLength(0);
  });

  it("退出早于异步加载完成时不再创建动画", async () => {
    let loaded: ((gsap: Gsap) => void) | undefined;
    runtime.loadGsap.mockReturnValueOnce(
      new Promise((resolve) => {
        loaded = resolve;
      }),
    );
    dispose = animateBuddyThinking(svg);
    dispose();
    dispose = undefined;
    loaded?.(engine.gsap);
    await flushLoad();
    expect(engine.contexts).toHaveLength(0);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("窗口隐藏或形象移出视口均暂停，两者恢复才续播", async () => {
    dispose = animateBuddyThinking(svg);
    await flushLoad();
    const timeline = engine.timelines[0];
    expect(timeline.paused).toHaveBeenLastCalledWith(false);
    page.update(true);
    expect(timeline.paused).toHaveBeenLastCalledWith(true);
    intersect([{ target: svg, isIntersecting: false }]);
    page.update(false);
    expect(timeline.paused).toHaveBeenLastCalledWith(true);
    intersect([{ target: svg, isIntersecting: true }]);
    expect(timeline.paused).toHaveBeenLastCalledWith(false);
  });

  it("隐藏期间异步加载完成，也不能开始播放", async () => {
    page.hidden = true;
    dispose = animateBuddyThinking(svg);
    await flushLoad();
    expect(engine.timelines[0].paused).toHaveBeenLastCalledWith(true);
  });

  it("偏好改变立即回滚，恢复后只有新的时间轴，清理后不再响应事件", async () => {
    dispose = animateBuddyThinking(svg);
    await flushLoad();
    preference.update(true);
    expect(engine.contexts[0].revert).toHaveBeenCalledOnce();
    preference.update(false);
    await flushLoad();
    expect(engine.contexts).toHaveLength(2);
    dispose();
    dispose = undefined;
    expect(engine.contexts[1].revert).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    const calls = runtime.loadGsap.mock.calls.length;
    preference.update(false);
    page.update(true);
    expect(runtime.loadGsap).toHaveBeenCalledTimes(calls);
    expect(engine.timelines[1].paused).toHaveBeenCalledTimes(1);
  });

  it("连续切换偏好时，旧加载回调不能创建第二份动画", async () => {
    const pending: ((gsap: Gsap) => void)[] = [];
    runtime.loadGsap.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    dispose = animateBuddyThinking(svg);
    preference.update(true);
    preference.update(false);
    for (const loaded of pending) loaded(engine.gsap);
    await flushLoad();
    expect(engine.contexts).toHaveLength(1);
  });

  it("加载失败留在静态姿态，仍能安全清理", async () => {
    runtime.loadGsap.mockRejectedValueOnce(new Error("chunk unavailable"));
    dispose = animateBuddyThinking(svg);
    await flushLoad();
    expect(engine.contexts).toHaveLength(0);
    expect(() => dispose?.()).not.toThrow();
    dispose = undefined;
  });
});
