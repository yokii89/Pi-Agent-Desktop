import { describe, expect, it } from "vitest";
import { parseGitHubRepo } from "./gitAvatar";

describe("parseGitHubRepo", () => {
  it("解析 https / git@ / ssh 常见 remote", () => {
    expect(parseGitHubRepo("https://github.com/yokii89/PiDesk.git")).toEqual({
      owner: "yokii89",
      repo: "PiDesk",
    });
    expect(parseGitHubRepo("https://github.com/yokii89/PiDesk")).toEqual({
      owner: "yokii89",
      repo: "PiDesk",
    });
    expect(parseGitHubRepo("git@github.com:yokii89/PiDesk.git")).toEqual({
      owner: "yokii89",
      repo: "PiDesk",
    });
    expect(parseGitHubRepo("ssh://git@github.com/yokii89/PiDesk.git")).toEqual({
      owner: "yokii89",
      repo: "PiDesk",
    });
  });

  it("非 GitHub remote 返回 null", () => {
    expect(parseGitHubRepo("https://gitlab.com/a/b.git")).toBeNull();
    expect(parseGitHubRepo("git@gitlab.com:a/b.git")).toBeNull();
    expect(parseGitHubRepo("")).toBeNull();
  });
});
