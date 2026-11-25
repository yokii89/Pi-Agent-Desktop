import { describe, expect, it } from "vitest";
import {
  AGENT_RUNTIME_PROTOCOL_VERSION,
  parseAgentRuntimeMessage,
  parseAgentRuntimeRequest,
} from "../../shared/agentRuntimeProtocol";

describe("agent runtime protocol", () => {
  it("accepts only the versioned utility-process smoke-test request shape", () => {
    expect(
      parseAgentRuntimeRequest({
        id: "smoke-1",
        type: "smoke-test",
        databasePath: "C:/temp/session.sqlite",
      }),
    ).toEqual({
      id: "smoke-1",
      type: "smoke-test",
      databasePath: "C:/temp/session.sqlite",
    });
    expect(parseAgentRuntimeRequest({ id: "x", type: "smoke-test", databasePath: "" })).toBeNull();
    expect(
      parseAgentRuntimeRequest({ id: "x", type: "smoke-test", databasePath: "x", extra: true }),
    ).toEqual({
      id: "x",
      type: "smoke-test",
      databasePath: "x",
    });
  });

  it("bounds message fields and validates runtime protocol handshakes", () => {
    expect(
      parseAgentRuntimeMessage({
        type: "ready",
        protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION,
        nodeVersion: "24.16.0",
      }),
    ).toEqual({
      type: "ready",
      protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION,
      nodeVersion: "24.16.0",
    });
    expect(
      parseAgentRuntimeMessage({ type: "ready", protocolVersion: 1.5, nodeVersion: "24.16.0" }),
    ).toBeNull();
    expect(
      parseAgentRuntimeMessage({ type: "response", id: "x", ok: false, error: "x".repeat(2_001) }),
    ).toBeNull();
  });
});
