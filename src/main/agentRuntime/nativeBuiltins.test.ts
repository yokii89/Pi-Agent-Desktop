import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isSafePlanCommand } from "../../agentRuntime/builtins/planCommands";
import { DurableSessions, type DurableSessionUpdate } from "../../agentRuntime/durableSessions";
import { SessionExtensionHost } from "../../agentRuntime/extensions/sessionExtensionHost";
import {
  INTERACTION_LIFETIME_MS,
  type NativeStatePush,
  parseNativeQuestions,
  parseQuestionnaireReply,
} from "../../shared/nativeBuiltins";

const questions = [
  {
    header: "Storage",
    question: "Which storage should we use?",
    options: [
      { label: "SQLite", description: "Local database" },
      { label: "Files", description: "Plain files" },
    ],
    multiSelect: false,
  },
];
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "pidesk-native-interactions-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const models = createModels();
  const faux = fauxProvider({ models: [{ id: "native-test" }] });
  models.setProvider(faux.provider);
  const sessionId = randomUUID();
  const host = new SessionExtensionHost(sessionId, directory);
  await host.load([]);
  cleanup.push(() => host.dispose());
  const updates: DurableSessionUpdate[] = [];
  const pushes: NativeStatePush[] = [];
  let clockOffset = 0;
  const service = new DurableSessions(
    directory,
    () => ({
      models,
      registry: host.registry,
      now: () => Date.now() + clockOffset,
      env: () => new NodeExecutionEnv({ cwd: directory }),
    }),
    (update) => updates.push(update),
    (push) => pushes.push(push),
  );
  cleanup.push(() => service.dispose());
  const open = {
    sessionId,
    cwd: directory,
    agent: { model: { provider: faux.provider.id, modelId: faux.models[0].id } },
  };
  await service.open(open);
  const wait = (marker: string) =>
    vi.waitFor(() =>
      expect(
        updates.some(
          (update) =>
            update.type === "settled" && JSON.stringify(update.view.entries).includes(marker),
        ),
      ).toBe(true),
    );
  return {
    directory,
    service,
    sessionId,
    open,
    faux,
    wait,
    updates,
    pushes,
    elapse: (milliseconds: number) => {
      clockOffset += milliseconds;
    },
  };
}

describe("persistent built-in interactions", () => {
  it("restores a parked questionnaire, validates membership, and accepts one of concurrent answers", async () => {
    const f = await fixture();
    f.faux.appendResponses([
      fauxAssistantMessage(
        fauxToolCall("ask_user_question", { questions }, { id: "ask-storage" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("QUESTION_ANSWERED"),
    ]);
    await f.service.submit(f.sessionId, {
      type: "input",
      requestId: "ask",
      content: "Ask about storage",
    });
    await vi.waitFor(async () =>
      expect(Object.keys((await f.service.nativeState(f.sessionId)).questions)).toHaveLength(1),
    );
    const pending = Object.values((await f.service.nativeState(f.sessionId)).questions)[0];
    await vi.waitFor(() =>
      expect(f.pushes.at(-1)?.state.questions[String(pending.taskId)]).toEqual(pending),
    );
    expect((await f.service.snapshot(f.sessionId)).docs["pidesk.builtins"]).toBeUndefined();
    await f.service.close(f.sessionId);
    const count = f.faux.state.callCount;
    await f.service.open(f.open);
    expect(Object.values((await f.service.nativeState(f.sessionId)).questions)[0]).toEqual(pending);
    expect(f.faux.state.callCount).toBe(count);
    expect(f.pushes.at(-1)?.state.questions[String(pending.taskId)]).toEqual(pending);
    await expect(
      f.service.answerQuestionnaire(f.sessionId, pending.taskId, 1, {
        cancelled: false,
        answers: [{ selected: ["invalid"], text: "" }],
      }),
    ).rejects.toThrow("Invalid answer");
    const reply = { cancelled: false, answers: [{ selected: ["SQLite"], text: "Use encryption" }] };
    const results = await Promise.all([
      f.service.answerQuestionnaire(f.sessionId, pending.taskId, 1, reply),
      f.service.answerQuestionnaire(f.sessionId, pending.taskId, 1, reply),
    ]);
    expect(results.sort()).toEqual(["closed", "delivered"]);
    await f.wait("QUESTION_ANSWERED");
    const entries = JSON.stringify(await f.service.entries(f.sessionId));
    expect(entries).toContain("Use encryption");
    await vi.waitFor(() => expect(f.pushes.at(-1)?.state.questions).toEqual({}));
    expect(Object.keys((await f.service.nativeState(f.sessionId)).questions)).toHaveLength(0);
  });

  it("aborts a parked question and rejects stale replies without another model request", async () => {
    const f = await fixture();
    f.faux.appendResponses([
      fauxAssistantMessage(fauxToolCall("ask_user_question", { questions }), {
        stopReason: "toolUse",
      }),
    ]);
    await f.service.submit(f.sessionId, { type: "input", content: "Ask", requestId: "abort-ask" });
    await vi.waitFor(async () =>
      expect(Object.keys((await f.service.nativeState(f.sessionId)).questions)).toHaveLength(1),
    );
    const pending = Object.values((await f.service.nativeState(f.sessionId)).questions)[0];
    await f.service.abort(f.sessionId);
    expect((await f.service.nativeState(f.sessionId)).questions).toEqual({});
    expect(
      await f.service.answerQuestionnaire(f.sessionId, pending.taskId, 1, {
        cancelled: true,
        answers: [],
      }),
    ).toBe("closed");
    expect(f.faux.state.callCount).toBe(1);
  });

  it("gates writes, persists plan mode, restores review and executes only after a decision", async () => {
    const f = await fixture();
    const file = path.join(f.directory, "must-wait.txt");
    await f.service.setNativeMode(f.sessionId, "plan");
    f.faux.appendResponses([
      fauxAssistantMessage(
        fauxToolCall("write", { path: file, content: "too early" }, { id: "blocked-write" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        "Plan:\n1. Write the approved file.\n2. Verify the content.\n\n[PLAN READY]",
      ),
      fauxAssistantMessage(
        fauxToolCall("write", { path: file, content: "approved" }, { id: "approved-write" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("PLAN_EXECUTED"),
    ]);
    await f.service.submit(f.sessionId, {
      type: "input",
      content: "Prepare a plan",
      requestId: "plan",
    });
    await vi.waitFor(async () =>
      expect((await f.service.nativeState(f.sessionId)).plan).not.toBeNull(),
    );
    await expect(access(file)).rejects.toThrow();
    expect(JSON.stringify(await f.service.entries(f.sessionId))).toContain(
      "Plan mode permits read-only exploration",
    );
    const plan = (await f.service.nativeState(f.sessionId)).plan;
    expect(plan).not.toBeNull();
    await f.service.close(f.sessionId);
    await f.service.open(f.open);
    expect((await f.service.nativeState(f.sessionId)).mode).toBe("plan");
    expect((await f.service.nativeState(f.sessionId)).plan?.taskId).toBe(plan?.taskId);
    const decision = await f.service.answerPlan(f.sessionId, plan?.taskId as number, "execute");
    expect(JSON.stringify(decision)).toContain("execute");
    await f.wait("PLAN_EXECUTED");
    expect(await readFile(file, "utf8")).toBe("approved");
    const state = await f.service.nativeState(f.sessionId);
    expect(state.mode).toBe("edit");
    expect(state.plan).toBeNull();
    expect(await readFile(state.savedPlan, "utf8")).toContain("source: pidesk-plan");
  });

  it("delivers cancellation as a decision without approving an option", async () => {
    const f = await fixture();
    f.faux.appendResponses([
      fauxAssistantMessage(fauxToolCall("ask_user_question", { questions }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("CANCELLED_ANSWER"),
    ]);
    await f.service.submit(f.sessionId, { type: "input", content: "Ask" });
    await vi.waitFor(async () =>
      expect(Object.keys((await f.service.nativeState(f.sessionId)).questions)).toHaveLength(1),
    );
    const pending = Object.values((await f.service.nativeState(f.sessionId)).questions)[0];
    expect(
      await f.service.answerQuestionnaire(f.sessionId, pending.taskId, 2, {
        cancelled: true,
        answers: [],
      }),
    ).toBe("closed");
    expect(Object.keys((await f.service.nativeState(f.sessionId)).questions)).toHaveLength(1);
    expect(
      await f.service.answerQuestionnaire(f.sessionId, pending.taskId, 1, {
        cancelled: true,
        answers: [],
      }),
    ).toBe("delivered");
    await f.wait("CANCELLED_ANSWER");
    expect(JSON.stringify(await f.service.entries(f.sessionId))).toContain(
      "No decision was approved",
    );
  });

  it("rejects answers after their deadline and expires the parked tool on reopen", async () => {
    const f = await fixture();
    f.faux.appendResponses([
      fauxAssistantMessage(fauxToolCall("ask_user_question", { questions }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("QUESTION_EXPIRED"),
    ]);
    await f.service.submit(f.sessionId, { type: "input", content: "Ask" });
    await vi.waitFor(async () =>
      expect(Object.keys((await f.service.nativeState(f.sessionId)).questions)).toHaveLength(1),
    );
    const pending = Object.values((await f.service.nativeState(f.sessionId)).questions)[0];
    f.elapse(INTERACTION_LIFETIME_MS + 1);
    expect(
      await f.service.answerQuestionnaire(f.sessionId, pending.taskId, 1, {
        cancelled: false,
        answers: [{ selected: ["SQLite"], text: "TOO_LATE" }],
      }),
    ).toBe("closed");
    expect(f.faux.state.callCount).toBe(1);
    await f.service.close(f.sessionId);
    await f.service.open(f.open);
    await f.wait("QUESTION_EXPIRED");
    const entries = JSON.stringify(await f.service.entries(f.sessionId));
    expect(entries).toContain("expired without an answer");
    expect(entries).not.toContain("TOO_LATE");
    expect((await f.service.nativeState(f.sessionId)).questions).toEqual({});
  });

  it.each(["new", "explore", "save"] as const)(
    "settles %s without executing in the source conversation and deduplicates retries",
    async (action) => {
      const f = await fixture();
      await f.service.setNativeMode(f.sessionId, "plan");
      f.faux.appendResponses([
        fauxAssistantMessage("Plan:\n1. Implement only after review.\n\n[PLAN READY]"),
      ]);
      await f.service.submit(f.sessionId, { type: "input", content: "Plan" });
      await vi.waitFor(async () =>
        expect((await f.service.nativeState(f.sessionId)).plan).not.toBeNull(),
      );
      const plan = (await f.service.nativeState(f.sessionId)).plan;
      if (!plan) throw new Error("Expected a pending plan.");
      const result = await f.service.answerPlan(f.sessionId, plan.taskId, action);
      expect(result).toMatchObject({ status: "delivered", result: { action } });
      expect(await f.service.answerPlan(f.sessionId, plan.taskId, action)).toMatchObject({
        status: "duplicate",
        result: { action },
      });
      expect(await f.service.answerPlan(f.sessionId, plan.taskId, "execute")).toEqual({
        status: "closed",
      });
      const state = await f.service.nativeState(f.sessionId);
      expect(state.mode).toBe("plan");
      expect(state.plan).toBeNull();
      expect(f.faux.state.callCount).toBe(1);
      if (action === "explore") expect(state.savedPlan).toBe("");
      else expect(await readFile(state.savedPlan, "utf8")).toContain(plan.text);
      await f.service.close(f.sessionId);
      await f.service.open(f.open);
      expect(await f.service.answerPlan(f.sessionId, plan.taskId, action)).toMatchObject({
        status: "duplicate",
      });
      expect(f.faux.state.callCount).toBe(1);
    },
  );

  it("accepts only the first of conflicting review actions and leaves writes blocked", async () => {
    const f = await fixture();
    await f.service.setNativeMode(f.sessionId, "plan");
    f.faux.appendResponses([
      fauxAssistantMessage("Plan:\n1. Save before deciding to execute.\n\n[PLAN READY]"),
    ]);
    await f.service.submit(f.sessionId, { type: "input", content: "Plan" });
    await vi.waitFor(async () =>
      expect((await f.service.nativeState(f.sessionId)).plan).not.toBeNull(),
    );
    const plan = (await f.service.nativeState(f.sessionId)).plan;
    if (!plan) throw new Error("Expected a pending plan.");
    const [saved, rejected] = await Promise.all([
      f.service.answerPlan(f.sessionId, plan.taskId, "save"),
      f.service.answerPlan(f.sessionId, plan.taskId, "execute"),
    ]);
    expect(saved).toMatchObject({ status: "delivered", result: { action: "save" } });
    expect(rejected).toEqual({ status: "closed" });
    expect((await f.service.nativeState(f.sessionId)).mode).toBe("plan");
    expect(f.faux.state.callCount).toBe(1);
  });

  it("reports artifact failures and clears the review without overwriting user edits", async () => {
    const f = await fixture();
    await f.service.setNativeMode(f.sessionId, "plan");
    f.faux.appendResponses([
      fauxAssistantMessage("Plan:\n1. Protect an existing plan artifact.\n\n[PLAN READY]"),
    ]);
    await f.service.submit(f.sessionId, { type: "input", content: "Plan" });
    await vi.waitFor(async () =>
      expect((await f.service.nativeState(f.sessionId)).plan).not.toBeNull(),
    );
    const plan = (await f.service.nativeState(f.sessionId)).plan;
    if (!plan) throw new Error("Expected a pending plan.");
    const directory = path.join(f.directory, ".pidesk", "artifacts", "plans");
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, `plan-${plan.taskId}-${plan.fingerprint.slice(0, 16)}.md`);
    await writeFile(file, "USER_EDITED");
    await expect(f.service.answerPlan(f.sessionId, plan.taskId, "execute")).rejects.toThrow(
      "could not complete",
    );
    expect(await readFile(file, "utf8")).toBe("USER_EDITED");
    expect(await f.service.nativeState(f.sessionId)).toMatchObject({
      mode: "plan",
      plan: null,
      lastPlan: "",
      savedPlan: "",
    });
    expect(f.faux.state.callCount).toBe(1);
  });

  it("expires plan review without granting edit access or saving an artifact", async () => {
    const f = await fixture();
    await f.service.setNativeMode(f.sessionId, "plan");
    f.faux.appendResponses([
      fauxAssistantMessage("Plan:\n1. Wait for execution approval.\n\n[PLAN READY]"),
    ]);
    await f.service.submit(f.sessionId, { type: "input", content: "Plan" });
    await vi.waitFor(async () =>
      expect((await f.service.nativeState(f.sessionId)).plan).not.toBeNull(),
    );
    const plan = (await f.service.nativeState(f.sessionId)).plan;
    if (!plan) throw new Error("Expected a pending plan.");
    f.elapse(INTERACTION_LIFETIME_MS + 1);
    expect(await f.service.answerPlan(f.sessionId, plan.taskId, "execute")).toEqual({
      status: "closed",
    });
    await f.service.close(f.sessionId);
    await f.service.open(f.open);
    await vi.waitFor(async () =>
      expect((await f.service.snapshot(f.sessionId)).docs["pi.live"]?.run).toBeUndefined(),
    );
    expect(await f.service.nativeState(f.sessionId)).toMatchObject({
      mode: "plan",
      plan: null,
      savedPlan: "",
    });
    expect(f.faux.state.callCount).toBe(1);
  });

  it("deduplicates a local /plan toggle across retries and rejects a mode change during work", async () => {
    const f = await fixture();
    await f.service.planCommand(f.sessionId, "toggle", "/plan");
    await f.service.planCommand(f.sessionId, "toggle", "/plan");
    expect((await f.service.nativeState(f.sessionId)).mode).toBe("plan");
    expect(f.faux.state.callCount).toBe(0);
    f.faux.appendResponses([
      fauxAssistantMessage(fauxToolCall("ask_user_question", { questions }), {
        stopReason: "toolUse",
      }),
    ]);
    await f.service.submit(f.sessionId, { type: "input", content: "Ask", requestId: "busy" });
    await vi.waitFor(async () =>
      expect(Object.keys((await f.service.nativeState(f.sessionId)).questions)).toHaveLength(1),
    );
    await expect(f.service.setNativeMode(f.sessionId, "edit")).rejects.toThrow("settle");
    await f.service.abort(f.sessionId);
  });
});

describe("native form and plan boundaries", () => {
  it("rejects reserved labels, excessive selections and empty answers, but accepts free text", () => {
    expect(parseNativeQuestions(questions)).toEqual(questions);
    expect(
      parseNativeQuestions([
        {
          ...questions[0],
          options: [{ label: "Other", description: "" }, questions[0].options[0]],
        },
      ]),
    ).toBeNull();
    expect(
      parseNativeQuestions([
        {
          ...questions[0],
          options: [{ label: " SQLite ", description: "" }, questions[0].options[0]],
        },
      ]),
    ).toBeNull();
    expect(
      parseQuestionnaireReply(
        { cancelled: true, answers: [{ selected: ["SQLite"], text: "" }] },
        questions,
      ),
    ).toBeNull();
    expect(
      parseQuestionnaireReply(
        { cancelled: false, answers: [{ selected: ["SQLite", "Files"], text: "" }] },
        questions,
      ),
    ).toBeNull();
    expect(
      parseQuestionnaireReply(
        { cancelled: false, answers: [{ selected: [], text: "" }] },
        questions,
      ),
    ).toBeNull();
    expect(
      parseQuestionnaireReply(
        { cancelled: false, answers: [{ selected: [], text: "custom" }] },
        questions,
      )?.answers[0].text,
    ).toBe("custom");
  });
  it.each([
    "ls && rm file",
    "echo $(touch file)",
    "rg --pre=evil pattern",
    "sort --output=file data",
    "cat file > other",
    "find . -exec touch file ;",
    "bash -c evil",
    "rg x || rm file",
    "tail -f file",
    "uniq input output",
    "file --compile magic",
    "tree -ooutput",
    "sort --compress-prog=evil data",
  ])("blocks shell mutation or evaluation: %s", (command) =>
    expect(isSafePlanCommand(command)).toBe(false),
  );
  it.each(["pwd", "ls -la", "rg -n 'hello world' src", "cat file | head -n 20"])(
    "allows read-only shell segments: %s",
    (command) => expect(isSafePlanCommand(command)).toBe(true),
  );
});
