import type {
  PiModelOverrideSetRequest,
  PiModelOverrideSetResult,
  PiModelOverridesSnapshot,
} from "../../shared/ipc";
import { unwrap } from "./ipc";

function api() {
  const a = window.pidesk?.modelOverrides;
  if (!a) throw new Error("预加载 API 不可用");
  return a;
}

/** 模型能力覆盖（docs/design/49）的渲染层服务。 */
export const modelOverridesService = {
  async get(): Promise<PiModelOverridesSnapshot> {
    return unwrap(api().get());
  },
  async set(req: PiModelOverrideSetRequest): Promise<PiModelOverrideSetResult> {
    return unwrap(api().set(req));
  },
};
