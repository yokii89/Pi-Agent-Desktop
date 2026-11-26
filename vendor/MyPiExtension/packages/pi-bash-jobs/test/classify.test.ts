import { describe, expect, it } from "vitest";
import { classifyCommand, commandHead } from "../core/classify.ts";

describe("commandHead", () => {
	it("falls back to the first executable body, not the whole pipeline", () => {
		expect(commandHead("ls -la")).toBe("ls -la");
		expect(commandHead("pnpm dev | tee dev.log")).toBe("pnpm dev");
		expect(commandHead("curl -o x.tar https://x && echo done")).toBe("curl -o x.tar https://x");
	});

	it("skips `cd` and variable-assignment segments", () => {
		expect(commandHead("cd /d/app && pnpm run dev")).toBe("pnpm run dev");
		expect(commandHead("cd /d/app")).toBe("cd /d/app");
		expect(commandHead("FOO=1 BAR=2")).toBe("FOO=1 BAR=2");
		expect(commandHead("FOO=1 pnpm dev")).toBe("pnpm dev");
	});

	it("strips wrapper words and their flags", () => {
		expect(commandHead("sudo -u root pnpm dev")).toBe("pnpm dev");
		expect(commandHead("nohup env FOO=1 ./serve.sh")).toBe("serve");
	});

	it("unwraps launchers but keeps package managers visible", () => {
		expect(commandHead("npx vite --port 3000")).toBe("vite --port 3000");
		expect(commandHead("pnpm exec tsc -w")).toBe("tsc -w");
		expect(commandHead("pnpm dlx serve dist")).toBe("serve dist");
		expect(commandHead("pnpm dev")).toBe("pnpm dev");
		expect(commandHead("npm run build")).toBe("npm run build");
	});

	it("skips a launcher's own flags and a pinned version", () => {
		// `npx --yes vite` used to read as the program `--yes`; `serve@14` as a program named `serve@14`.
		expect(commandHead("npx --yes vite")).toBe("vite");
		expect(commandHead("npx -y --package=serve serve dist")).toBe("serve dist");
		expect(commandHead("pnpm dlx serve@14 dist")).toBe("serve dist");
		expect(commandHead("npx @vue/cli-service dev")).toBe("@vue/cli-service dev");
	});

	it("normalizes absolute Windows paths and script extensions", () => {
		expect(commandHead("C:\\Program Files\\Git\\bin\\bash.exe -c pnpm_dev")).toBe("bash -c pnpm_dev");
		expect(commandHead('"/c/Program Files/nodejs/npm.cmd" run dev')).toBe("npm run dev");
	});
});

describe("classifyCommand", () => {
	it.each([
		["pnpm dev", "detach"],
		["pnpm run dev", "detach"],
		["npm run dev:web", "detach"],
		["cd /d/code && pnpm dev", "detach"],
		["npx vite", "detach"],
		["next dev", "detach"],
		["nodemon server.js", "detach"],
		["tsc --watch", "detach"],
		["webpack serve", "detach"],
		["python -m http.server 8000", "detach"],
		["uvicorn app:app", "detach"],
		["flask run", "detach"],
		["docker compose up", "detach"],
		["tail -f dev.log", "detach"],
		["watch -n 2 date", "detach"],
		["ngrok http 3000", "detach"],
		["hugo server", "detach"],
		["astro dev", "detach"],
	] as const)("%s → %s", (command, mode) => {
		expect(classifyCommand(command).mode).toBe(mode);
	});

	it.each([
		["docker compose up -d", "finish"],
		["ls -la", "finish"],
		["pnpm build", "finish"],
		["git status", "finish"],
		["./node_modules/electron/dist/electron.exe /tmp/zoom-smoke.cjs 2>&1 | tail -40", "finish"],
		["tail -n 40 dev.log", "finish"],
	] as const)("%s → %s", (command, mode) => {
		expect(classifyCommand(command).mode).toBe(mode);
	});

	it.each([
		["curl -o isubs.tar.zst https://x", "long"],
		["curl -O https://x", "long"],
		["wget https://x", "long"],
		["git clone https://github.com/x/y", "long"],
		["docker pull node:22", "long"],
		["docker build -t app .", "long"],
		["pnpm install", "long"],
		["npm i", "long"],
		["pip install torch", "long"],
		["ffmpeg -i in.mp4 out.mp4", "long"],
		["yt-dlp https://x", "long"],
		["robocopy a b /E", "long"],
	] as const)("%s → %s", (command, mode) => {
		expect(classifyCommand(command).mode).toBe(mode);
	});

	it("reports the rule that matched, so a wrong classification is debuggable", () => {
		expect(classifyCommand("pnpm dev").reason).toBe("npm/pnpm/yarn/bun dev");
		expect(classifyCommand("ls").reason).toBe("default");
		expect(classifyCommand("ls").head).toBe("ls");
	});

	it("lets user patterns extend the default set", () => {
		expect(classifyCommand("cargo watch", { extraDetachPatterns: ["^cargo watch"] })).toMatchObject({
			mode: "detach",
			reason: "custom detach: ^cargo watch",
		});
		expect(classifyCommand("my-downloader 1", { extraLongPatterns: ["^my-downloader"] }).mode).toBe("long");
	});

	it("ignores extra patterns that do not compile", () => {
		// One hand-edited settings entry must not take every bash call down with a RegExp error.
		expect(classifyCommand("ntool", { extraDetachPatterns: ["["] }).mode).toBe("finish");
		expect(classifyCommand("ntool", { extraDetachPatterns: ["[", "^ntool$"] }).mode).toBe("detach");
		expect(classifyCommand("ls", { extraLongPatterns: ["(unclosed"] }).mode).toBe("finish");
	});

	it.each([
		["npx --yes vite", "detach"],
		["npx -y vite", "detach"],
		["pnpm dlx serve@14 dist", "detach"],
		["npx --yes serve dist", "detach"],
		["npx --yes next dev", "detach"],
	] as const)("%s → %s (launcher flags and versions)", (command, mode) => {
		expect(classifyCommand(command).mode).toBe(mode);
	});

	it("never over-matches a substring it should not see (the whole point of the head)", () => {
		// The command *mentions* vite in a log path, but runs `rm`.
		expect(classifyCommand("rm -rf node_modules/.vite").mode).toBe("finish");
	});
});
