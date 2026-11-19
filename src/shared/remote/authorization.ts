import { fail, type Grant, type RoutingContext, sameBinding } from "./contract";
export const COMMAND_SCOPES = {
  "projects.list": "projects.read",
  "sessions.list": "sessions.read",
  "sessions.history": "sessions.read",
  "sessions.history.sync": "sessions.read",
  "sessions.subscribe": "sessions.read",
  "interactions.list": "interactions.read",
  "requests.lookup": "sessions.read",
  "sessions.send": "sessions.send",
  "sessions.stop": "sessions.stop",
  "sessions.create": "sessions.create",
  "interactions.answer": "interactions.answer",
} as const;
/** Invoke before payload parsing/services and again immediately before each response/event. */
export function authorize(
  grant: Grant | null,
  context: RoutingContext,
  command: string,
  configuredProjects: readonly string[],
  now: number,
  projectId?: string,
): void {
  if (
    grant?.state !== "active" ||
    !sameBinding(grant, context) ||
    now >= Date.parse(grant.expiresAt) ||
    now >= Date.parse(context.accessExpiresAt)
  )
    fail("DEVICE_REVOKED");
  if (!Object.hasOwn(COMMAND_SCOPES, command)) fail("INVALID_COMMAND");
  const scope = COMMAND_SCOPES[command as keyof typeof COMMAND_SCOPES];
  if (!(grant.scopes as string[]).includes(scope)) fail("FORBIDDEN");
  if (
    projectId !== undefined &&
    (!configuredProjects.includes(projectId) || !grant.projectIds.includes(projectId))
  )
    fail("RESOURCE_UNAVAILABLE");
}
