import type { ViewNode, ViewSpec } from "@pidesk/view-sdk";
import { describe, expect, it, vi } from "vitest";
import { buildDesktopQuestionnaireSpec, presentQuestionnaireOnDesktop } from "../desktop-view.ts";
import type { QuestionnaireResult, QuestionParams } from "../tool/types.ts";

const PARAMS: QuestionParams = {
	questions: [
		{
			question: "Which library?",
			header: "Library",
			options: [
				{ label: "A", description: "fast" },
				{ label: "B", description: "slow" },
			],
		},
		{
			question: "Which features?",
			header: "Features",
			multiSelect: true,
			options: [
				{ label: "Auth", description: "login" },
				{ label: "Billing", description: "pay" },
			],
		},
	],
};

const SINGLE: QuestionParams = {
	questions: [
		{
			question: "Which library?",
			header: "Library",
			options: [
				{ label: "A", description: "fast" },
				{ label: "B", description: "slow" },
			],
		},
	],
};

type ChangeEvent = { type: "change"; nodeId: string; value: unknown };
type ActionEvent = { type: "action"; actionId: string; values?: Record<string, unknown> };
type TestEvent = ChangeEvent | ActionEvent;

interface ClientHarness {
	updates: ViewSpec[];
	closes: Array<{ action?: string; values?: Record<string, unknown> }>;
	send(event: TestEvent): void;
	settle(result: { action?: string; values?: Record<string, unknown> }): void;
	waitForOpen(): Promise<void>;
	open: ReturnType<typeof vi.fn>;
	dispose: ReturnType<typeof vi.fn>;
}

/** Fake DesktopViewClient：记录 update 回显 / close，可手动派发 Host 事件。 */
function makeClient(): ClientHarness {
	const updates: ViewSpec[] = [];
	const closes: Array<{ action?: string; values?: Record<string, unknown> }> = [];
	let handler: ((event: TestEvent, session: unknown) => void) | null = null;
	let resolveOpen: ((result: { action?: string; values?: Record<string, unknown> }) => void) | null = null;
	let markOpened!: () => void;
	const opened = new Promise<void>((resolve) => {
		markOpened = resolve;
	});
	const session = {
		update: (spec: ViewSpec) => updates.push(spec),
		close: (result: { action?: string; values?: Record<string, unknown> }) => {
			closes.push(result);
			resolveOpen?.(result);
		},
	};
	const open = vi.fn(async (_spec: ViewSpec, opts?: { onEvent?: (event: TestEvent, session: unknown) => void }) => {
		handler = opts?.onEvent ?? null;
		markOpened();
		return await new Promise((resolve) => {
			resolveOpen = resolve;
		});
	});
	return {
		updates,
		closes,
		send: (event) => handler?.(event, session),
		settle: (result) => resolveOpen?.(result),
		waitForOpen: () => opened,
		open,
		dispose: vi.fn(),
	};
}

/** 遍历整树（含非激活页签）；tabs 的子节点用一个 column 壳收集，不入 nodeTypes 计数。 */
function walkNodes(node: ViewNode, acc: ViewNode[] = []): ViewNode[] {
	acc.push(node);
	if ("children" in node && Array.isArray(node.children)) {
		for (const c of node.children) walkNodes(c, acc);
	}
	if (node.type === "tabs") {
		for (const tab of node.tabs) walkNodes({ type: "column", children: tab.children }, acc);
	}
	return acc;
}

function hasNodeType(root: ViewNode, type: ViewNode["type"]): boolean {
	return walkNodes(root).some((n) => n.type === type);
}

/** 起一个桌面会话，并等 `open()` 挂上 handler。旧测试直发事件会抢在它之前，
 * 所以把流程用例共用的五行收成一个 helper。 */
async function startDesktopSession(
	params: QuestionParams,
): Promise<{ client: ClientHarness; pending: Promise<QuestionnaireResult | null> }> {
	const client = makeClient();
	const pending = presentQuestionnaireOnDesktop(params, { deps: { connect: () => client as never } });
	await client.waitForOpen();
	return { client, pending };
}

function lastUpdate(client: ClientHarness): ViewSpec {
	const spec = client.updates.at(-1);
	if (!spec) throw new Error("no update echoed");
	return spec;
}

/** open() 的首个 spec：会话还没回显过任何 update 时读它。 */
function firstSpec(client: ClientHarness): ViewSpec {
	const spec = client.open.mock.calls[0]?.[0];
	if (!spec) throw new Error("open() never called");
	return spec as ViewSpec;
}

function walkIds(node: ViewNode, acc: string[] = []): string[] {
	if ("id" in node && typeof node.id === "string") acc.push(node.id);
	if ("children" in node && Array.isArray(node.children)) {
		for (const c of node.children) walkIds(c, acc);
	}
	if (node.type === "tabs") {
		for (const tab of node.tabs) {
			acc.push(`tab:${tab.id}`);
			for (const child of tab.children) walkIds(child, acc);
		}
	}
	return acc;
}

function tabsOf(spec: ViewSpec): Extract<ViewNode, { type: "tabs" }> {
	if (spec.root.type !== "tabs") throw new Error(`expected tabs root, got ${spec.root.type}`);
	return spec.root;
}

describe("desktop questionnaire spec", () => {
	it("single-question dialogs keep the flat card column (no tab bar)", () => {
		const spec = buildDesktopQuestionnaireSpec(SINGLE);
		expect(spec.placement).toBe("widget");
		expect(spec.placementRequired).toBe(true);
		expect(spec.placementHint).toEqual({ side: "aboveEditor", floating: true });
		expect(spec.actions?.map((a) => a.id)).toEqual(["cancel", "submit"]);
		expect(spec.root.type).toBe("column");
		if (spec.root.type !== "column") throw new Error("root");
		expect(spec.root.children).toHaveLength(1);
		expect(spec.root.children[0].type).toBe("card");
	});

	it("multi-question dialogs build a tabs tree: one tab per question + review tab", () => {
		const spec = buildDesktopQuestionnaireSpec(PARAMS);
		const root = tabsOf(spec);
		expect(root.id).toBe("questionnaire-tabs");
		expect(root.tabs.map((t) => t.id)).toEqual(["q0", "q1", "review"]);
		expect(root.tabs.map((t) => t.label)).toEqual(["Library", "Features", "复核"]);
		// 初始：全部未答 → 题目页签无 status，复核页 attention
		expect(root.tabs[0].status).toBeUndefined();
		expect(root.tabs[2].status).toBe("attention");
		expect(root.activeTab).toBe("q0");
	});

	it("tabs mode keeps the unified free-text input and per-question ids", () => {
		const ids = walkIds(buildDesktopQuestionnaireSpec(PARAMS).root);
		expect(ids).toContain("tab:q0");
		expect(ids).toContain("tab:q1");
		expect(ids).toContain("tab:review");
		expect(ids).toContain("q0");
		expect(ids).toContain("q0-custom");
		expect(ids).toContain("q1");
		expect(ids).not.toContain("q0-notes");
	});

	it("question tabs carry no advance button; review keeps only progress + summary rows", () => {
		const root = tabsOf(buildDesktopQuestionnaireSpec(PARAMS));
		// 推进控件收归 footer：页签内只剩「本题答案」相关节点，两处并存会让用户分不清出路
		expect(root.tabs[0].children.filter((n) => n.type === "button")).toEqual([]);
		expect(root.tabs[1].children.filter((n) => n.type === "button")).toEqual([]);

		const reviewChildren = root.tabs[2].children;
		expect(reviewChildren[0]).toMatchObject({ type: "text", content: "已答 0 / 2" });
		// 说明行与页内提交按钮都已撤销：提交出口全仓只有 footer 主按钮一处
		const reviewButtons = reviewChildren
			.flatMap((n) => (n.type === "row" ? n.children : [n]))
			.filter((n) => n.type === "button");
		expect(reviewButtons).toEqual([
			{ type: "button", id: "goto:0", label: "修改", variant: "ghost" },
			{ type: "button", id: "goto:1", label: "修改", variant: "ghost" },
		]);
		expect(JSON.stringify(reviewChildren)).not.toContain("提交后以下答案将返回给模型");
		expect(JSON.stringify(reviewChildren)).not.toContain("提交答案");
	});

	it("footer primary button reads as the next action, not as a constant 提交", () => {
		// 停在 q0、q1 未答 → 下一题（目标就是下一个未答题）
		const initial = buildDesktopQuestionnaireSpec(PARAMS);
		expect(initial.actions?.map((a) => [a.id, a.label])).toEqual([
			["cancel", "取消"],
			["goto:1", "下一题"],
		]);

		// 单题布局没有「下一题」可言 → 恒为提交
		expect(buildDesktopQuestionnaireSpec(SINGLE).actions?.[1]).toMatchObject({ id: "submit", label: "提交" });
	});

	it("returns null when no desktop host env", async () => {
		const result = await presentQuestionnaireOnDesktop(PARAMS, {
			deps: { connect: () => null },
		});
		expect(result).toBeNull();
	});
});

describe("desktop questionnaire flow", () => {
	it("auto-advances once: unanswered→answered on single-select moves to next tab", async () => {
		const { client, pending } = await startDesktopSession(PARAMS);

		client.send({ type: "change", nodeId: "q0", value: "opt:0:0" });
		expect(tabsOf(lastUpdate(client)).activeTab).toBe("q1");
		expect(tabsOf(lastUpdate(client)).tabs[0].status).toBe("answered");

		client.settle({ action: "cancel", values: {} });
		await pending;
	});

	it("re-editing an answered question stays put and leaves a footer way out", async () => {
		const { client, pending } = await startDesktopSession(PARAMS);

		client.send({ type: "change", nodeId: "q0", value: "opt:0:0" });
		expect(tabsOf(lastUpdate(client)).activeTab).toBe("q1");

		// 回改 q0：隐藏页签点不到，所以 q0 的 change 本身就是「用户已切回 q0」的证据
		// （页签观测）。不前进的不变量保持：已答题再选也不会被拽走。
		client.send({ type: "change", nodeId: "q0", value: "opt:0:1" });
		const echoed = tabsOf(lastUpdate(client));
		expect(echoed.activeTab).toBe("q0");
		// 出路改由 footer 给：q1 还没答 → 「下一题」指向 q1
		expect(lastUpdate(client).actions?.[1]).toMatchObject({ id: "goto:1", label: "下一题" });

		client.settle({ action: "cancel", values: {} });
		await pending;
	});

	it("multi-select toggles mark answered without advancing", async () => {
		const { client, pending } = await startDesktopSession(PARAMS);

		client.send({ type: "change", nodeId: "q0", value: "opt:0:0" });
		expect(tabsOf(lastUpdate(client)).activeTab).toBe("q1");

		// 勾完 q1 后两题都答了：若误进「勾选也前进」就会落到复核页，所以停在 q1
		client.send({ type: "change", nodeId: "q1", value: ["opt:1:0"] });
		expect(tabsOf(lastUpdate(client)).activeTab).toBe("q1");
		expect(tabsOf(lastUpdate(client)).tabs[1].status).toBe("answered");
		// q1 之后无可补的题 → footer 改口「复核」
		expect(lastUpdate(client).actions?.[1]).toMatchObject({ id: "goto:review", label: "复核" });

		client.settle({ action: "cancel", values: {} });
		await pending;
	});

	it("free-text typing marks answered without advancing", async () => {
		const { client, pending } = await startDesktopSession(PARAMS);

		client.send({ type: "change", nodeId: "q0-custom", value: "自己写的" });
		expect(tabsOf(lastUpdate(client)).activeTab).toBe("q0");
		expect(tabsOf(lastUpdate(client)).tabs[0].status).toBe("answered");
		expect(lastUpdate(client).actions?.[1]).toMatchObject({ id: "goto:1", label: "下一题" });

		client.settle({ action: "cancel", values: {} });
		await pending;
	});

	it("tab observations from a nodeId rebase the footer target onto the visible tab", async () => {
		const { client, pending } = await startDesktopSession(PARAMS);

		// 用户没碰过任何控件、只用 chip 切到 q1（Host 本地切页，老 Host 不发事件）：
		// 扩展此刻仍以为是 q0。第一次落到 q1 的 change 就把页签账本校正过来。
		expect(firstSpec(client).actions?.[1]).toMatchObject({ id: "goto:1", label: "下一题" });
		client.send({ type: "change", nodeId: "q1", value: ["opt:1:1"] });
		expect(tabsOf(lastUpdate(client)).activeTab).toBe("q1");
		// 校正后从 q1 往后算：没有未答题了 → 「复核」，而不是按旧账再跳 q1
		expect(lastUpdate(client).actions?.[1]).toMatchObject({ id: "goto:review", label: "复核" });

		client.settle({ action: "cancel", values: {} });
		await pending;
	});

	it("host tab: actions report local tab switches and adopt the flushed form snapshot", async () => {
		const { client, pending } = await startDesktopSession(PARAMS);

		client.send({ type: "change", nodeId: "q0", value: "opt:0:0" });
		client.send({ type: "action", actionId: "cancel" });
		expect(client.closes).toHaveLength(0); // 有工作内容 → 仅布防
		expect(lastUpdate(client).actions?.[0].label).toBe("再按一次确认取消");

		// Host 本地切页（新 Host）：actionId=tab:<ViewTab.id>，values 是 sendAction 先 flush 的表单快照
		client.send({ type: "action", actionId: "tab:q1", values: { q1: ["opt:1:0"], "q1-custom": "打字未落盘" } });
		const echoed = tabsOf(lastUpdate(client));
		expect(echoed.activeTab).toBe("q1");
		expect(echoed.tabs[1].status).toBe("answered");
		expect(JSON.stringify(echoed.tabs[2].children)).toContain("Features：Auth（补充：打字未落盘）");
		// 切页也是一种交互 → 取消布防解除
		expect(lastUpdate(client).actions?.[0].label).toBe("取消");

		client.settle({ action: "cancel", values: {} });
		await pending;
	});

	it("tab: carries ViewTab ids, clamps out-of-range ones, ignores other id shapes", async () => {
		const { client, pending } = await startDesktopSession(PARAMS);

		client.send({ type: "action", actionId: "tab:q9" });
		expect(tabsOf(lastUpdate(client)).activeTab).toBe("q1");
		client.send({ type: "action", actionId: "tab:review" });
		expect(tabsOf(lastUpdate(client)).activeTab).toBe("review");
		expect(lastUpdate(client).actions?.[1]).toMatchObject({ id: "submit", label: "提交" });

		const before = client.updates.length;
		// 裸下标是 `goto:` 族的写法，Host 只会发页签 id；认错了就当不认识的 id 忽略掉
		client.send({ type: "action", actionId: "tab:1" });
		client.send({ type: "action", actionId: "tab:not-a-tab" });
		expect(client.updates).toHaveLength(before);

		client.settle({ action: "cancel", values: {} });
		await pending;
	});

	it("a supplement draft keeps the question in place: text + selection stays, footer moves on", async () => {
		const { client, pending } = await startDesktopSession(PARAMS);

		// 先写补充草稿（该题即视为已答），再点选选项：文本 + 选择 = 该答案的
		// notes 补充，不自动前进（对齐 TUI；选完仍停在本题）
		client.send({ type: "change", nodeId: "q0-custom", value: "生态最熟" });
		client.send({ type: "change", nodeId: "q0", value: "opt:0:0" });
		expect(tabsOf(lastUpdate(client)).activeTab).toBe("q0");
		expect(tabsOf(lastUpdate(client)).tabs[0].status).toBe("answered");

		// 出路 = footer 主按钮（同一时刻它算出的目标正是 q1），actionId 仍是 goto:<i>
		expect(lastUpdate(client).actions?.[1]).toMatchObject({ id: "goto:1", label: "下一题" });
		client.send({ type: "action", actionId: "goto:1" });
		expect(tabsOf(lastUpdate(client)).activeTab).toBe("q1");

		client.settle({ action: "cancel", values: {} });
		await pending;
	});

	it("review tab reflects answers and flags unanswered ones", async () => {
		const { client, pending } = await startDesktopSession(PARAMS);

		client.send({ type: "change", nodeId: "q0", value: "opt:0:0" });
		const review = tabsOf(lastUpdate(client)).tabs[2];
		expect(review.status).toBe("attention");
		// 进度行：页内提交按钮之前，部分作答时如实显示缺了几题
		expect(review.children[0]).toMatchObject({ type: "text", content: "已答 1 / 2" });
		const texts = JSON.stringify(review.children);
		expect(texts).toContain("Library：A");
		expect(texts).toContain("Features：未作答");
		// 状态色走协议字段，不再拿 emoji 冒充（docs/design/79 F2）
		expect(texts).not.toContain("⚠");
		expect(review.children.some((row) => row.type === "row" && hasNodeType(row, "text"))).toBe(true);
		const warningRow = review.children
			.flatMap((row) => (row.type === "row" ? row.children : []))
			.find((n) => n.type === "text" && n.content.includes("未作答"));
		expect(warningRow).toMatchObject({ tone: "warning" });

		client.send({ type: "change", nodeId: "q1", value: ["opt:1:1"] });
		const final = tabsOf(lastUpdate(client));
		expect(final.tabs[2].status).toBe("answered");
		expect(final.tabs[2].children[0]).toMatchObject({ content: "已答 2 / 2" });
		expect(JSON.stringify(final.tabs[2].children)).toContain("Features：Billing");

		client.settle({ action: "cancel", values: {} });
		await pending;
	});

	it("goto actions switch tabs: review ↔ question", async () => {
		const { client, pending } = await startDesktopSession(PARAMS);

		client.send({ type: "action", actionId: "goto:review" });
		expect(tabsOf(lastUpdate(client)).activeTab).toBe("review");
		client.send({ type: "action", actionId: "goto:0" });
		expect(tabsOf(lastUpdate(client)).activeTab).toBe("q0");

		client.settle({ action: "cancel", values: {} });
		await pending;
	});

	it("cancel without any work closes immediately", async () => {
		const { client, pending } = await startDesktopSession(PARAMS);

		client.send({ type: "action", actionId: "cancel" });
		expect(client.closes).toHaveLength(1);
		expect(client.closes[0].action).toBe("cancel");
		await pending;
	});

	it("cancel arms on first press when work exists, disarms on change, closes on second press", async () => {
		const { client, pending } = await startDesktopSession(PARAMS);

		client.send({ type: "change", nodeId: "q0", value: "opt:0:0" });
		client.send({ type: "action", actionId: "cancel" });
		expect(client.closes).toHaveLength(0);
		expect(lastUpdate(client).actions?.[0].label).toBe("再按一次确认取消");
		expect(lastUpdate(client).actions?.[0].variant).toBe("danger");

		client.send({ type: "change", nodeId: "q0-custom", value: "note" });
		expect(lastUpdate(client).actions?.[0].label).toBe("取消");

		client.send({ type: "action", actionId: "cancel" });
		expect(client.closes).toHaveLength(0); // 重新布防
		client.send({ type: "action", actionId: "cancel" });
		expect(client.closes).toHaveLength(1);
		expect(client.closes[0].action).toBe("cancel");

		await pending;
	});

	it("maps submit values to questionnaire answers", async () => {
		const { client, pending } = await startDesktopSession(PARAMS);
		const values = {
			q0: "opt:0:0",
			"q0-custom": "prefer A",
			q1: ["opt:1:0", "opt:1:1"],
			"q1-custom": "",
		};
		client.send({ type: "action", actionId: "submit", values });
		const result = await pending;

		expect(result?.cancelled).toBe(false);
		expect(result?.answers).toHaveLength(2);
		expect(result?.answers[0]).toMatchObject({
			kind: "option",
			answer: "A",
			notes: "prefer A",
		});
		expect(result?.answers[1]).toMatchObject({
			kind: "multi",
			selected: ["Auth", "Billing"],
		});
	});

	it("allows partial submission (unanswered questions are skipped)", async () => {
		const { client, pending } = await startDesktopSession(PARAMS);
		client.send({
			type: "action",
			actionId: "submit",
			values: { q0: "opt:0:1", "q0-custom": "", "q1-custom": "" },
		});
		const result = await pending;
		expect(result?.cancelled).toBe(false);
		expect(result?.answers).toHaveLength(1);
		expect(result?.answers[0]).toMatchObject({ kind: "option", answer: "B" });
	});

	it("text alongside a selection becomes that answer's supplement; text alone is the answer", async () => {
		const { client, pending } = await startDesktopSession(PARAMS);
		client.send({
			type: "action",
			actionId: "submit",
			values: {
				q0: "opt:0:0",
				"q0-custom": "my own answer",
				q1: [],
				"q1-custom": "typed instead",
			},
		});
		const result = await pending;
		// 选择 + 文本 → 选项答案 + notes 补充
		expect(result?.answers[0]).toMatchObject({ kind: "option", answer: "A", notes: "my own answer" });
		// 无选择 + 文本 → custom 答案
		expect(result?.answers[1]).toMatchObject({ kind: "custom", answer: "typed instead" });
	});

	it("cancel action yields cancelled result", async () => {
		const { client, pending } = await startDesktopSession(PARAMS);
		client.send({ type: "action", actionId: "cancel" });
		const result = await pending;
		expect(result?.cancelled).toBe(true);
		expect(result?.answers).toEqual([]);
	});
});
