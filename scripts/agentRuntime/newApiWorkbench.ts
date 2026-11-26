import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { app, type BrowserWindow } from "electron";
import type { DurableModelConfig } from "../../src/shared/durableProtocol";
import type { IpcResult, PiModelOption } from "../../src/shared/ipc";
import type { GatewayCatalog, GatewayModelInfo } from "../../src/shared/newApi";

const hostRequire = createRequire(__filename);
function production<T>(module: string): T {
  return hostRequire(path.join(app.getAppPath(), "dist/main", `${module}.js`)) as T;
}
async function previous(file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
async function until(check: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 20000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`New API acceptance timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

/** Exercise the real encrypted store, private model catalog and renderer controls in an isolated profile. */
export async function checkNewApiWorkbench(
  window: BrowserWindow,
  reportPath: string,
): Promise<Record<string, unknown>> {
  const evaluate = <T>(source: string): Promise<T> =>
    window.webContents.executeJavaScript(source, true) as Promise<T>;
  const invoke = async <T>(source: string): Promise<T> => {
    const result = await evaluate<IpcResult<T>>(source);
    assert(result.ok, result.ok ? "" : result.error);
    return result.data as T;
  };
  const sessions = production<{
    desktopSessions: { close(id: string): Promise<void>; updateModel(): Promise<void> };
  }>("agentRuntime/desktopSessions").desktopSessions;
  const runtime = production<{ listRuntimeSnapshots(hidden?: boolean): { sessionId: string }[] }>(
    "session/runtimeCoordinator",
  );
  for (const row of runtime.listRuntimeSnapshots(true)) await sessions.close(row.sessionId);
  const home = app.getPath("home");
  assert(home.startsWith(app.getPath("userData")), "Codex acceptance must use an isolated home.");
  const modelFile = path.join(app.getPath("userData"), "durable/v1/model.bin");
  const authFile = path.join(home, ".codex/auth.json");
  const configFile = path.join(home, ".codex/config.toml");
  const saved = await Promise.all([previous(modelFile), previous(authFile), previous(configFile)]);
  let discoveries = 0;
  let failed = false;
  let latest = "catalog-first";
  const server = createServer((request, response) => {
    assert.equal(request.url, "/v1/models");
    assert.equal(request.headers.authorization, "Bearer newapi-acceptance-only");
    discoveries++;
    response.writeHead(failed ? 503 : 200, { "Content-Type": "application/json" });
    response.end(
      failed
        ? JSON.stringify({ error: "upstream unavailable" })
        : JSON.stringify({
            data: [
              { id: "gpt-4o", name: "GPT-4o", supported_endpoint_types: ["openai"] },
              { id: latest, supported_endpoint_types: ["anthropic"] },
            ],
          }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await mkdir(path.dirname(authFile), { recursive: true });
    await writeFile(authFile, JSON.stringify({ OPENAI_API_KEY: "newapi-acceptance-only" }));
    await writeFile(
      configFile,
      `model = "codex-unlisted"\nmodel_provider = "acceptance"\nmodel_reasoning_effort = "high"\n[model_providers.acceptance]\nbase_url = "${baseUrl}/v1/"\nwire_api = "responses"\n`,
    );
    const imported = await invoke<DurableModelConfig>("window.pidesk.durable.importCodexModel()");
    assert.equal(imported.modelId, "codex-unlisted");
    assert.equal(imported.preferredThinking, "high");
    assert(!("apiKey" in imported));
    const catalog = await invoke<GatewayCatalog<GatewayModelInfo>>(
      "window.pidesk.durable.modelCatalog()",
    );
    assert.equal(discoveries, 1);
    assert(catalog.models.some((model) => model.id === "codex-unlisted"));
    assert.deepEqual(catalog.models.find((model) => model.id === "gpt-4o")?.input, [
      "text",
      "image",
    ]);
    assert.equal(catalog.models.find((model) => model.id === "gpt-4o")?.reasoning, false);
    assert.equal(catalog.models.find((model) => model.id === latest)?.api, "openai-completions");
    await invoke("window.pidesk.durable.modelCatalog()");
    assert.equal(discoveries, 1);
    const probe = await invoke<{ count: number }>("window.pidesk.durable.testModelConnection()");
    assert.equal(probe.count, 2);
    assert.equal(discoveries, 2);
    latest = "catalog-refreshed";
    await invoke("window.pidesk.durable.modelCatalog(true)");
    assert.equal(discoveries, 3);
    failed = true;
    const fallback = await invoke<GatewayCatalog<GatewayModelInfo>>(
      "window.pidesk.durable.modelCatalog(true)",
    );
    assert(fallback.stale && fallback.error);
    assert(fallback.models.some((model) => model.id === latest));
    failed = false;
    await invoke("window.pidesk.durable.clearModelCache()");
    await invoke("window.pidesk.durable.modelCatalog()");
    assert.equal(discoveries, 5);
    const options = await invoke<PiModelOption[]>("window.pidesk.session.getModels({})");
    assert(options.some((model) => model.modelId === latest));
    await invoke(
      `window.pidesk.session.setDefaultModel({ provider: "pidesk-openai", modelId: ${JSON.stringify(latest)} })`,
    );
    assert.equal(
      (await invoke<DurableModelConfig>("window.pidesk.durable.model()")).modelId,
      latest,
    );

    await evaluate("document.querySelector('button[title=\"Settings\"]').click()");
    await until(
      () =>
        evaluate<boolean>(
          '!!document.querySelector(\'[role="dialog"] nav[aria-label="Settings categories"]\')',
        ),
      "settings dialog",
    );
    await evaluate(
      "Array.from(document.querySelectorAll('[role=\"dialog\"] nav button')).find(b => b.textContent.trim() === 'Models').click()",
    );
    await until(
      () =>
        evaluate<boolean>(
          "!!document.querySelector('input[aria-label=\"Model ID\"]') && !document.querySelector('input[aria-label=\"Model ID\"]').disabled",
        ),
      "model panel",
    );
    assert.equal(
      await evaluate<string>("document.querySelector('input[aria-label=\"Model ID\"]').value"),
      latest,
    );
    const beforeRefresh = discoveries;
    await evaluate(
      "Array.from(document.querySelectorAll('[role=\"dialog\"] button')).find(b => b.textContent.trim() === 'Refresh models').click()",
    );
    await until(
      async () =>
        discoveries === beforeRefresh + 1 &&
        (await evaluate<boolean>(
          "!document.querySelector('input[aria-label=\"Model ID\"]').disabled",
        )),
      "refresh control",
    );
    assert(!(await evaluate<string>("document.body.innerText")).includes("newapi-acceptance-only"));
    assert.equal(
      await evaluate<string>("document.querySelector('input[aria-label=\"API key\"]').value"),
      "",
    );
    await writeFile(
      path.join(
        path.dirname(reportPath),
        `${app.isPackaged ? "packaged" : "development"}-newapi.png`,
      ),
      (await window.webContents.capturePage()).toPNG(),
    );
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    console.log("New API discovery, cache controls, Codex import and model settings passed.");
    return {
      discovery: "passed",
      cacheAndRefresh: "passed",
      failureFallback: "passed",
      codexImport: "passed",
      unlistedPreference: "passed",
      capabilityMatching: "passed",
      modelSelection: "passed",
      settingsControls: "passed",
      credentialIsolation: "passed",
      discoveries,
    };
  } finally {
    for (const [index, file] of [modelFile, authFile, configFile].entries()) {
      if (saved[index]) await writeFile(file, saved[index] as Buffer);
      else await rm(file, { force: true });
    }
    await sessions.updateModel();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
