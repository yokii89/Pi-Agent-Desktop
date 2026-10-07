import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopViewClient, readEnv } from "./client.js";

const tmpFiles: string[] = [];

function writeRendezvous(payload: Record<string, unknown>): string {
  const file = path.join(os.tmpdir(), `pidesk-view-rdv-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(file, JSON.stringify(payload), "utf8");
  tmpFiles.push(file);
  return file;
}

afterEach(() => {
  for (const f of tmpFiles.splice(0)) {
    try {
      fs.unlinkSync(f);
    } catch {
      // ignore
    }
  }
});

describe("readEnv / rendezvous (docs/design/15 P0-1)", () => {
  it("prefers rendezvous file over baked endpoint/token", () => {
    const file = writeRendezvous({
      endpoint: "\\\\.\\pipe\\pidesk-view-9999",
      token: "live-token",
      protocol: "view/v1",
    });
    const env = readEnv({
      PIDESK_VIEW_ENDPOINT: "\\\\.\\pipe\\pidesk-view-1",
      PIDESK_VIEW_TOKEN: "stale-token",
      PIDESK_VIEW_SESSION: "sess-A",
      PIDESK_VIEW_RENDEZVOUS: file,
    });
    expect(env).toMatchObject({
      endpoint: "\\\\.\\pipe\\pidesk-view-9999",
      token: "live-token",
      sessionId: "sess-A",
      rendezvousPath: file,
    });
  });

  it("falls back to baked env when rendezvous is missing", () => {
    const env = readEnv({
      PIDESK_VIEW_ENDPOINT: "http://127.0.0.1:1234",
      PIDESK_VIEW_TOKEN: "tok",
      PIDESK_VIEW_SESSION: "s1",
      PIDESK_VIEW_RENDEZVOUS: path.join(os.tmpdir(), "no-such-pidesk-rdv.json"),
    });
    expect(env).toMatchObject({
      endpoint: "http://127.0.0.1:1234",
      token: "tok",
      sessionId: "s1",
    });
  });

  it("DesktopViewClient.refreshEnv picks up a new endpoint from rendezvous", () => {
    const file = writeRendezvous({
      endpoint: "http://127.0.0.1:5555",
      token: "new-token",
      protocol: "view/v1",
    });
    const client = new DesktopViewClient(
      {
        endpoint: "\\\\.\\pipe\\pidesk-view-old",
        token: "old-token",
        protocol: "view/v1",
        sessionId: "sess-A",
        rendezvousPath: file,
      },
      { env: { PIDESK_VIEW_RENDEZVOUS: file, PIDESK_VIEW_SESSION: "sess-A" } },
    );
    expect(client.env.endpoint).toContain("old");
    const changed = client.refreshEnv();
    expect(changed).toBe(true);
    expect(client.env.endpoint).toBe("http://127.0.0.1:5555");
    expect(client.env.token).toBe("new-token");
    expect(client.env.sessionId).toBe("sess-A");
  });

  it("refreshEnv keeps setSessionId over stale spawn env sessionId", () => {
    const file = writeRendezvous({
      endpoint: "http://127.0.0.1:7777",
      token: "tok-2",
      protocol: "view/v1",
    });
    const client = new DesktopViewClient(
      {
        endpoint: "http://127.0.0.1:1",
        token: "tok-1",
        protocol: "view/v1",
        sessionId: "sess-A",
        rendezvousPath: file,
      },
      { env: { PIDESK_VIEW_RENDEZVOUS: file, PIDESK_VIEW_SESSION: "sess-A" } },
    );
    client.setSessionId("sess-B");
    client.refreshEnv();
    expect(client.env.sessionId).toBe("sess-B");
    expect(client.env.endpoint).toBe("http://127.0.0.1:7777");
    expect(client.env.token).toBe("tok-2");
  });

  it("refreshEnv preserves the connection role across a host restart", () => {
    const client = new DesktopViewClient({
      endpoint: "http://127.0.0.1:1",
      token: "t1",
      protocol: "view/v1",
      role: "worker",
    });
    // New host advertises a different endpoint; role only exists in memory.
    const changed = client.refreshEnv({
      PIDESK_VIEW_ENDPOINT: "http://127.0.0.1:2",
      PIDESK_VIEW_TOKEN: "t2",
    } as NodeJS.ProcessEnv);
    expect(changed).toBe(true);
    expect(client.env.endpoint).toBe("http://127.0.0.1:2");
    // Losing the role silently re-opens the Host's worker restriction gate.
    expect(client.env.role).toBe("worker");
  });

  it("setSessionId marks force-reconnect and updates auth env", () => {
    const client = new DesktopViewClient({
      endpoint: "http://127.0.0.1:1",
      token: "t",
      protocol: "view/v1",
      sessionId: "sess-A",
    });
    client.setSessionId("sess-B");
    expect(client.env.sessionId).toBe("sess-B");
  });
});
