import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { app, type BrowserWindow } from "electron";

const localRequire = createRequire(__filename);
function production<T>(module: string): T {
  return localRequire(path.join(app.getAppPath(), "dist/main", `${module}.js`)) as T;
}
async function until(check: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 20000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Native View acceptance timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

/** Exercise the real renderer, private utility channel, View sockets and desktop package service. */
export async function checkP3ViewsWorkbench(
  window: BrowserWindow,
  reportPath: string,
): Promise<Record<string, unknown>> {
  const evaluate = <T>(source: string) =>
    window.webContents.executeJavaScript(source, true) as Promise<T>;
  const runtime = production<{
    listRuntimeSnapshots(hidden?: boolean): { sessionId: string; state: string }[];
  }>("session/runtimeCoordinator");
  const sessions = production<{ desktopSessions: { close(id: string): Promise<void> } }>(
    "agentRuntime/desktopSessions",
  ).desktopSessions;
  for (const row of runtime.listRuntimeSnapshots(true)) await sessions.close(row.sessionId);
  const hosts = production<{
    startAppExtensionHost(): Promise<void>;
    reloadWorkerForExtensionChange(): Promise<unknown>;
    disposeExtensionWorker(): Promise<void>;
    getWorkerStatus(): { ready: boolean; leases: number };
  }>("extension/extensionWorkerManager");
  const agent = production<{ getPiAgentDir(): string }>("session/piInfo").getPiAgentDir();
  assert(agent.startsWith(app.getPath("userData")));
  const settings = path.join(agent, "settings.json");
  let original: Buffer | undefined;
  try {
    original = await readFile(settings);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const packageRoot = path.join(app.getPath("userData"), "native views 包");
  const lifecycle = path.join(packageRoot, "lifecycle.txt");
  await mkdir(packageRoot, { recursive: true });
  await mkdir(agent, { recursive: true });
  await writeFile(settings, JSON.stringify({ packages: [] }));
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      name: "native-views-acceptance",
      version: "1.0.0",
      type: "module",
      pidesk: {
        runtime: {
          engine: "durable",
          apiVersion: 1,
          id: "view-demo",
          entry: "./desktop.mjs",
          capabilities: ["views", "commands"],
          hosts: ["session", "app", "settings"],
        },
        contributes: { settingsViews: [{ id: "preferences", title: "Native preferences" }] },
      },
    }),
  );
  await writeFile(
    path.join(packageRoot, "desktop.mjs"),
    `
    import { appendFile } from 'node:fs/promises';
    export default async host => {
      await appendFile(${JSON.stringify(lifecycle)}, 'open:'+host.hostScope+':'+host.sessionId+'\\n');
      if (host.hostScope === 'app') await host.views.openLive({placement:'header',root:{type:'text',content:'P3_APP_VIEW_OK'}});
      if (host.hostScope === 'settings') await host.views.openLive({placement:'settings',title:'Native preferences',contributionKey:host.contributions['settings:preferences'],placementHint:{panelId:'preferences'},root:{type:'text',content:'P3_SETTINGS_VIEW_OK'}});
      return {
        commands: host.hostScope === 'session' ? [{name:'view-demo:inspect',description:'Show native session View',execute:async()=>{
          await host.views.openLive({placement:'modal',title:'Native command',root:{type:'text',content:'P3_SESSION_VIEW_OK'}});
        }}] : undefined,
        dispose: () => appendFile(${JSON.stringify(lifecycle)}, 'close:'+host.hostScope+':'+host.signal.aborted+'\\n')
      };
    };
  `,
  );
  const settingsOpen = async () => {
    await until(
      () => evaluate<boolean>("!!document.querySelector('button[title=\"Settings\"]')"),
      "settings button",
    );
    await evaluate("document.querySelector('button[title=\"Settings\"]').click()");
    await until(
      () =>
        evaluate<boolean>(
          "Array.from(document.querySelectorAll('[role=\"dialog\"] button')).some(b=>b.textContent.trim()==='From extensions')",
        ),
      "extension settings navigation",
    );
    await evaluate(
      "Array.from(document.querySelectorAll('[role=\"dialog\"] button')).find(b=>b.textContent.trim()==='From extensions').click()",
    );
  };
  const assertResult = (value: { ok: boolean; error?: string }) => assert(value.ok, value.error);
  try {
    assertResult(
      await evaluate(`window.pidesk.extension.install({source:${JSON.stringify(packageRoot)}})`),
    );
    await hosts.startAppExtensionHost();
    await until(
      () => evaluate<boolean>("document.body.innerText.includes('P3_APP_VIEW_OK')"),
      "app view",
    );
    const before = runtime.listRuntimeSnapshots(true).length;
    await settingsOpen();
    await until(
      () => evaluate<boolean>("document.body.innerText.includes('P3_SETTINGS_VIEW_OK')"),
      "native settings card",
    );
    assert.equal(
      runtime.listRuntimeSnapshots(true).length,
      before,
      "Opening settings must not create a conversation.",
    );
    assert(hosts.getWorkerStatus().ready);
    await writeFile(
      path.join(
        path.dirname(reportPath),
        `${app.isPackaged ? "packaged" : "development"}-p3-views.png`,
      ),
      (await window.webContents.capturePage()).toPNG(),
    );
    await evaluate("document.querySelector('button[title=\"Close settings\"]').click()");
    await until(() => hosts.getWorkerStatus().leases === 0, "settings lease released");
    await new Promise<void>((resolve) => {
      window.webContents.once("did-finish-load", () => resolve());
      window.webContents.reload();
    });
    await until(
      () => evaluate<boolean>("document.body.innerText.includes('P3_APP_VIEW_OK')"),
      "app View replay after renderer reload",
    );
    await settingsOpen();
    await until(
      () => evaluate<boolean>("document.body.innerText.includes('P3_SETTINGS_VIEW_OK')"),
      "settings View replay during grace",
    );
    await evaluate("document.querySelector('button[title=\"Close settings\"]').click()");
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='New task').click()",
    );
    await until(
      () => evaluate<boolean>("!!document.querySelector('[contenteditable=\"true\"]')"),
      "new session composer",
    );
    await evaluate("document.querySelector('[contenteditable=\"true\"]').focus()");
    await window.webContents.insertText("/view-demo:inspect");
    await until(
      () =>
        evaluate<boolean>("!!document.querySelector('button[aria-label=\"Send\"]:not(:disabled)')"),
      "command send",
    );
    await evaluate("document.querySelector('button[aria-label=\"Send\"]').click()");
    await until(
      () => evaluate<boolean>("document.body.innerText.includes('P3_SESSION_VIEW_OK')"),
      "host command View",
    );
    await until(
      () => runtime.listRuntimeSnapshots().every((row) => row.state !== "busy"),
      "handled command settles",
    );
    for (const row of runtime.listRuntimeSnapshots(true)) await sessions.close(row.sessionId);
    await until(
      () => evaluate<boolean>("!document.body.innerText.includes('P3_SESSION_VIEW_OK')"),
      "session View cleanup",
    );
    assertResult(
      await evaluate(`window.pidesk.extension.remove({source:${JSON.stringify(packageRoot)}})`),
    );
    await until(
      () =>
        evaluate<boolean>(
          "!document.body.innerText.includes('P3_APP_VIEW_OK') && !document.body.innerText.includes('P3_SETTINGS_VIEW_OK')",
        ),
      "package removal cleanup",
    );
    const history = await readFile(lifecycle, "utf8");
    for (const scope of ["app", "settings", "session"])
      assert(history.includes(`close:${scope}:true`));
    assert(
      (await readFile(path.join(packageRoot, "desktop.mjs"), "utf8")).includes("export default"),
    );
    const archiveDir = path.join(app.getPath("userData"), "package archives");
    await mkdir(archiveDir, { recursive: true });
    await production<{
      runPackageCommand(
        program: "pnpm",
        args: string[],
        cwd: string,
        log: (line: string) => void,
      ): Promise<void>;
    }>("extension/packageCommand").runPackageCommand(
      "pnpm",
      ["pack", "--pack-destination", archiveDir],
      packageRoot,
      () => {},
    );
    const archive = path.join(archiveDir, "native-views-acceptance-1.0.0.tgz");
    assertResult(
      await evaluate(`window.pidesk.extension.install({source:${JSON.stringify(archive)}})`),
    );
    await until(
      () => evaluate<boolean>("document.body.innerText.includes('P3_APP_VIEW_OK')"),
      "archive package loaded",
    );
    const installed = await evaluate<{
      ok: boolean;
      data: { user: { source: string; installPath: string }[] };
    }>("window.pidesk.extension.list()");
    const archived = installed.data.user.find((entry) => entry.source === archive);
    assert(archived);
    assert(archived.installPath.startsWith(path.join(agent, "archives")));
    assertResult(
      await evaluate(`window.pidesk.extension.remove({source:${JSON.stringify(archive)}})`),
    );
    await assert.rejects(readFile(path.join(archived.installPath, "package.json")));
    assert((await readFile(archive)).length > 0);
    return {
      settingsWithoutConversation: "passed",
      appView: "passed",
      rendererReplay: "passed",
      hostCommand: "passed",
      sessionCleanup: "passed",
      uninstallCleanup: "passed",
      localSourceRetained: "passed",
      sdkRuntimeImport: "passed",
      archiveInstallAndRemove: "passed",
    };
  } finally {
    for (const row of runtime.listRuntimeSnapshots(true))
      await sessions.close(row.sessionId).catch(() => {});
    if (original) await writeFile(settings, original);
    else await rm(settings, { force: true });
    production<{ invalidateCatalog(): void }>("extension/contributionCatalog").invalidateCatalog();
    await hosts.reloadWorkerForExtensionChange();
  }
}
