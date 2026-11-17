import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app, BrowserWindow } from "electron";

const { url, fixtures, report } = JSON.parse(process.env.PIDESK_PDF_REGRESSION ?? "{}") as {
  url: string;
  fixtures: string;
  report: string;
};
const taskRoot = path.dirname(report);
mkdirSync(path.join(taskRoot, "profile"), { recursive: true });
app.setPath("userData", path.join(taskRoot, "profile"));
app.disableHardwareAcceleration();
const warnings: string[] = [];
const requests: string[] = [];
const violations: string[] = [];
const timeout = setTimeout(() => {
  console.error("PDF regression timed out");
  app.exit(1);
}, 45_000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 640,
    height: 1500,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.webContents.on("console-message", ({ message }) => {
    if (/Warning:|Error:|Content Security Policy/.test(message)) warnings.push(message);
  });
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    requests.push(details.url);
    callback({
      cancel: /^https?:/.test(details.url) && !details.url.startsWith("http://localhost:"),
    });
  });
  try {
    await win.loadURL(url);
    await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const end = Date.now() + 10000;
      const timer = setInterval(() => {
        if (window.runPdfRegression) { clearInterval(timer); resolve(true); }
        else if (Date.now() > end) { clearInterval(timer); reject(new Error('Renderer did not load')); }
      }, 20);
    })`);
    const result = await win.webContents.executeJavaScript(
      `window.runPdfRegression(${readFileSync(fixtures, "utf8")})`,
    );
    const cspViolations = await win.webContents.executeJavaScript("window.pdfCspViolations ?? []");
    violations.push(...cspViolations);
    writeFileSync(report, JSON.stringify({ result, warnings, requests, violations }, null, 2));
    await win.webContents.executeJavaScript(`(() => {
      const elements = [...document.body.querySelectorAll('p, canvas')];
      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(3, 480px);gap:8px';
      for (let index = 0; index < elements.length; index += 2) {
        const cell = document.createElement('div');
        cell.append(elements[index], elements[index + 1]);
        grid.append(cell);
      }
      document.body.replaceChildren(grid);
    })()`);
    win.setContentSize(1500, 1000);
    const image = await win.webContents.capturePage();
    writeFileSync(report.replace(/\.json$/, ".png"), image.toPNG());
    if (warnings.length || violations.length)
      throw new Error(JSON.stringify({ warnings, violations }));
    clearTimeout(timeout);
    app.quit();
  } catch (error) {
    console.error(error);
    clearTimeout(timeout);
    app.exit(1);
  }
});
