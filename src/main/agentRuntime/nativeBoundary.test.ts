import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? sources(file)
      : /\.(?:ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
        ? [file]
        : [];
  });
}

describe("built-in Durable execution boundary", () => {
  it("keeps desktop source independent of the retired executor and coding-agent packages", () => {
    const violations = sources(path.join(root, "src")).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return /(?:from\s*|import\s*\(|require\s*\()["'][^"']*(?:piSession|piLauncher|piModelList|sessionIpc|piCredentials|piAuth|modelOverridesIpc|mcpProbe)["']/.test(
        text,
      ) ||
        /["']@(?:earendil-works|mariozechner)\/pi-(?:coding-agent|agent-core|tui)(?:\/[^"']*)?["']/.test(
          text,
        )
        ? [path.relative(root, file)]
        : [];
    });
    expect(violations).toEqual([]);
    const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
    expect(dependencies["@earendil-works/pi-durable"]).toBe("1.6.0");
    expect(
      Object.keys(dependencies).filter((name) =>
        /\/pi-(?:coding-agent|agent-core|tui)$/.test(name),
      ),
    ).toEqual([]);
  });

  it("ships only desktop-owned skill guidance and native ESM examples", () => {
    const packaging = readFileSync(path.join(root, "electron-builder.yml"), "utf8");
    expect(packaging).toContain("assets/skills/**/*");
    expect(packaging).not.toContain("vendor/MyPiExtension/");
    const contract = readFileSync(
      path.join(root, "assets/skills/plugin-creator/references/durable-extension.md"),
      "utf8",
    );
    expect(contract).toContain('"engine": "durable"');
    expect(contract).toContain('"hosts": ["session"]');
    expect(contract).toContain("context.views");
  });
});
