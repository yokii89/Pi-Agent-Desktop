import { createHash } from "node:crypto";
import path from "node:path";
import type { SessionPushMessage } from "../../shared/ipc";
import { pendingUiRequests } from "../session/extensionUi";
import { getPiAgentDir } from "../session/piInfo";
import {
  abortSession,
  fetchSessionMessages,
  fetchSessionState,
  hasSession,
  liveSessionIdForFile,
  promptSession,
  respondSessionUi,
  setSessionName,
} from "../session/piSession";
import {
  ensureSessionReady,
  getRuntimeState,
  listRuntimeSnapshots,
} from "../session/runtimeCoordinator";
import { encodeCwdToSessionDir, listSessions } from "../session/sessionHistory";
import { getSettings } from "../settings/settings";
import { RemoteHistoryReader } from "./historySync";
import { RemoteHistoryTail } from "./historyTail";
import { remoteInteractionAnswer } from "./interactionAnswer";
import { projectRemoteMessages, readRemoteHistory, remoteSessionFile } from "./readAdapter";
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

/** Only sanitized public DTOs leave the desktop main process. */
export class DesktopReadOnlySource implements ReadOnlySource {
  private refs = new Map<string, { file: string; projectId: string; root: string }>();
  private readonly pendingSessions = new Map<string, Promise<RemoteSession[]>>();
  private readonly historyReader = new RemoteHistoryReader();
  private readonly historyTail = new RemoteHistoryTail();

  observe(event: SessionPushMessage): void {
    this.historyTail.observe(event);
  }

  async history(session: RemoteSession) {
    const ref = this.ref(session);
    const view = await this.historyReader.read(ref.file, sessionDirectory(ref.root), sessionRoot());
    this.ref(session);
    return { view, tail: this.historyTail.current(liveSessionIdForFile(ref.file), view) };
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
        refs.set(id, { file: s.file, projectId: project.id, root: project.dir });
        const live = runtime.find((r) => r.sessionFile === s.file);
        const liveId = liveSessionIdForFile(s.file);
        result.push({
          id,
          projectId: project.id,
          title: sanitizeRemoteText(s.sessionName || s.firstUserMessage || "PiDesk").slice(0, 256),
          status:
            liveId && pendingUiRequests(liveId).length > 0
              ? "waiting"
              : live?.state === "busy"
                ? "running"
                : "idle",
          updatedAt: s.updatedAt,
          preview: sanitizeRemoteText(s.firstUserMessage ?? "").slice(0, 256),
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
    const ref = this.ref(session);
    const directory = sessionDirectory(ref.root);
    await remoteSessionFile(ref.file, directory, sessionRoot());
    const liveId = liveSessionIdForFile(ref.file);
    let messages: RemoteMessage[];
    if (liveId && hasSession(liveId)) {
      try {
        const raw = await fetchSessionMessages(liveId);
        messages = projectRemoteMessages(raw, getRuntimeState(liveId) === "busy");
      } catch {
        messages = await readRemoteHistory(ref.file, directory, sessionRoot());
      }
    } else {
      messages = await readRemoteHistory(ref.file, directory, sessionRoot());
    }
    await remoteSessionFile(ref.file, directory, sessionRoot());
    this.ref(session);
    return messages;
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
    this.refs.set(id, { file, projectId, root: project.dir });
    const sessions = await listSessions(project.dir);
    const summary = sessions.find((item) => item.file === file);
    return {
      id,
      projectId,
      title: sanitizeRemoteText(summary?.sessionName || title).slice(0, 256),
      status: "idle",
      updatedAt: summary?.updatedAt ?? Date.now(),
      preview: sanitizeRemoteText(summary?.firstUserMessage ?? "").slice(0, 256),
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
