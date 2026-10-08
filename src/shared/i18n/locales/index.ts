import type { Catalog, LocaleId, MessageDefs } from "../types";
import { browserMessages } from "./browser";
import { chromeMessages } from "./chrome";
import { commandPaletteMessages } from "./commandPalette";
import { commonMessages } from "./common";
import { contextMessages } from "./context";
import { extensionMessages } from "./extensions";
import { mcpMessages } from "./mcp";
import { notificationMessages } from "./notification";
import { panelMessages } from "./panels";
import { procMessages } from "./proc";
import { scheduledMessages } from "./scheduled";
import { sessionMessages } from "./session";
import { settingsMessages } from "./settings";
import { sidenavMessages } from "./sidenav";
import { uiMessages } from "./ui";

const ALL_DEFS: MessageDefs = {
  ...commonMessages,
  ...settingsMessages,
  ...sidenavMessages,
  ...sessionMessages,
  ...panelMessages,
  ...contextMessages,
  ...chromeMessages,
  ...browserMessages,
  ...extensionMessages,
  ...mcpMessages,
  ...notificationMessages,
  ...procMessages,
  ...uiMessages,
  ...commandPaletteMessages,
  ...scheduledMessages,
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
