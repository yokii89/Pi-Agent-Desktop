/**
 * Process layer. Everything here mirrors what pi's own bash tool does on the same platform —
 * `getShellConfig()` (Git Bash on Windows), `detached` on Unix, `taskkill /F /T` for tree kills —
 * with one deliberate difference: the child is **not** handed to pi's tracked-children set.
 *
 * That difference is the whole feature. Pi kills every tracked child on shutdown
 * (`killTrackedDetachedChildren()`), which is right for a blocking tool call and wrong for a
 * dev server the user was told would keep running (doc 129 D3).
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import { getShellConfig } from "@earendil-works/pi-coding-agent";

/** Grace period for inherited stdio after `exit`, same idea as pi's `waitForChildProcess`. */
const EXIT_STDIO_GRACE_MS = 100;

/** Structural copy of pi's (unexported) `ShellConfig`. */
export interface ShellConfig {
	shell: string;
	args: string[];
	commandTransport?: "argv" | "stdin";
}

export interface ShellSpawnRequest {
	command: string;
	cwd: string;
	env?: NodeJS.ProcessEnv;
	/**
	 * Explicit shell instead of `getShellConfig()`. Used by tests (so the spawn/exit/kill paths
	 * can be exercised without Git Bash) and available to callers that must pin a shell.
	 */
	shell?: ShellConfig;
}

export interface ShellExit {
	exitCode: number | null;
	error?: Error;
}

export interface ShellChild {
	pid: number | undefined;
	/** Resolves exactly once, with the exit code or the spawn error. */
	exited: Promise<ShellExit>;
	onData(listener: (chunk: Buffer) => void): void;
	/** Kill the whole tree. Safe to call twice. */
	kill(): void;
}

/**
 * Kill a process and all of its children. Windows uses the trusted System32 taskkill so
 * cleanup does not depend on PATH; Unix kills the group, which is why `spawn` detaches.
 */
export function killProcessTree(pid: number): void {
	if (process.platform === "win32") {
		try {
			const child = spawn(
				join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"),
				["/F", "/T", "/PID", String(pid)],
				{ stdio: "ignore", detached: true, windowsHide: true },
			);
			// A failed spawn emits "error" asynchronously; consume it so it cannot crash pi.
			child.once("error", () => {});
		} catch {
			// taskkill is best effort: the process may already be gone.
		}
		return;
	}
	try {
		process.kill(-pid, "SIGKILL");
	} catch {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// Already dead.
		}
	}
}

/** Send a signal to a process group (Unix). Windows has no equivalent; `killProcessTree` is used there. */
export function signalProcessGroup(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
	try {
		process.kill(-pid, signal);
	} catch {
		try {
			process.kill(pid, signal);
		} catch {
			// Already gone.
		}
	}
}

/** Liveness probe used when restoring a snapshot. Pid reuse is not detectable here. */
export function isProcessAlive(pid: number | undefined): boolean {
	if (pid === undefined) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM means "exists, not ours"; ESRCH means gone.
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

export function spawnShellCommand(request: ShellSpawnRequest): ShellChild {
	const shellConfig = request.shell ?? getShellConfig();
	const commandFromStdin = shellConfig.commandTransport === "stdin";
	const child = spawn(
		shellConfig.shell,
		commandFromStdin ? shellConfig.args : [...shellConfig.args, request.command],
		{
			cwd: request.cwd,
			// Unix: own session/group so `process.kill(-pid)` reaches the whole tree.
			// Windows: no detach (taskkill walks the tree instead), matching pi's bash.
			detached: process.platform !== "win32",
			env: request.env ?? process.env,
			stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
			windowsHide: true,
		},
	);
	if (commandFromStdin) {
		child.stdin?.on("error", () => {});
		child.stdin?.end(request.command);
	}

	const listeners = new Set<(chunk: Buffer) => void>();
	child.stdout?.on("data", (chunk: Buffer) => {
		for (const listener of listeners) listener(chunk);
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		for (const listener of listeners) listener(chunk);
	});

	let killed = false;
	const kill = () => {
		if (killed) return;
		killed = true;
		if (child.pid !== undefined) killProcessTree(child.pid);
	};

	const exited = new Promise<ShellExit>((resolve) => {
		let settled = false;
		let exiting = false;
		let exitCode: number | null = null;
		let stdoutEnded = child.stdout === null;
		let stderrEnded = child.stderr === null;
		let idleTimer: NodeJS.Timeout | undefined;

		const finish = () => {
			if (settled) return;
			settled = true;
			if (idleTimer) clearTimeout(idleTimer);
			child.removeListener("error", onError);
			child.removeListener("exit", onExit);
			child.removeListener("close", onClose);
			child.stdout?.removeListener("end", onStdoutEnd);
			child.stderr?.removeListener("end", onStderrEnd);
			resolve({ exitCode });
		};
		const maybeFinishAfterExit = () => {
			if (exiting && !settled && stdoutEnded && stderrEnded) finish();
		};
		const armIdleTimer = () => {
			if (idleTimer) clearTimeout(idleTimer);
			// A descendant may hold the pipe open forever (Windows daemonized child); once the
			// shell itself is gone and the pipes have been quiet for the grace period, stop waiting.
			idleTimer = setTimeout(finish, EXIT_STDIO_GRACE_MS);
		};
		function onStdoutEnd() {
			stdoutEnded = true;
			maybeFinishAfterExit();
		}
		function onStderrEnd() {
			stderrEnded = true;
			maybeFinishAfterExit();
		}
		function onExit(code: number | null) {
			exiting = true;
			exitCode = code;
			maybeFinishAfterExit();
			if (!settled) armIdleTimer();
		}
		function onClose(code: number | null) {
			if (code !== null) exitCode = code;
			finish();
		}
		function onError(error: Error) {
			if (settled) return;
			settled = true;
			if (idleTimer) clearTimeout(idleTimer);
			resolve({ exitCode: null, error });
		}
		child.stdout?.once("end", onStdoutEnd);
		child.stderr?.once("end", onStderrEnd);
		child.once("error", onError);
		child.once("exit", onExit);
		child.once("close", onClose);
	});

	return {
		pid: child.pid,
		exited,
		onData(listener) {
			listeners.add(listener);
		},
		kill,
	};
}
