import { MANAGED_SKILL_OPERATIONS, type ManagedSkillOperation } from "./managedSkills";

export interface ManagedSkillsIntent {
  tab: "manage" | "doctor" | "manifest";
  operation?: ManagedSkillOperation;
  name?: string;
}

/** Local desktop commands open a reviewable manager; they never submit a model turn. */
export function parseManagedSkillCommand(text: string): ManagedSkillsIntent | "invalid" | null {
  const input = text.trim();
  if (!/^\/skills(?:\s|$)/.test(input)) return null;
  const [, action, name, ...extra] = input.split(/\s+/);
  if (extra.length) return "invalid";
  if (!action || ["browse", "manage", "doctor", "manifest"].includes(action)) {
    if (name) return "invalid";
    return { tab: action === "doctor" || action === "manifest" ? action : "manage" };
  }
  if (
    !MANAGED_SKILL_OPERATIONS.some((operation) => operation === action) ||
    (name !== undefined && !/^[a-z0-9-]{1,64}$/.test(name))
  )
    return "invalid";
  return { tab: "manage", operation: action as ManagedSkillOperation, ...(name ? { name } : {}) };
}
