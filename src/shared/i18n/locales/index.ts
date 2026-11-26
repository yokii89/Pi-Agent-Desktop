import { pairingMessages } from "../../remote/labels";
import type { Catalog, LocaleId, MessageDefs } from "../types";
import { browserMessages } from "./browser";
import { chromeMessages } from "./chrome";
import { commandPaletteMessages } from "./commandPalette";
import { commitDialogMessages } from "./commitDialog";
import { commonMessages } from "./common";
import { contextMessages } from "./context";
import { extensionMessages } from "./extensions";
import { managedSkillsMessages } from "./managedSkills";
import { mcpMessages } from "./mcp";
import { monitorMessages } from "./monitor";
import { nativeMessages } from "./nativeBuiltins";
import { newApiMessages } from "./newApi";
import { notificationMessages } from "./notification";
import { panelMessages } from "./panels";
import { procMessages } from "./proc";
import { remoteAccountMessages } from "./remoteAccount";
import { remoteSettingsMessages } from "./remoteSettings";
import { scheduledMessages } from "./scheduled";
import { sessionMessages } from "./session";
import { settingsMessages } from "./settings";
import { sidenavMessages } from "./sidenav";
import { uiMessages } from "./ui";
import { windowMessages } from "./window";

const ALL_DEFS: MessageDefs = {
  ...pairingMessages,
  ...commonMessages,
  ...settingsMessages,
  ...remoteSettingsMessages,
  ...remoteAccountMessages,
  ...sidenavMessages,
  ...sessionMessages,
  ...panelMessages,
  ...contextMessages,
  ...chromeMessages,
  ...browserMessages,
  ...extensionMessages,
  ...managedSkillsMessages,
  ...mcpMessages,
  ...monitorMessages,
  ...commitDialogMessages,
  ...notificationMessages,
  ...procMessages,
  ...uiMessages,
  ...commandPaletteMessages,
  ...scheduledMessages,
  ...windowMessages,
  ...nativeMessages,
  ...newApiMessages,
};

function catalogFor(locale: LocaleId): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(ALL_DEFS)) {
    out[key] = entry[locale];
  }
  return out;
}

let cached: Catalog | null = null;

export function buildCatalog(): Catalog {
  if (cached) return cached;
  cached = {
    "zh-CN": catalogFor("zh-CN"),
    "en-US": catalogFor("en-US"),
  };
  return cached;
}
