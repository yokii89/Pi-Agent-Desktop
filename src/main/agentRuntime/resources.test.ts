import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionExtensionHost } from "../../agentRuntime/extensions/sessionExtensionHost";
import {
  expandPromptTemplate,
  loadSessionResources,
} from "../../agentRuntime/resources/sessionResources";
import { parseDurableCommand } from "../../shared/durableProtocol";
import { type DurableResourceSpec, isDurableCommandMetadata } from "../../shared/durableResources";

let root: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "pidesk-resource-runtime-")));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function resource(
  name: string,
  text: string,
  kind: "skill" | "prompt" = "skill",
  scope: "user" | "project" = "user",
): Promise<DurableResourceSpec> {
  const file = path.join(root, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  return { root, file, kind, scope };
}

const skill =
  "---\nname: review\ndescription: Review code safely\n---\nFollow the bundled checklist in references/check.md.";

describe("Durable resource snapshots and commands", () => {
  it("loads metadata, keeps bodies lazy, hides explicit-only skills and preserves source paths", async () => {
    const visible = await resource(
      "visible/SKILL.md",
      skill.replace(
        "description: Review code safely",
        'description: "Review code safely" # metadata comment',
      ),
    );
    const hidden = await resource(
      "hidden/SKILL.md",
      "---\nname: manual\ndescription: Run manually\ndisable-model-invocation: true\n---\nMANUAL_BODY",
    );
    const prompt = await resource(
      "prompts/changes.md",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Literal prompt-template syntax is under test.
      "---\ndescription: >-\n  Review selected\n  files\n---\nReview $1 for ${2:-correctness}; remaining ${@:3}; all $ARGUMENTS",
      "prompt",
    );
    const loaded = await loadSessionResources(root, [visible, hidden, prompt]);
    expect(loaded.commands.map((command) => command.name)).toEqual([
      "skill:review",
      "skill:manual",
      "changes",
    ]);
    expect(loaded.instructions).toContain('name="review"');
    expect(loaded.instructions).not.toContain("MANUAL_BODY");
    expect(loaded.instructions).not.toContain('name="manual"');
    expect(loaded.instructions).not.toContain("bundled checklist");
    expect(loaded.commands[2].description).toBe("Review selected files");
    const host = new SessionExtensionHost(randomUUID(), root);
    try {
      host.installResources(loaded.commands);
      await host.load([]);
      expect(host.listCommands().every(isDurableCommandMetadata)).toBe(true);
      expect(host.listCommands()[0]).toMatchObject({ source: "skill", filePath: visible.file });
      const expanded = await host.expand("one", "/skill:review check diff");
      expect(expanded).toContain(`Base directory: ${path.dirname(visible.file)}`);
      expect(expanded).toContain("references/check.md");
      expect(expanded).toContain("check diff");
      expect(await host.expand("two", '/changes "api server"')).toBe(
        "Review api server for correctness; remaining ; all api server",
      );
      await writeFile(visible.file, "changed on disk");
      expect(await host.expand("three", "/skill:review")).toContain("bundled checklist");
      await expect(host.expand("bad", "/missing private arguments")).rejects.toThrow(
        "unknownCommand:missing",
      );
    } finally {
      await host.dispose();
    }
  });

  it("lets project resources override user resources but rejects ambiguous names in one scope", async () => {
    const user = await resource("user/SKILL.md", skill);
    const project = await resource(
      "project/SKILL.md",
      skill.replace("bundled checklist", "project checklist"),
      "skill",
      "project",
    );
    const loaded = await loadSessionResources(root, [project, user, user]);
    expect(loaded.commands).toHaveLength(1);
    expect(loaded.commands[0].filePath).toBe(project.file);
    expect(loaded.commands[0].expand("")).toContain("project checklist");
    expect(loaded.instructions.match(/name="review"/g)).toHaveLength(1);
    const duplicate = await resource("duplicate/SKILL.md", skill);
    await expect(loadSessionResources(root, [user, duplicate])).rejects.toThrow(
      "duplicate:skill:review",
    );
    const hiddenProject = await resource(
      "hidden/SKILL.md",
      skill.replace("---\nFollow", "disable-model-invocation: true\n---\nFollow"),
      "skill",
      "project",
    );
    expect((await loadSessionResources(root, [user, hiddenProject])).instructions).not.toContain(
      'name="review"',
    );
  });

  it.each(["steer", "STEER"])("reserves /%s for the composer's queue intent", async (name) => {
    const spec = await resource(`prompts/${name}.md`, "Prompt body", "prompt");
    await expect(loadSessionResources(root, [spec])).rejects.toThrow(`invalid:${name}.md`);
  });

  it.each([
    "---\nname: [invalid]\n---\nbody",
    "---\nname: invalid name\n---\nbody",
    "---\nname: good\nname: duplicate\n---\nbody",
    "---\ndescription: broken",
    "---\ndisable-model-invocation: maybe\n---\nbody",
    "\0private content",
    " ",
  ])("rejects invalid resource metadata without returning its contents", async (text) => {
    const spec = await resource("bad/SKILL.md", text);
    await expect(loadSessionResources(root, [spec])).rejects.toThrow(
      "PIDESK_RESOURCE:invalid:SKILL.md",
    );
  });

  it("bounds file size, instruction size and count, and rechecks package containment", async () => {
    const large = await resource("large/SKILL.md", "x".repeat(64 * 1024 + 1));
    await expect(loadSessionResources(root, [large])).rejects.toThrow("tooLarge:SKILL.md");
    await expect(
      loadSessionResources(
        root,
        Array.from({ length: 257 }, () => large),
      ),
    ).rejects.toThrow("tooLarge:catalog");
    const outside = await resource("outside/SKILL.md", skill);
    const inside = path.join(root, "inside");
    await mkdir(inside);
    await symlink(path.dirname(outside.file), path.join(inside, "link"), "junction");
    await expect(
      loadSessionResources(root, [
        { ...outside, root: inside, file: path.join(inside, "link/SKILL.md") },
      ]),
    ).rejects.toThrow("invalid:SKILL.md");
    await writeFile(path.join(root, "AGENTS.md"), "x".repeat(128 * 1024 + 1));
    await expect(loadSessionResources(root, [])).rejects.toThrow("tooLarge:AGENTS.md");
  });

  it("loads ancestor instructions in order and rejects malformed private resource DTOs", async () => {
    await writeFile(path.join(root, "AGENTS.md"), "PARENT_INSTRUCTIONS");
    const child = path.join(root, "child");
    await mkdir(child);
    await writeFile(path.join(child, "AGENTS.md"), "CHILD_INSTRUCTIONS");
    const loaded = await loadSessionResources(child, []);
    expect(loaded.instructions.indexOf("PARENT_INSTRUCTIONS")).toBeLessThan(
      loaded.instructions.indexOf("CHILD_INSTRUCTIONS"),
    );
    const spec = await resource("review/SKILL.md", skill);
    const command = {
      op: "open",
      sessionId: randomUUID(),
      cwd: child,
      create: true,
      resources: [spec],
    };
    expect(parseDurableCommand(command)).toEqual(command);
    for (const change of [{ kind: "script" }, { scope: "other" }, { file: "bad\0path" }])
      expect(parseDurableCommand({ ...command, resources: [{ ...spec, ...change }] })).toBeNull();
    expect(
      isDurableCommandMetadata({
        name: "skill:review",
        source: "skill",
        description: "valid",
        filePath: "bad\0path",
      }),
    ).toBe(false);
  });
});

describe("Durable prompt template arguments", () => {
  it.each([
    [
      "$1|$2|$@|$ARGUMENTS",
      '"api server" security',
      "api server|security|api server security|api server security",
    ],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Literal prompt-template syntax is under test.
    ["${1:-fallback}|${@:-all default}", "", "fallback|all default"],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Literal prompt-template syntax is under test.
    ["${@:2}|${@:2:2}", "one two three four", "two three four|two three"],
    ["$1|$2", "doesn't break", "doesn't|break"],
    ["$1|$2", '"unclosed quote', '"unclosed|quote'],
    ["$1", '"the \\"fast\\" path"'.replaceAll("\\\\", "\\"), 'the "fast" path'],
    ["$1|$2", '"" value', "|value"],
    ["$1|$2", "C:\\work\\project tail", "C:\\work\\project|tail"],
    ["$1|$@", "'$2' literal", "$2|$2 literal"],
  ])("expands %s from %s", (template, args, expected) => {
    expect(expandPromptTemplate(template, args)).toBe(expected);
  });
});
