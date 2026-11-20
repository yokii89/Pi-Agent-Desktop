import type { IpcResult } from "./ipc";
import type {
  AccountProfile,
  ClaimStatus,
  DesktopSummary,
  Grant,
  PairingQr,
  Scope,
} from "./remote";

export const REMOTE_IPC = {
  snapshot: "pidesk:remote:snapshot",
  enroll: "pidesk:remote:enroll",
  account: "pidesk:remote:account",
  cancelLogin: "pidesk:remote:cancelLogin",
  resetEnrollment: "pidesk:remote:resetEnrollment",
  desktops: "pidesk:remote:desktops",
  removeDesktop: "pidesk:remote:removeDesktop",
  logout: "pidesk:remote:logout",
  connect: "pidesk:remote:connect",
  disconnect: "pidesk:remote:disconnect",
  invite: "pidesk:remote:invite",
  approve: "pidesk:remote:approve",
  reject: "pidesk:remote:reject",
  revoke: "pidesk:remote:revoke",
} as const;

export type DesktopLoginPhase =
  | "signed_out"
  | "opening_browser"
  | "waiting_for_browser"
  | "exchanging_code"
  | "signed_in"
  | "error";

/** Display-only identity. Tokens and the authorization URL never cross IPC. */
export interface DesktopAuthSnapshot {
  phase: DesktopLoginPhase;
  identity: AccountProfile | null;
  deadline: number | null;
  error: string | null;
}

/** Persisted before registration so reopening the panel cannot create another computer. */
export interface DesktopEnrollmentDraft {
  relayOrigin: string;
  displayName: string;
  registrationRequestId: string;
  desktopId: string | null;
  accountId: string | null;
}

export interface RemoteSnapshot {
  configured: boolean;
  controlVersion: 2;
  accountReady: boolean;
  auth: DesktopAuthSnapshot;
  accountId: string | null;
  desktopId: string | null;
  operation: "enrolling" | "signing_in" | "resetting" | "signing_out" | null;
  connectionState: "paused" | "connecting" | "connected" | "disconnected";
  enrollment: DesktopEnrollmentDraft | null;
  credentialState: "none" | "ready" | "expired" | "invalid";
  relayOrigin: string | null;
  connected: boolean;
  qr: PairingQr | null;
  claim: ClaimStatus | null;
  grant: Grant | null;
  revocationPending: boolean;
  projects: { id: string; name: string }[];
  error: string | null;
}

export interface RemoteApi {
  snapshot(): Promise<IpcResult<RemoteSnapshot>>;
  enroll(request: RemoteEnrollment): Promise<IpcResult<RemoteSnapshot>>;
  account(request: RemoteAccountInput): Promise<IpcResult<RemoteSnapshot>>;
  cancelLogin(): Promise<IpcResult<RemoteSnapshot>>;
  resetEnrollment(localOnly: boolean): Promise<IpcResult<RemoteSnapshot>>;
  desktops(relayOrigin: string): Promise<IpcResult<DesktopSummary[]>>;
  removeDesktop(relayOrigin: string, desktopId: string): Promise<IpcResult<RemoteSnapshot>>;
  logout(): Promise<IpcResult<RemoteSnapshot>>;
  connect(): Promise<IpcResult<RemoteSnapshot>>;
  disconnect(): Promise<IpcResult<RemoteSnapshot>>;
  invite(): Promise<IpcResult<RemoteSnapshot>>;
  /** Approve the exact locally confirmed claim; stale callers and missing claim ids are rejected. */
  approve(claimId: string, projects: string[], scopes: Scope[]): Promise<IpcResult<RemoteSnapshot>>;
  reject(): Promise<IpcResult<RemoteSnapshot>>;
  revoke(): Promise<IpcResult<RemoteSnapshot>>;
}

export interface RemoteAccountInput {
  relayOrigin: string;
  /** Explicit sign-in always opens the browser; ordinary reconnect uses connect(). */
  reauthenticate?: boolean;
}

export interface RemoteEnrollment {
  controlVersion: 2;
  relayOrigin: string;
  displayName: string;
  registrationRequestId: string;
  trustRelay: boolean;
}
