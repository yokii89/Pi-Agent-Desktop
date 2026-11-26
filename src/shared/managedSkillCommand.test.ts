import { describe, expect, it } from "vitest";
import { parseManagedSkillCommand } from "./managedSkillCommand";

describe("desktop /skills navigation", () => {
  it.each(["install", "update", "repair", "uninstall"])(
    "opens a preview for %s with an optional name",
    (operation) => {
      expect(parseManagedSkillCommand(`/skills ${operation} plugin-creator`)).toEqual({
        tab: "manage",
        operation,
        name: "plugin-creator",
      });
      expect(parseManagedSkillCommand(`/skills ${operation}`)).toEqual({
        tab: "manage",
        operation,
      });
    },
  );
  it("supports the read-only tabs and preserves /skill: expansion", () => {
    expect(parseManagedSkillCommand(" /skills ")).toEqual({ tab: "manage" });
    expect(parseManagedSkillCommand("/skills doctor")).toEqual({ tab: "doctor" });
    expect(parseManagedSkillCommand("/skills manifest")).toEqual({ tab: "manifest" });
    expect(parseManagedSkillCommand("/skill:plugin-creator args")).toBeNull();
    expect(parseManagedSkillCommand("Please explain /skills")).toBeNull();
  });
  it.each([
    "/skills unknown",
    "/skills doctor name",
    "/skills install ../escape",
    "/skills install name extra",
    "/skills install C:\\escape",
  ])("rejects invalid syntax: %s", (input) => {
    expect(parseManagedSkillCommand(input)).toBe("invalid");
  });
});
