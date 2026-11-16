import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";

const taskRoot = path.resolve("temp/office-benchmark");
const fixtures = path.resolve("temp/office-preview/corpus");
const allowed = new Set(
  JSON.parse(fs.readFileSync(path.join(fixtures, "manifest.json"), "utf8")).files.map(
    (file: { file: string }) => file.file,
  ),
);
const readOfficeFile = require(path.resolve("dist/main/fs/readOffice.js")).readOfficeFile;
const officeFormatForPath = require(
  path.resolve("dist/shared/officePreview.js"),
).officeFormatForPath;
fs.mkdirSync(path.join(taskRoot, "profile"), { recursive: true });
app.setPath("userData", path.join(taskRoot, "profile"));
app.commandLine.appendSwitch("remote-debugging-port", "9388");
app.commandLine.appendSwitch("js-flags", "--expose-gc");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  ipcMain.handle("benchmark:read", (_event, name: string) => {
    if (!allowed.has(name)) throw new Error("Unknown fixture");
    return readOfficeFile(path.join(fixtures, name), officeFormatForPath(name) ?? null);
  });
  ipcMain.handle("benchmark:close", () => {
    setTimeout(() => app.quit(), 100);
    return true;
  });
  ipcMain.handle("benchmark:metrics", () =>
    app
      .getAppMetrics()
      .filter((process) => process.type === "Tab")
      .map((process) => ({ pid: process.pid, memory: process.memory, cpu: process.cpu })),
  );
  const win = new BrowserWindow({
    width: 800,
    height: 1000,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  await win.loadFile(path.join(taskRoot, "dist/index.html"));
  win.showInactive();
});
app.on("window-all-closed", () => app.quit());
