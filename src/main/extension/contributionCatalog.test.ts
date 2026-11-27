import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveContributionBinding } from "../view/contributionBinding";
import { __resetCatalogCacheForTests, buildCatalogSnapshot } from "./contributionCatalog";

vi.mock("../window/createMainWindow", () => ({ getMainWindow: () => null }));

const tempDirs: string[] = [];
const pidesk = {
  contributes: {
    panels: [{ id: "subagents", title: "Subagents", icon: "robot", activation: "onSessionView" }],
  },
};

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function install(): { packageDir: string; agentDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pidesk-catalog-"));
  tempDirs.push(root);
  const agentDir = path.join(root, "agent");
  const packageDir = path.join(root, "monorepo");
  write(path.join(agentDir, "settings.json"), JSON.stringify({ packages: [packageDir] }));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  return { packageDir, agentDir };
}

afterEach(() => {
  __resetCatalogCacheForTests();
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("buildCatalogSnapshot entrypoint sidecars", () => {
  it("discovers a nested monorepo panel before startup without hiding other contributions", () => {
    const { packageDir } = install();
    const subagents = "packages/pi-subagents/src/index.ts";
    const plan = "packages/yoki-plan/index.ts";
    write(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "monorepo", pi: { extensions: [subagents, plan] } }),
    );
    write(path.join(packageDir, subagents), "export {};\n");
    write(path.join(packageDir, plan), "export {};\n");
    write(
      path.join(packageDir, "packages/pi-subagents/package.json"),
      JSON.stringify({ name: "pi-subagents", pidesk }),
    );
    write(
      path.join(packageDir, "packages/yoki-plan/package.json"),
      JSON.stringify({
        pidesk: {
          contributes: {
            accessModes: [{ id: "yoki-plan", title: "Plan", activation: "onAccessMode" }],
          },
        },
      }),
    );

    const before = buildCatalogSnapshot(null);
    expect(before.entries.map((entry) => entry.id)).toEqual(["yoki-plan"]);
    write(
      path.join(packageDir, "packages/pi-subagents/src/index.pidesk.json"),
      JSON.stringify(pidesk),
    );
    const snapshot = buildCatalogSnapshot(null);
    expect(snapshot.entries.map((entry) => entry.id)).toEqual(["subagents", "yoki-plan"]);
    expect(snapshot.diagnostics).toEqual([]);
    const panel = snapshot.entries.find((entry) => entry.id === "subagents");
    expect(panel).toMatchObject({
      placement: "panel",
      activation: "onSessionView",
      packageId: before.entries[0]?.packageId,
    });
    expect(
      resolveContributionBinding({
        entries: snapshot.entries,
        contributionKey: panel?.key,
        placement: "panel",
        hint: { panelId: "subagents" },
        worker: false,
      }),
    ).toBe(panel?.key);
  });

  it("keeps standalone package discovery unique when an entrypoint sidecar also ships", () => {
    const { packageDir } = install();
    write(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "pi-subagents", pi: { extensions: ["src/index.ts"] }, pidesk }),
    );
    write(path.join(packageDir, "src/index.ts"), "export {};\n");
    write(path.join(packageDir, "src/index.pidesk.json"), JSON.stringify(pidesk));
    const snapshot = buildCatalogSnapshot(null);
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]).toMatchObject({ id: "subagents", placement: "panel" });
    expect(snapshot.diagnostics).toEqual([]);
  });
});
