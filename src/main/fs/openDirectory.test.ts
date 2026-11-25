import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { envelopeAsync } from "../ipc/envelope";
import { openDirectory } from "./fsService";

const { openPath } = vi.hoisted(() => ({ openPath: vi.fn() }));
vi.mock("electron", () => ({ app: {}, dialog: {}, shell: { openPath } }));

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "pidesk-open-directory-"));
  openPath.mockReset();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("system directory opening", () => {
  it("rejects missing paths before invoking the system shell", async () => {
    const result = await envelopeAsync(() => openDirectory(path.join(root, "missing")));
    expect(result).toMatchObject({ ok: false });
    expect(openPath).not.toHaveBeenCalled();
  });

  it("returns the system failure text through the IPC envelope", async () => {
    openPath.mockResolvedValue("The system cannot open this folder.");
    expect(await envelopeAsync(() => openDirectory(root))).toEqual({
      ok: false,
      error: "The system cannot open this folder.",
    });
    expect(openPath).toHaveBeenCalledWith(root);
  });

  it("accepts an empty system failure message as success", async () => {
    openPath.mockResolvedValue("");
    await expect(openDirectory(root)).resolves.toBeUndefined();
  });
});
