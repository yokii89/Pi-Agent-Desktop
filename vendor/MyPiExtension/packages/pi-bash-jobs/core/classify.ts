/**
 * Command → mode (doc 129 §5.2). Pure string work: no fs, no spawn, no clock.
 *
 * The matching target is the *executable body* of the command, not its text: a command may
 * be wrapped in `cd X &&`, prefixed with `FOO=1`, invoked through `sudo`, `npx`, or by an
 * absolute Windows path. All of those are stripped first, because `cd /d/app && pnpm dev`
 * and `pnpm dev` are the same command to a user.
 *
 * The classification is deliberately allowed to be wrong in only one direction: a missed
 * match falls back to `finish`, and `finish` does not kill — it yields after the soft budget
 * (doc 129 §5.2 「本设计里最关键的一条冗余」). Over-matching would be the dangerous error.
 */

import type { JobMode } from "../types.ts";

export interface ClassifyOptions {
	extraDetachPatterns?: string[];
	extraLongPatterns?: string[];
}

export interface ClassifiedCommand {
	mode: JobMode;
	/** Human-readable rule that produced the mode, or `default`. */
	reason: string;
	/** Normalized executable body, surfaced in receipts so a wrong call is debuggable. */
	head: string;
}

interface Rule {
	mode: JobMode;
	label: string;
	test: RegExp;
}

/** Long-running servers: never auto-killed, never blocked on (doc 129 §5.2 `detach`). */
const DETACH_RULES: Rule[] = [
	{ mode: "detach", label: "vite", test: /^vite(?:\s|$)/ },
	{ mode: "detach", label: "next dev", test: /^next\s+dev\b/ },
	{ mode: "detach", label: "npm/pnpm/yarn/bun dev", test: /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?dev\b/ },
	{ mode: "detach", label: "nodemon", test: /^nodemon\b/ },
	{ mode: "detach", label: "tsc --watch", test: /^tsc\b.*\s(?:-w|--watch)(?:\s|$)/ },
	{ mode: "detach", label: "webpack", test: /^webpack(?:\s+serve)?(?:\s|$)/ },
	{ mode: "detach", label: "python -m http.server", test: /^python[0-9.]*\s+-m\s+http\.server\b/ },
	{ mode: "detach", label: "uvicorn", test: /^uvicorn\b/ },
	{ mode: "detach", label: "flask run", test: /^flask\s+run\b/ },
	// `docker compose up -d` returns on its own; only the foreground form blocks.
	{ mode: "detach", label: "docker compose up", test: /^docker(?:-compose|\s+compose)\s+up\b(?![\s\S]*\s-d(?:\s|$))/ },
	{ mode: "detach", label: "tail -f", test: /^tail\b.*-[a-zA-Z0-9]*f(?:\s|$)/ },
	{ mode: "detach", label: "watch", test: /^watch(?:\s|$)/ },
	{ mode: "detach", label: "ngrok", test: /^ngrok\b/ },
	{ mode: "detach", label: "serve", test: /^serve(?:\s|$)/ },
	{ mode: "detach", label: "hugo server", test: /^hugo\s+server\b/ },
	{
		mode: "detach",
		label: "framework dev/serve",
		test: /^(?:astro|ng|remix|nuxt|expo|storybook)\s+(?:dev|serve|start)\b/,
	},
];

/** Long tasks: worth yielding early, but the caller usually wants the exit code eventually. */
const LONG_RULES: Rule[] = [
	{ mode: "long", label: "curl download", test: /^curl\b.*\s(?:-o|-O|--output)(?:\s|=|$)/ },
	{ mode: "long", label: "wget", test: /^wget(?:\s|$)/ },
	{ mode: "long", label: "git clone", test: /^git\s+clone\b/ },
	{ mode: "long", label: "docker pull/build/push", test: /^docker\s+(?:pull|build|push)\b/ },
	{ mode: "long", label: "install dependencies", test: /^(?:npm|pnpm|yarn|bun)\s+(?:i|install|add|ci)\b/ },
	{ mode: "long", label: "pip install", test: /^pip[0-9.]*\s+install\b/ },
	{ mode: "long", label: "ffmpeg", test: /^ffmpeg\b/ },
	{ mode: "long", label: "yt-dlp", test: /^yt-dlp\b/ },
	{ mode: "long", label: "rsync", test: /^rsync\b/ },
	{ mode: "long", label: "robocopy", test: /^robocopy\b/ },
	{ mode: "long", label: "certbot", test: /^certbot\b/ },
	{ mode: "long", label: "make", test: /^make\b/ },
];

/** Leading words that only wrap the real command. Stripped repeatedly (`sudo env X=1 …`). */
const WRAPPER_WORDS = new Set([
	"sudo",
	"command",
	"builtin",
	"exec",
	"nohup",
	"time",
	"winpty",
	"nice",
	"stdbuf",
	"env",
]);

/** Package-manager launchers whose next token is the real program (`npx vite`, `pnpm exec tsc`). */
const RUNNER_PROGRAMS = new Set(["npx", "pnpx", "bunx"]);
/** Launcher flags that consume the next token (`npx -p pkg cmd`), so it is not taken for a program. */
const RUNNER_FLAGS_WITH_VALUE = new Set(["-p", "--package", "-c", "--call", "--shell"]);
/** Package managers keep their own name in the head: `pnpm run dev` must still read as a dev server. */
const PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);

const SHELL_EXTENSIONS = /\.(?:exe|cmd|bat|com|sh)$/i;

/**
 * An absolute script path may contain spaces (`C:\Program Files\Git\bin\bash.exe`).
 * Bash only accepts it quoted, but models write it bare, so the first token is pulled out by
 * path shape before ordinary tokenizing.
 */
const ABSOLUTE_SCRIPT_PATH = /^(?:[A-Za-z]:[\\/]|\/)[\s\S]*?\.(?:exe|cmd|bat|com|sh)(?=\s|$)/i;

/** Short flags that consume the following token, per wrapper program (`sudo -u root cmd`). */
const WRAPPER_FLAGS_WITH_VALUE: Record<string, Set<string>> = {
	sudo: new Set(["-u", "-g", "-p", "-U", "-C", "-h", "-r", "-t", "-T", "--user", "--group", "--prompt", "--chdir"]),
	env: new Set(["-u", "--unset", "-C", "--chdir"]),
	nice: new Set(["-n", "--adjustment"]),
	stdbuf: new Set(["-i", "-o", "-e"]),
};

function splitSegments(command: string): string[] {
	// `||` must be tried before `|` so the empty alternative is not produced.
	return command
		.split(/\s*(?:&&|\|\||;|\r?\n|\|)\s*/)
		.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0);
}

function tokenize(segment: string): string[] {
	const tokens: string[] = [];
	const scriptPath = ABSOLUTE_SCRIPT_PATH.exec(segment);
	if (scriptPath) {
		tokens.push(scriptPath[0]);
		segment = segment.slice(scriptPath[0].length).trim();
	}
	let current = "";
	let quote: '"' | "'" | undefined;
	for (const char of segment) {
		if (quote) {
			if (char === quote) quote = undefined;
			else current += char;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			if (current) tokens.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	if (current) tokens.push(current);
	return tokens;
}

function basename(token: string): string {
	const lastSlash = Math.max(token.lastIndexOf("/"), token.lastIndexOf("\\"));
	return SHELL_EXTENSIONS.test(token) ? token.slice(lastSlash + 1).replace(SHELL_EXTENSIONS, "") : token;
}

/** `serve@14` and `serve@14.1.0` are the same program as `serve`; `@vue/cli` is a scope, not a version. */
function stripVersion(token: string): string {
	if (token.startsWith("@")) return token;
	const at = token.lastIndexOf("@");
	return at > 0 ? token.slice(0, at) : token;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Strip everything in front of the executable body. Returns the joined tokens
 * (`"pnpm run dev --port 3000"`) so rules can look at arguments too.
 */
export function commandHead(command: string): string {
	for (const segment of splitSegments(command)) {
		let tokens = tokenize(segment);
		// A segment that is only `cd …` or only `FOO=bar` sets context, it does not run.
		if (tokens[0]?.toLowerCase() === "cd") continue;
		while (tokens.length > 0 && ASSIGNMENT.test(tokens[0] as string)) tokens.shift();
		if (tokens.length === 0) continue;
		// `env FOO=1 cmd`, `sudo -u root cmd`, …: drop wrapper words and their flags.
		for (;;) {
			const first = tokens[0]?.toLowerCase() ?? "";
			if (!WRAPPER_WORDS.has(first)) break;
			const valued = WRAPPER_FLAGS_WITH_VALUE[first];
			tokens = tokens.slice(1);
			while (tokens.length > 0 && (tokens[0] as string).startsWith("-")) {
				const flag = (tokens[0] as string).toLowerCase();
				tokens = tokens.slice(1);
				// `sudo -u root cmd`: the user name is the flag's argument, not the program.
				if (valued?.has(flag) && tokens.length > 0 && !(tokens[0] as string).startsWith("-"))
					tokens = tokens.slice(1);
			}
			while (tokens.length > 0 && ASSIGNMENT.test(tokens[0] as string)) tokens = tokens.slice(1);
			if (tokens.length === 0) break;
		}
		if (tokens.length === 0) continue;
		// `npx vite` / `pnpm exec tsc -w` / `pnpm dlx serve`: the wrapper consumes its own words.
		// A plain package-manager call keeps its name — `pnpm run dev` is matched by the dev rule.
		const program = (tokens[0] as string).toLowerCase();
		let unwrapped = false;
		if (RUNNER_PROGRAMS.has(program)) {
			tokens = tokens.slice(1);
			unwrapped = true;
		} else if (PACKAGE_MANAGERS.has(program)) {
			const verb = tokens[1]?.toLowerCase();
			if (verb === "exec" || verb === "dlx") {
				tokens = tokens.slice(2);
				unwrapped = true;
			}
		}
		if (unwrapped) {
			// The launcher's own flags sit between it and the program: without this, `npx --yes vite`
			// reads as the program `--yes` and a dev server is classified as `finish`.
			while (tokens.length > 0 && (tokens[0] as string).startsWith("-")) {
				const flag = (tokens[0] as string).toLowerCase();
				tokens = tokens.slice(1);
				if (RUNNER_FLAGS_WITH_VALUE.has(flag) && tokens.length > 0 && !(tokens[0] as string).startsWith("-")) {
					tokens = tokens.slice(1);
				}
			}
		}
		if (tokens.length === 0) continue;
		tokens = [stripVersion(basename(tokens[0] as string)), ...tokens.slice(1)];
		return tokens.join(" ");
	}
	return command.trim();
}

function toRules(patterns: string[] | undefined, mode: JobMode): Rule[] {
	if (!patterns || patterns.length === 0) return [];
	const rules: Rule[] = [];
	for (const pattern of patterns) {
		let test: RegExp;
		try {
			test = new RegExp(pattern, "i");
		} catch {
			// Config loading already drops these; a caller passing patterns straight in gets the same
			// tolerance, because one bad expression must not fail every bash call.
			continue;
		}
		rules.push({ mode, label: `custom ${mode}: ${pattern}`, test });
	}
	return rules;
}

/**
 * Decide a mode for one command. Explicit `mode` / `timeout` arguments are applied by the
 * caller before this runs (doc 129 §5.1 priority 1–2); this function is priority 3–4 only.
 */
export function classifyCommand(command: string, options: ClassifyOptions = {}): ClassifiedCommand {
	const head = commandHead(command);
	// Detach before long: a server mistaken for a download would still never be killed, but a
	// download mistaken for a server would never wake the model on completion.
	const rules = [
		...toRules(options.extraDetachPatterns, "detach"),
		...DETACH_RULES,
		...toRules(options.extraLongPatterns, "long"),
		...LONG_RULES,
	];
	for (const rule of rules) {
		if (rule.test.test(head)) return { mode: rule.mode, reason: rule.label, head };
	}
	return { mode: "finish", reason: "default", head };
}
