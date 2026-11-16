import { describe, expect, it, vi } from "vitest";
import { MermaidRenderCache, type MermaidRenderSpec } from "./mermaidRenderCache";

const spec = (code = "flowchart LR; A-->B"): MermaidRenderSpec => ({
  code,
  theme: "dark",
  fontFamily: "system-ui",
});
const signal = (): AbortSignal => new AbortController().signal;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Mermaid shared layout scheduling", () => {
  it("shares in-flight layouts and reuses successful and invalid results", async () => {
    const render = vi.fn(async ({ code }: MermaidRenderSpec) => (code === "invalid" ? null : code));
    const cache = new MermaidRenderCache(render);
    expect(
      await Promise.all([cache.request(spec(), signal()), cache.request(spec(), signal())]),
    ).toEqual([spec().code, spec().code]);
    await cache.request(spec(), signal());
    expect(render).toHaveBeenCalledTimes(1);
    expect(await cache.request(spec("invalid"), signal())).toBeNull();
    expect(await cache.request(spec("invalid"), signal())).toBeNull();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("separates themes and fonts and serializes all global configuration changes", async () => {
    const gate = deferred<string>();
    const render = vi
      .fn()
      .mockImplementationOnce(() => gate.promise)
      .mockResolvedValue("svg");
    const cache = new MermaidRenderCache(render);
    const first = cache.request(spec(), signal());
    const light = cache.request({ ...spec(), theme: "default" }, signal());
    const font = cache.request({ ...spec(), fontFamily: "serif" }, signal());
    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(1);
    gate.resolve("first");
    expect(await Promise.all([first, light, font])).toEqual(["first", "svg", "svg"]);
    expect(render).toHaveBeenCalledTimes(3);
  });

  it("drops queued work that no longer has a consumer", async () => {
    const gate = deferred<string>();
    const render = vi.fn(() => gate.promise);
    const cache = new MermaidRenderCache(render);
    const first = cache.request(spec(), signal());
    const controller = new AbortController();
    const queued = cache.request(spec("obsolete"), controller.signal);
    const cancelled = expect(queued).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    gate.resolve("first");
    await cancelled;
    await first;
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("keeps shared work alive until its last consumer leaves", async () => {
    const gate = deferred<string>();
    const render = vi.fn(() => gate.promise);
    const cache = new MermaidRenderCache(render);
    const controller = new AbortController();
    const first = cache.request(spec(), controller.signal);
    const second = cache.request(spec(), signal());
    const cancelled = expect(first).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    controller.abort();
    gate.resolve("shared");
    await cancelled;
    expect(await second).toBe("shared");
    expect(await cache.request(spec(), signal())).toBe("shared");
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("aborts abandoned work and cannot discard a later request for the same diagram", async () => {
    const oldLayout = deferred<string>();
    const newLayout = deferred<string>();
    const render = vi.fn((_spec: MermaidRenderSpec, _signal: AbortSignal) => oldLayout.promise);
    render
      .mockImplementationOnce(() => oldLayout.promise)
      .mockImplementation(() => newLayout.promise);
    const cache = new MermaidRenderCache(render);
    const controller = new AbortController();
    const obsolete = cache.request(spec(), controller.signal);
    const cancelled = expect(obsolete).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    controller.abort();
    expect(render.mock.calls[0][1].aborted).toBe(true);
    const current = cache.request(spec(), signal());
    oldLayout.resolve("obsolete");
    await cancelled;
    // 旧任务完成后的 finally 不得删掉新任务；第三个消费者仍须共享它。
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
    const shared = cache.request(spec(), signal());
    newLayout.resolve("current");
    expect(await Promise.all([current, shared])).toEqual(["current", "current"]);
    expect(await cache.request(spec(), signal())).toBe("current");
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("honors both the LRU entry limit and the total string budget", async () => {
    const render = vi.fn(async () => "svg");
    const cache = new MermaidRenderCache(render, 2);
    for (const code of ["A", "B", "A", "C", "A", "B"]) {
      await cache.request(spec(code), signal());
    }
    expect(render).toHaveBeenCalledTimes(4);

    const oneCost = JSON.stringify(["A", "dark", "system-ui"]).length + "svg".length;
    const bounded = new MermaidRenderCache(render, 6, oneCost);
    render.mockClear();
    for (const code of ["A", "B", "A"]) await bounded.request(spec(code), signal());
    expect(render).toHaveBeenCalledTimes(3);
    const oversized = new MermaidRenderCache(render, 6, oneCost - 1);
    render.mockClear();
    await oversized.request(spec("A"), signal());
    await oversized.request(spec("A"), signal());
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("allows retrying transient failures and rejects an already cancelled consumer", async () => {
    const render = vi.fn().mockRejectedValueOnce(new Error("chunk load")).mockResolvedValue("svg");
    const cache = new MermaidRenderCache(render);
    await expect(cache.request(spec(), signal())).rejects.toThrow("chunk load");
    expect(await cache.request(spec(), signal())).toBe("svg");
    const controller = new AbortController();
    controller.abort();
    await expect(cache.request(spec(), controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(render).toHaveBeenCalledTimes(2);
  });
});
