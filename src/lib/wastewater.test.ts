import {afterEach, expect, it, vi} from "vitest";
import {wastewaterWorkflows} from "../spec/wastewater";
import {createCdcApiFetch} from "./api-adapter";
import {PATHOGENS, WASTEWATER_COLUMNS, wastewaterQuery} from "./wastewater";
import observed from "./wastewater-observed.fixture.json";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status, headers: {"Content-Type": "application/json"}});
const metadata = () => ({id: "atcp-73re", rowsUpdatedAt: 1790348665, viewLastModified: 1790348545, columns: WASTEWATER_COLUMNS.map(fieldName => ({fieldName, dataTypeName: ["site_wval", "population_served"].includes(fieldName) ? "number" : "text", description: `Fixture definition: ${fieldName}`})), metadata: {custom_fields: {"Data Quality": {Footnotes: "Fixture: August 2026 methods were applied to historical data."}}}});
const params = {pathogen: "RSV", week_from: "2026-08-01", week_to: "2026-09-19", state_territory: "Alabama", site: "ID:4"};
const native = () => ({...observed.rows[1]});
function stub(rows: unknown[] = [native()], before: unknown = metadata(), after: unknown = before) {
  let metaCalls = 0;
  const fetcher = vi.fn().mockImplementation((url: string | URL) => String(url).includes("/api/views/") ? json(++metaCalls === 1 ? before : after) : json(rows));
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
const read = (input: Record<string, unknown> = params) => createCdcApiFetch()({method: "GET", path: "/wastewater/observations", params: input});
afterEach(() => vi.unstubAllGlobals());
it.each(PATHOGENS)("preserves observed %s record, processing date and metadata context", async pathogen => {
  const row = observed.rows.find(item => item.pathogen_target === pathogen)!;
  const fetcher = stub([row]); const result = await read({...params, pathogen});
  expect(result.data).toMatchObject({data: [row], metadata: metadata(), metadata_after: metadata(), _mcp: {revision: "1790348665:1790348545", revision_unchanged_during_request: true, atomic_snapshot_verified: false, methodology: {historical_values_recalculated: true}}});
  expect(fetcher).toHaveBeenCalledTimes(3);
  const url = new URL(fetcher.mock.calls[1][0]); expect(url.origin).toBe("https://data.cdc.gov");
  expect(url.searchParams.get("$where")).toContain(`pathogen_target='${pathogen}'`);
  expect(url.searchParams.get("$order")).toContain(":id ASC");
});
it("does not assign older methodology to pre-August observation weeks", async () => {
  const row = {...native(), week_end: "2026-07-25", date_updated: "2026-09-25 11:01"}; stub([row]);
  expect((await read({...params, week_from: "2026-07-01"})).data).toMatchObject({data: [row], _mcp: {methodology: {reported_change_date: "2026-08-14", historical_values_recalculated: true}, historical_availability_verified: false}});
});
it("preserves missing values, native precision and limited-data categories", async () => {
  const row = {...native(), population_served: "9007199254740993", site_wval: null, site_wval_category: "Limited/No Data", future_field: {unknown: "kept"}};
  stub([row]); expect((await read()).data).toMatchObject({data: [row]});
});
it("retains full metadata and declares no immutable snapshot", async () => {
  stub(); expect((await createCdcApiFetch()({method: "GET", path: "/wastewater/metadata"})).data).toMatchObject({metadata: metadata(), _mcp: {atomic_snapshot_verified: false, complete_dataset_verified: false, revision: "1790348665:1790348545"}});
});
it("returns bounded continuation only when revision stamps are unchanged", async () => {
  stub(); expect((await read({...params, limit: 1, offset: 4})).data).toMatchObject({_mcp: {next_offset: 5, query_page_exhausted: false}});
});
it("retains data but stops continuation after mid-request dataset revision", async () => {
  stub([native()], metadata(), {...metadata(), rowsUpdatedAt: 1790348999});
  expect((await read({...params, limit: 1})).data).toMatchObject({data: [native()], _mcp: {revision_unchanged_during_request: false, next_offset: null, query_page_exhausted: null}});
});
it("checks the expected revision before making another data read", async () => {
  const fetcher = stub(); await expect(read({...params, expected_revision: "1:2"})).rejects.toMatchObject({status: 409, data: {observed_revision: "1790348665:1790348545", incomplete: true}});
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not infer a revision from absent metadata stamps", async () => {
  const meta = {...metadata(), rowsUpdatedAt: undefined}; stub([native()], meta);
  expect((await read()).data).toMatchObject({_mcp: {revision: null, revision_unchanged_during_request: false, next_offset: null}});
});
it("an empty page is not proof of no community infection or complete dataset coverage", async () => {
  stub([]); expect((await read()).data).toMatchObject({data: [], _mcp: {query_page_exhausted: true, complete_dataset_verified: false}});
});
it.each([
  {...params, pathogen: "Influenza A"}, {...params, week_from: "2026-02-30"}, {...params, week_to: "2026-01-01"},
  {...params, limit: 5001}, {...params, limit: "1"}, {...params, offset: -1}, {...params, offset: 1000001},
  {...params, site: ""}, {...params, expected_revision: "bad"}, {...params, $where: "true"}, {...params, state_territory: ["Alabama"]},
])("rejects invalid input %# before fetching", async input => {
  const fetcher = stub(); await expect(read(input)).rejects.toMatchObject({status: 400}); expect(fetcher).not.toHaveBeenCalled();
});
it("escapes exact-value literals instead of concatenating executable predicates", () => {
  const query = wastewaterQuery({...params, state_territory: "A' OR 'x'='x"});
  expect(query.$where).toContain("state_territory='A'' OR ''x''=''x'");
});
it.each([
  {...metadata(), id: "wrong"},
  {...metadata(), columns: metadata().columns.filter(column => column.fieldName !== "week_end")},
  {...metadata(), columns: metadata().columns.map(column => column.fieldName === "week_end" ? {...column, dataTypeName: "calendar_date"} : column)},
])("refuses unexpected metadata/schema %#", async meta => {
  const fetcher = stub([], meta); await expect(read()).rejects.toMatchObject({status: 502}); expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([{pathogen_target: "SARS-CoV-2"}, {state_territory: "New York"}, {site: "ID:5"}, {week_end: "2025-01-01"}])("rejects observations outside requested filters %j", async change => {
  stub([{...native(), ...change}]); await expect(read()).rejects.toThrow("requested filters");
});
it("rejects an oversized row count even when provider ignores the limit", async () => {
  stub([native(), native()]); await expect(read({...params, limit: 1})).rejects.toThrow("requested bound");
});
it("bounds response bytes including non-ASCII data", async () => {
  stub([{...native(), extra: "α".repeat(3 * 1024 * 1024)}]); await expect(read()).rejects.toThrow("4 MiB");
});
it.each([401, 429, 500])("surfaces provider HTTP %s as an error", async status => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({message: "fixture"}, status))); await expect(read()).rejects.toMatchObject({status, data: {incomplete: true}});
});
it("rejects malformed JSON", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("html"))); await expect(read()).rejects.toThrow("not JSON");
});
it("preserves legacy array results and defaults discovery to CDC", async () => {
  const fetcher = vi.fn().mockImplementation(() => json([{existing: "shape"}])); vi.stubGlobal("fetch", fetcher);
  expect(await createCdcApiFetch()({method: "GET", path: "/data/abcd-1234.json", params: {$limit: 1}})).toEqual({status: 200, data: [{existing: "shape"}]});
  await createCdcApiFetch()({method: "GET", path: "/discover", params: {q: "wastewater"}});
  expect(String(fetcher.mock.calls[1][0])).toContain("domains=data.cdc.gov");
});
it("does not silently convert unsupported POSTs to unfiltered GETs", async () => {
  const fetcher = stub(); await expect(createCdcApiFetch()({method: "POST", path: "/wastewater/observations", body: params})).rejects.toMatchObject({status: 400}); expect(fetcher).not.toHaveBeenCalled();
});
it.each([{__api_error: true}, {__staged: true}, {__stage_error: true}, {_mcp: {revision_unchanged_during_request: false}}])("paging recipe stops on incomplete response %j", async page => {
  const api = {get: vi.fn().mockResolvedValue(page)};
  const result = await new Function("api", `return (async () => {${wastewaterWorkflows[3].code}})()`)(api);
  expect(result).toMatchObject({complete: false}); expect(api.get).toHaveBeenCalledTimes(1);
});
it("paging recipe passes revision and unchanged filters through three bounded pages", async () => {
  let offset = 0;
  const api = {get: vi.fn().mockImplementation(async () => ({data: [native()], _mcp: {revision: "1:2", revision_unchanged_during_request: true, next_offset: ++offset}}))};
  const result = await new Function("api", `return (async () => {${wastewaterWorkflows[3].code}})()`)(api);
  expect(result).toMatchObject({complete: false, expected_revision: "1:2", next_offset: 3});
  expect(api.get.mock.calls[1][1]).toMatchObject({expected_revision: "1:2", pathogen: "RSV", state_territory: "Alabama", offset: 1});
});
