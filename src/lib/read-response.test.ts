import { afterEach, expect, it, vi } from "vitest";
import { createCdcApiFetch } from "./api-adapter";
import { readCdcResponse } from "./read-response";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each([200, 206])("rejects partial HTTP %s while retaining complete received evidence", async status => {
  await expect(readCdcResponse(new Response("[]", {status, headers: {"content-range": "bytes 0-1/50"}})))
    .rejects.toMatchObject({status: 502, data: {response: "[]", http_status: status, incomplete: true}});
});

it("bounds a stalled body without awaiting stalled cancellation", async () => {
  vi.useFakeTimers();
  const response = new Response(new ReadableStream({pull: () => new Promise(() => {}), cancel: () => new Promise(() => {})}));
  const check = expect(readCdcResponse(response)).rejects.toMatchObject({status: 504});
  await vi.advanceTimersByTimeAsync(15001); await check;
});

it("retains complete native problems and malformed JSON evidence", async () => {
  const problem = {code: "query.soql.no-such-column", message: "α".repeat(20000), data: {column: "missing"}, future: [null, "001"]};
  vi.stubGlobal("fetch", async () => Response.json(problem, {status: 400}));
  await expect(createCdcApiFetch()({method: "GET", path: "/data/atcp-73re.json"})).rejects.toMatchObject({status: 400, data: {problem, response: JSON.stringify(problem)}});
  vi.stubGlobal("fetch", async () => new Response('{"data":', {headers: {"content-type": "application/json"}}));
  await expect(createCdcApiFetch()({method: "GET", path: "/meta/atcp-73re"})).rejects.toMatchObject({status: 502, data: {response: '{"data":'}});
  await expect(readCdcResponse(new Response(new Uint8Array([0xc3, 0x28])))).rejects.toThrow();
});
