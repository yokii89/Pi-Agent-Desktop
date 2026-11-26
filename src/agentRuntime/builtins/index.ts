import type { Extension } from "@earendil-works/pi-durable";
import type { RuntimeBuiltinToolsConfig } from "../../shared/builtinTools.js";
import { imageTool } from "./image/tool.js";
import type { BackgroundJobs } from "./jobs/manager.js";
import { jobTools } from "./jobs/tools.js";
import { questionnaireTool } from "./questionnaire.js";
import { type TelegramHost, telegramTools } from "./telegram.js";
import { webTools } from "./web/tools.js";
export type BuiltinSessionServices = {
  jobs: BackgroundJobs;
  sessionId: string;
  telegram?: TelegramHost;
};

/** App-owned capabilities; installed before Harness.open(), outside third-party extension discovery. */
export function desktopBuiltinTools(
  cwd: string,
  getConfig: () => RuntimeBuiltinToolsConfig,
  services?: BuiltinSessionServices,
): Extension {
  return {
    name: "pidesk-builtins",
    tools: [
      ...webTools(getConfig),
      imageTool(cwd, getConfig),
      questionnaireTool(),
      ...(services ? jobTools(services.jobs, services.sessionId, cwd) : []),
      ...(services?.telegram ? telegramTools(services.sessionId, services.telegram) : []),
    ],
  };
}
