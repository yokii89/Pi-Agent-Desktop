import { createHash } from "node:crypto";
import path from "node:path";
import type { SessionPushMessage } from "../../shared/ipc";
import {
  REMOTE_THINKING_LEVELS,
  type RemoteSessionConfiguration,
} from "../../shared/remote/business";
import { pendingUiRequests } from "../session/extensionUi";
import { getPiAgentDir } from "../session/piInfo";
import {
  abortSession,
  fetchSessionState,
  hasSession,
  liveSessionIdForFile,
  promptSession,
  respondSessionUi,
  setSessionName,
} from "../session/piSession";
import { ensureSessionReady, listRuntimeSnapshots } from "../session/runtimeCoordinator";
import { encodeCwdToSessionDir, getSessionMeta, listSessions } from "../session/sessionHistory";
import { SESSION_PREVIEW_MAX_LENGTH } from "../session/sessionMeta";
import { getSettings } from "../settings/settings";
import { completedHistory, EMPTY_TAIL, RemoteHistoryReader } from "./historySync";
import { remoteInteractionAnswer } from "./interactionAnswer";
import { remoteSessionFile } from "./readAdapter";
import type {
  ReadOnlySource,
  RemoteInteraction,
  RemoteMessage,
  RemoteProject,
  RemoteSession,
} from "./readOnlyBridge";
import { sanitizeRemoteText } from "./sanitize";

const publicId = (projectId: string, file: string) =>
  createHash("sha256").update(`${projectId}\0${file}`).digest("hex");
const idForCreate = (creationKey: string) =>
  `remote_${createHash("sha256").update(creationKey).digest("hex").slice(0, 48)}`;
const sessionRoot = () => path.join(getPiAgentDir(), "sessions");
const sessionDirectory = (cwd: string) => path.join(sessionRoot(), encodeCwdToSessionDir(cwd));

function remoteConfiguration(configuration: {
  modelLabel?: unknown;
  thinkingLevel?: unknown;
}): RemoteSessionConfiguration {
  const result: RemoteSessionConfiguration = {};
  if (typeof configuration.modelLabel === "string" && configuration.modelLabel.trim())
    result.modelLabel = sanitizeRemoteText(configuration.modelLabel).slice(0, 256);
  const level = REMOTE_THINKING_LEVELS.find((value) => value === configuration.thinkingLevel);
  if (level !== undefined) result.thinkingLevel = level;
  return result;
}

function stateConfiguration(state: unknown): RemoteSessionConfiguration {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {};
  const current = state as { model?: unknown; thinkingLevel?: unknown };
  const model =
    current.model && typeof current.model === "object"
      ? (current.model as { name?: unknown; id?: unknown })
      : null;
  return remoteConfiguration({
    modelLabel: typeof model?.name === "string" && model.name.trim() ? model.name : model?.id,
    thinkingLevel: current.thinkingLevel,
  });
}

/** Only sanitized public DTOs leave the desktop main process. */
export class DesktopReadOnlySource implements ReadOnlySource {
  private refs = new Map<string, { file: string; projectId: string; root: string }>();
  private readonly runtimeSessions = new Map<
    string,
    { id: string; title: string; projectId: string; root: string }
  >();
  private readonly pendingSessions = new Map<string, Promise<RemoteSession[]>>();
  private readonly historyReader = new RemoteHistoryReader();

  observe(event: SessionPushMessage): boolean {
    if (event.type === "exit" || event.type === "error") return true;
    const updates =
      event.type === "eventBatch" ? event.payload : event.type === "event" ? [event.payload] : [];
    return updates.some((update) =>
      [
        "agent_start",
        "agent_end",
        "agent_settled",
        "message_end",
        "tool_execution_start",
        "tool_execution_end",
        "session_name_changed",
        "session_info_changed",
        "thinking_level_changed",
      ].includes(update.type),
    );
  }

  async history(session: RemoteSession) {
    const ref = this.ref(session);
    const view = await this.historyReader.read(ref.file, sessionDirectory(ref.root), sessionRoot());
    this.ref(session);
    const busy = listRuntimeSnapshots().some(
      (runtime) => runtime.sessionFile === ref.file && runtime.state === "busy",
    );
    return { view: completedHistory(view, !busy), tail: EMPTY_TAIL };
  }
  projects(): RemoteProject[] {
    return getSettings().projects.map((p) => ({
      id: p.id,
      name: sanitizeRemoteText(p.name).slice(0, 256),
      description: { "zh-CN": "", "en-US": "" },
    }));
  }
  sessions(projectIds: string[]): Promise<RemoteSession[]> {
    const selected = new Set(projectIds);
    const projects = getSettings().projects.filter((project) => selected.has(project.id));
    // Share only work in flight; completed scans must not hide disk or configuration changes.
    const key = JSON.stringify(projects.map(({ id, dir }) => [id, dir]));
    const active = this.pendingSessions.get(key);
    if (active) return active;
    const pending = this.scanSessions(projects).finally(() => this.pendingSessions.delete(key));
    this.pendingSessions.set(key, pending);
    return pending;
  }
  private async scanSessions(
    projects: readonly { id: string; dir: string }[],
  ): Promise<RemoteSession[]> {
    const result: RemoteSession[] = [];
    const refs = new Map<string, { file: string; projectId: string; root: string }>();
    const runtime = listRuntimeSnapshots();
    for (const project of projects) {
      for (const s of await listSessions(project.dir)) {
        const normalize = (value: string) =>
          process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
        if (!s.cwd || normalize(s.cwd) !== normalize(project.dir)) continue;
        try {
          await remoteSessionFile(s.file, sessionDirectory(project.dir), sessionRoot());
        } catch {
          continue;
        }
        if (!getSettings().projects.some((p) => p.id === project.id && p.dir === project.dir))
          continue;
        const id = publicId(project.id, s.file);
        const live = runtime.find((r) => r.sessionFile === s.file);
        const liveId = liveSessionIdForFile(s.file);
        let configuration = (await getSessionMeta(s.file)).configuration;
        if (liveId) {
          try {
            configuration = {
              ...configuration,
              ...stateConfiguration(await fetchSessionState(liveId)),
            };
          } catch {
            // A process may exit while listing; use its saved session configuration.
          }
        }
        if (!getSettings().projects.some((p) => p.id === project.id && p.dir === project.dir))
          continue;
        refs.set(id, { file: s.file, projectId: project.id, root: project.dir });
        const title = sanitizeRemoteText(s.sessionName || s.firstUserMessage || "PiDesk").slice(
          0,
          256,
        );
        if (liveId) {
          this.runtimeSessions.set(liveId, { id, title, projectId: project.id, root: project.dir });
          if (this.runtimeSessions.size > 512)
            this.runtimeSessions.delete(this.runtimeSessions.keys().next().value as string);
        }
        result.push({
          ...remoteConfiguration(configuration),
          id,
          projectId: project.id,
          title,
          status:
            liveId && pendingUiRequests(liveId).length > 0
              ? "waiting"
              : live?.state === "busy"
                ? "running"
                : "idle",
          updatedAt: s.updatedAt,
          preview: sanitizeRemoteText(s.latestUserMessage ?? "").slice(
            0,
            SESSION_PREVIEW_MAX_LENGTH,
          ),
        });
      }
    }
    const scanned = new Map(projects.map((project) => [project.id, project.dir]));
    for (const [id, ref] of this.refs)
      if (scanned.get(ref.projectId) === ref.root) this.refs.delete(id);
    for (const [id, ref] of refs) this.refs.set(id, ref);
    for (const [id, ref] of this.refs)
      if (!getSettings().projects.some((p) => p.id === ref.projectId && p.dir === ref.root))
        this.refs.delete(id);
    return result.filter((session) => this.refs.has(session.id));
  }
  async notificationSession(
    runtimeSessionId: string,
    projectIds: string[],
  ): Promise<{ id: string; title: string; projectId: string } | null> {
    let session = this.runtimeSessions.get(runtimeSessionId);
    if (!session) {
      await this.sessions(projectIds);
      session = this.runtimeSessions.get(runtimeSessionId);
    }
    if (
      !session ||
      !projectIds.includes(session.projectId) ||
      !getSettings().projects.some(
        (project) => project.id === session.projectId && project.dir === session.root,
      )
    )
      return null;
    return { id: session.id, title: session.title, projectId: session.projectId };
  }
  private ref(session: RemoteSession): { file: string; projectId: string; root: string } {
    const ref = this.refs.get(session.id);
    if (
      !ref ||
      ref.projectId !== session.projectId ||
      !getSettings().projects.some((p) => p.id === ref.projectId && p.dir === ref.root)
    )
      throw new Error("RESOURCE_UNAVAILABLE");
    return ref;
  }
  async messages(session: RemoteSession): Promise<RemoteMessage[]> {
    return (await this.history(session)).view.messages;
  }
  async interactions(projectIds: string[]): Promise<RemoteInteraction[]> {
    const sessions = await this.sessions(projectIds);
    const result: RemoteInteraction[] = [];
    for (const session of sessions) {
      const ref = this.refs.get(session.id);
      const liveId = ref ? liveSessionIdForFile(ref.file) : null;
      if (!liveId) continue;
      for (const pending of pendingUiRequests(liveId)) {
        result.push({
          id: pending.id,
          sessionId: session.id,
          projectId: session.projectId,
          kind: pending.request.method,
          title: sanitizeRemoteText(pending.request.title),
          description: sanitizeRemoteText(pending.request.message ?? ""),
          ...(pending.request.options
            ? { options: pending.request.options.map(sanitizeRemoteText) }
            : {}),
          ...(pending.request.prefill !== undefined
            ? { initialValue: sanitizeRemoteText(pending.request.prefill) }
            : {}),
          ...(pending.request.placeholder !== undefined
            ? { placeholder: sanitizeRemoteText(pending.request.placeholder) }
            : {}),
        });
      }
      if (result.length >= 100) return result.slice(0, 100);
    }
    return result;
  }
  async send(session: RemoteSession, message: string): Promise<{ disposition: string }> {
    const ref = this.ref(session);
    const { sessionId } = await ensureSessionReady({
      sessionFile: ref.file,
      cwd: ref.root,
      reason: "send",
    });
    const disposition = await promptSession(sessionId, message, { streamingBehavior: "followUp" });
    return { disposition };
  }
  async stop(session: RemoteSession): Promise<{ requested: boolean }> {
    const ref = this.ref(session);
    const liveId = liveSessionIdForFile(ref.file);
    if (!liveId || !hasSession(liveId)) throw new Error("RESOURCE_UNAVAILABLE");
    await abortSession(liveId);
    return { requested: true };
  }
  async create(projectId: string, title: string, creationKey: string): Promise<RemoteSession> {
    const project = getSettings().projects.find((p) => p.id === projectId);
    if (!project) throw new Error("RESOURCE_UNAVAILABLE");
    const sessionId = idForCreate(creationKey);
    const started = await ensureSessionReady({ sessionId, cwd: project.dir, reason: "manual" });
    await setSessionName(started.sessionId, title);
    const state = await fetchSessionState(started.sessionId);
    const file =
      state && typeof state === "object" ? (state as { sessionFile?: unknown }).sessionFile : null;
    if (typeof file !== "string" || !file) throw new Error("STATE_UNAVAILABLE");
    const id = publicId(projectId, file);
    const sessions = await listSessions(project.dir);
    const summary = sessions.find((item) => item.file === file);
    const configuration = {
      ...remoteConfiguration((await getSessionMeta(file)).configuration),
      ...stateConfiguration(state),
    };
    if (!getSettings().projects.some((p) => p.id === projectId && p.dir === project.dir))
      throw new Error("RESOURCE_UNAVAILABLE");
    this.refs.set(id, { file, projectId, root: project.dir });
    const sessionTitle = sanitizeRemoteText(summary?.sessionName || title).slice(0, 256);
    this.runtimeSessions.set(started.sessionId, {
      id,
      title: sessionTitle,
      projectId,
      root: project.dir,
    });
    return {
      ...configuration,
      id,
      projectId,
      title: sessionTitle,
      status: "idle",
      updatedAt: summary?.updatedAt ?? Date.now(),
      preview: sanitizeRemoteText(summary?.latestUserMessage ?? "").slice(
        0,
        SESSION_PREVIEW_MAX_LENGTH,
      ),
    };
  }
  answer(
    session: RemoteSession,
    interactionId: string,
    value: string | boolean,
  ): { settled: boolean } {
    const ref = this.ref(session);
    const liveId = liveSessionIdForFile(ref.file);
    if (!liveId) throw new Error("RESOURCE_UNAVAILABLE");
    const pending = pendingUiRequests(liveId).find((entry) => entry.id === interactionId);
    if (!pending) return { settled: false };
    const answer = remoteInteractionAnswer(pending.request, value);
    return { settled: respondSessionUi(liveId, interactionId, answer) };
  }
  isViewingLive(sessionId: string, viewing: (publicId: string) => boolean): boolean {
    for (const [id, ref] of this.refs)
      if (liveSessionIdForFile(ref.file) === sessionId && viewing(id)) return true;
    return false;
  }
}
