import type {
  ActivateContributionRequest,
  ActivateContributionResult,
  ContributionCatalogSnapshot,
  SessionRuntimeSnapshot,
} from "../../shared/contribution";
import { CATALOG_IPC, RUNTIME_IPC, VIEW_ACTIVATE_IPC } from "../../shared/contribution";
import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

function catalogApi() {
  const a = pideskApi()?.catalog ?? window.pidesk?.catalog;
  if (!a) throw new Error("预加载 API 不可用");
  return a;
}

function runtimeApi() {
  const a = pideskApi()?.runtime ?? window.pidesk?.runtime;
  if (!a) throw new Error("预加载 API 不可用");
  return a;
}

/** Contribution Catalog 渲染层服务（docs/design/16 Phase A/B）。 */
export const catalogService = {
  async list(projectDir?: string | null): Promise<ContributionCatalogSnapshot> {
    return unwrap(catalogApi().list(projectDir ?? null));
  },
  async refresh(projectDir?: string | null): Promise<ContributionCatalogSnapshot> {
    return unwrap(catalogApi().refresh(projectDir ?? null));
  },
  onChanged(callback: (snapshot: ContributionCatalogSnapshot) => void): () => void {
    return catalogApi().onChanged(callback);
  },
};

/** Session Runtime 快照服务（docs/design/16 Phase C）。 */
export const runtimeService = {
  async snapshot(): Promise<SessionRuntimeSnapshot[]> {
    return unwrap(runtimeApi().snapshot());
  },
  onChanged(callback: (snapshot: SessionRuntimeSnapshot) => void): () => void {
    return runtimeApi().onChanged(callback);
  },
};

/** Contribution 原子激活（docs/design/16 Phase D）。 */
export async function activateContribution(
  req: ActivateContributionRequest,
): Promise<ActivateContributionResult> {
  const api = pideskApi()?.view ?? window.pidesk?.view;
  if (!api?.activateContribution) throw new Error("预加载 API 不可用");
  return unwrap(api.activateContribution(req));
}

export { CATALOG_IPC, RUNTIME_IPC, VIEW_ACTIVATE_IPC };
