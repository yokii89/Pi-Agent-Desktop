import type { IpcResult } from "./ipc";
import type { ClaimStatus, Grant, PairingQr, Scope } from "./remote";
export const REMOTE_IPC = {
  snapshot: "pidesk:remote:snapshot",
  enroll: "pidesk:remote:enroll",
  connect: "pidesk:remote:connect",
  disconnect: "pidesk:remote:disconnect",
  invite: "pidesk:remote:invite",
  approve: "pidesk:remote:approve",
  reject: "pidesk:remote:reject",
  revoke: "pidesk:remote:revoke",
} as const;
export interface RemoteSnapshot {
  configured: boolean;
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
  connect(): Promise<IpcResult<RemoteSnapshot>>;
  disconnect(): Promise<IpcResult<RemoteSnapshot>>;
  invite(): Promise<IpcResult<RemoteSnapshot>>;
  approve(projects: string[], scopes: Scope[]): Promise<IpcResult<RemoteSnapshot>>;
  reject(): Promise<IpcResult<RemoteSnapshot>>;
  revoke(): Promise<IpcResult<RemoteSnapshot>>;
}
export interface RemoteEnrollment {
  relayOrigin: string;
  enrollmentTicket: string;
  trustRelay: boolean;
}
