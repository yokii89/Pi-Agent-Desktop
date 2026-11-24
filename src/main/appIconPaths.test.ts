import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AppIconPathEnv,
  resolveAppIconPath,
  resolveNotificationIconPath,
  resolveTaskbarIconPath,
} from "./appIconPaths";

const APP_PATH = path.join("C:", "Apps", "PiDesk", "resources", "app.asar");
const RESOURCES = path.join("C:", "Apps", "PiDesk", "resources");
const EXEC = path.join("C:", "Apps", "PiDesk", "PiDesk.exe");

const asarIcon = (id: string, ext: string) =>
  path.join(APP_PATH, "build", "app-icons", `${id}.${ext}`);
const unpackedIcon = (id: string, ext: string) =>
  path.join(RESOURCES, "app.asar.unpacked", "build", "app-icons", `${id}.${ext}`);
const legacyIcon = (ext: string) => path.join(APP_PATH, "build", `icon.${ext}`);

function envWith(
  files: readonly string[],
  overrides: Partial<AppIconPathEnv> = {},
): AppIconPathEnv {
  const set = new Set(files);
  return {
    appPath: APP_PATH,
    resourcesPath: RESOURCES,
    platform: "win32",
    packaged: true,
    execPath: EXEC,
    hasFile: (file) => set.has(file),
    ...overrides,
  };
}

describe("app icon path resolution", () => {
  it("reads window icons from asar and taskbar/toast from unpacked files", () => {
    const env = envWith([
      asarIcon("blue", "ico"),
      asarIcon("blue", "png"),
      unpackedIcon("blue", "ico"),
      unpackedIcon("blue", "png"),
    ]);
    expect(resolveAppIconPath(env, "blue")).toBe(asarIcon("blue", "ico"));
    expect(resolveTaskbarIconPath(env, "blue")).toBe(unpackedIcon("blue", "ico"));
    expect(resolveNotificationIconPath(env, "blue")).toBe(unpackedIcon("blue", "png"));
  });

  it("falls back to the classic variant when the chosen one is missing", () => {
    const env = envWith([
      asarIcon("classic", "ico"),
      asarIcon("classic", "png"),
      unpackedIcon("classic", "ico"),
      unpackedIcon("classic", "png"),
    ]);
    expect(resolveAppIconPath(env, "yellow")).toBe(asarIcon("classic", "ico"));
    expect(resolveTaskbarIconPath(env, "yellow")).toBe(unpackedIcon("classic", "ico"));
    expect(resolveNotificationIconPath(env, "yellow")).toBe(unpackedIcon("classic", "png"));
  });

  it("uses the executable icon when no unpacked taskbar icon survives", () => {
    const env = envWith([asarIcon("classic", "ico")]);
    expect(resolveTaskbarIconPath(env, "classic")).toBe(asarIcon("classic", "ico"));
    const bare = envWith([]);
    expect(resolveTaskbarIconPath(bare, "classic")).toBe(EXEC);
  });

  it("keeps the legacy build/icon.* as the last resort", () => {
    const env = envWith([legacyIcon("ico"), legacyIcon("png")]);
    expect(resolveAppIconPath(env, "green")).toBe(legacyIcon("ico"));
    expect(resolveNotificationIconPath(env, "green")).toBe(legacyIcon("png"));
  });

  it("reads everything from the repo in development", () => {
    const env = envWith([asarIcon("green", "ico"), asarIcon("green", "png")], {
      packaged: false,
    });
    expect(resolveAppIconPath(env, "green")).toBe(asarIcon("green", "ico"));
    expect(resolveTaskbarIconPath(env, "green")).toBe(asarIcon("green", "ico"));
    expect(resolveNotificationIconPath(env, "green")).toBe(asarIcon("green", "png"));
  });

  it("reports nothing when the variant assets are absent", () => {
    const env = envWith([]);
    expect(resolveAppIconPath(env, "blue")).toBeUndefined();
    expect(resolveNotificationIconPath(env, "blue")).toBeUndefined();
    expect(resolveTaskbarIconPath(envWith([], { platform: "linux" }), "blue")).toBeUndefined();
  });
});
