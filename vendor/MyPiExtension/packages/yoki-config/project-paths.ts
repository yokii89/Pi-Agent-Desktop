/**
 * Project-scoped yoki domain paths under Pi's project tree.
 *
 *   <cwd>/.pi/yoki/<domain>/...
 *
 * Domains: artifacts, workflows, guidance, todo. Pi-native surfaces
 * (`.pi/skills`, `.pi/mcp.json`, `.pi/agents`) and XDG user config
 * (`~/.config/yoki-*`) are orthogonal and intentionally not unified here.
 */

import { join } from "node:path";

/** Absolute path segments under `<cwd>` for the unified yoki project root. */
export const PROJECT_YOKI_SEGMENTS = [".pi", "yoki"] as const;

/** Absolute path to `<cwd>/.pi/yoki`. */
export function projectYokiRoot(cwd: string): string {
	return join(cwd, ...PROJECT_YOKI_SEGMENTS);
}

/**
 * Absolute path to a domain (and optional rest) under the project yoki root.
 *
 * @example projectYokiDomain(cwd, "workflows") → `<cwd>/.pi/yoki/workflows`
 * @example projectYokiDomain(cwd, "artifacts", "research") → `…/artifacts/research`
 */
export function projectYokiDomain(cwd: string, name: string, ...rest: string[]): string {
	return join(projectYokiRoot(cwd), name, ...rest);
}

/**
 * Forward-slash relative prefixes for skills, collectors, docs, and user-facing
 * strings. Never build these with platform `join` when they must appear in
 * transcripts / regex — separators must stay `/` on every OS.
 */
export const REL = {
	root: ".pi/yoki",
	artifacts: ".pi/yoki/artifacts",
	workflows: ".pi/yoki/workflows",
	guidance: ".pi/yoki/guidance",
	todo: ".pi/yoki/todo",
} as const;
