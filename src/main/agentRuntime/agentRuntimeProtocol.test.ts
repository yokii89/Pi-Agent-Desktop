import { describe, expect, it } from "vitest";
import {
  AGENT_RUNTIME_PROTOCOL_VERSION,
  parseAgentRuntimeMessage,
  parseAgentRuntimeRequest,
} from "../../shared/agentRuntimeProtocol";

describe("agent runtime protocol", () => {
  it("accepts the managed smoke storage root and rejects the superseded database-path shape", () => {
    const request = { id: "smoke-1", type: "smoke-test", storageRoot: "C:/temp/smoke" };
    expect(parseAgentRuntimeRequest(request)).toEqual(request);
    expect(parseAgentRuntimeRequest({ ...request, storageRoot: "" })).toBeNull();
    expect(
      parseAgentRuntimeRequest({
        ...request,
        storageRoot: undefined,
        databasePath: "C:/temp/session.sqlite",
      }),
    ).toBeNull();
    expect(parseAgentRuntimeRequest({ ...request, extra: true })).toEqual(request);
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
