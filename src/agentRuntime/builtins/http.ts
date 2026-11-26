const MAX_TEXT_RESPONSE_BYTES = 8 * 1024 * 1024;

/** Provider responses use bounded buffers and never forward credentials through redirects. */
export async function fetchProvider(url: string | URL, init: RequestInit): Promise<Response> {
  const response = await fetch(url, { ...init, redirect: "error" });
  if (!response.ok) {
    await response.body?.cancel();
    // Provider error bodies can echo authorization headers or account details.
    throw new Error(
      `Search provider request failed (HTTP ${response.status}). Check its built-in tool settings.`,
    );
  }
  const body = await readResponseBytes(response, MAX_TEXT_RESPONSE_BYTES);
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  return new Response(response.body === null ? null : new Uint8Array(body).buffer, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Bound decoded response bodies, including chunked and compressed responses. */
export async function readResponseBytes(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel();
    throw new Error(`Response exceeds the ${maxBytes}-byte limit.`);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error(`Response exceeds the ${maxBytes}-byte limit.`);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally {
    reader.releaseLock();
  }
}

/** Retain complete text only within the native reader's memory budget. */
export async function readResponseText(
  response: Response,
  maxBytes = MAX_TEXT_RESPONSE_BYTES,
): Promise<string> {
  return (await readResponseBytes(response, maxBytes)).toString("utf8");
}
