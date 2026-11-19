import type { IpcResult } from "./ipc";
import type { ClaimStatus, Grant, PairingQr, Scope } from "./remote";
export const REMOTE_IPC = {
  snapshot: "pidesk:remote:snapshot",
  enroll: "pidesk:remote:enroll",
  account: "pidesk:remote:account",
  logout: "pidesk:remote:logout",
  connect: "pidesk:remote:connect",
  disconnect: "pidesk:remote:disconnect",
  invite: "pidesk:remote:invite",
  approve: "pidesk:remote:approve",
  reject: "pidesk:remote:reject",
  revoke: "pidesk:remote:revoke",
} as const;
export interface RemoteSnapshot {
  configured: boolean;
  controlVersion?: 1 | 2;
  accountReady?: boolean;
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
}
export type RemoteEnrollment =
  | {
      relayOrigin: string;
      enrollmentTicket: string;
      trustRelay: boolean;
    }
  | {
      controlVersion: 2;
      relayOrigin: string;
      displayName: string;
      registrationRequestId: string;
      trustRelay: boolean;
    };
