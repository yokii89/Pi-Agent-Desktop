import fs from "node:fs";
import type {
  DurableExtensionHostScope,
  DurableExtensionSpec,
} from "../../shared/durableExtension";
import {
  ensureViewHost,
  issueNativeViewBinding,
  revokeNativeExtensionViews,
} from "../view/viewHost";
import { getCatalogSnapshot } from "./contributionCatalog";
import { listPackageEntries } from "./packageStore";

/** Main resolves identity and contribution ownership before sending memory-only credentials. */
export async function prepareExtensionViews(
  specs: readonly DurableExtensionSpec[],
  owner: {
    ownerId: string;
    sessionId?: string;
    hostScope: DurableExtensionHostScope;
    projectDir?: string;
  },
): Promise<DurableExtensionSpec[]> {
  if (!specs.some((spec) => spec.capabilities.includes("views"))) return [...specs];
  await ensureViewHost();
  const packages = listPackageEntries(owner.projectDir ?? null);
  const catalog = getCatalogSnapshot(owner.projectDir ?? null);
  try {
    return specs.map((spec) => {
      if (!spec.capabilities.includes("views")) return spec;
      const entry = [...packages.user, ...packages.project].find(
        (candidate) =>
          candidate.installPath &&
          fs.realpathSync(candidate.installPath) === fs.realpathSync(spec.root),
      );
      const contributions = Object.fromEntries(
        catalog.entries
          .filter((item) => item.scope === spec.scope && item.packageId === entry?.name)
          .map((item) => [`${item.placement}:${item.id}`, item.key]),
      );
      return {
        ...spec,
        view: issueNativeViewBinding({ ...owner, extensionId: spec.id }, contributions),
      };
    });
  } catch (error) {
    revokeNativeExtensionViews(owner.ownerId);
    throw error;
  }
}
