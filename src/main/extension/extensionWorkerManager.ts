import { homedir } from "node:os";
import { agentRuntimeManager } from "../agentRuntime/agentRuntimeManager";
import { revokeNativeExtensionViews } from "../view/viewHost";
import { discoverDurableExtensions } from "./durableExtensions";
import { NativeExtensionHosts } from "./nativeExtensionHosts";
import { prepareExtensionViews } from "./nativeViewBindings";

const hosts = new NativeExtensionHosts({
  request: (command) => agentRuntimeManager.request(command),
  discover: (scope) => discoverDurableExtensions(null, scope),
  bind: (specs, ownerId, hostScope) => prepareExtensionViews(specs, { ownerId, hostScope }),
  revoke: revokeNativeExtensionViews,
  cwd: homedir(),
});
agentRuntimeManager.subscribe(
  () => {},
  () => hosts.fault(),
);

/** Existing IPC channel names are retained; all execution now uses the built-in native host. */
export const getWorkerStatus = () => hosts.status();
export const acquireWorkerLease = () => hosts.acquire();
export const releaseWorkerLease = () => hosts.release();
export const reloadWorkerForExtensionChange = () => hosts.reload();
export const startAppExtensionHost = () => hosts.startApp();
export const disposeExtensionWorker = () => hosts.dispose();
