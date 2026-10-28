/**
 * Access-mode contribution descriptors (PiDesk docs/design/14).
 *
 * An access-mode extension declares the same metadata twice: once in
 * `package.json` (`pidesk.contributes.accessModes[]`, read by the Host's Catalog
 * scanner) and once in code (the live registration descriptor). Keeping two
 * hand-written copies in sync is what docs/design/19 §3.1.3 called out; this
 * helper makes the manifest entry the single source.
 */

import type {
  ContributionAccent,
  ContributionActivation,
  ManifestContributionItem,
} from "./contributionTypes.js";

/**
 * Input accepted by {@link defineAccessMode}: the `pidesk.contributes.accessModes[]`
 * entry shape. `activation` is optional and must be `onAccessMode` when present.
 */
export interface AccessModeContributionInput {
  id: string;
  title: string;
  description?: string;
  /**
   * Host built-in icon name. The access-mode chip renders
   * `ACCESS_MODE_ICON_NAMES`; any other valid contribution icon falls back to
   * the default chip icon.
   */
  icon?: string;
  accent?: ContributionAccent;
  activation?: ContributionActivation;
}

/**
 * Frozen runtime descriptor, directly usable as the `registration` argument of
 * `superviseAccessMode()` or as the base options of `registerAccessMode()`.
 */
export interface AccessModeContribution {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly icon?: string;
  readonly accent?: ContributionAccent;
}

/**
 * Define the live registration descriptor for a composer access mode.
 *
 * Pass the manifest entry itself (import your `package.json`) so the manifest
 * stays the single source and the Catalog/live rows cannot drift:
 *
 * ```ts
 * import pkg from "./package.json" with { type: "json" };
 * const PLAN_MODE = defineAccessMode(pkg.pidesk.contributes.accessModes[0]);
 * ```
 *
 * The result is frozen; `id`/`title` are trimmed and must be non-empty. A
 * non-`onAccessMode` `activation` throws because an access-mode entry cannot
 * activate through another placement. Runtime-only fields (`signal`, `onEvent`,
 * `contributionKey`) stay with the caller.
 *
 * Throws `TypeError` for contract violations; it never talks to the Host.
 */
export function defineAccessMode(input: AccessModeContributionInput): AccessModeContribution {
  if (!input || typeof input !== "object") {
    throw new TypeError("[pidesk/view-sdk] defineAccessMode requires an access-mode object");
  }
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!id || !title) {
    throw new TypeError("[pidesk/view-sdk] defineAccessMode requires non-empty id and title");
  }
  if (input.activation !== undefined && input.activation !== "onAccessMode") {
    throw new TypeError(`[pidesk/view-sdk] access mode "${id}" must use activation "onAccessMode"`);
  }

  const description =
    typeof input.description === "string" ? input.description.trim() || undefined : undefined;
  const icon = typeof input.icon === "string" && input.icon ? input.icon : undefined;
  const mode: AccessModeContribution = {
    id,
    title,
    ...(description ? { description } : {}),
    ...(icon ? { icon } : {}),
    ...(input.accent ? { accent: input.accent } : {}),
  };
  return Object.freeze(mode);
}

/**
 * Project a descriptor back to the manifest entry shape
 * (`activation: "onAccessMode"`), for drift tests:
 *
 * ```ts
 * expect(pkg.pidesk.contributes.accessModes).toContainEqual(
 *   accessModeManifestEntry(PLAN_MODE),
 * );
 * ```
 */
export function accessModeManifestEntry(mode: AccessModeContribution): ManifestContributionItem {
  return {
    id: mode.id,
    title: mode.title,
    description: mode.description,
    icon: mode.icon,
    accent: mode.accent,
    activation: "onAccessMode",
  };
}
