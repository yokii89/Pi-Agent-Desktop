/**
 * Persist exploration plans under `{cwd}/.pi/yoki/artifacts/plans/`.
 * Written by the extension process (node:fs) — not the agent write tool.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { projectYokiDomain, REL } from "@yoki/yoki-config";
import type { PlanStep } from "./extract.ts";
import { topicSlugFromSteps } from "./extract.ts";

export const PLAN_ARTIFACT_SOURCE = "yoki-plan";

export interface WritePlanArtifactInput {
	cwd: string;
	steps: readonly PlanStep[];
	/** Optional short title; defaults from first step. */
	topic?: string;
	/** ISO timestamp; defaults to now. */
	date?: Date;
	/** Optional overview / excerpt above the step list. */
	overview?: string;
}

export interface WritePlanArtifactResult {
	/** Absolute path written. */
	absolutePath: string;
	/** Path relative to cwd using `/` separators. */
	relativePath: string;
	/** Filename only. */
	filename: string;
}

/** Absolute plans directory for a project cwd. */
export function plansDir(cwd: string): string {
	return projectYokiDomain(cwd, "artifacts", "plans");
}

/** Ensure `.pi/yoki/artifacts/plans/` exists. */
export async function ensurePlansDir(cwd: string): Promise<string> {
	const dir = plansDir(cwd);
	await mkdir(dir, { recursive: true });
	return dir;
}

/** Local timestamp slug: `2026-07-21_14-30-00`. */
export function formatPlanSlug(date: Date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
		`_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
	);
}

/** ISO string for frontmatter (local offset preserved via toISOString for simplicity). */
export function formatIso(date: Date = new Date()): string {
	return date.toISOString();
}

export function buildPlanMarkdown(input: {
	steps: readonly PlanStep[];
	topic: string;
	dateIso: string;
	overview?: string;
}): string {
	const { steps, topic, dateIso, overview } = input;
	const frontmatter = [
		"---",
		`date: ${dateIso}`,
		`source: ${PLAN_ARTIFACT_SOURCE}`,
		"status: ready",
		`topic: ${yamlString(topic)}`,
		"tags: [plan, plan-mode]",
		`steps_count: ${steps.length}`,
		`last_updated: ${dateIso}`,
		"---",
		"",
	].join("\n");

	const bodyParts: string[] = [`# ${topic}`, ""];
	if (overview?.trim()) {
		bodyParts.push(overview.trim(), "");
	}
	bodyParts.push("## Plan", "");
	for (const step of steps) {
		bodyParts.push(`${step.step}. ${step.text}`);
	}
	bodyParts.push("");
	return frontmatter + bodyParts.join("\n");
}

function yamlString(value: string): string {
	// Quote when special chars present; escape double quotes.
	if (/[:#{}[\],&*!|>'"%@`]|^\s|\s$/.test(value) || value.includes("\n")) {
		return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	}
	return value;
}

/**
 * Write an exploration plan artifact.
 * Filename: `<slug>_<topic>.md` under `.pi/yoki/artifacts/plans/`.
 */
export async function writePlanArtifact(input: WritePlanArtifactInput): Promise<WritePlanArtifactResult> {
	const date = input.date ?? new Date();
	const topic = (input.topic ?? topicSlugFromSteps(input.steps)).trim() || "plan";
	const topicForFile = topicSlugFromSteps([{ step: 1, text: topic }], 48);
	const filename = `${formatPlanSlug(date)}_${topicForFile}.md`;
	const dir = await ensurePlansDir(input.cwd);
	const absolutePath = join(dir, filename);
	const markdown = buildPlanMarkdown({
		steps: input.steps,
		topic,
		dateIso: formatIso(date),
		overview: input.overview,
	});
	await writeFile(absolutePath, markdown, "utf8");
	const relativePath = `${REL.artifacts}/plans/${filename}`.replace(/\\/g, "/");
	// Prefer cwd-relative when possible for notify; keep forward slashes.
	const fromCwd = relative(input.cwd, absolutePath).replace(/\\/g, "/");
	return {
		absolutePath,
		relativePath: fromCwd.length > 0 && !fromCwd.startsWith("..") ? fromCwd : relativePath,
		filename,
	};
}
