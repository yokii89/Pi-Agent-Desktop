/**
 * Loopback integration: DesktopViewClient ↔ a protocol-faithful Host.
 *
 * Covers the opened-ack path end-to-end over a real TCP socket (same framing as
 * viewHost): token auth → hello → open → opened → event → close.
 *
 * The harness is `createTestViewHost` from `./testing.js`, which imports the
 * real Host decision helpers instead of restating them. This file used to carry
 * a hand-written copy that had already drifted — zero `capabilities`, no
 * `sanitizeTree`, its own placement table — so every capability-gated SDK path
 * was silently untested here (docs/design/20 §1.3, O5). Two cases below exist
 * precisely to keep the "old Host / new SDK" direction covered.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  IMPLEMENTED_VIEW_PLACEMENTS,
  VIEW_HOST_CAPABILITIES,
  VIEW_LIMITS,
} from "../../../src/shared/view";
import { DesktopViewClient, VIEW_PROTOCOL_VERSION } from "./index.js";
import { createTestViewHost, type TestViewHost } from "./testing.js";

let current: TestViewHost;
let legacy: TestViewHost;

beforeAll(async () => {
  current = await createTestViewHost();
  legacy = await createTestViewHost({ legacy: true });
});

afterAll(async () => {
  await Promise.all([current?.close(), legacy?.close()]);
});

function makeClient(host: "current" | "legacy" = "current"): DesktopViewClient {
  return new DesktopViewClient(
    {
      endpoint: (host === "current" ? current : legacy).endpoint,
      token: "test-token",
      protocol: VIEW_PROTOCOL_VERSION,
    },
    { helloTimeoutMs: 1000, connectTimeoutMs: 2000 },
  );
}

/** Resolve once `predicate()` holds, or fail loudly instead of hanging the suite. */
async function viWaitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

interface OpenedAck {
  placement?: string;
  panelId?: string;
}

/** Collect `opened` acks so a test can assert what the Host reported back. */
function openedCollector(): {
  onEvent: (event: { type: string; placement?: string; panelId?: string }) => void;
  seen: OpenedAck[];
} {
  const seen: OpenedAck[] = [];
  return {
    seen,
    onEvent: (event) => {
      if (event.type === "opened")
        seen.push({ placement: event.placement, panelId: event.panelId });
    },
  };
}

describe("opened ack over real socket", () => {
  it("receives hello and opened with requested modal placement", async () => {
    const client = makeClient();
    const { onEvent, seen } = openedCollector();

    const resultPromise = client.open(
      { title: "问卷", root: { type: "text", content: "hi" }, placement: "modal" },
      { onEvent },
    );

    // open() only resolves on close, so wait for the ack itself.
    await viWaitFor(() => seen.length > 0);
    expect(seen[0]?.placement).toBe("modal");
    expect(seen[0]?.panelId).toBeUndefined();

    client.dispose();
    expect(await resultPromise).toBeNull();
  });

  it("assigns default panelId for panel placement", async () => {
    current.reset();
    const client = makeClient();
    const { onEvent, seen } = openedCollector();

    const resultPromise = client.open(
      {
        title: "面板",
        root: { type: "text", content: "panel body" },
        placement: "panel",
        placementHint: {},
      },
      { onEvent },
    );

    await viWaitFor(() => seen.length > 0);
    expect(seen[0]).toMatchObject({ placement: "panel" });
    expect(seen[0]?.panelId).toMatch(/^ext-view-/);

    client.dispose();
    await resultPromise;
  });

  it("honours requested panelId in opened ack", async () => {
    const client = makeClient();
    const { onEvent, seen } = openedCollector();

    const resultPromise = client.open(
      {
        root: { type: "text", content: "p" },
        placement: "panel",
        placementHint: { panelId: "yoki-queue" },
      },
      { onEvent },
    );

    await viWaitFor(() => seen.length > 0);
    expect(seen[0]).toEqual({ placement: "panel", panelId: "yoki-queue" });

    client.dispose();
    await resultPromise;
  });

  it("normalizes unknown placement to modal in opened", async () => {
    const client = makeClient();
    const { onEvent, seen } = openedCollector();

    const resultPromise = client.open(
      { root: { type: "text", content: "x" }, placement: "drawer" as never },
      { onEvent },
    );

    await viWaitFor(() => seen.length > 0);
    expect(seen[0]?.placement).toBe("modal");

    client.dispose();
    await resultPromise;
  });

  it("placementRequired rejects an unknown placement instead of landing as modal", async () => {
    // This is the behaviour the hand-written stub always claimed; the real Host
    // only started honouring it after docs/design/20 §6.2 chose to tighten
    // `resolvePlacement` (an explicit non-enum slot + required = error, not a
    // silent modal). The omitted-`placement` case stays modal — see the
    // "normalizes unknown placement to modal" case above plus §5.3.4.
    const client = makeClient();
    const { onEvent, seen } = openedCollector();

    const err = (await client
      .open(
        {
          root: { type: "text", content: "x" },
          placement: "drawer" as never,
          placementRequired: true,
        },
        { onEvent },
      )
      .catch((e: unknown) => e)) as { code?: string; name?: string };

    expect(err.name).toBe("ViewHostError");
    expect(err.code).toBe("placement");
    // 没有任何 `opened`：拒绝发生在渲染之前
    expect(seen).toHaveLength(0);
    client.dispose();
  });

  it("refuses a tree the Host sanitizer rejects, with code=limit", async () => {
    // The old stub never ran `sanitizeTree`, so nothing cross-checked the SDK's
    // own node/depth pre-flight against the Host's verdict.
    const client = makeClient();
    current.reset();
    const wide = {
      type: "column" as const,
      children: Array.from({ length: VIEW_LIMITS.maxNodes + 10 }, (_, i) => ({
        type: "text" as const,
        content: `n${i}`,
      })),
    };
    const err = (await client.open({ root: wide }).catch((e: unknown) => e)) as {
      code?: string;
      name?: string;
    };
    expect(err.name).toBe("ViewHostError");
    expect(err.code).toBe("limit");
    expect(current.framesOfType("open")).toHaveLength(0);
    client.dispose();
  });

  it("a current Host advertises everything the SDK gates on (no silent stub drift)", async () => {
    const client = makeClient();
    const hello = await client.ensureConnected();
    expect(hello?.capabilities).toEqual([...VIEW_HOST_CAPABILITIES]);
    expect(hello?.placements).toEqual([...IMPLEMENTED_VIEW_PLACEMENTS]);
    expect(hello?.limits).toEqual(VIEW_LIMITS);
    expect(client.limits.maxNodes).toBe(VIEW_LIMITS.maxNodes);
    expect(client.hasCapability("view-patch")).toBe(true);
    client.dispose();
  });

  it("registerAccessMode soft-nulls against an old Host with no access-mode slot, and never opens", async () => {
    const { registerAccessMode } = await import("./index.js");
    const client = makeClient("legacy");
    legacy.reset();
    const handle = await registerAccessMode(client, { id: "yoki-plan", title: "计划模式" });
    expect(handle).toBeNull();
    // 未发 open：hello 预检直接失败，绝不弹 modal 兜底
    expect(legacy.framesOfType("open")).toHaveLength(0);
    client.dispose();
  });

  it("an old Host without capabilities or limits still degrades cleanly", async () => {
    const { supportsPatch, supportsTable } = await import("./index.js");
    const client = makeClient("legacy");
    const hello = await client.ensureConnected();
    expect(hello?.capabilities).toBeUndefined();
    expect(hello?.limits).toBeUndefined();
    // hello 缺字段 ≠ 崩溃：能力探测按不支持处理，预算回落到编译期默认
    expect(supportsTable(client)).toBe(false);
    expect(supportsPatch(client)).toBe(false);
    expect(client.limits).toEqual(VIEW_LIMITS);
    client.dispose();
  });
});
