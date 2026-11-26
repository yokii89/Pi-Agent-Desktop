import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { BUNDLED_SKILLS } from "../extensions/pi-codex-skills/catalog.ts";
import { ManagedSkillInstaller } from "../extensions/pi-codex-skills/installer.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = resolve(packageRoot, "extensions", "pi-codex-skills", "index.ts");

interface RpcCommand {
	name: string;
	source: string;
	sourceInfo?: {
		path?: string;
		source?: string;
		scope?: string;
		baseDir?: string;
	};
}

function resolvePiCli(): { command: string; argsPrefix: string[] } {
	const envCli = process.env.PI_CLI_PATH;
	if (envCli && existsSync(envCli)) {
		return { command: process.execPath, argsPrefix: [envCli] };
	}

	// Prefer the published global install on Windows. Spawning `pi.cmd` with piped
	// stdin hangs under several Node spawn modes, so invoke cli.js with node.
	if (process.platform === "win32") {
		const appData = process.env.APPDATA;
		if (!appData) throw new Error("APPDATA is required to locate the Windows global Pi installation");
		const globalCli = join(appData, "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
		if (!existsSync(globalCli)) {
			throw new Error(`Installed Pi CLI not found at ${globalCli}. Install @earendil-works/pi-coding-agent >= 0.80.10.`);
		}
		return { command: process.execPath, argsPrefix: [globalCli] };
	}

	return { command: "pi", argsPrefix: [] };
}

async function getCommands(agentDir: string): Promise<RpcCommand[]> {
	return await new Promise<RpcCommand[]>((resolveCommands, reject) => {
		const { command, argsPrefix } = resolvePiCli();
		const args = [
			...argsPrefix,
			"--mode",
			"rpc",
			"--no-session",
			"--offline",
			"--no-extensions",
			"-e",
			extensionPath,
		];
		const child = spawn(command, args, {
			env: {
				...process.env,
				// Force Pi to discover the managed install under the isolated agent dir.
				PI_CODING_AGENT_DIR: agentDir,
			},
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		let output = "";
		let errors = "";
		let settled = false;

		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			try {
				child.kill();
			} catch {
				// ignore
			}
			fn();
		};

		const timeout = setTimeout(() => {
			finish(() => {
				reject(new Error(`Pi RPC get_commands timed out.\nstdout: ${output}\nstderr: ${errors}`));
			});
		}, 15_000);

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			output += chunk;
			for (;;) {
				const newline = output.indexOf("\n");
				if (newline === -1) return;
				const line = output.slice(0, newline).trim();
				output = output.slice(newline + 1);
				if (!line) continue;
				let response: { id?: string; success?: boolean; data?: { commands?: RpcCommand[] }; error?: string };
				try {
					response = JSON.parse(line) as typeof response;
				} catch {
					continue;
				}
				if (response.id !== "commands") continue;
				finish(() => {
					if (!response.success) {
						reject(new Error(response.error ?? "Pi rejected get_commands"));
						return;
					}
					resolveCommands(response.data?.commands ?? []);
				});
				return;
			}
		});
		child.stderr.on("data", (chunk: string) => {
			errors += chunk;
		});
		child.on("error", (error) => {
			finish(() => reject(error));
		});
		child.on("close", (code) => {
			if (settled) return;
			finish(() => {
				reject(new Error(`Pi RPC exited before get_commands (code=${code}).\nstdout: ${output}\nstderr: ${errors}`));
			});
		});
		child.stdin.end('{"id":"commands","type":"get_commands"}\n');
	});
}

test("Pi reloads every managed skill from its canonical target", { skip: process.env.PI_CODEX_SKILLS_SMOKE !== "1" }, async () => {
	const home = await mkdtemp(join(tmpdir(), "pi-codex-skills-pi-"));
	try {
		const agentDir = join(home, "agent");
		const installer = new ManagedSkillInstaller({ packageRoot, agentDir, extensionVersion: "test" });
		const plans = BUNDLED_SKILLS.map((skill) => installer.plan("install", skill.name, []));
		for (const plan of plans) await installer.apply(plan);

		const commands = await getCommands(agentDir);
		const extensionCommand = commands.find((command) => command.name === "skills");

		assert.equal(extensionCommand?.source, "extension");
		for (const plan of plans) {
			const skillCommand = commands.find((command) => command.name === `skill:${plan.skill}`);
			assert.equal(skillCommand?.source, "skill", plan.skill);
			assert.equal(resolve(skillCommand?.sourceInfo?.path ?? ""), resolve(plan.target, "SKILL.md"), plan.skill);
			// Discovery must come from the managed user tree, not a temporary --skill injection.
			assert.equal(skillCommand?.sourceInfo?.scope, "user", plan.skill);
			assert.equal(skillCommand?.sourceInfo?.source, "auto", plan.skill);
			assert.equal(resolve(skillCommand?.sourceInfo?.baseDir ?? ""), resolve(agentDir), plan.skill);
		}
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
