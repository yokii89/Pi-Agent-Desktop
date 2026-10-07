import type {
  GitHubAuthState,
  GitHubDeviceStart,
  GitHubDeviceStatus,
  GitHubSyncPreview,
  GitHubSyncResult,
} from "../../shared/github";
import { unwrap } from "./ipc";
import { pideskApi } from "./pideskApi";

/** GitHub 登录与设置同步（docs/design/36）。 */
export const githubService = {
  deviceStart(): Promise<GitHubDeviceStart> {
    const api = pideskApi();
    if (!api) return Promise.reject(new Error("bridge unavailable"));
    return unwrap(api.github.deviceStart());
  },
  deviceCancel(): Promise<null> {
    const api = pideskApi();
    if (!api) return Promise.resolve(null);
    return unwrap(api.github.deviceCancel()).catch(() => null);
  },
  onDeviceStatus(callback: (status: GitHubDeviceStatus) => void): () => void {
    const api = pideskApi();
    return api ? api.github.onDeviceStatus(callback) : () => {};
  },
  getAuth(): Promise<GitHubAuthState | null> {
    const api = pideskApi();
    return api ? unwrap(api.github.getAuth()).catch(() => null) : Promise.resolve(null);
  },
  logout(): Promise<GitHubAuthState | null> {
    const api = pideskApi();
    return api ? unwrap(api.github.logout()).catch(() => null) : Promise.resolve(null);
  },
  syncPush(): Promise<GitHubSyncResult> {
    const api = pideskApi();
    if (!api) return Promise.reject(new Error("bridge unavailable"));
    return unwrap(api.github.syncPush());
  },
  syncPull(options?: { force?: boolean }): Promise<GitHubSyncResult> {
    const api = pideskApi();
    if (!api) return Promise.reject(new Error("bridge unavailable"));
    return unwrap(api.github.syncPull(options));
  },
  syncPreview(): Promise<GitHubSyncPreview> {
    const api = pideskApi();
    if (!api) return Promise.reject(new Error("bridge unavailable"));
    return unwrap(api.github.syncPreview());
  },
};
