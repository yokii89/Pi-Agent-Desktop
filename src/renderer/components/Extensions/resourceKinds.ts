import type { TranslateFn } from "../../../shared/i18n";
import type { PiPackageResourceKind } from "../../../shared/ipc";

export const RESOURCE_KIND_ORDER: readonly PiPackageResourceKind[] = [
  "extensions",
  "skills",
  "prompts",
  "themes",
];

export function resourceKindLabel(t: TranslateFn, kind: PiPackageResourceKind): string {
  return t(`extensions.resourceKind.${kind}`);
}
