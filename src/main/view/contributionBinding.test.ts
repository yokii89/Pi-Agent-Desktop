import { describe, expect, it } from "vitest";
import type { ExtensionContribution } from "../../shared/contribution";
import { resolveContributionBinding } from "./contributionBinding";

const entry: ExtensionContribution = {
  key: "key-A",
  catalogContextId: "A",
  packageId: "plan",
  scope: "user",
  placement: "access-mode",
  id: "plan",
  title: "Plan",
  activation: "onAccessMode",
  workerSafe: false,
};
const input = {
  entries: [entry],
  placement: "access-mode" as const,
  hint: { mode: { id: "plan", title: "Plan" } },
  worker: false,
};
describe("contribution binding", () => {
  it("binds an explicit key only to its declared id and placement", () => {
    expect(resolveContributionBinding({ ...input, contributionKey: entry.key })).toBe(entry.key);
    expect(() =>
      resolveContributionBinding({ ...input, contributionKey: entry.key, placement: "settings" }),
    ).toThrow();
    expect(() =>
      resolveContributionBinding({
        ...input,
        contributionKey: entry.key,
        hint: { mode: { id: "wrong", title: "Wrong" } },
      }),
    ).toThrow();
  });
  it("rejects another context and worker session placements", () => {
    expect(() => resolveContributionBinding({ ...input, contributionKey: "key-B" })).toThrow();
    expect(() => resolveContributionBinding({ ...input, worker: true })).toThrow();
  });
  it("legacy unique ids bind while ambiguous ids remain unbound", () => {
    expect(resolveContributionBinding(input)).toBe(entry.key);
    expect(
      resolveContributionBinding({ ...input, entries: [entry, { ...entry, key: "other" }] }),
    ).toBeUndefined();
  });
});
