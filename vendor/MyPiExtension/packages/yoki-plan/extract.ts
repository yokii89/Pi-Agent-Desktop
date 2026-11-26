/**
 * Pure plan-document extractors for post-plan TUI.
 * Port/strengthen of pi examples/extensions/plan-mode extractTodoItems + ready marker.
 */

import { createHash } from "node:crypto";

/** Case-insensitive ready marker (compare via upper-case normalize). */
export const PLAN_READY_MARKER = "[PLAN READY]";

export interface PlanStep {
	/** 1-based step index as written. */
	step: number;
	/** Step text with light markdown cleanup; full length kept for execute/fingerprint. */
	text: string;
}

/** True when the assistant message contains an explicit ready marker. */
export function hasPlanReady(message: string): boolean {
	return message.toUpperCase().includes(PLAN_READY_MARKER.toUpperCase());
}

/**
 * Extract numbered steps under a `Plan:` section.
 * Accepts `1. …` / `1) …`, optional bold around the header or step text.
 * Returns [] when the section is missing or no valid steps are found.
 */
export function extractPlanSteps(message: string): PlanStep[] {
	const headerMatch = message.match(/\*{0,2}Plan:\*{0,2}\s*\n/i);
	if (!headerMatch || headerMatch.index === undefined) return [];

	const planSection = message.slice(headerMatch.index + headerMatch[0].length);
	// Stop at blank line followed by non-numbered content, or at [PLAN READY].
	const endReady = planSection.search(/\[PLAN READY\]/i);
	const body = endReady >= 0 ? planSection.slice(0, endReady) : planSection;

	const items: PlanStep[] = [];
	const numberedPattern = /^\s*(\d+)[.)]\s+(.+)$/gm;

	for (const match of body.matchAll(numberedPattern)) {
		const raw = match[2] ?? "";
		const text = cleanStepText(raw);
		if (text.length === 0) continue;
		items.push({ step: items.length + 1, text });
	}

	return items;
}

/** Light cleanup: strip wrapping bold/code; collapse whitespace; no truncation. */
export function cleanStepText(text: string): string {
	return text
		.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/\*{1,2}$/g, "")
		.trim();
}

/**
 * Stable fingerprint for dedup: sha256 of normalized step texts joined by newline.
 * Empty steps → empty string (caller should not prompt).
 */
export function planFingerprint(steps: readonly PlanStep[]): string {
	if (steps.length === 0) return "";
	const normalized = steps
		.map((s) => s.text.trim().toLowerCase().replace(/\s+/g, " "))
		.filter((t) => t.length > 0)
		.join("\n");
	if (!normalized) return "";
	return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/** Parse ready + steps; returns undefined when either contract half is missing. */
export function parseReadyPlan(message: string): { steps: PlanStep[]; fingerprint: string } | undefined {
	if (!hasPlanReady(message)) return undefined;
	const steps = extractPlanSteps(message);
	if (steps.length === 0) return undefined;
	const fingerprint = planFingerprint(steps);
	if (!fingerprint) return undefined;
	return { steps, fingerprint };
}

/** Short topic slug from first step (filename-safe). */
export function topicSlugFromSteps(steps: readonly PlanStep[], maxLen = 40): string {
	const first = steps[0]?.text ?? "plan";
	const slug = first
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, maxLen)
		.replace(/-+$/g, "");
	return slug.length > 0 ? slug : "plan";
}
