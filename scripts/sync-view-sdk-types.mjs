/**
 * Sync PiDesk host contract types into `packages/view-sdk/src/`.
 *
 * Two mirrored regions, one source of truth each:
 * - `src/shared/view.ts` → `packages/view-sdk/src/types.ts` (view/v1 wire)
 * - `src/shared/contribution.ts` → `packages/view-sdk/src/contributionTypes.ts`
 *   (public manifest subset; Catalog/runtime internals stay Host-only)
 *
 * The SDK copies stay self-contained so extensions can depend on
 * `@pidesk/view-sdk` without pulling Electron / renderer code — but they must
 * not be hand-edited.
 *
 * Usage:
 *   node scripts/sync-view-sdk-types.mjs          # write both files
 *   node scripts/sync-view-sdk-types.mjs --check  # fail on drift (CI / pre-test)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

const VIEW = {
  sourcePath: join(root, "..", "src", "shared", "view.ts"),
  sdkPath: join(root, "..", "packages", "view-sdk", "src", "types.ts"),
  begin: "// #begin view-sdk-protocol",
  end: "// #end view-sdk-protocol",
  label: "view-sdk types.ts",
  sourceLabel: "src/shared/view.ts",
};

const CONTRIBUTION = {
  sourcePath: join(root, "..", "src", "shared", "contribution.ts"),
  sdkPath: join(root, "..", "packages", "view-sdk", "src", "contributionTypes.ts"),
  begin: "// #begin view-sdk-contribution",
  end: "// #end view-sdk-contribution",
  label: "view-sdk contributionTypes.ts",
  sourceLabel: "src/shared/contribution.ts",
};

const VIEW_HEADER = `/**
 * Protocol types for view/v1.
 *
 * GENERATED FILE — do not edit by hand.
 * Source of truth: PiDesk \`src/shared/view.ts\` (${VIEW.begin.trim()} … ${VIEW.end.trim()}).
 * Regenerate: \`node scripts/sync-view-sdk-types.mjs\`
 * Verify:      \`node scripts/sync-view-sdk-types.mjs --check\`
 *
 * Self-contained so extensions can depend on \`@pidesk/view-sdk\` without
 * pulling Electron / renderer code.
 */

`;

const CONTRIBUTION_HEADER = `/**
 * Public contribution manifest types.
 *
 * GENERATED FILE — do not edit by hand.
 * Source of truth: PiDesk \`src/shared/contribution.ts\` (${CONTRIBUTION.begin.trim()} … ${CONTRIBUTION.end.trim()}).
 * Regenerate: \`node scripts/sync-view-sdk-types.mjs\`
 * Verify:      \`node scripts/sync-view-sdk-types.mjs --check\`
 *
 * Only the manifest subset is mirrored; Catalog entries, activation
 * transactions and runtime/worker state stay Host-internal (准则 §7.1).
 */

`;

function extractRegion(source, spec) {
  const begin = source.indexOf(spec.begin);
  const end = source.indexOf(spec.end);
  if (begin === -1 || end === -1 || end <= begin) {
    throw new Error(`Missing ${spec.begin} / ${spec.end} markers in ${spec.sourcePath}`);
  }
  const start = source.indexOf("\n", begin);
  if (start === -1) throw new Error("Malformed begin marker");
  const region = source
    .slice(start + 1, end)
    .replace(/^\n+/, "")
    .replace(/\s+$/, "");
  return `${region}\n`;
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
  "VIEW_OPTION_PREVIEW_MAX_CHARS",
];

const REQUIRED_CONTRIBUTION_VALUES = [
  "CONTRIBUTION_ICON_NAMES",
  "ACCESS_MODE_ICON_NAMES",
  "CONTRIBUTION_ICONS",
  "CONTRIBUTION_LIMITS",
];

const REQUIRED_CONTRIBUTION_TYPES = [
  "ContributionPlacement",
  "ContributionActivation",
  "ContributionAccent",
  "ContributionIconName",
  "AccessModeIconName",
  "ManifestContributionItem",
];

function assertExports(rendered, spec, values, types = []) {
  const missingValues = values.filter(
    (name) => !new RegExp(`^export const ${name}\\b`, "m").test(rendered),
  );
  const missingTypes = types.filter(
    (name) => !new RegExp(`^export (?:interface|type) ${name}\\b`, "m").test(rendered),
  );
  const missing = [...missingValues, ...missingTypes];
  if (missing.length > 0) {
    throw new Error(
      `${spec.label} is missing required exports: ${missing.join(", ")}.\n` +
        `They must stay between the ${spec.begin} / ${spec.end} markers in ${spec.sourcePath}.`,
    );
  }
}

function renderFor(spec, header, values, types) {
  const source = readFileSync(spec.sourcePath, "utf8");
  const rendered = header + extractRegion(source, spec);
  assertExports(rendered, spec, values, types);
  return rendered;
}

function main() {
  const check = process.argv.includes("--check");
  const outputs = [
    {
      spec: VIEW,
      content: renderFor(VIEW, VIEW_HEADER, REQUIRED_PROTOCOL_VALUES, []),
    },
    {
      spec: CONTRIBUTION,
      content: renderFor(
        CONTRIBUTION,
        CONTRIBUTION_HEADER,
        REQUIRED_CONTRIBUTION_VALUES,
        REQUIRED_CONTRIBUTION_TYPES,
      ),
    },
  ];

  if (check) {
    for (const { spec, content } of outputs) {
      let current = "";
      try {
        current = readFileSync(spec.sdkPath, "utf8");
      } catch {
        console.error(`Missing generated file: ${spec.sdkPath}`);
        process.exit(1);
      }
      if (current !== content) {
        console.error(
          `${spec.label} is out of lockstep with ${spec.sourceLabel}.\n` +
            `Run: node scripts/sync-view-sdk-types.mjs`,
        );
        process.exit(1);
      }
    }
    console.log(
      `view-sdk types.ts + contributionTypes.ts are in lockstep with src/shared/{view,contribution}.ts ` +
        `(${REQUIRED_PROTOCOL_VALUES.length} protocol constants + ${REQUIRED_CONTRIBUTION_VALUES.length} contribution values mirrored)`,
    );
    return;
  }

  for (const { spec, content } of outputs) {
    writeFileSync(spec.sdkPath, content, "utf8");
    console.log(`Wrote ${spec.sdkPath}`);
  }
}

main();
