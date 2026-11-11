import {McpServer} from "@bio-mcp/shared/mcp";
import {createApiProxyTool} from "@bio-mcp/shared/tools/api-proxy";
import {afterEach, expect, it, vi} from "vitest";
import {createCdcApiFetch} from "../lib/api-adapter";
import {WASTEWATER_COLUMNS} from "../lib/wastewater";
import {cdcCatalog} from "../spec/catalog";
import {registerCodeMode} from "./code-mode";
import {registerGetSchema} from "./get-schema";
import {registerQueryData} from "./query-data";

const json = (data: unknown) => new Response(JSON.stringify(data), {headers: {"Content-Type": "application/json"}});
afterEach(() => vi.unstubAllGlobals());
it("registers both aliases and both response fields", async () => {
  const server = new McpServer({name: "fixture", version: "1"});
  registerCodeMode(server, {CODE_MODE_LOADER: {get: () => ({})}} as unknown as Parameters<typeof registerCodeMode>[1]);
  registerGetSchema(server, {}); registerQueryData(server, {});
  const tools = (server as unknown as {_registeredTools: Record<string, {handler: (args: unknown, extra: unknown) => Promise<unknown>}>})._registeredTools;
  for (const suffix of ["search", "execute", "query_data", "get_schema"]) { expect(tools[`cdc_${suffix}`]).toBeDefined(); expect(tools[`mcp_cdc_${suffix}`]).toBeDefined(); }
  expect(await tools.cdc_search.handler({query: "wastewater", max_results: 5}, {})).toMatchObject({content: expect.any(Array), structuredContent: {success: true}});
  expect(await tools.mcp_cdc_query_data.handler({data_access_id: "cdc_fixture", sql: "SELECT 1"}, {})).toMatchObject({isError: true, content: expect.any(Array), structuredContent: expect.any(Object)});
});
it("stages complete observations with source metadata, processing date and methodology context", async () => {
  const metadata = {id: "atcp-73re", rowsUpdatedAt: 100, viewLastModified: 200, columns: WASTEWATER_COLUMNS.map(fieldName => ({fieldName, dataTypeName: ["population_served", "site_wval"].includes(fieldName) ? "number" : "text"})), metadata: {custom_fields: {"Data Quality": {Footnotes: "Synthetic historical-recalibration note"}}}};
  const rows = Array.from({length: 200}, (_, i) => ({site: `ID:${i}`, state_territory: "Alabama", week_end: "2026-09-19", pathogen_target: "RSV", site_wval: null, site_wval_category: "Limited/No Data", source: "Synthetic α source", date_updated: "2026-09-25 11:01"}));
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string | URL) => json(String(url).includes("/api/views/") ? metadata : rows)));
  const stored: unknown[] = [];
  const namespace = {idFromName: (name: string) => name, get: () => ({fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") { stored.push((await request.json() as {data: unknown}).data); return json({success: true, tables_created: ["data"], total_rows: 200, input_rows: 200, table_row_counts: {data: 200}}); }
    return json({success: true, schema: {tables: {data: {columns: [{name: "site"}]}}}});
  }})} as unknown as DurableObjectNamespace;
  const proxy = createApiProxyTool({apiFetch: createCdcApiFetch(), catalog: cdcCatalog, doNamespace: namespace, stagingPrefix: "cdc", maxInlineBytes: 30 * 1024});
  const result = await proxy.handler({method: "GET", path: "/wastewater/observations", params: {pathogen: "RSV", week_from: "2026-09-01", week_to: "2026-09-19", limit: 200}}, {sql: () => []});
  expect(result).toMatchObject({__staged: true, data_access_id: expect.any(String)});
  expect(JSON.parse(stored[0] as string)).toMatchObject({data: rows, metadata, metadata_after: metadata, _mcp: {revision: "100:200", methodology: {historical_values_recalculated: true}, next_offset: 200}});
  expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThan(100000);
});
it("surfaces invalid wastewater queries as incomplete API errors", async () => {
  const proxy = createApiProxyTool({apiFetch: createCdcApiFetch(), catalog: cdcCatalog, stagingPrefix: "cdc"});
  expect(await proxy.handler({method: "GET", path: "/wastewater/observations", params: {pathogen: "unknown"}}, {sql: () => []})).toMatchObject({__api_error: true, incomplete: true, status: 400});
});
