import { describe, expect, it } from "vitest";
import { SECURITY_PROFILE } from "./contract";
import {
  encodeClientSocketFrame,
  encodeRelaySocketFrame,
  parseClientSocketFrame,
  parseRelaySocketFrame,
} from "./control";

const accountId = `account-v1-${"a".repeat(64)}`;
const principal = {
  accountId,
  role: "desktop",
  relayInstanceId: "relay-1",
  desktopId: "desktop-1",
  deviceId: "device-1",
  grantId: "grant-1",
  grantVersion: 1,
  connectionGeneration: 2,
  accessExpiresAt: "2030-01-01T00:00:00.000Z",
};
const context = {
  accountId,
  relayInstanceId: "relay-1",
  desktopId: "desktop-1",
  deviceId: "phone-1",
  grantId: "grant-1",
  grantVersion: 1,
  connectionGeneration: 3,
  accessExpiresAt: "2030-01-01T00:00:00.000Z",
};
const response = { version: 1, type: "response", id: "request-1", status: "completed", data: {} };
const request = {
  version: 1,
  type: "request",
  id: "request-1",
  command: "projects.list",
  payload: {},
};
const relay = (frame: Record<string, unknown>, role?: "desktop" | "mobile") =>
  parseRelaySocketFrame(JSON.stringify(frame), role);
const client = (
  frame: Record<string, unknown>,
  role: "desktop" | "mobile" | null,
  authenticated = true,
) => parseClientSocketFrame(JSON.stringify(frame), { role, authenticated });

describe("shared v2 WebSocket control protocol", () => {
  it("parses strict pre-authentication and role-specific client frames", () => {
    expect(
      client(
        { controlVersion: 2, type: "authenticate", accessToken: "account-token" },
        null,
        false,
      ),
    ).toMatchObject({ type: "authenticate" });
    expect(client(request, "mobile")).toMatchObject({ command: "projects.list" });
    expect(
      client({ controlVersion: 2, type: "deliver", context, frame: response }, "desktop"),
    ).toMatchObject({ type: "deliver", context: { deviceId: "phone-1" } });
    expect(() => client(request, "desktop")).toThrow("FORBIDDEN");
  });

  it("rejects extra fields, wrong roles and client frames in the wrong state", () => {
    expect(() =>
      client(
        { controlVersion: 2, type: "authenticate", accessToken: "token", debug: true },
        null,
        false,
      ),
    ).toThrow("INVALID_FRAME");
    expect(() => client({ ...request, unexpected: true }, "mobile")).toThrow();
    expect(() =>
      client({ controlVersion: 2, type: "deliver", context, frame: response }, "mobile"),
    ).toThrow("FORBIDDEN");
  });

  it("parses relay handshake, pairing/status events and routed business frames", () => {
    expect(
      relay(
        {
          controlVersion: 2,
          type: "authenticated",
          principal: { ...principal, role: "desktop" },
          securityProfile: SECURITY_PROFILE,
          desktopOnline: true,
          features: ["state-push-v1", "session-reauth-v1", "completed-history-v1"],
          accountExpiresAt: "2030-01-01T00:00:00.000Z",
        },
        "desktop",
      ),
    ).toMatchObject({ type: "authenticated", principal: { role: "desktop" } });
    expect(
      relay(
        {
          controlVersion: 2,
          type: "pairing_state",
          state: { revision: 0, grant: null, claim: null },
          deliverySequence: 1,
        },
        "desktop",
      ),
    ).toMatchObject({ type: "pairing_state", state: { revision: 0 } });
    expect(
      relay(
        { controlVersion: 2, type: "desktop_status", online: true, deliverySequence: 2 },
        "mobile",
      ),
    ).toMatchObject({ type: "desktop_status", online: true });
    expect(
      relay(
        { controlVersion: 2, type: "route", context, frame: request, deliverySequence: 3 },
        "desktop",
      ),
    ).toMatchObject({ type: "route", frame: { command: "projects.list" } });
    expect(
      relay(
        { controlVersion: 2, type: "business", frame: response, deliverySequence: 4 },
        "mobile",
      ),
    ).toMatchObject({ type: "business", frame: { status: "completed" } });
    expect(() =>
      relay(
        {
          controlVersion: 2,
          type: "business",
          frame: { ...response, unrecognized: true },
          deliverySequence: 5,
        },
        "mobile",
      ),
    ).toThrow();
    expect(() =>
      relay(
        {
          controlVersion: 2,
          type: "pairing_state",
          state: { revision: 0, grant: null, claim: null },
          deliverySequence: 1,
        },
        "mobile",
      ),
    ).toThrow("FORBIDDEN");
  });

  it("round-trips only schema-valid protocol frames", () => {
    const encoded = encodeClientSocketFrame(
      { controlVersion: 2, type: "ack", deliverySequence: 1 },
      { role: "mobile", authenticated: true },
    );
    expect(parseClientSocketFrame(encoded, { role: "mobile", authenticated: true })).toMatchObject({
      type: "ack",
      deliverySequence: 1,
    });
    expect(() =>
      encodeRelaySocketFrame(
        { controlVersion: 2, type: "business", frame: response, deliverySequence: 0 },
        "mobile",
      ),
    ).toThrow("INVALID_FRAME");
  });
});
