import { describe, expect, it, vi } from "vitest";
import { updateAppIconShortcuts } from "./appIconShortcut";

const executable = "C:\\Apps\\PiDesk\\PiDesk.exe";
const icon = "C:\\Apps\\PiDesk\\resources\\app.asar.unpacked\\build\\app-icons\\blue.ico";

describe("desktop app icon shortcuts", () => {
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
