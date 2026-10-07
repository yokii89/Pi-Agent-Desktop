/**
 * Contribution 原子激活事务（docs/design/16 §7）。
 * Catalog 校验 → ensureSession ready → waitForContribution → 发 action → 等扩展确认。
 */

import { randomUUID } from "node:crypto";
import type {
  ActivateContributionAction,
  ActivateContributionFailure,
  ActivateContributionRequest,
  ActivateContributionResult,
  SessionId,
} from "../../shared/contribution";
import { ACTIVATION_TIMEOUTS } from "../../shared/contribution";
import { ACCESS_MODE_ACTIONS } from "../../shared/view";
import { getCatalogSnapshot } from "../extension/contributionCatalog";
import {
  ensureSessionReady,
  listRuntimeSnapshots,
  withActivationLock,
} from "../session/runtimeCoordinator";
import { getSessionCwd } from "../session/sessionCwdRegistry";
import {
  getContributionViewId,
  getViewModeState,
  sendViewEvent,
  waitForContribution,
} from "./viewHost";

class ActivationError extends Error {
  readonly failure: ActivateContributionFailure;

  constructor(failure: ActivateContributionFailure) {
    super(failure.message);
    this.name = "ActivationError";
    this.failure = failure;
  }
}

function toActionId(raw: unknown): ActivateContributionAction {
  if (raw === ACCESS_MODE_ACTIONS.activate || raw === "mode:activate") return "mode:activate";
  if (raw === ACCESS_MODE_ACTIONS.deactivate || raw === "mode:deactivate") return "mode:deactivate";
  if (raw === "view:open") return "view:open";
  throw new ActivationError({
    code: "invalid-request",
    message: "无效的 actionId",
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForActiveState(
  viewId: string,
  targetActive: boolean,
  timeoutMs: number,
): Promise<{ ok: boolean; detail?: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = getViewModeState(viewId);
    if (state && state.active === targetActive) {
      return { ok: true, detail: state.detail };
    }
    // 视图被替换/关闭：等待新注册不在本函数职责内
    if (!state) {
      return { ok: false };
    }
    await sleep(120);
  }
  return { ok: false };
}

async function runActivation(
  req: ActivateContributionRequest,
): Promise<ActivateContributionResult> {
  const actionId = toActionId(req.actionId);
  const contributionKey = typeof req.contributionKey === "string" ? req.contributionKey.trim() : "";
  if (!contributionKey) {
    throw new ActivationError({
      code: "invalid-request",
      message: "缺少 contributionKey",
      contributionKey,
    });
  }

  const cwd = getSessionCwd(req.sessionId) ?? req.cwd ?? null;
  const contribution = getCatalogSnapshot(cwd).entries.find(
    (entry) => entry.key === contributionKey,
  );
  if (!contribution) {
    throw new ActivationError({
      code: "catalog-missing",
      message: "Catalog 中不存在该扩展能力",
      contributionKey,
    });
  }

  // access-mode 走 mode 指令 + active 确认；panel/settings 冷态入口只等 live 注册
  // （docs/design/19 §10.1/§10.2）。widget/header/sidebar 等仍无原子激活事务。
  const isModeAction = actionId === "mode:activate" || actionId === "mode:deactivate";
  const isOpenAction = actionId === "view:open";
  if (isModeAction && contribution.placement !== "access-mode") {
    throw new ActivationError({
      code: "invalid-request",
      message: `placement ${contribution.placement} 不支持 mode 激活`,
      contributionKey,
    });
  }
  if (isOpenAction && contribution.placement !== "panel" && contribution.placement !== "settings") {
    throw new ActivationError({
      code: "invalid-request",
      message: `placement ${contribution.placement} 不支持 view:open 激活`,
      contributionKey,
    });
  }
  if (!isModeAction && !isOpenAction) {
    throw new ActivationError({
      code: "invalid-request",
      message: "无效的 actionId",
      contributionKey,
    });
  }
  // worker-safe settings 由设置页 lease 覆盖，不经会话 ensureSession 激活
  if (isOpenAction && contribution.placement === "settings" && contribution.workerSafe) {
    throw new ActivationError({
      code: "activation-rejected",
      message: "该设置来自 Extension Worker，请在「设置 → 来自扩展」中打开",
      contributionKey,
    });
  }

  // 2. ensureSession（reason=view-action）+ ready barrier
  let sessionId: SessionId;
  try {
    const started = await ensureSessionReady({
      sessionId: req.sessionId,
      sessionFile: req.sessionFile,
      cwd: cwd ?? undefined,
      reason: "view-action",
    });
    sessionId = started.sessionId;
  } catch (err) {
    const code = (err as { code?: string }).code;
    const limitInfo = (err as { limitInfo?: ActivateContributionFailure }).limitInfo;
    if (code === "limit-reached" && limitInfo) {
      throw new ActivationError({
        code: "limit-reached",
        message: limitInfo.message ?? "并行会话已达上限",
        contributionKey,
        limit: limitInfo.limit,
        idleCandidateIds: limitInfo.idleCandidateIds,
      });
    }
    if (code === "runtime-ready-timeout") {
      throw new ActivationError({
        code: "runtime-ready-timeout",
        message: err instanceof Error ? err.message : "RPC ready 超时",
        contributionKey,
        sessionId: req.sessionId,
      });
    }
    throw new ActivationError({
      code: "runtime-start-failed",
      message: err instanceof Error ? err.message : "会话启动失败",
      contributionKey,
      sessionId: req.sessionId,
    });
  }

  // mode 切换不得在 busy 时抢跑；view:open 只是拉起面板，不改门禁，允许 busy
  if (
    isModeAction &&
    listRuntimeSnapshots().some(
      (runtime) => runtime.sessionId === sessionId && runtime.state === "busy",
    )
  ) {
    throw new ActivationError({
      code: "activation-rejected",
      message: "请在当前回复结束后切换访问模式",
      sessionId,
      contributionKey,
    });
  }

  // 5. 等待 live contribution 注册（先等后注册 / 先注册后等均覆盖）
  let liveViewId = getContributionViewId(sessionId, contributionKey);
  if (!liveViewId) {
    try {
      liveViewId = await waitForContribution({
        sessionId,
        contributionKey,
        timeoutMs: ACTIVATION_TIMEOUTS.contributionRegister,
      });
    } catch {
      // 扩展未注册：复用已有 ready 进程时不杀进程（docs/design/16 §7.4）
      throw new ActivationError({
        code: "contribution-not-registered",
        message: "扩展未响应（未注册该能力）",
        contributionKey,
        sessionId,
      });
    }
  }

  // view:open：live 注册即成功确认——panel/settings 没有 mode 真值可等
  // （docs/design/19 §10.1/§10.2）。扩展负责在会话就绪后自行 open 并带 contributionKey。
  if (isOpenAction) {
    return {
      sessionId,
      contributionKey,
      liveViewId,
      state: "active",
    };
  }

  const targetActive = actionId === "mode:activate";
  const before = getViewModeState(liveViewId);
  if (before && before.active === targetActive) {
    return {
      sessionId,
      contributionKey,
      liveViewId,
      state: targetActive ? "active" : "inactive",
      detail: before.detail,
    };
  }

  // 6. 发 action 到当次 liveViewId（禁止直发旧 viewId——这里取的是索引中的 live）
  sendViewEvent(liveViewId, {
    type: "action",
    actionId,
    values: {},
  });

  // 7. 等待扩展 update 把 mode.active 改成目标值
  const confirmed = await waitForActiveState(
    liveViewId,
    targetActive,
    ACTIVATION_TIMEOUTS.activationConfirm,
  );
  if (!confirmed.ok) {
    // 连接断开后可能顶替出新 viewId：再查一次索引
    const rebound = getContributionViewId(sessionId, contributionKey);
    if (rebound && rebound !== liveViewId) {
      const retry = await waitForActiveState(
        rebound,
        targetActive,
        ACTIVATION_TIMEOUTS.activationConfirm,
      );
      if (retry.ok) {
        return {
          sessionId,
          contributionKey,
          liveViewId: rebound,
          state: targetActive ? "active" : "inactive",
          detail: retry.detail,
        };
      }
      liveViewId = rebound;
    }
    throw new ActivationError({
      code: "activation-not-confirmed",
      message: getViewModeState(liveViewId)?.detail ?? "扩展未确认模式切换",
      contributionKey,
      sessionId,
    });
  }

  return {
    sessionId,
    contributionKey,
    liveViewId,
    state: targetActive ? "active" : "inactive",
    detail: confirmed.detail,
  };
}

/**
 * 对外入口：per-key 事务互斥 + 失败分类。
 * 快速双击合并到同一 Promise。
 */
export async function activateContribution(
  req: ActivateContributionRequest,
): Promise<ActivateContributionResult> {
  const contributionKey = typeof req.contributionKey === "string" ? req.contributionKey.trim() : "";
  const sessionId = req.sessionId ?? req.sessionFile ?? randomUUID();

  try {
    return await withActivationLock(sessionId, `${contributionKey}:${req.actionId}`, () =>
      runActivation(req),
    );
  } catch (err) {
    if (err instanceof ActivationError) {
      throw Object.assign(new Error(err.failure.message), {
        code: err.failure.code,
        activationFailure: err.failure,
      });
    }
    throw err;
  }
}

export type { ActivateContributionFailure, ActivateContributionResult };
