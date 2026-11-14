import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetBackgroundJobsForTests,
  hasLiveBackgroundJobs,
  setBackgroundJobProbe,
} from "./backgroundJobs";

beforeEach(__resetBackgroundJobsForTests);

describe("后台保护查询", () => {
  it("未注入时保留会话", async () => {
    expect(await hasLiveBackgroundJobs("a")).toBe(true);
  });
  it("只有明确 false 才允许继续回收", async () => {
    setBackgroundJobProbe(() => false);
    expect(await hasLiveBackgroundJobs("a")).toBe(false);
    setBackgroundJobProbe(async () => true);
    expect(await hasLiveBackgroundJobs("a")).toBe(true);
  });
  it("同步或异步异常均保留会话", async () => {
    setBackgroundJobProbe(() => {
      throw new Error("failed");
    });
    expect(await hasLiveBackgroundJobs("a")).toBe(true);
    setBackgroundJobProbe(async () => {
      throw new Error("failed");
    });
    expect(await hasLiveBackgroundJobs("a")).toBe(true);
  });
  it("旧解绑不会移除新查询，当前解绑恢复未知保护", async () => {
    const old = setBackgroundJobProbe(() => true);
    const current = setBackgroundJobProbe(() => false);
    old();
    expect(await hasLiveBackgroundJobs("a")).toBe(false);
    current();
    expect(await hasLiveBackgroundJobs("a")).toBe(true);
  });
});
