import { describe, expect, it, vi } from "vitest";
import type { PromptDisposition } from "../../shared/ipc";
import type { BrowserContextItem } from "../services/browserService";
import {
  type ComposerDraft,
  type ComposerDraftPart,
  ComposerDraftStore,
  composerDraftKey,
  MAX_CHAT_ELEMENTS,
  sameComposerContent,
} from "./composerDrafts";

function save(store: ComposerDraftStore, key: string, text: string): ComposerDraft {
  store.update(key, (draft) => ({ ...draft, content: [{ kind: "text", text }] }));
  return store.get(key);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function saveAttachments(store: ComposerDraftStore, key: string): ComposerDraft {
  store.update(key, (draft) => ({
    ...draft,
    content: [
      ...draft.content,
      { kind: "file", path: "C:/project/src/index.ts" },
      { kind: "slash", name: "skill:review" },
    ],
    fileMentions: [{ path: "C:/project/src/index.ts", displayPath: "src/index.ts" }],
    fileAttachments: [
      {
        id: "file-1",
        name: "notes.md",
        path: "C:/project/notes.md",
        displayPath: "notes.md",
        kind: "file",
      },
    ],
    imageAttachments: [
      {
        id: "image-1",
        name: "screenshot.png",
        mimeType: "image/png",
        width: 1,
        height: 1,
        byteLength: 1,
        data: "AA==",
        previewUrl: "data:image/png;base64,AA==",
      },
    ],
  }));
  return store.get(key);
}

describe("composer drafts", () => {
  it("keeps home and session drafts separate across navigation and project changes", () => {
    const store = new ComposerDraftStore();
    const home = composerDraftKey(null, "C:/project");
    const a = composerDraftKey("a", "C:/project");
    const b = composerDraftKey("b", "C:/project");
    const otherHome = composerDraftKey(null, "D:/other");
    const homeDraft = save(store, home, "首页还未提交\n第二行");
    const aDraft = save(store, a, "会话 A 未提交");
    save(store, b, "会话 B 需要介入");
    save(store, otherHome, "另一项目的草稿");
    expect(store.get(home)).toBe(homeDraft);
    expect(store.get(a)).toBe(aDraft);
    expect(composerDraftKey("a", "D:/other")).toBe(a);
  });

  it("preserves the complete home draft when the process limit rejects a new session", async () => {
    const store = new ComposerDraftStore();
    const key = composerDraftKey(null, "C:/project");
    save(store, key, "  保留原始提示词\n\n以及空行  ");
    const before = saveAttachments(store, key);
    expect(await store.submit(key, async () => null)).toBe(false);
    expect(store.get(key)).toEqual(before);
    expect(store.get(key).sending).toBe(false);
  });

  it("preserves the draft and unlocks retry if sending throws", async () => {
    const store = new ComposerDraftStore();
    const before = save(store, "home:", "retry me");
    await expect(
      store.submit("home:", async () => {
        throw new Error("limit reached");
      }),
    ).rejects.toThrow("limit reached");
    expect(store.get("home:")).toEqual(before);
    expect(await store.submit("home:", async () => "started")).toBe(true);
    expect(store.get("home:").content).toEqual([]);
  });

  it.each<PromptDisposition>(["started", "queued", "handled"])(
    "clears text, inline chips and attachments only after pi accepts with %s",
    async (disposition) => {
      const store = new ComposerDraftStore();
      save(store, "session:a", "发送的正文");
      saveAttachments(store, "session:a");
      const pending = deferred<PromptDisposition | null>();
      const sent = store.submit("session:a", () => pending.promise);
      expect(store.get("session:a").content).not.toEqual([]);
      expect(store.get("session:a").sending).toBe(true);
      pending.resolve(disposition);
      expect(await sent).toBe(true);
      expect(store.get("session:a")).toEqual({
        content: [],
        fileMentions: [],
        imageAttachments: [],
        fileAttachments: [],
        chatElements: [],
        edits: [],
        sending: false,
      });
    },
  );

  it("does not let a delayed receipt erase another session or a newer home draft", async () => {
    const store = new ComposerDraftStore();
    save(store, "home:", "first message");
    const pending = deferred<PromptDisposition | null>();
    const sent = store.submit("home:", () => pending.promise);
    const other = save(store, "session:b", "intervene here");
    save(store, "home:", "new draft typed while starting");
    pending.resolve("started");
    await sent;
    expect(store.get("session:b")).toBe(other);
    expect(store.get("home:").content).toEqual([
      { kind: "text", text: "new draft typed while starting" },
    ]);
    expect(store.get("home:").sending).toBe(false);
  });

  it("protects attachments added while a send is pending", async () => {
    const store = new ComposerDraftStore();
    save(store, "session:a", "original");
    const pending = deferred<PromptDisposition | null>();
    const sent = store.submit("session:a", () => pending.promise);
    const newer = saveAttachments(store, "session:a");
    pending.resolve("queued");
    await sent;
    expect(store.get("session:a")).toEqual({ ...newer, sending: false });
  });

  it("deduplicates sends even when the input unmounts and remounts", async () => {
    const store = new ComposerDraftStore();
    save(store, "home:", "send once");
    const pending = deferred<PromptDisposition | null>();
    const send = vi.fn(() => pending.promise);
    const first = store.submit("home:", send);
    expect(await store.submit("home:", send)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    pending.resolve("started");
    await first;
  });

  it("migrates the draft and its in-flight receipt when a bucket gets its authoritative id", async () => {
    const store = new ComposerDraftStore();
    save(store, "session:temporary", "do not lose me");
    const pending = deferred<PromptDisposition | null>();
    const sent = store.submit("session:temporary", () => pending.promise);
    store.move("session:temporary", "session:real");
    store.move("session:real", "session:final");
    expect(store.get("session:final").content).toEqual([{ kind: "text", text: "do not lose me" }]);
    pending.resolve("started");
    await sent;
    expect(store.get("session:final").content).toEqual([]);
    expect(store.get("session:final").sending).toBe(false);
  });

  it("retains a newer authoritative draft when remapping an older bucket", () => {
    const store = new ComposerDraftStore();
    save(store, "session:temporary", "old draft");
    const newer = save(store, "session:real", "newer draft");
    store.move("session:temporary", "session:real");
    expect(store.get("session:real")).toBe(newer);
  });

  it("keeps snapshot identity stable until content changes and supports unsubscription", () => {
    const store = new ComposerDraftStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const before = store.get("home:");
    expect(store.get("home:")).toBe(before);
    store.update("home:", (current) => current);
    expect(listener).not.toHaveBeenCalled();
    save(store, "home:", "draft");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    save(store, "home:", "new draft");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

function contextItem(id: string): BrowserContextItem {
  return {
    id,
    kind: "element",
    url: "http://localhost:3000",
    at: 1,
    tag: "div",
    selector: "#example",
    label: "example",
    outerHTML: "<div>Example</div>",
    textSummary: "Example",
    a11y: null,
    rect: null,
    viewport: { width: 800, height: 600 },
    styles: "",
    screenshot: null,
    attached: false,
    stale: false,
  };
}

describe("draft ownership across startup and asynchronous work", () => {
  it("keeps prewarming on the home draft and migrates the same object only on submission", () => {
    const store = new ComposerDraftStore();
    save(store, "home:", "draft before opening / or changing model");
    const original = store.bind("home:");
    expect(composerDraftKey("warmed", null, "empty")).toBe("home:");
    expect(store.bind(composerDraftKey("warmed", null, "empty"))).toBe(original);
    expect(store.bind(composerDraftKey(null, null))).toBe(original);
    store.move("home:", "session:warmed", original);
    expect(store.bind("session:warmed")).toBe(original);
    expect(store.bind("home:")).not.toBe(original);
    save(store, "home:", "next task");
    original.enqueue({ kind: "text", text: "late result for the warmed session" });
    expect(store.get("home:").edits).toEqual([]);
    expect(store.get("session:warmed").edits).toHaveLength(1);
  });

  it("does not let an old home send clear or unlock a new home send", async () => {
    const store = new ComposerDraftStore();
    save(store, "home:", "first task");
    const firstResponse = deferred<PromptDisposition | null>();
    const first = store.submit("home:", () => firstResponse.promise);
    store.move("home:", "session:first");
    save(store, "home:", "second task");
    const secondResponse = deferred<PromptDisposition | null>();
    const second = store.submit("home:", () => secondResponse.promise);
    firstResponse.resolve("started");
    await first;
    expect(store.get("home:").sending).toBe(true);
    expect(store.get("home:").content).toEqual([{ kind: "text", text: "second task" }]);
    expect(await store.submit("home:", async () => "started")).toBe(false);
    secondResponse.resolve(null);
    await second;
    expect(store.get("home:").sending).toBe(false);
  });

  it("does not let a remap collision unlock an authoritative session's pending send", async () => {
    const store = new ComposerDraftStore();
    save(store, "session:temporary", "old");
    const oldResponse = deferred<PromptDisposition | null>();
    const oldSend = store.submit("session:temporary", () => oldResponse.promise);
    save(store, "session:real", "new");
    const currentResponse = deferred<PromptDisposition | null>();
    const currentSend = store.submit("session:real", () => currentResponse.promise);
    store.move("session:temporary", "session:real");
    oldResponse.resolve("started");
    await oldSend;
    expect(store.get("session:real").sending).toBe(true);
    expect(await store.submit("session:real", async () => "queued")).toBe(false);
    currentResponse.resolve(null);
    await currentSend;
  });

  it("does not migrate a new home draft when a late startup belongs to a previous one", () => {
    const store = new ComposerDraftStore();
    const old = store.bind("home:");
    store.move("home:", "session:first");
    const newer = store.bind("home:");
    save(store, "home:", "keep this in home");
    store.move("home:", "session:late", old);
    expect(store.bind("home:")).toBe(newer);
    expect(store.get("home:").content).toEqual([{ kind: "text", text: "keep this in home" }]);
    expect(store.get("session:late").content).toEqual([]);
  });

  it("queues every quote and recovered message in its own session, consuming only once", () => {
    const store = new ComposerDraftStore();
    const a = store.bind("session:a");
    a.enqueue({ kind: "text", text: "first recovered message" });
    a.enqueue({ kind: "text", text: "second recovered message" });
    a.enqueue({ kind: "quote", text: "selected quote" });
    store.bind("session:b").enqueue({ kind: "quote", text: "quote for B" });
    expect(a.takeEdits().map((edit) => edit.text)).toEqual([
      "first recovered message",
      "second recovered message",
      "selected quote",
    ]);
    expect(a.takeEdits()).toEqual([]);
    expect(store.get("session:b").edits).toEqual([{ kind: "quote", text: "quote for B" }]);
  });

  it("keeps a quote that arrives while the previous prompt is being accepted", async () => {
    const store = new ComposerDraftStore();
    const a = store.bind("session:a");
    save(store, "session:a", "prompt");
    const response = deferred<PromptDisposition | null>();
    const send = a.submit(() => response.promise);
    a.enqueue({ kind: "quote", text: "new quote" });
    response.resolve("started");
    await send;
    expect(a.takeEdits()).toEqual([{ kind: "quote", text: "new quote" }]);
  });
});

describe("browser context belongs to its draft", () => {
  it("isolates elements and clears only the draft accepted by pi", async () => {
    const store = new ComposerDraftStore();
    const a = store.bind("session:a");
    const b = store.bind("session:b");
    a.addChatElement(contextItem("same-node"));
    b.addChatElement(contextItem("same-node"));
    expect(await a.submit(async () => "started")).toBe(true);
    expect(a.getSnapshot().chatElements).toEqual([]);
    expect(b.getSnapshot().chatElements).toHaveLength(1);
  });

  it("removes only its own chips and keeps the existing attachment cap", () => {
    const store = new ComposerDraftStore();
    const draft = store.bind("session:a");
    for (let index = 0; index <= MAX_CHAT_ELEMENTS; index += 1) {
      draft.addChatElement(contextItem(`node-${index}`));
    }
    expect(draft.getSnapshot().chatElements).toHaveLength(MAX_CHAT_ELEMENTS);
    expect(draft.getSnapshot().chatElements[0].id).toBe("node-1");
    const before = draft.getSnapshot();
    draft.addChatElement(contextItem("node-1"));
    draft.removeChatElement("not-present");
    expect(draft.getSnapshot()).toBe(before);
    draft.update((current) => ({ ...current, content: [{ kind: "element", id: "node-1" }] }));
    draft.removeChatElement("node-1");
    expect(draft.getSnapshot().content).toEqual([]);
  });

  it("marks inactive drafts stale after navigation without duplicating or dropping elements", () => {
    const store = new ComposerDraftStore();
    store.bind("session:a").addChatElement(contextItem("a"));
    store.bind("session:b").addChatElement(contextItem("b"));
    store.markChatElementsStale();
    expect(store.get("session:a").chatElements[0].stale).toBe(true);
    expect(store.get("session:b").chatElements[0].stale).toBe(true);
    const before = store.get("session:b");
    store.markChatElementsStale();
    expect(store.get("session:b")).toBe(before);
  });
});

describe("sameComposerContent", () => {
  it("compares text, whitespace, inline chip identities and ordering", () => {
    const content: ComposerDraftPart[] = [
      { kind: "text", text: "first\n\n" },
      { kind: "file", path: "C:/index.ts" },
      { kind: "slash", name: "skill:review" },
      { kind: "element", id: "element-1" },
    ];
    expect(sameComposerContent(content, structuredClone(content))).toBe(true);
    for (let index = 0; index < content.length; index += 1) {
      const changed = content.map((part, i) =>
        i === index ? { kind: "text" as const, text: "different" } : part,
      );
      expect(sameComposerContent(content, changed)).toBe(false);
    }
    expect(sameComposerContent(content, [...content].reverse())).toBe(false);
    expect(sameComposerContent(content, content.slice(1))).toBe(false);
  });
});
