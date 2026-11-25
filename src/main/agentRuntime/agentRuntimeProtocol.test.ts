import { describe, expect, it } from "vitest";
import {
  AGENT_RUNTIME_PROTOCOL_VERSION,
  parseAgentRuntimeMessage,
  parseAgentRuntimeRequest,
} from "../../shared/agentRuntimeProtocol";
import { parseRuntimeUpdate } from "../../shared/durableProtocol";

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

  it("admits bounded image submissions larger than the text-only runtime DTO cap", () => {
    const data = "A".repeat(700 * 1024);
    const command = {
      op: "submit",
      sessionId: "00000000-0000-4000-8000-000000000001",
      requestId: "image-input",
      text: "",
      mode: "followUp",
      images: [{ type: "image", data, mimeType: "image/png" }],
    };
    const parsed = parseAgentRuntimeRequest({ id: "request-1", type: "command", command });
    expect(parsed?.type).toBe("command");
    if (parsed?.type !== "command" || parsed.command.op !== "submit")
      throw new Error("Image submission was not accepted.");
    expect(parsed.command.text).toBe("");
    expect(parsed.command.images?.[0]?.data).toHaveLength(data.length);
  });

  it("accepts image-bearing runtime snapshots above the old 8 MiB message cap", () => {
    const data = "A".repeat(8 * 1024 * 1024);
    const update = {
      type: "snapshot",
      sessionId: "00000000-0000-4000-8000-000000000001",
      view: {
        conversation: { id: 1 },
        entries: [
          {
            id: 1,
            conversationId: 1,
            kind: "pi.user",
            model: [{ role: "user", content: [{ type: "image", data, mimeType: "image/png" }] }],
          },
        ],
        docs: {},
      },
    };
    expect(parseRuntimeUpdate(update)).not.toBeNull();
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
