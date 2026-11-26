import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

export type PackageCommand = (
  program: "pnpm" | "git",
  args: string[],
  cwd: string,
  log: (line: string) => void,
) => Promise<void>;

function command(program: "pnpm" | "git"): {
  file: string;
  prefix: string[];
  env: NodeJS.ProcessEnv;
} {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", CI: "true" };
  if (process.platform !== "win32") return { file: program, prefix: [], env };
  let candidates: string[];
  try {
    candidates = execFileSync("where.exe", [program], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    throw new Error(
      `Install ${program} and make it available on PATH to manage extension packages.`,
    );
  }
  const executable = candidates.find((file) => /\.exe$/i.test(file));
  if (executable) return { file: executable, prefix: [], env };
  // Resolve the JS entry instead of forwarding untrusted sources through a cmd.exe shim.
  if (program === "pnpm") {
    for (const candidate of candidates) {
      const entry = path.join(path.dirname(candidate), "node_modules", "pnpm", "bin", "pnpm.cjs");
      if (fs.existsSync(entry))
        return {
          file: process.execPath,
          prefix: [entry],
          env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
        };
    }
  }
  throw new Error(`A native ${program} executable or pnpm Node entry is required.`);
}

/** Stream complete UTF-8 lines from argument-array subprocesses; never invoke a shell. */
export const runPackageCommand: PackageCommand = (program, args, cwd, log) =>
  new Promise((resolve, reject) => {
    const resolved = command(program);
    const child = spawn(resolved.file, [...resolved.prefix, ...args], {
      cwd,
      env: resolved.env,
      windowsHide: true,
      shell: false,
    });
    const streams = [child.stdout, child.stderr];
    for (const stream of streams) {
      const decoder = new StringDecoder("utf8");
      let buffer = "";
      const flush = (final = false) => {
        let index = buffer.indexOf("\n");
        while (index >= 0) {
          const line = buffer.slice(0, index).replace(/\r$/, "");
          buffer = buffer.slice(index + 1);
          if (line.trim()) log(line.slice(0, 4000));
          index = buffer.indexOf("\n");
        }
        if (final || buffer.length > 16000) {
          if (buffer.trim()) log(buffer.slice(0, 4000));
          buffer = "";
        }
      };
      stream.on("data", (chunk: Buffer) => {
        buffer += decoder.write(chunk);
        flush();
      });
      stream.on("end", () => {
        buffer += decoder.end();
        flush(true);
      });
    }
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${program} exited with code ${code ?? "unknown"}.`)),
    );
  });
