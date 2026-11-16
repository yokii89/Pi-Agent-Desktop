export interface MermaidRenderSpec {
  code: string;
  theme: "default" | "dark";
  fontFamily: string;
}

type Render = (spec: MermaidRenderSpec, signal: AbortSignal) => Promise<string | null>;
interface Subscriber {
  resolve: (svg: string | null) => void;
  reject: (error: unknown) => void;
  detach: () => void;
}
interface Job {
  key: string;
  spec: MermaidRenderSpec;
  controller: AbortController;
  subscribers: Set<Subscriber>;
}

const abortError = (): Error => new DOMException("Diagram request cancelled", "AbortError");

/**
 * 串行保护 Mermaid 全局配置；相同图共享在途布局，缓存只保留有界 SVG 字符串。
 * 取消的排队任务不进引擎；已开始的布局完成后不再投递给卸载的界面。
 */
export class MermaidRenderCache {
  private readonly cache = new Map<string, string | null>();
  private cacheChars = 0;
  private readonly jobs = new Map<string, Job>();
  private readonly queue: Job[] = [];
  private draining = false;

  constructor(
    private readonly render: Render,
    private readonly maxEntries = 6,
    private readonly maxChars = 2 * 1024 * 1024,
  ) {}

  /** 按源码、主题与字体请求图表；signal 仅取消本次消费者。 */
  request(spec: MermaidRenderSpec, signal: AbortSignal): Promise<string | null> {
    if (signal.aborted) return Promise.reject(abortError());
    const key = JSON.stringify([spec.code, spec.theme, spec.fontFamily]);
    if (this.cache.has(key)) {
      const svg = this.cache.get(key) ?? null;
      this.cache.delete(key);
      this.cache.set(key, svg);
      return Promise.resolve(svg);
    }
    let job = this.jobs.get(key);
    if (!job) {
      job = { key, spec, controller: new AbortController(), subscribers: new Set() };
      this.jobs.set(key, job);
      this.queue.push(job);
    }
    const target = job;
    const promise = new Promise<string | null>((resolve, reject) => {
      const cancel = (): void => {
        target.subscribers.delete(subscriber);
        subscriber.detach();
        reject(abortError());
        if (target.subscribers.size === 0) {
          target.controller.abort();
          this.jobs.delete(key);
          const index = this.queue.indexOf(target);
          if (index >= 0) this.queue.splice(index, 1);
        }
      };
      const subscriber: Subscriber = {
        resolve,
        reject,
        detach: () => signal.removeEventListener("abort", cancel),
      };
      target.subscribers.add(subscriber);
      signal.addEventListener("abort", cancel, { once: true });
    });
    if (!this.draining) {
      this.draining = true;
      // 等本次提交的卸载清理完成，快速切文件时不抢先布局已经过期的图。
      void Promise.resolve().then(() => this.drain());
    }
    return promise;
  }

  private remember(key: string, svg: string | null): void {
    const cost = key.length + (svg?.length ?? 0);
    if (cost > this.maxChars) return;
    this.cache.set(key, svg);
    this.cacheChars += cost;
    while (this.cache.size > this.maxEntries || this.cacheChars > this.maxChars) {
      const oldest = this.cache.entries().next().value;
      if (!oldest) break;
      this.cache.delete(oldest[0]);
      this.cacheChars -= oldest[0].length + (oldest[1]?.length ?? 0);
    }
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) break;
      try {
        if (job.subscribers.size === 0) continue;
        const svg = await this.render(job.spec, job.controller.signal);
        if (job.subscribers.size > 0) this.remember(job.key, svg);
        for (const subscriber of job.subscribers) subscriber.resolve(svg);
      } catch (error) {
        // 模块加载等瞬态错误不缓存，下次打开仍可重试。
        for (const subscriber of job.subscribers) subscriber.reject(error);
      } finally {
        for (const subscriber of job.subscribers) subscriber.detach();
        job.subscribers.clear();
        if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
      }
      // 把事件循环交还输入、绘制和卸载清理，避免多图连续布局占满同一个任务。
      if (this.queue.length > 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    this.draining = false;
  }
}
