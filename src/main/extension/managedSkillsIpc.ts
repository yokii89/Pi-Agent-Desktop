import path from "node:path";
import { app, ipcMain } from "electron";
import {
  MANAGED_SKILL_OPERATIONS,
  MANAGED_SKILLS_IPC,
  type ManagedSkillOperation,
} from "../../shared/managedSkills";
import { envelopeAsync } from "../ipc/envelope";
import { getPiAgentDir } from "../session/piInfo";
import { markExtensionStale } from "../session/runtimeCoordinator";
import { getMainWindow } from "../window/createMainWindow";
import { invalidateCatalog } from "./contributionCatalog";
import { discoverDurableResources } from "./durableResources";
import { ManagedSkills } from "./managedSkills";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function cwd(value: unknown): string {
  if (value === undefined || value === null) return app.getPath("home");
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 32768 ||
    value.includes("\0") ||
    !path.isAbsolute(value)
  )
    throw new Error("PIDESK_SKILLS:invalid");
  return path.resolve(value);
}

/** Preview tokens and all filesystem ownership stay in main, restricted to the main window. */
export function registerManagedSkillsIpc(): void {
  let service: ManagedSkills | undefined;
  const manager = () =>
    (service ??= new ManagedSkills({
      agentDir: getPiAgentDir(),
      version: app.getVersion(),
      sourceRoot: path.join(
        app.getAppPath(),
        "vendor",
        "MyPiExtension",
        "packages",
        "yoki-skills",
        "skills",
      ),
      discover: (directory) => discoverDurableResources(directory, app.getPath("home")),
    }));
  const handle = (channel: string, operation: (request: Record<string, unknown>) => unknown) => {
    ipcMain.handle(channel, (event, request: unknown) =>
      envelopeAsync(async () => {
        const window = getMainWindow();
        if (
          !window ||
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          throw new Error("UNTRUSTED_SENDER");
        if (!record(request)) throw new Error("PIDESK_SKILLS:invalid");
        return operation(request);
      }),
    );
  };
  handle(MANAGED_SKILLS_IPC.list, (request) => manager().snapshot(cwd(request.projectDir)));
  handle(MANAGED_SKILLS_IPC.plan, (request) => {
    if (
      !MANAGED_SKILL_OPERATIONS.some((operation) => operation === request.operation) ||
      typeof request.name !== "string"
    )
      throw new Error("PIDESK_SKILLS:invalid");
    return manager().plan({
      operation: request.operation as ManagedSkillOperation,
      name: request.name,
      projectDir: cwd(request.projectDir),
    });
  });
  handle(MANAGED_SKILLS_IPC.apply, (request) => {
    if (typeof request.id !== "string" || !/^[a-f0-9-]{36}$/.test(request.id))
      throw new Error("PIDESK_SKILLS:invalid");
    const result = manager().apply(request.id);
    invalidateCatalog();
    markExtensionStale();
    return result;
  });
}
