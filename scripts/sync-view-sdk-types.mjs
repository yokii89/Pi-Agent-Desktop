/**
 * Sync PiDesk host protocol types into `packages/view-sdk/src/types.ts`.
 *
 * Source of truth: `pidesk/src/shared/view.ts` between the
 * `// #begin view-sdk-protocol` / `// #end view-sdk-protocol` markers.
 * The SDK copy stays self-contained so extensions can depend on
 * `@pidesk/view-sdk` without pulling Electron / renderer code — but it must
 * not be hand-edited.
 *
 * Usage:
 *   node scripts/sync-view-sdk-types.mjs          # write types.ts
 *   node scripts/sync-view-sdk-types.mjs --check  # fail on drift (CI / pre-test)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const sharedPath = join(root, "..", "src", "shared", "view.ts");
const sdkTypesPath = join(root, "..", "packages", "view-sdk", "src", "types.ts");

const BEGIN = "// #begin view-sdk-protocol";
const END = "// #end view-sdk-protocol";

const HEADER = `/**
 * Protocol types for view/v1.
 *
 * GENERATED FILE — do not edit by hand.
 * Source of truth: PiDesk \`src/shared/view.ts\` (${BEGIN.trim()} … ${END.trim()}).
 * Regenerate: \`node scripts/sync-view-sdk-types.mjs\`
 * Verify:      \`node scripts/sync-view-sdk-types.mjs --check\`
 *
 * Self-contained so extensions can depend on \`@pidesk/view-sdk\` without
 * pulling Electron / renderer code.
 */

`;

function extractProtocolRegion(source) {
  const begin = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  if (begin === -1 || end === -1 || end <= begin) {
    throw new Error(`Missing ${BEGIN} / ${END} markers in ${sharedPath}`);
  }
  const start = source.indexOf("\n", begin);
  if (start === -1) throw new Error("Malformed begin marker");
  const region = source
    .slice(start + 1, end)
    .replace(/^\n+/, "")
    .replace(/\s+$/, "");
  return `${region}\n`;
}

function renderTypesTs(sharedSource) {
  return HEADER + extractProtocolRegion(sharedSource);
}

/**
 * Values that must be inside the mirrored region (docs/design/20 O3).
 *
 * Before O3 the budget constants lived outside the markers, so the only place an
 * extension could read `maxNodes` from was README prose — and `pi-telegram-main`
 * responded by hand-copying the counting rules. Re-exporting them from
 * `types.ts` is what makes that copy illegal; this list is the guard that keeps
 * it legal, and `--check` fails if a constant is moved back out.
 */
const REQUIRED_PROTOCOL_VALUES = [
  "VIEW_PROTOCOL_VERSION",
  "ACCESS_MODE_ACTIONS",
  "VIEW_LIMITS",
  "VIEW_HOST_CAPABILITIES",
  "IMPLEMENTED_VIEW_PLACEMENTS",
  "SLOTTED_VIEW_PLACEMENTS",
];

function assertProtocolValues(rendered) {
  const missing = REQUIRED_PROTOCOL_VALUES.filter(
    (name) => !new RegExp(`^export const ${name}\\b`, "m").test(rendered),
  );
  if (missing.length > 0) {
    throw new Error(
      `Protocol region is missing exported constants: ${missing.join(", ")}.\n` +
        `They must stay between the ${BEGIN} / ${END} markers in ${sharedPath}.`,
    );
  }
}

function main() {
  const check = process.argv.includes("--check");
  const sharedSource = readFileSync(sharedPath, "utf8");
  const next = renderTypesTs(sharedSource);
  assertProtocolValues(next);

  if (check) {
    let current = "";
    try {
      current = readFileSync(sdkTypesPath, "utf8");
    } catch {
      console.error(`Missing generated file: ${sdkTypesPath}`);
      process.exit(1);
    }
    if (current !== next) {
      console.error(
        `view-sdk types.ts is out of lockstep with src/shared/view.ts.\n` +
          `Run: node scripts/sync-view-sdk-types.mjs`,
      );
      process.exit(1);
    }
    console.log(
      `view-sdk types.ts is in lockstep with src/shared/view.ts (${REQUIRED_PROTOCOL_VALUES.length} protocol constants mirrored)`,
    );
    return;
  }

  writeFileSync(sdkTypesPath, next, "utf8");
  console.log(`Wrote ${sdkTypesPath}`);
}

main();
