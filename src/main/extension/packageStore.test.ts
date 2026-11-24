import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listPackageEntries } from "./packageStore";

const tempDirs: string[] = [];

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pidesk-package-store-"));
  tempDirs.push(root);
  return root;
}

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("listPackageEntries local paths", () => {
  it("finds global local packages relative to the agent settings directory", () => {
    const root = makeRoot();
    const agentDir = path.join(root, ".pi", "agent");
    const packageDir = path.join(root, "WebstormProjects", "MyPiExtension");
    const source = path.relative(agentDir, packageDir);

    write(path.join(agentDir, "settings.json"), JSON.stringify({ packages: [source] }));
    write(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "my-pi-extension", pi: { extensions: ["index.ts"] } }),
    );
    write(path.join(packageDir, "index.ts"), "export {};\n");
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);

    const entry = listPackageEntries(null).user[0];

    expect(entry?.installed).toBe(true);
    expect(entry?.installPath).toBe(packageDir);
    expect(entry?.resources.extensions).toBe(1);
    expect(entry?.resourceItems.extensions[0]?.path).toBe(path.join(packageDir, "index.ts"));
  });
});
