import NodeWebSocket from "ws";

/** v2 account authentication belongs to the upgrade headers, never the URL or subprotocol. */
export function relaySocket(url: string, headers: Record<string, string>): WebSocket {
  return new NodeWebSocket(url, {
    headers,
    followRedirects: false,
    perMessageDeflate: false,
    maxPayload: 65_536,
    handshakeTimeout: 5_000,
  }) as unknown as WebSocket;
}
