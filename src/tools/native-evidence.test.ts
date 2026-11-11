import { verifyCitationEnvelope } from "@bio-mcp/shared";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ RpcTarget: class {}, DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));

import { WASTEWATER_COLUMNS } from "../lib/wastewater";
import { wastewaterWorkflows } from "../spec/wastewater";
import { fixture, recover } from "./staging-fixture";

const metadata = () => ({id: "atcp-73re", rowsUpdatedAt: 100, viewLastModified: 200,
  columns: WASTEWATER_COLUMNS.map(fieldName => ({fieldName, dataTypeName: ["site_wval", "population_served"].includes(fieldName) ? "number" : "text"})),
  metadata: {footnotes: "Historical recalibration α😀".repeat(2000)}});
const observation = (i: number) => ({site: `ID:${i}`, state_territory: "Alabama", week_end: "2026-08-01", pathogen_target: "RSV",
  population_served: "9007199254740993", site_wval: i ? "1.00000000000000001" : null, site_wval_category: "Limited/No Data",
  source: "fixture", date_updated: "2026-10-02 11:01", unknown_field: {values: ["001", null]}});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function invoke(f: ReturnType<typeof fixture>, name: string, args: Record<string, unknown>, failed = false) {
  const result = await f.tools[name].handler(args, {});
  expect(result.isError === true, JSON.stringify(result).slice(0, 500)).toBe(failed);
  expect(result.content.length).toBeGreaterThan(0);
  const sc = result.structuredContent;
  const id = sc.staged ? sc.data_access_id : sc.data?.__staged ? sc.data.data_access_id : undefined;
  const staged = id ? await recover(f, id, "") : undefined;
  const proof = await verifyCitationEnvelope({ citation: sc._meta?.citation, structuredContent: sc, toolArguments: args,
    ...(staged ? { materialized: { value: staged } } : {}) });
  expect(proof.verification).toMatchObject({ query: "verified", result: "verified" });
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(30720);
  return { sc, id, data: sc.staged ? staged.structuredContent.data : sc.data?.__staged ? staged : sc.data };
}

it.each(["", "mcp_"])("verifies all %s aliases, argument hashes and error envelopes", async prefix => {
  const f = fixture();
  try {
    await invoke(f, `${prefix}cdc_search`, { query: "wastewater" });
    await invoke(f, `${prefix}cdc_execute`, { code: "return {value:'001'};" });
    await invoke(f, `${prefix}cdc_execute`, { code: "" }, true);
    await invoke(f, `${prefix}cdc_query_data`, { data_access_id: "missing", sql: "SELECT * FROM missing" }, true);
    await invoke(f, `${prefix}cdc_get_schema`, { data_access_id: "missing" });
  } finally { f.close(); }
});

it("recovers native values, before/after metadata and bounded revision context from real SQLite", async () => {
  const f = fixture(); const meta = metadata(); const rows = [observation(0), observation(1)];
  vi.stubGlobal("fetch", async (url: string | URL) => Response.json(String(url).includes("/api/views/") ? meta : rows));
  try {
    const result = await invoke(f, "cdc_execute", {code: 'return await api.get("/wastewater/observations",{pathogen:"RSV",week_from:"2026-08-01",week_to:"2026-09-19",limit:2});'});
    expect(result.id).toBeTruthy(); expect(result.data).toMatchObject({data: rows, metadata: meta, metadata_after: meta});
    expect(result.sc._meta.citation.record_count).toBe(2);
    const queried = await invoke(f, "mcp_cdc_query_data", {data_access_id: result.id, sql: "SELECT native_json,population_served,typeof(population_served) AS kind,site_wval FROM observations ORDER BY source_index"});
    expect(queried.data.rows.map((row: {native_json: string}) => JSON.parse(row.native_json))).toEqual(rows);
    expect(queried.data.rows[0]).toMatchObject({population_served: "9007199254740993", kind: "text", site_wval: null});
    expect(queried.data.rows[1].site_wval).toBe("1.00000000000000001");
    const context = await invoke(f, "cdc_query_data", {data_access_id: result.id, sql: "SELECT native_json FROM revision_context"});
    expect(JSON.parse(context.data.rows[0].native_json)).toMatchObject({revision: "100:200", next_offset: 2, methodology: {historical_values_recalculated: true}});
    const oversized = await invoke(f, "cdc_query_data", {data_access_id: result.id, sql: "SELECT native_json FROM response_context"}, true);
    expect(oversized.sc.error.code).toBe("QUERY_COST_LIMIT");
    let raw = "";
    for (let start = 1; ; start += 1000) {
      const part = await invoke(f, "cdc_query_data", {data_access_id: result.id, sql: `SELECT substr(native_json,${start},1000) AS part FROM response_context`});
      raw += part.data.rows[0].part;
      if ([...part.data.rows[0].part].length < 1000) break;
    }
    expect(JSON.parse(raw)).toEqual({metadata: meta, metadata_after: meta, _mcp: result.data._mcp});
  } finally { f.close(); }
});

it("continues staged pages and retains every full page handle through the recipe", async () => {
  const f = fixture(); const offsets: number[] = []; const meta = metadata();
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = new URL(input);
    if (url.pathname.includes("/api/views/")) return Response.json(meta);
    const offset = Number(url.searchParams.get("$offset")); offsets.push(offset);
    return Response.json(Array.from({length: offset < 200 ? 100 : 1}, (_, i) => observation(offset + i)));
  });
  try {
    const result = await invoke(f, "mcp_cdc_execute", {code: wastewaterWorkflows[3].code});
    expect(offsets).toEqual([0, 100, 200]);
    expect(result.data).toMatchObject({query_page_exhausted: true, atomic_snapshot_verified: false});
    expect(result.data.pages).toHaveLength(3);
    for (const page of result.data.pages) {
      expect(page.__staged).toBe(true);
      expect(await recover(f, page.data_access_id, "")).toMatchObject({metadata: meta, metadata_after: meta, _mcp: {revision: "100:200"}});
    }
  } finally { f.close(); }
});

it("preserves large native failures and composed results through full staging", async () => {
  const f = fixture(); const problem = {code: "fixture", message: "α".repeat(30000), future: ["001", null]};
  vi.stubGlobal("fetch", async () => Response.json(problem, {status: 400}));
  try {
    const failed = await invoke(f, "cdc_execute", {code: 'return await api.get("/data/atcp-73re.json",{$select:"missing"});'}, true);
    const native = failed.data.data.__staged ? await recover(f, failed.data.data.data_access_id, "") : failed.data.data;
    expect(native.problem).toEqual(problem); expect(JSON.parse(native.response)).toEqual(problem);
    const composed = await invoke(f, "mcp_cdc_execute", {code: 'return {notes:"α😀".repeat(12000),values:[0,null,"001"]};'});
    expect(composed.sc.staged).toBe(true); expect(composed.data.notes).toBe("α😀".repeat(12000));
  } finally { f.close(); }
});
