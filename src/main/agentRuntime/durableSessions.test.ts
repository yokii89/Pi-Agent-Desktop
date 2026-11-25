import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import type { SubmissionId } from "@earendil-works/pi-durable";
import {
  createRegistry,
  defineExtension,
  defineTask,
  GenerationTask,
  hook,
  hookTask,
} from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it } from "vitest";
import { DurableSessions, type DurableSessionUpdate } from "../../agentRuntime/durableSessions";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "pidesk-session-test-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const models = createModels();
  const faux = fauxProvider();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  const updates: DurableSessionUpdate[] = [];
  const service = new DurableSessions(
    directory,
    () => ({ models, registry }),
    (update) => updates.push(update),
  );
  cleanups.push(() => service.dispose());
  const sessionId = randomUUID();
  const request = {
    sessionId,
    cwd: directory,
    agent: { model: { provider: faux.provider.id, modelId: faux.models[0].id } },
  };
  return { directory, models, faux, registry, updates, service, sessionId, request };
}

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for Durable session state.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function latch() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("Durable session ownership and persistence", () => {
  it("shares concurrent opens, deduplicates admissions across reopen, and hydrates without replaying entries", async () => {
    const f = await fixture();
    f.faux.setResponses([fauxAssistantMessage("one answer")]);
    const [a, b] = await Promise.all([f.service.open(f.request), f.service.open(f.request)]);
    expect(a).toEqual(b);
    expect(f.updates.filter((u) => u.type === "snapshot")).toHaveLength(1);
    const draft = { type: "input", content: "hello", requestId: "once" } as const;
    const [first, duplicate] = await Promise.all([
      f.service.submit(f.sessionId, draft),
      f.service.submit(f.sessionId, draft),
    ]);
    expect(first).toEqual(duplicate);
    await until(
      async () =>
        (await f.service.submission(f.sessionId, first.submissionId as SubmissionId))?.status ===
        "done",
    );
    await until(() => f.updates.some((u) => u.type === "settled" && !u.view.docs["pi.live"]?.run));
    await f.service.close(f.sessionId);
    f.updates.length = 0;
    expect(await f.service.open(f.request)).toEqual(a);
    expect(await f.service.submit(f.sessionId, draft)).toEqual(first);
    expect(f.faux.state.callCount).toBe(1);
    const history = await f.service.entries(f.sessionId);
    expect(history.filter((e) => e.kind === "pi.user")).toHaveLength(1);
    expect(history.filter((e) => e.kind === "pi.assistant")).toHaveLength(1);
    expect(f.updates.filter((u) => u.type === "entries")).toHaveLength(0);
  });

  it("withdraws only the queued input, then aborts foreground work without closing the session", async () => {
    const f = await fixture();
    const held = latch();
    cleanups.push(async () => held.release());
    f.faux.setResponses([
      async () => {
        await held.promise;
        return fauxAssistantMessage("late");
      },
    ]);
    await f.service.open(f.request);
    const active = await f.service.submit(f.sessionId, { type: "input", content: "active" });
    await until(() => f.faux.state.callCount === 1);
    const queued = await f.service.submit(f.sessionId, {
      type: "input",
      content: "queued",
      whenBusy: "followUp",
    });
    expect(await f.service.withdraw(f.sessionId, queued.submissionId as SubmissionId)).toBe(
      "aborted",
    );
    expect(
      (await f.service.submission(f.sessionId, active.submissionId as SubmissionId))?.status,
    ).toBe("placed");
    held.release();
    await f.service.abort(f.sessionId);
    expect(
      (await f.service.submission(f.sessionId, queued.submissionId as SubmissionId))?.status,
    ).toBe("unanswered");
    f.faux.appendResponses([fauxAssistantMessage("next")]);
    const next = await f.service.submit(f.sessionId, { type: "input", content: "next" });
    await until(
      async () =>
        (await f.service.submission(f.sessionId, next.submissionId as SubmissionId))?.status ===
        "done",
    );
  });

  it("does not settle an answered submission while afterRun tasks are still running", async () => {
    const f = await fixture();
    const held = latch();
    cleanups.push(async () => held.release());
    const After = defineTask<null, { phase: "finish" }, null>({
      name: "test.after",
      version: 1,
      initial: () => ({ phase: "finish" }),
      phases: {
        finish: async (_task, runtime, context) => {
          await held.promise;
          await runtime.commit(
            () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
            context,
          );
        },
      },
      abort: (_task, runtime, context) =>
        runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
    });
    f.registry.install(
      defineExtension({
        name: "test-after",
        tasks: [After],
        hooks: [hook(GenerationTask, { afterRun: () => ({ tasks: [hookTask(After, null)] }) })],
      }),
    );
    f.faux.setResponses([fauxAssistantMessage("answer before afterRun")]);
    await f.service.open(f.request);
    const submitted = await f.service.submit(f.sessionId, { type: "input", content: "hello" });
    await until(
      async () =>
        (await f.service.submission(f.sessionId, submitted.submissionId as SubmissionId))
          ?.status === "done",
    );
    await until(() => f.updates.some((u) => u.type === "live" && !!u.view.docs["pi.live"]?.run));
    expect(
      f.updates.filter(
        (u) => u.type === "settled" && u.view.entries.some((e) => e.kind === "pi.assistant"),
      ),
    ).toHaveLength(0);
    expect(await f.service.closeIdle(f.sessionId)).toBe(false);
    held.release();
    await until(() =>
      f.updates.some(
        (u) => u.type === "settled" && u.view.entries.some((e) => e.kind === "pi.assistant"),
      ),
    );
    expect(await f.service.closeIdle(f.sessionId)).toBe(true);
  });

  it("closes admissions immediately, drains pending opens and writes, and keeps committed data", async () => {
    const f = await fixture();
    const opening = f.service.open(f.request);
    const write = f.service.submit(f.sessionId, {
      type: "write",
      requestId: "notice",
      entry: { kind: "test.notice", data: "saved" },
    });
    const closing = f.service.close(f.sessionId);
    await expect(f.service.open(f.request)).rejects.toThrow(/closing/);
    await expect(
      f.service.submit(f.sessionId, { type: "input", content: "too late" }),
    ).rejects.toThrow(/not open/);
    await Promise.all([opening, write, closing]);
    await f.service.open(f.request);
    expect((await f.service.entries(f.sessionId)).some((e) => e.kind === "test.notice")).toBe(true);
    await f.service.dispose();
    await expect(f.service.open(f.request)).rejects.toThrow(/closing/);
  });

  it("rejects a second writer, validates persisted cwd, and isolates two sessions", async () => {
    const f = await fixture();
    await f.service.open(f.request);
    const other = new DurableSessions(
      f.directory,
      () => ({ models: f.models, registry: f.registry }),
      () => {},
    );
    cleanups.push(() => other.dispose());
    await expect(other.open(f.request)).rejects.toThrow(/writer/);
    const secondId = randomUUID();
    await f.service.open({ ...f.request, sessionId: secondId });
    await f.service.submit(secondId, { type: "write", entry: { kind: "test.second" } });
    expect(await f.service.entries(f.sessionId)).toHaveLength(0);
    expect(await f.service.entries(secondId)).toHaveLength(1);
    await f.service.close(f.sessionId);
    await expect(f.service.open({ ...f.request, cwd: path.dirname(f.directory) })).rejects.toThrow(
      /another cwd/,
    );
    await f.service.open(f.request);
    await expect(
      f.service.configure(f.sessionId, { cwd: path.dirname(f.directory) }),
    ).rejects.toThrow(/cwd/);
  });

  it("pages complete history and emits each saved entry exactly once even after watch windows overflow", async () => {
    const f = await fixture();
    await f.service.open(f.request);
    await Promise.all(
      Array.from({ length: 235 }, (_, index) =>
        f.service.submit(f.sessionId, {
          type: "write",
          entry: { kind: "test.notice", data: index },
        }),
      ),
    );
    await until(
      () => f.updates.filter((u) => u.type === "entries").flatMap((u) => u.entries).length === 235,
    );
    const emitted = f.updates.filter((u) => u.type === "entries").flatMap((u) => u.entries);
    expect(new Set(emitted.map((e) => e.id)).size).toBe(235);
    const newest = await f.service.entries(f.sessionId);
    const middle = await f.service.entries(f.sessionId, newest.at(-1)?.id);
    const oldest = await f.service.entries(f.sessionId, middle.at(-1)?.id);
    expect([...oldest, ...middle, ...newest]).toHaveLength(235);
    expect(new Set([...oldest, ...middle, ...newest].map((e) => e.id)).size).toBe(235);
    await expect(f.service.entries(f.sessionId, undefined, 101)).rejects.toThrow(/page size/);
  });

  it("retains the active run's settlement observer after a rejected busy admission", async () => {
    const f = await fixture();
    const held = latch();
    cleanups.push(async () => held.release());
    f.faux.setResponses([
      async () => {
        await held.promise;
        return fauxAssistantMessage("saved");
      },
    ]);
    await f.service.open(f.request);
    await f.service.submit(f.sessionId, { type: "input", content: "active" });
    await until(() => f.faux.state.callCount === 1);
    await expect(
      f.service.submit(f.sessionId, { type: "input", content: "reject", whenBusy: "reject" }),
    ).rejects.toThrow();
    f.updates.length = 0;
    held.release();
    await until(() =>
      f.updates.some(
        (u) => u.type === "settled" && u.view.entries.some((e) => e.kind === "pi.assistant"),
      ),
    );
    expect((await f.service.entries(f.sessionId)).filter((e) => e.kind === "pi.user")).toHaveLength(
      1,
    );
  });

  it("resumes persisted sleeping afterRun work after close and reopen without another model input", async () => {
    const f = await fixture();
    let sleeping = false;
    let finished = 0;
    let hooks = 0;
    const After = defineTask<{ at: number }, { phase: "wait" } | { phase: "finish" }, null>({
      name: "test.resume",
      version: 1,
      initial: () => ({ phase: "wait" }),
      phases: {
        wait: async (task, runtime, context) => {
          await runtime.sleepUntil(task.input.at, { phase: "finish" }, context);
          sleeping = true;
        },
        finish: async (_task, runtime, context) => {
          await runtime.commit(
            () => ({ status: "terminal", outcome: { status: "completed", result: null } }),
            context,
          );
          ++finished;
        },
      },
      abort: (_task, runtime, context) =>
        runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
    });
    f.registry.install(
      defineExtension({
        name: "test-resume",
        tasks: [After],
        hooks: [
          hook(GenerationTask, {
            afterRun: () => {
              ++hooks;
              return { tasks: [hookTask(After, { at: Date.now() + 500 })] };
            },
          }),
        ],
      }),
    );
    f.faux.setResponses([fauxAssistantMessage("answer")]);
    await f.service.open(f.request);
    const submission = await f.service.submit(f.sessionId, {
      type: "input",
      content: "hello",
      requestId: "resume",
    });
    await until(() => sleeping);
    await f.service.close(f.sessionId);
    expect(finished).toBe(0);
    f.updates.length = 0;
    await f.service.open(f.request);
    await until(() => finished === 1 && f.updates.some((u) => u.type === "settled"));
    expect(hooks).toBe(1);
    expect(f.faux.state.callCount).toBe(1);
    expect(
      (await f.service.submission(f.sessionId, submission.submissionId as SubmissionId))?.status,
    ).toBe("done");
    expect((await f.service.entries(f.sessionId)).filter((e) => e.kind === "pi.user")).toHaveLength(
      1,
    );
  });

  it("rejects path-shaped session IDs and relative storage or cwd", async () => {
    const f = await fixture();
    await expect(f.service.open({ ...f.request, sessionId: "../outside" })).rejects.toThrow(
      /session ID/,
    );
    await expect(f.service.open({ ...f.request, cwd: "relative" })).rejects.toThrow(/absolute/);
    expect(
      () =>
        new DurableSessions(
          "relative",
          () => ({ models: f.models, registry: f.registry }),
          () => {},
        ),
    ).toThrow(/absolute/);
  });
});
