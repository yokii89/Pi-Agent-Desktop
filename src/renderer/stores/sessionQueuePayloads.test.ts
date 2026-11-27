import { describe, expect, it, vi } from "vitest";
import type { PiQueuedMessages, PromptDisposition, QueueIntent } from "../../shared/ipc";
import { toPiImageContent } from "../utils/imageAttach";
import {
  type ComposerDraftContent,
  ComposerDraftStore,
  snapshotComposerDraft,
} from "./composerDrafts";
import { convertQueueItem, moveQueueItem, removeQueueItem } from "./sessionBuckets";
import {
  type QueuedMessage,
  restoreQueuedMessages,
  SessionQueuePayloads,
  withQueueIntent,
} from "./sessionQueuePayloads";

const EMPTY: PiQueuedMessages = { steering: [], followUp: [] };

function message(
  intent: QueueIntent,
  id = "first",
  text = "看这张图",
): QueuedMessage & { draft: ComposerDraftContent } {
  const image = {
    id,
    name: `${id}.png`,
    mimeType: "image/png",
    width: 10,
    height: 20,
    byteLength: 1,
    data: "AA==",
    previewUrl: "data:image/png;base64,AA==",
    hint: "original metadata",
  };
  const draft: ComposerDraftContent = {
    content: [
      ...(intent === "steer" ? [{ kind: "slash" as const, name: "steer" }] : []),
      { kind: "text", text },
      { kind: "file", path: "C:/project/src/index.ts" },
      { kind: "slash", name: "skill:review" },
      { kind: "element", id: "browser-element" },
    ],
    fileMentions: [{ path: "C:/project/src/index.ts", displayPath: "src/index.ts" }],
    imageAttachments: [image],
    fileAttachments: [
      {
        id: "notes",
        name: "notes.pdf",
        path: "C:/project/notes.pdf",
        displayPath: "notes.pdf",
        kind: "file",
      },
      {
        id: "folder",
        name: "docs",
        path: "C:/project/docs",
        displayPath: "docs",
        kind: "dir",
      },
    ],
    chatElements: [
      {
        id: "browser-element",
        kind: "element",
        url: "http://localhost:3000",
        at: 1,
        tag: "div",
        selector: "#target",
        label: "target",
        outerHTML: '<div id="target">Example</div>',
        textSummary: "Example",
        a11y: null,
        rect: null,
        viewport: { width: 800, height: 600 },
        styles: "",
        screenshot: null,
        attached: true,
        stale: false,
      },
    ],
  };
  return {
    text,
    intent,
    images: [toPiImageContent(image)],
    displayImages: [{ src: image.previewUrl, mimeType: image.mimeType, name: image.name }],
    draft: snapshotComposerDraft(draft),
  };
}

async function enqueue(
  queue: SessionQueuePayloads,
  item: QueuedMessage,
  snapshot: PiQueuedMessages,
  id = "session-a",
): Promise<void> {
  await queue.submit(id, item, async () => {
    queue.update(id, snapshot);
    return "queued";
  });
}

function clear(queue: SessionQueuePayloads, snapshot: PiQueuedMessages, id = "session-a") {
  queue.beginClear(id);
  queue.update(id, EMPTY);
  return queue.finishClear(id, snapshot);
}

describe("queued message payload recovery", () => {
  it.each<QueueIntent>(["steer", "followUp"])(
    "restores the full editable %s draft after pi accepts and the composer clears",
    async (intent) => {
      const queue = new SessionQueuePayloads();
      const drafts = new ComposerDraftStore();
      const draft = drafts.bind("session:a");
      const original = message(intent);
      const content = original.draft;
      draft.update((current) => ({ ...current, ...content }));
      const snapshot = {
        steering: intent === "steer" ? [original.text] : [],
        followUp: intent === "followUp" ? [original.text] : [],
      };
      expect(
        await draft.submit(() =>
          queue.submit("session-a", original, async () => {
            queue.update("session-a", snapshot);
            return "queued";
          }),
        ),
      ).toBe(true);
      expect(draft.getSnapshot().imageAttachments).toEqual([]);
      const recovered = clear(queue, snapshot);
      const target = removeQueueItem(recovered, intent, 0, original.text);
      expect(target).not.toBeNull();
      restoreQueuedMessages(draft, target ? [target.removed] : []);
      expect(snapshotComposerDraft(draft.getSnapshot())).toEqual(content);
      expect(draft.getSnapshot().sending).toBe(false);
      expect(draft.takeEdits()).toEqual([{ kind: "focus", text: "" }]);
      expect(draft.takeEdits()).toEqual([]);
    },
  );

  it("recovers an image-only message with an empty queue text", async () => {
    const queue = new SessionQueuePayloads();
    const original = message("followUp", "only-image", "");
    original.draft = {
      ...original.draft,
      content: [],
      fileMentions: [],
      fileAttachments: [],
      chatElements: [],
    };
    await enqueue(queue, original, { steering: [], followUp: [""] });
    const recovered = clear(queue, { steering: [], followUp: [""] });
    const removed = removeQueueItem(recovered, "followUp", 0, "");
    const draft = new ComposerDraftStore().bind("session:a");
    restoreQueuedMessages(draft, removed ? [removed.removed] : []);
    expect(draft.getSnapshot().content).toEqual([]);
    expect(draft.getSnapshot().imageAttachments).toEqual(original.draft.imageAttachments);
  });

  it("preserves distinct attachments for duplicate texts and FIFO delivery", async () => {
    const queue = new SessionQueuePayloads();
    const first = message("followUp", "first");
    const second = message("followUp", "second");
    await enqueue(queue, first, { steering: [], followUp: [first.text] });
    await enqueue(queue, second, { steering: [], followUp: [first.text, second.text] });
    expect(queue.update("session-a", { steering: [], followUp: [second.text] })).toEqual([first]);
    expect(queue.update("session-a", { steering: [], followUp: [second.text] })).toEqual([]);
    const recovered = clear(queue, { steering: [], followUp: [second.text] });
    expect(recovered.followUp).toEqual([second]);
  });

  it("keeps the unedited messages' images through reordering and conversion", async () => {
    const queue = new SessionQueuePayloads();
    const first = message("followUp", "first", "first");
    const second = message("followUp", "second", "second");
    const third = message("followUp", "third", "third");
    await enqueue(queue, first, { steering: [], followUp: ["first"] });
    await enqueue(queue, second, { steering: [], followUp: ["first", "second"] });
    await enqueue(queue, third, { steering: [], followUp: ["first", "second", "third"] });
    const taken = removeQueueItem(
      clear(queue, { steering: [], followUp: ["first", "second", "third"] }),
      "followUp",
      0,
      "first",
    );
    expect(taken?.removed.draft).toEqual(first.draft);
    const moved = taken && moveQueueItem(taken, "followUp", 0, 1, "second");
    const converted = moved && convertQueueItem(moved, "followUp", 0, "third");
    expect(converted).not.toBeNull();
    if (!converted) throw new Error("Queue conversion failed");
    const prompts = vi.fn(async (item: QueuedMessage, snapshot: PiQueuedMessages) => {
      await enqueue(queue, item, snapshot);
    });
    await prompts(withQueueIntent(converted.steering[0], "steer"), {
      steering: ["third"],
      followUp: [],
    });
    await prompts(withQueueIntent(converted.followUp[0], "followUp"), {
      steering: ["third"],
      followUp: ["second"],
    });
    expect(prompts.mock.calls.map(([item]) => item.images)).toEqual([third.images, second.images]);
    const recovered = clear(queue, { steering: ["third"], followUp: ["second"] });
    expect(recovered.steering[0].draft?.imageAttachments).toEqual(third.draft?.imageAttachments);
    expect(recovered.steering[0].draft?.content[0]).toEqual({ kind: "text", text: "/steer " });
    expect(recovered.followUp[0].draft).toEqual(second.draft);
  });

  it("returns all queued attachments to the owning draft without replacing a newer draft", async () => {
    const queue = new SessionQueuePayloads();
    const drafts = new ComposerDraftStore();
    const a = drafts.bind("session:a");
    const b = drafts.bind("session:b");
    const current = message("followUp", "current", "new draft").draft;
    a.update((draft) => ({ ...draft, ...current }));
    const other = b.getSnapshot();
    const steer = message("steer", "steer", "interrupt");
    const followUp = message("followUp", "follow", "later");
    await enqueue(queue, steer, { steering: [steer.text], followUp: [] });
    await enqueue(queue, followUp, { steering: [steer.text], followUp: [followUp.text] });
    const recovered = clear(queue, { steering: [steer.text], followUp: [followUp.text] });
    restoreQueuedMessages(a, [...recovered.steering, ...recovered.followUp]);
    expect(a.getSnapshot().imageAttachments.map((image) => image.id)).toEqual([
      "current",
      "steer",
      "follow",
    ]);
    expect(a.getSnapshot().fileAttachments).toEqual(current.fileAttachments);
    expect(a.getSnapshot().fileMentions).toEqual(current.fileMentions);
    expect(a.getSnapshot().content[0]).toEqual(current.content[0]);
    expect(b.getSnapshot()).toBe(other);
  });

  it("excludes messages delivered during clear and preserves a newer identical message", async () => {
    const queue = new SessionQueuePayloads();
    const first = message("followUp", "first");
    const second = message("followUp", "second");
    const newer = message("followUp", "newer");
    await enqueue(queue, first, { steering: [], followUp: [first.text] });
    await enqueue(queue, second, { steering: [], followUp: [first.text, second.text] });
    queue.beginClear("session-a");
    queue.update("session-a", { steering: [], followUp: [second.text] });
    queue.update("session-a", EMPTY);
    await enqueue(queue, newer, { steering: [], followUp: [newer.text] });
    expect(
      queue.finishClear("session-a", { steering: [], followUp: [second.text] }).followUp,
    ).toEqual([second]);
    expect(clear(queue, { steering: [], followUp: [newer.text] }).followUp).toEqual([newer]);
  });

  it("handles a queued receipt before its event and a clear receipt before its empty event", async () => {
    const queue = new SessionQueuePayloads();
    const original = message("followUp");
    await queue.submit("session-a", original, async () => "queued");
    queue.update("session-a", { steering: [], followUp: [original.text] });
    queue.beginClear("session-a");
    expect(
      queue.finishClear("session-a", { steering: [], followUp: [original.text] }).followUp,
    ).toEqual([original]);
    expect(queue.update("session-a", EMPTY)).toEqual([]);
  });

  it.each(["started", "handled", "failed"])(
    "does not attach a %s prompt to a later queue item",
    async (result) => {
      const queue = new SessionQueuePayloads();
      const original = message("followUp");
      const submitted = queue.submit("session-a", original, async () => {
        if (result === "failed") throw new Error("send failed");
        return result as "started" | "handled";
      });
      if (result === "failed") await expect(submitted).rejects.toThrow("send failed");
      else await submitted;
      queue.update("session-a", { steering: [], followUp: [original.text] });
      expect(
        clear(queue, { steering: [], followUp: [original.text] }).followUp[0].draft,
      ).toBeUndefined();
    },
  );

  it("retains the source draft when pi expands a slash skill before queueing", async () => {
    const queue = new SessionQueuePayloads();
    const original = message("followUp", "skill", "/skill:review");
    await enqueue(queue, original, { steering: [], followUp: ["expanded skill prompt"] });
    const recovered = clear(queue, { steering: [], followUp: ["expanded skill prompt"] });
    expect(recovered.followUp[0]).toEqual({ ...original, text: "expanded skill prompt" });
  });

  it("isolates sessions and releases payloads when their process exits", async () => {
    const queue = new SessionQueuePayloads();
    const a = message("followUp", "a");
    const b = message("followUp", "b");
    await enqueue(queue, a, { steering: [], followUp: [a.text] });
    await enqueue(queue, b, { steering: [], followUp: [b.text] }, "session-b");
    queue.delete("session-a");
    queue.update("session-a", { steering: [], followUp: [a.text] });
    expect(clear(queue, { steering: [], followUp: [a.text] }).followUp[0].draft).toBeUndefined();
    expect(clear(queue, { steering: [], followUp: [b.text] }, "session-b").followUp).toEqual([b]);
  });

  it("restores original bytes for image sends without a composer snapshot", () => {
    const draft = new ComposerDraftStore().bind("session:a");
    restoreQueuedMessages(draft, [
      {
        text: "",
        intent: "followUp",
        images: [{ type: "image", data: "AA==", mimeType: "image/png" }],
      },
    ]);
    expect(draft.getSnapshot().imageAttachments.map(toPiImageContent)).toEqual([
      { type: "image", data: "AA==", mimeType: "image/png" },
    ]);
  });

  it("restores pending queue payloads exactly once when the process exits", async () => {
    const queue = new SessionQueuePayloads();
    const drafts = new ComposerDraftStore();
    const owner = drafts.bind("session:a");
    const other = drafts.bind("session:b").getSnapshot();
    const first = message("steer", "first", "first");
    const second = message("followUp", "second", "second");
    await enqueue(queue, first, { steering: [first.text], followUp: [] });
    await enqueue(queue, second, { steering: [first.text], followUp: [second.text] });
    restoreQueuedMessages(owner, queue.release("session-a"));
    expect(owner.getSnapshot().imageAttachments.map((image) => image.id)).toEqual([
      "first",
      "second",
    ]);
    expect(queue.release("session-a")).toEqual([]);
    expect(drafts.get("session:b")).toBe(other);
  });

  it("retains a queued receipt when the process exits before its queue event", async () => {
    const queue = new SessionQueuePayloads();
    const original = message("followUp");
    await queue.submit("session-a", original, async () => "queued");
    expect(queue.release("session-a")).toEqual([original]);
  });

  it("keeps the original input when exit arrives before the queued receipt", async () => {
    const queue = new SessionQueuePayloads();
    const draft = new ComposerDraftStore().bind("session:a");
    const original = message("followUp");
    draft.update((current) => ({ ...current, ...original.draft }));
    let resolve!: (value: PromptDisposition) => void;
    const receipt = new Promise<PromptDisposition>((done) => {
      resolve = done;
    });
    const sending = draft.submit(() =>
      queue.submit("session-a", original, () => receipt).catch(() => null),
    );
    queue.update("session-a", { steering: [], followUp: [original.text] });
    restoreQueuedMessages(draft, queue.release("session-a"));
    restoreQueuedMessages(draft, [original]);
    resolve("queued");
    expect(await sending).toBe(false);
    expect(snapshotComposerDraft(draft.getSnapshot())).toEqual(original.draft);
    expect(draft.getSnapshot().sending).toBe(false);
    expect(draft.takeEdits()).toEqual([{ kind: "focus", text: "" }]);
  });

  it("preserves the unsent draft when the process exits without any queue event", async () => {
    const queue = new SessionQueuePayloads();
    const draft = new ComposerDraftStore().bind("session:a");
    const original = message("followUp");
    draft.update((current) => ({ ...current, ...original.draft }));
    let resolve!: (value: PromptDisposition) => void;
    const receipt = new Promise<PromptDisposition>((done) => {
      resolve = done;
    });
    const sending = draft.submit(() =>
      queue.submit("session-a", original, () => receipt).catch(() => null),
    );
    expect(queue.release("session-a")).toEqual([]);
    resolve("queued");
    expect(await sending).toBe(false);
    expect(snapshotComposerDraft(draft.getSnapshot())).toEqual(original.draft);
  });

  it("returns suppressed delivery with its images when clear fails before an empty snapshot", async () => {
    const queue = new SessionQueuePayloads();
    const first = message("followUp", "first", "first");
    const second = message("followUp", "second", "second");
    await enqueue(queue, first, { steering: [], followUp: [first.text] });
    await enqueue(queue, second, { steering: [], followUp: [first.text, second.text] });
    queue.beginClear("session-a");
    queue.update("session-a", { steering: [], followUp: [second.text] });
    expect(queue.cancelClear("session-a")).toEqual({ delivered: [first], recovered: [] });
    expect(queue.cancelClear("session-a")).toEqual({ delivered: [], recovered: [] });
    expect(queue.update("session-a", { steering: [], followUp: [second.text] })).toEqual([]);
    expect(clear(queue, { steering: [], followUp: [second.text] }).followUp).toEqual([second]);
  });

  it("keeps unconfirmed clear results in the draft and preserves newly queued messages", async () => {
    const queue = new SessionQueuePayloads();
    const first = message("followUp", "first");
    const newer = message("followUp", "newer");
    await enqueue(queue, first, { steering: [], followUp: [first.text] });
    queue.beginClear("session-a");
    queue.update("session-a", EMPTY);
    await enqueue(queue, newer, { steering: [], followUp: [newer.text] });
    const failed = queue.cancelClear("session-a");
    expect(failed).toEqual({ delivered: [], recovered: [first] });
    const draft = new ComposerDraftStore().bind("session:a");
    restoreQueuedMessages(draft, failed.recovered);
    expect(draft.getSnapshot().imageAttachments).toEqual(first.draft.imageAttachments);
    expect(clear(queue, { steering: [], followUp: [newer.text] }).followUp).toEqual([newer]);
  });

  it("recovers clear archives on exit without recreating them from a late clear receipt", async () => {
    const queue = new SessionQueuePayloads();
    const original = message("followUp");
    await enqueue(queue, original, { steering: [], followUp: [original.text] });
    queue.beginClear("session-a");
    queue.update("session-a", EMPTY);
    expect(queue.release("session-a")).toEqual([original]);
    expect(() =>
      queue.finishClear("session-a", { steering: [], followUp: [original.text] }),
    ).toThrow();
    expect(queue.cancelClear("session-a")).toEqual({ delivered: [], recovered: [] });
    expect(queue.release("session-a")).toEqual([]);
  });

  it("deduplicates recovery when exit and a failed requeue return the same payload", async () => {
    const queue = new SessionQueuePayloads();
    const first = message("followUp", "first", "first");
    const second = message("followUp", "second", "second");
    await enqueue(queue, first, { steering: [], followUp: [first.text] });
    await enqueue(queue, second, { steering: [], followUp: [first.text, second.text] });
    const removed = removeQueueItem(
      clear(queue, { steering: [], followUp: [first.text, second.text] }),
      "followUp",
      0,
      first.text,
    );
    if (!removed) throw new Error("Queue removal failed");
    let reject!: (error: Error) => void;
    const receipt = new Promise<PromptDisposition>((_resolve, fail) => {
      reject = fail;
    });
    const requeued = queue.submit("session-a", removed.followUp[0], () => receipt);
    queue.update("session-a", { steering: [], followUp: [second.text] });
    const draft = new ComposerDraftStore().bind("session:a");
    restoreQueuedMessages(draft, queue.release("session-a"));
    reject(new Error("Process exited"));
    await expect(requeued).rejects.toThrow();
    restoreQueuedMessages(draft, [removed.followUp[0], removed.removed]);
    expect(draft.getSnapshot().imageAttachments.map((image) => image.id)).toEqual([
      "second",
      "first",
    ]);
    expect(
      draft.getSnapshot().content.filter((part) => part.kind === "text" && part.text === "second"),
    ).toHaveLength(1);
  });

  it("removes the local steer command when converting a message to follow up", () => {
    const original = message("steer");
    const converted = withQueueIntent(original, "followUp");
    expect(converted.draft?.content).toEqual(original.draft?.content.slice(1));
    expect(original.draft?.content[0]).toEqual({ kind: "slash", name: "steer" });
    expect(converted.images).toEqual(original.images);
  });
});
