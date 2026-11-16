import { readFileSync } from "node:fs";
import { connectBenchmark, writeBenchmarkReport } from "./benchmarkCdp.ts";

interface Fixture {
  file: string;
  bytes: number;
  expected: string;
  pages?: number;
  sha256: string;
}
interface Timing {
  elapsedMs: number;
  readMs: number;
  maxLongTaskMs: number;
  blockingMs: number;
  maxFrameGapMs: number;
  longTaskCount: number;
}
interface HostMetric {
  memory: { workingSetSize: number; privateBytes?: number };
}

/** Measure real main-process IO, first paint, long tasks and post-GC document retention. */
export async function measureOfficePreview(label: string, runs = 3): Promise<void> {
  const cdp = await connectBenchmark();
  const { send, evaluate, wait, errors } = cdp;
  const manifest = JSON.parse(readFileSync("temp/office-preview/corpus/manifest.json", "utf8")) as {
    files: Fixture[];
  };
  const selected = process.env.OFFICE_BENCH_CASES?.split(",");
  const files = manifest.files.filter((file) => !selected || selected.includes(file.file));
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const memory = async () => {
    await send("HeapProfiler.collectGarbage");
    const { metrics } = await send("Performance.getMetrics");
    const dom = await send("Memory.getDOMCounters");
    const host = await evaluate<HostMetric[]>("officeBenchmark.metrics()");
    return {
      heapMiB: (metrics?.find((entry) => entry.name === "JSHeapUsedSize")?.value ?? 0) / 1048576,
      documents: dom.documents,
      nodes: dom.nodes,
      listeners: dom.jsEventListeners,
      workingSetMiB: host.reduce((sum, entry) => sum + entry.memory.workingSetSize / 1024, 0),
      privateMiB: host.reduce((sum, entry) => sum + (entry.memory.privateBytes ?? 0) / 1024, 0),
    };
  };
  const result = {
    label,
    runs,
    environment: {} as object,
    samples: [] as object[],
    lifecycle: [] as object[],
    errors,
    failure: undefined as string | undefined,
  };
  try {
    await send("Runtime.enable");
    await send("Performance.enable");
    await wait("!!window.bench");
    await pause(150);
    result.environment = {
      platform: process.platform,
      versions: await evaluate("navigator.userAgent"),
      viewport: await evaluate("({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})"),
    };
    for (const file of files) {
      for (let iteration = 0; iteration < runs; iteration++) {
        await evaluate("bench.close()");
        await pause(100);
        const before = await memory();
        await evaluate(`bench.open(${JSON.stringify(file.file)})`);
        const state = await wait("bench.ready()");
        const timing = await evaluate<Timing>("bench.finish()");
        const snapshot = await evaluate("bench.snapshot()");
        const active = await memory();
        const correct = ["invalid", "encrypted", "tooLarge", "legacy"].includes(file.expected)
          ? state === "error"
          : await evaluate<boolean>(`bench.hasText(${JSON.stringify(file.expected)})`);
        let pageMs: number | null = null;
        if (state === "document" && (file.pages ?? 0) > 1) {
          const start = performance.now();
          await evaluate(
            "[...document.querySelectorAll('button')].find(button=>button.title.includes('前进')).click()",
          );
          await wait(
            "document.querySelector('iframe').contentDocument.getElementById('office-content').firstElementChild?.dataset.officePage === '2'",
          );
          pageMs = performance.now() - start;
        }
        await evaluate("bench.close()");
        await pause(100);
        const closed = await memory();
        result.samples.push({
          file: file.file,
          bytes: file.bytes,
          sha256: file.sha256,
          iteration,
          state,
          correct,
          ...timing,
          pageMs,
          before,
          active,
          closed,
          snapshot,
        });
        console.log(
          `${file.file} #${iteration + 1}: ${timing.elapsedMs.toFixed(0)}ms, main task ${timing.maxLongTaskMs.toFixed(0)}ms, nodes ${active.nodes}, correct=${correct}`,
        );
        await writeBenchmarkReport(label, result);
      }
    }
    for (let index = 0; index < 6; index++) {
      const file = index % 2 ? "grid-many-sheets.xlsx" : "word-long.docx";
      await evaluate(`bench.open(${JSON.stringify(file)})`);
      await wait("bench.ready()");
      await evaluate("bench.find('PERFORMANCE-1')");
      await pause(80);
      await evaluate("bench.close()");
      await pause(150);
      result.lifecycle.push({ file, ...(await memory()) });
    }
    if (errors.length) throw new Error(`Renderer errors: ${errors.join("\n")}`);
  } catch (error) {
    result.failure = String(error);
    throw error;
  } finally {
    await writeBenchmarkReport(label, result);
    cdp.close();
  }
}
