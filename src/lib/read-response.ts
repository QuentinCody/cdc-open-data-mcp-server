export function fail(message: string, status = 400, data?: unknown): never {
  throw Object.assign(new Error(message), { status, data });
}

/** A body can stall after headers arrive; cancellation must not extend the deadline. */
export async function readCdcResponse(response: Response): Promise<string> {
  if (!response.body) fail("Empty CDC response", 502);
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  const deadline = Date.now() + 15_000;
  let raw = "";
  let bytes = 0;
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("CDC body exceeded its 15-second deadline"), { status: 504 })), Math.max(0, deadline - Date.now()));
      });
      const chunk = await Promise.race([reader.read(), timeout]).finally(() => clearTimeout(timer));
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 4 * 1024 * 1024) fail("CDC response exceeds 4 MiB; narrow the query", 502);
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
    if (response.status === 206 || response.headers.has("content-range")) fail("Unexpected partial CDC response", 502,
      { response: raw, http_status: response.status, content_range: response.headers.get("content-range"), incomplete: true });
    return raw;
  } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

/** Preserve the complete bounded provider error, including unknown problem fields. */
export function cdcHttpError(response: Response, raw: string, sourceUrl?: string): never {
  let problem: unknown;
  try { problem = JSON.parse(raw); } catch { problem = undefined; }
  fail(`CDC HTTP ${response.status}`, response.status, { response: raw, problem, http_status: response.status,
    source_url: sourceUrl || response.url || undefined, retry_after: response.headers.get("Retry-After"), incomplete: true });
}
