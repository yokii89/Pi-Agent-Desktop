import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listLocalResourceDirs, setLocalResourceEnabled } from "./localResources";

const tempDirs: string[] = [];

function makeRoot(): { agentDir: string; homeDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pidesk-local-resources-"));
  tempDirs.push(root);
  return { agentDir: path.join(root, "agent"), homeDir: path.join(root, "home") };
}

function write(file: string, content = ""): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function readSettings(agentDir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(agentDir, "settings.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("listLocalResourceDirs", () => {
  it("按 pi 口径扫描四类目录与共享技能目录", () => {
    const { agentDir, homeDir } = makeRoot();
    write(path.join(agentDir, "skills", "alpha", "SKILL.md"), "# alpha");
    write(path.join(agentDir, "skills", "beta", "SKILL.md"), "# beta");
    write(path.join(agentDir, "skills", "notes.md"), "# note");
    write(path.join(agentDir, "prompts", "review.md"), "# review");
    write(path.join(agentDir, "themes", "dark.json"), "{}");
    write(path.join(agentDir, "extensions", "one.ts"), "");
    write(path.join(agentDir, "extensions", "group", "index.ts"), "");
    write(path.join(homeDir, ".agents", "skills", "gamma", "SKILL.md"), "# gamma");
    write(path.join(homeDir, ".agents", "skills", "ignored.md"), "# ignored");

    const dirs = listLocalResourceDirs(agentDir, null, homeDir);
    const byKind = new Map(dirs.map((dir) => [dir.kind, dir]));

    expect(byKind.get("skills")?.exists).toBe(true);
    expect(byKind.get("skills")?.items.map((item) => item.name)).toEqual([
      "alpha",
      "beta",
      "notes",
    ]);
    expect(byKind.get("skills")?.items.map((item) => item.relativePath)).toContain(
      "skills/alpha/SKILL.md",
    );

    expect(byKind.get("sharedSkills")?.items.map((item) => item.name)).toEqual(["gamma"]);
    expect(byKind.get("extensions")?.items.map((item) => item.name)).toEqual(["group", "one"]);
    expect(byKind.get("prompts")?.items.map((item) => item.name)).toEqual(["review"]);
    expect(byKind.get("themes")?.items.map((item) => item.name)).toEqual(["dark"]);
  });

  it("读取 +/- 精确覆盖与 !glob 排除", () => {
    const { agentDir, homeDir } = makeRoot();
    write(path.join(agentDir, "skills", "alpha", "SKILL.md"), "# alpha");
    write(path.join(agentDir, "skills", "beta", "SKILL.md"), "# beta");
    write(path.join(homeDir, ".agents", "skills", "gamma", "SKILL.md"), "# gamma");

    const settings = {
      skills: ["-skills/alpha/SKILL.md", "!skills/beta/**", "-skills/gamma/SKILL.md"],
    };
    const dirs = listLocalResourceDirs(agentDir, settings, homeDir);
    const byKind = new Map(dirs.map((dir) => [dir.kind, dir]));
    expect(byKind.get("skills")?.items.map((item) => [item.name, item.enabled])).toEqual([
      ["alpha", false],
      ["beta", false],
    ]);
    expect(byKind.get("sharedSkills")?.items[0]?.enabled).toBe(false);
  });
});

describe("setLocalResourceEnabled", () => {
  it("停用写 -，启用替换为 +，并保留其它设置与手写规则", () => {
    const { agentDir, homeDir } = makeRoot();
    const skillFile = path.join(agentDir, "skills", "alpha", "SKILL.md");
    write(skillFile, "# alpha");
    write(
      path.join(agentDir, "settings.json"),
      JSON.stringify(
        {
          defaultModel: "test-model",
          skills: ["~/.claude/skills", "!skills/legacy/**", "-skills/alpha/SKILL.md"],
        },
        null,
        2,
      ),
    );

    setLocalResourceEnabled(agentDir, { kind: "skills", path: skillFile, enabled: true }, homeDir);
    let settings = readSettings(agentDir);
    expect(settings.defaultModel).toBe("test-model");
    expect(settings.skills).toEqual([
      "~/.claude/skills",
      "!skills/legacy/**",
      "+skills/alpha/SKILL.md",
    ]);

    setLocalResourceEnabled(agentDir, { kind: "skills", path: skillFile, enabled: false }, homeDir);
    settings = readSettings(agentDir);
    expect(settings.skills).toEqual([
      "~/.claude/skills",
      "!skills/legacy/**",
      "-skills/alpha/SKILL.md",
    ]);
  });

  it("共享技能写到同一 settings.skills，模式相对 ~/.agents", () => {
    const { agentDir, homeDir } = makeRoot();
    const skillFile = path.join(homeDir, ".agents", "skills", "gamma", "SKILL.md");
    write(skillFile, "# gamma");

    setLocalResourceEnabled(
      agentDir,
      { kind: "sharedSkills", path: skillFile, enabled: false },
      homeDir,
    );
    expect(readSettings(agentDir).skills).toEqual(["-skills/gamma/SKILL.md"]);
  });

  it("拒绝本地资源目录之外的路径", () => {
    const { agentDir, homeDir } = makeRoot();
    const outside = path.join(homeDir, "outside.ts");
    write(outside);
    expect(() =>
      setLocalResourceEnabled(
        agentDir,
        { kind: "extensions", path: outside, enabled: false },
        homeDir,
      ),
    ).toThrow("资源路径不在本地资源目录内");
  });
});
