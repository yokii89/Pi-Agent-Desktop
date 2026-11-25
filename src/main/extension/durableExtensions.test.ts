import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ agentDir: "" }));
vi.mock("../session/piInfo", () => ({ getPiAgentDir: () => fixture.agentDir }));

import { discoverDurableExtensions, inspectDurablePackages } from "./durableExtensions";
import { listPackageEntries, setPackageResourceEnabled } from "./packageStore";

let root: string;
let project: string;
const nativeRuntime = {
  engine: "durable",
  apiVersion: 1,
  id: "native",
  entry: "./desktop.mjs",
  capabilities: ["agent", "commands"],
};
async function json(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}
async function packageAt(name: string, runtime: unknown = nativeRuntime) {
  const directory = path.join(root, name);
  await json(path.join(directory, "package.json"), {
    name,
    ...(runtime ? { pidesk: { runtime } } : { pi: { extensions: ["desktop.js"] } }),
  });
  await writeFile(
    path.join(directory, runtime ? "desktop.mjs" : "desktop.js"),
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(path.join(root, "imported"))}, 'unexpected'); export default () => ({});`,
  );
  return directory;
}
async function configure(user: string[], local: string[] = []) {
  await json(path.join(fixture.agentDir, "settings.json"), { packages: user });
  await json(path.join(project, ".pi", "settings.json"), { packages: local });
}
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "pidesk-native-discovery-"));
  fixture.agentDir = path.join(root, "agent");
  project = path.join(root, "workspace");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("Durable package discovery", () => {
  it("discovers explicit user/project entries without importing them and honors the native resource toggle", async () => {
    const user = await packageAt("user");
    const local = await packageAt("project", { ...nativeRuntime, id: "project-native" });
    await configure([user], [local]);
    expect(discoverDurableExtensions(project)).toMatchObject([
      { id: "native", scope: "user" },
      { id: "project-native", scope: "project" },
    ]);
    const item = listPackageEntries(project).user[0];
    expect(item.resourceItems.extensions).toMatchObject([
      { relativePath: "desktop.mjs", enabled: true },
    ]);
    expect(existsSync(path.join(root, "imported"))).toBe(false);
    setPackageResourceEnabled({
      source: user,
      scope: "user",
      kind: "extensions",
      relativePath: "desktop.mjs",
      enabled: false,
    });
    expect(discoverDurableExtensions(project).map((item) => item.id)).toEqual(["project-native"]);
    setPackageResourceEnabled({
      source: user,
      scope: "user",
      kind: "extensions",
      relativePath: "desktop.mjs",
      enabled: true,
    });
    expect(discoverDurableExtensions(project)).toHaveLength(2);
  });

  it("reports legacy compatibility without executing or blocking legacy packages", async () => {
    const legacy = await packageAt("legacy", null);
    await configure([legacy]);
    const snapshot = listPackageEntries(project);
    const result = inspectDurablePackages(snapshot.user, "user");
    expect(result.extensions).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.diagnostics).toMatchObject([{ field: "pidesk.runtime", scope: "user" }]);
    expect(discoverDurableExtensions(project)).toEqual([]);
    expect(existsSync(path.join(root, "imported"))).toBe(false);
  });

  it.each([
    { apiVersion: 2 },
    { capabilities: ["interactions"] },
    { entry: "../outside.mjs" },
    { entry: "./missing.mjs" },
    { entry: "./desktop.ts" },
    { id: "Bad ID" },
  ])("refuses invalid explicitly native packages: %j", async (change) => {
    const directory = await packageAt("invalid", { ...nativeRuntime, ...change });
    await writeFile(path.join(root, "outside.mjs"), "export default () => ({});");
    await configure([directory]);
    expect(() => discoverDurableExtensions(project)).toThrow();
    expect(existsSync(path.join(root, "imported"))).toBe(false);
  });

  it("rejects duplicate IDs across scopes instead of replacing a guard", async () => {
    await configure([await packageAt("user")], [await packageAt("project")]);
    expect(() => discoverDurableExtensions(project)).toThrow();
  });

  it("rejects an entry escaping through a directory junction", async () => {
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "entry.mjs"), "export default () => ({});");
    const directory = await packageAt("linked", { ...nativeRuntime, entry: "./link/entry.mjs" });
    await symlink(outside, path.join(directory, "link"), "junction");
    await configure([directory]);
    expect(() => discoverDurableExtensions(project)).toThrow();
  });
});
