import { describe, expect, it } from "vitest";
import { getNamedIconUrl } from "../fileIcons/resolve";
import { COMMAND_BRAND_ICONS, detectCommandBrand } from "./commandIcon";

function icon(command: string): string | null {
  return detectCommandBrand(command)?.icon ?? null;
}

describe("detectCommandBrand", () => {
  it("matches the commands from the stream screenshots", () => {
    expect(icon("pnpm exec tsc -p tsconfig.json --noEmit 2>&1 | head -30")).toBe("file_pnpm");
    expect(icon("git status --short && git diff --stat")).toBe("file_gitignore");
    expect(icon("cd temp/project-reorder-e2e && node run.mjs 2>&1 | tail -40")).toBe("file_nodejs");
  });

  it("skips env assignments, wrappers and shell keywords", () => {
    expect(icon("NODE_ENV=test pnpm build")).toBe("file_pnpm");
    expect(icon("sudo -E docker compose up")).toBe("file_docker");
    expect(icon("timeout 30 node server.js")).toBe("file_nodejs");
    expect(icon("nice -n 10 node server.js")).toBe("file_nodejs");
    expect(icon("if [ -f package.json ]; then pnpm test; fi")).toBe("file_pnpm");
  });

  it("handles quoted paths, executable extensions and versioned interpreters", () => {
    expect(icon('"C:\\Program Files\\nodejs\\node.exe" server.js')).toBe("file_nodejs");
    expect(icon("./gradlew.bat build")).toBe("file_java");
    expect(icon("python3.12 -m pytest")).toBe("file_python");
    expect(icon("pip3 list")).toBe("file_python");
    expect(icon("./scripts/build.sh")).toBe("file_shell");
  });

  it("does not match arguments or unknown commands", () => {
    expect(icon('echo "git status"')).toBeNull();
    expect(icon('echo "pnpm|git"')).toBeNull();
    expect(icon("cd src && ls")).toBeNull();
    expect(icon("some-unlisted-cli --help")).toBeNull();
    expect(detectCommandBrand("")).toBeNull();
  });

  it("keeps the first known executable in a chain", () => {
    expect(icon("cd src && npm test && git status")).toBe("file_npm");
    expect(icon("git status | grep pnpm")).toBe("file_gitignore");
  });

  it("resolves every registered icon from the file icon asset pool", () => {
    for (const name of COMMAND_BRAND_ICONS) {
      expect(getNamedIconUrl(name, "light"), name).not.toBeNull();
      expect(getNamedIconUrl(name, "dark"), name).not.toBeNull();
    }
  });
});
