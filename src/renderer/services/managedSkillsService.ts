import type { ManagedSkillPlanRequest, ManagedSkillsDesktopApi } from "../../shared/managedSkills";
import { unwrap } from "./ipc";

function api(): ManagedSkillsDesktopApi {
  const value = window.pidesk?.managedSkills;
  if (!value) throw new Error("PIDESK_SKILLS:unavailable");
  return value;
}

export const managedSkillsService = {
  list: (projectDir?: string | null) => unwrap(api().list(projectDir)),
  plan: (request: ManagedSkillPlanRequest) => unwrap(api().plan(request)),
  apply: (id: string) => unwrap(api().apply(id)),
};
