import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { collectAppIconShortcuts, updateAppIconShortcuts } from "./appIconShortcut";

const executable = "C:\\Apps\\PiDesk\\PiDesk.exe";
const icon = "C:\\Apps\\PiDesk\\resources\\app.asar.unpacked\\build\\app-icons\\blue.ico";

describe("desktop app icon shortcuts", () => {
  it("covers desktop and start menu, skipping unknown roots", () => {
    expect(
      collectAppIconShortcuts({
        desktop: "C:\\Users\\me\\Desktop",
        publicDesktop: "C:\\Users\\Public\\Desktop",
        startMenuPrograms:
          "C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs",
        allUsersStartMenuPrograms: null,
      }),
    ).toEqual([
      path.win32.join("C:\\Users\\me\\Desktop", "PiDesk.lnk"),
      path.win32.join("C:\\Users\\Public\\Desktop", "PiDesk.lnk"),
      path.win32.join(
        "C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs",
        "PiDesk.lnk",
      ),
    ]);
    expect(
      collectAppIconShortcuts({
        desktop: "",
        publicDesktop: null,
        startMenuPrograms: null,
        allUsersStartMenuPrograms: null,
      }),
    ).toEqual([]);
  });

  it("updates only existing links to this installation", () => {
    const update = vi.fn(() => true);
    const read = vi.fn((file: string) => ({
      target: file === "other.lnk" ? "C:\\Other\\PiDesk.exe" : executable.toUpperCase(),
    }));
    expect(
      updateAppIconShortcuts(["desktop.lnk", "missing.lnk", "other.lnk"], executable, icon, {
        exists: (file) => file !== "missing.lnk",
        read,
        update,
      }),
    ).toEqual([]);
    expect(read).not.toHaveBeenCalledWith("missing.lnk");
    expect(update.mock.calls).toEqual([["desktop.lnk", icon]]);
  });

  it("avoids rewriting unchanged icons and duplicate links", () => {
    const update = vi.fn(() => true);
    updateAppIconShortcuts(["same.lnk", "index.lnk", "index.lnk"], executable, icon, {
      exists: () => true,
      read: (file) => ({
        target: executable,
        icon: icon.toUpperCase(),
        iconIndex: file === "same.lnk" ? 0 : 1,
      }),
      update,
    });
    expect(update.mock.calls).toEqual([["index.lnk", icon]]);
  });

  it("isolates unreadable and unwritable links so later links still update", () => {
    const update = vi.fn((file: string) => file !== "readonly.lnk");
    expect(
      updateAppIconShortcuts(["broken.lnk", "readonly.lnk", "desktop.lnk"], executable, icon, {
        exists: () => true,
        read: (file) => {
          if (file === "broken.lnk") throw new Error("Invalid shortcut");
          return { target: executable };
        },
        update,
      }),
    ).toEqual(["broken.lnk", "readonly.lnk"]);
    expect(update).toHaveBeenCalledWith("desktop.lnk", icon);
  });
});
