import { open, realpath } from "node:fs/promises";
import path from "node:path";
import {
  DURABLE_RESOURCE_LIMIT,
  DURABLE_RESOURCE_NAME,
  type DurableResourceCommand,
  type DurableResourceSpec,
  durableResourceError,
  isDurableResourceSpec,
} from "../../shared/durableResources.js";

import { parseResourceDocument } from "../../shared/resourceDocument.js";

const FILE_BYTES = 64 * 1024;
const TOTAL_BYTES = 1024 * 1024;
const INSTRUCTION_BYTES = 128 * 1024;

/** Read at most limit + 1 bytes, even when a file grows after discovery. */
async function boundedFile(file: string, limit: number, label: string): Promise<string> {
  const handle = await open(file, "r");
  try {
    if (!(await handle.stat()).isFile()) throw durableResourceError("invalid", label);
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > limit) throw durableResourceError("tooLarge", label);
    const text = buffer
      .subarray(0, size)
      .toString("utf8")
      .replace(/^\uFEFF/, "");
    if (text.includes("\0")) throw durableResourceError("invalid", label);
    return text.replace(/\r\n?/g, "\n");
  } finally {
    await handle.close();
  }
}

function xml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Quoted arguments are parsed without running a shell or recursively expanding inserted text. */
export function expandPromptTemplate(template: string, args: string): string {
  const words: string[] = [];
  let offset = 0;
  while (offset < args.length) {
    if (/\s/.test(args[offset])) {
      offset++;
      continue;
    }
    let word = "";
    const quote = args[offset];
    if (quote === '"' || quote === "'") {
      let end = offset + 1;
      for (; end < args.length; end++) {
        if (args[end] === "\\" && args[end + 1] === quote) {
          word += quote;
          end++;
        } else if (args[end] === quote) break;
        else word += args[end];
      }
      if (end < args.length) offset = end + 1;
      else word = "";
    }
    while (offset < args.length && !/\s/.test(args[offset])) word += args[offset++];
    words.push(word);
  }
  const all = words.join(" ");
  return template.replace(
    /\$\{(\d+|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$ARGUMENTS\b|\$@|\$(\d+)/g,
    (
      token,
      defaultIndex: string | undefined,
      fallback: string | undefined,
      from: string | undefined,
      count: string | undefined,
      single: string | undefined,
    ) => {
      if (defaultIndex !== undefined)
        return (defaultIndex === "@" ? all : words[Number(defaultIndex) - 1]) || fallback || "";
      if (token === "$ARGUMENTS" || token === "$@") return all;
      const index = Number(single ?? from);
      if (!Number.isSafeInteger(index) || index < 1) return "";
      if (single !== undefined) return words[index - 1] ?? "";
      return words
        .slice(index - 1, count === undefined ? undefined : index - 1 + Number(count))
        .join(" ");
    },
  );
}

/** A session snapshot: edits and enablement changes take effect after close/reopen. */
export async function loadSessionResources(
  cwd: string,
  specs: readonly DurableResourceSpec[],
): Promise<{ commands: DurableResourceCommand[]; instructions: string }> {
  if (specs.length > DURABLE_RESOURCE_LIMIT) throw durableResourceError("tooLarge", "catalog");
  if (!specs.every(isDurableResourceSpec)) throw durableResourceError("invalid", "catalog");
  const commands: DurableResourceCommand[] = [];
  const names = new Map<string, "user" | "project">();
  const skills = new Map<string, string>();
  const seen = new Set<string>();
  let size = 0;
  // Project resources override user resources. Two different files at the same scope are ambiguous.
  const ordered = [...specs].sort(
    (a, b) => Number(a.scope === "project") - Number(b.scope === "project"),
  );
  for (const spec of ordered) {
    const label = path.basename(spec.file);
    try {
      if (!path.isAbsolute(spec.root) || !path.isAbsolute(spec.file))
        throw durableResourceError("invalid", label);
      const [root, file] = await Promise.all([realpath(spec.root), realpath(spec.file)]);
      const relative = path.relative(root, file);
      if (
        !relative ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative) ||
        !/\.md$/i.test(file)
      )
        throw durableResourceError("invalid", label);
      const identity = `${spec.scope}:${spec.kind}:${process.platform === "win32" ? file.toLowerCase() : file}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const text = await boundedFile(file, FILE_BYTES, label);
      size += Buffer.byteLength(text);
      if (size > TOTAL_BYTES) throw durableResourceError("tooLarge", "catalog");
      const parsed = parseResourceDocument(text, label);
      const name =
        spec.kind === "skill"
          ? (parsed.name ??
            (path.basename(file) === "SKILL.md"
              ? path.basename(path.dirname(file))
              : path.basename(file, path.extname(file))))
          : path.basename(file, path.extname(file));
      if (
        !DURABLE_RESOURCE_NAME.test(name) ||
        (spec.kind === "prompt" && name.toLowerCase() === "steer") ||
        !parsed.body.trim()
      )
        throw durableResourceError("invalid", label);
      const commandName = spec.kind === "skill" ? `skill:${name}` : name;
      const previous = names.get(commandName);
      if (previous === spec.scope) throw durableResourceError("duplicate", commandName);
      if (previous)
        commands.splice(
          commands.findIndex((command) => command.name === commandName),
          1,
        );
      names.set(commandName, spec.scope);
      const description = (
        parsed.description ??
        parsed.body.split("\n").find((line) => line.trim()) ??
        name
      )
        .replace(/\s+/g, " ")
        .trim();
      if (!description || description.length > 1024) throw durableResourceError("invalid", label);
      if (spec.kind === "skill") {
        skills.delete(name);
        if (!parsed.hidden)
          skills.set(
            name,
            `<skill name="${xml(name)}" description="${xml(description)}" location="${xml(file)}" />`,
          );
      }
      commands.push({
        name: commandName,
        description: description.slice(0, 400),
        source: spec.kind,
        filePath: file,
        expand: (args) =>
          spec.kind === "skill"
            ? `<skill name="${xml(name)}" location="${xml(file)}">\nBase directory: ${path.dirname(file)}\nResolve relative resource paths against this directory.\n\n${parsed.body}\n</skill>${args ? `\n\n${args}` : ""}`
            : expandPromptTemplate(parsed.body, args),
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("PIDESK_RESOURCE:")) throw error;
      throw durableResourceError("load", label);
    }
  }
  const instructions = await projectInstructions(cwd);
  const catalog = skills.size
    ? `Available skills: read the listed SKILL.md with the read tool when its description matches the task. Resolve relative paths from that skill's directory.\n<available_skills>\n${[...skills.values()].join("\n")}\n</available_skills>`
    : "";
  return { commands, instructions: [instructions, catalog].filter(Boolean).join("\n\n") };
}

async function projectInstructions(cwd: string): Promise<string> {
  const directories: string[] = [];
  let directory = path.resolve(cwd);
  for (;;) {
    directories.unshift(directory);
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const sections: string[] = [];
  let size = 0;
  for (const root of directories) {
    const file = path.join(root, "AGENTS.md");
    try {
      const text = await boundedFile(file, INSTRUCTION_BYTES - size, "AGENTS.md");
      size += Buffer.byteLength(text);
      sections.push(`<project_instructions path="${xml(file)}">\n${text}\n</project_instructions>`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      if (error instanceof Error && error.message.startsWith("PIDESK_RESOURCE:")) throw error;
      throw durableResourceError("load", "AGENTS.md");
    }
  }
  return sections.join("\n\n");
}
