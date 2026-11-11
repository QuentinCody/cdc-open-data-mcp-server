import type {ApiEndpoint, WorkflowRecipe} from "@bio-mcp/shared/codemode/catalog";
import {PATHOGENS} from "../lib/wastewater";
export const wastewaterEndpoints: ApiEndpoint[] = [
  {method: "GET", path: "/wastewater/metadata", category: "wastewater", summary: "Curated combined CDC WVAL dataset: live fields, revision, footnotes and methodology context", responseShape: "{metadata: <full Socrata metadata>, _mcp: {revision, methodology, metadata_provenance, ...}}", usageHint: "Inspect provider values: state_territory rows currently use full names despite the column description mentioning abbreviations. Cached column values are discovery hints, not an exhaustive live domain."},
  {method: "GET", path: "/wastewater/observations", category: "wastewater", summary: "Metadata-checked site-week WVAL page for SARS-CoV-2, influenza A or RSV; retains processing stamp and methodology caveats", queryParams: [
    {name: "pathogen", type: "string", required: true, description: PATHOGENS.join(" | ")},
    {name: "week_from", type: "string", required: true, description: "Inclusive YYYY-MM-DD lower week_end bound; collection week is not publication time"},
    {name: "week_to", type: "string", required: true, description: "Inclusive YYYY-MM-DD upper week_end bound; provider week ends are Saturdays"},
    {name: "state_territory", type: "string", required: false, description: "Exact provider value, e.g. Alabama; inspect live metadata/rows"},
    {name: "site", type: "string", required: false, description: "Exact anonymous site ID, e.g. ID:4; not a county ID"},
    {name: "limit", type: "number", required: false, description: "1–5000 native observations per page", default: 100},
    {name: "offset", type: "number", required: false, description: "0–1000000 with unchanged filters and revision; narrow large requests", default: 0},
    {name: "expected_revision", type: "string", required: false, description: "Token from the previous page's _mcp.revision; detects metadata revision changes before fetching rows"},
  ], responseShape: "{data: <native row array>, metadata, metadata_after, _mcp: {revision, next_offset, revision_unchanged_during_request, methodology, ...}}", usageHint: "August 14, 2026 methodology changes were applied to historical values. Do not split methods at the observation date, mix retrieved vintages or recalculate categories with stale/shared pathogen thresholds. Retain missing/limited data, source and native precision. Metadata checks do not provide an atomic snapshot."},
];
export const wastewaterWorkflows: WorkflowRecipe[] = [
  ...PATHOGENS.map(pathogen => ({title: `Read ${pathogen} wastewater WVAL with recalibration context`, keywords: ["wastewater", "WVAL", pathogen, "methodology", "revision"], description: "Query an explicit site/week window in the combined dataset. The result retains live metadata, source, processing stamp and the historical recalibration warning. Numeric WVALs are not infection counts; categories remain pathogen-specific.", code: `return await api.get("/wastewater/observations", {pathogen: ${JSON.stringify(pathogen)}, state_territory: "Alabama", site: "ID:4", week_from: "2026-08-01", week_to: "2026-09-19", limit: 100});`})),
  {title: "Page wastewater observations without mixing detected revisions", keywords: ["wastewater", "paging", "revision", "historical", "RSV"], description: "Read at most three pages; stop on errors or detected metadata drift. For staged pages read bounded revision_context via SQL and retain the full page handle. Native records and metadata remain in observations, response_context and payloads. Matching metadata revisions do not prove an immutable snapshot or national representativeness.", code: `const params = {pathogen: "RSV", state_territory: "Alabama", week_from: "2026-08-01", week_to: "2026-09-19", limit: 100};
const pages = [];
let offset = 0;
let revision;
for (let i = 0; i < 3; i++) {
  const page = await api.get("/wastewater/observations", {...params, offset, ...(revision ? {expected_revision: revision} : {})});
  pages.push(page);
  if (page.__api_error || page.__stage_error) return {pages, complete: false};
  let context = page._mcp;
  if (page.__staged) {
    if (!page.data_access_id) return {pages, complete: false};
    const stored = await api.query(page.data_access_id, "SELECT native_json FROM revision_context LIMIT 1");
    if (stored.truncated || stored.results?.length !== 1) return {pages, complete: false};
    context = JSON.parse(stored.results[0].native_json);
  }
  if (!context?.revision_unchanged_during_request) return {pages, complete: false};
  revision = context.revision;
  const next = context.next_offset;
  if (next === null) return {pages, query_page_exhausted: context.query_page_exhausted, atomic_snapshot_verified: false};
  if (!Number.isSafeInteger(next) || next <= offset) return {pages, complete: false, reason: "Non-advancing continuation"};
  offset = next;
}
return {pages, complete: false, next_offset: offset, expected_revision: revision, request: params};`},
];
