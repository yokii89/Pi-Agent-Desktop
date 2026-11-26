import { ipcMain } from "electron";
import { t } from "../../shared/i18n";
import { MCP_IPC, type McpPiSupport } from "../../shared/ipc";
import { envelopeAsync } from "../ipc/envelope";
import { getMainWindow } from "../window/createMainWindow";
import { listUserMcpConfig } from "./mcpConfig";
import { searchMarket } from "./mcpMarket";

/** MCP configuration is inspectable until a native Durable transport is implemented. */
export function registerMcpIpc(): void {
  const handle = (channel: string, operation: (request: unknown) => unknown) => {
    ipcMain.handle(channel, (event, request: unknown) =>
      envelopeAsync(async () => {
        const window = getMainWindow();
        if (
          !window ||
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          throw new Error("UNTRUSTED_SENDER");
        return operation(request);
      }),
    );
  };
  handle(MCP_IPC.list, () => listUserMcpConfig());
  handle(
    MCP_IPC.getPiSupport,
    (): McpPiSupport => ({
      version: "Durable 1.6.0",
      status: "unsupported",
    }),
  );
  for (const channel of [
    MCP_IPC.probe,
    MCP_IPC.save,
    MCP_IPC.remove,
    MCP_IPC.sessionCommand,
    MCP_IPC.reloadSessions,
  ])
    handle(channel, () => {
      throw new Error(t("mcp.degrade.description"));
    });
  handle(MCP_IPC.marketSearch, (request) => {
    if (
      typeof request !== "object" ||
      request === null ||
      Array.isArray(request) ||
      !("query" in request) ||
      typeof request.query !== "string" ||
      request.query.length > 1024
    )
      throw new Error("Invalid marketplace search.");
    return searchMarket({
      query: request.query,
      cursor: "cursor" in request && typeof request.cursor === "string" ? request.cursor : null,
    });
  });
}
