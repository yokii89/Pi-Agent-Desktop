import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";

const launched = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("../window/createMainWindow", () => ({ getMainWindow: () => null }));
vi.mock("../settings/settings", () => ({ getSettings: () => ({}) }));
vi.mock("../view/viewHost", () => ({
  ensureViewHost: async () => null,
  closeSessionViews() {},
  retainSessionViews() {},
  getViewHostRendezvousPath: () => "",
}));
vi.mock("../extension/contributionCatalog", () => ({
  getCatalogSnapshot: () => ({ entries: [] }),
}));
vi.mock("./piLauncher", () => ({ resolvePiCommand: launched.resolve }));

import { startSession } from "./piSession";

it("retired RPC entry points cannot start new or legacy sessions, including extension callers", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pidesk-retired-rpc-"));
  const file = path.join(directory, "session.jsonl");
  const text = '{"type":"session","id":"old"}\n';
  try {
    await writeFile(file, text);
    expect(() => startSession({ cwd: directory })).toThrow("read-only");
    expect(() => startSession({ cwd: directory, sessionFile: file })).toThrow("read-only");
    expect(launched.resolve).not.toHaveBeenCalled();
    expect(await readFile(file, "utf8")).toBe(text);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
