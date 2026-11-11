import { cdcHttpError, fail, readCdcResponse } from "./read-response";

export { fail } from "./read-response";

export const WASTEWATER_ID = "atcp-73re";
export const WASTEWATER_METHOD_URL = "https://www.cdc.gov/wastewater/about/wval.html";
export const PATHOGENS = ["SARS-CoV-2", "Influenza A virus", "RSV"] as const;
export const WASTEWATER_COLUMNS = ["state_territory", "counties_served", "site", "population_served", "source", "site_wval", "site_wval_category", "date_included_in_wval", "week_end", "pathogen_target", "date_updated"];
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
async function read(path: string, params: Record<string, string | number>, signal: AbortSignal) {
  const url = new URL(path, "https://data.cdc.gov");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  let response: Response;
  try { response = await fetch(url, {headers: {Accept: "application/json"}, redirect: "manual", signal}); }
  catch { fail("CDC wastewater request failed or timed out", 502); }
  const raw = await readCdcResponse(response);
  if (!response.ok) cdcHttpError(response, raw, url.href);
  let data: unknown;
  try { data = JSON.parse(raw); } catch { fail("CDC wastewater response is not JSON", 502, {response: raw, source_url: url.href, incomplete: true}); }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return {data, provenance: {source_url: url.href, retrieved_at: new Date().toISOString(), response_sha256: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("")}};
}
function revision(metadata: Record<string, unknown>) {
  return [metadata.rowsUpdatedAt, metadata.viewLastModified].every(value => typeof value === "number" && Number.isSafeInteger(value) && value > 0)
    ? `${metadata.rowsUpdatedAt}:${metadata.viewLastModified}` : null;
}
function validateMetadata(data: unknown) {
  if (!record(data) || data.id !== WASTEWATER_ID || !Array.isArray(data.columns)) fail("Unexpected wastewater dataset metadata", 502);
  const columns = new Map(data.columns.filter(record).map(column => [column.fieldName, column.dataTypeName]));
  for (const field of WASTEWATER_COLUMNS) {
    const expected = ["population_served", "site_wval"].includes(field) ? "number" : "text";
    if (columns.get(field) !== expected) fail(`CDC wastewater schema changed: inspect ${field} before querying`, 502);
  }
  return data;
}
function validDate(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail(`${name} must be a valid YYYY-MM-DD date`);
}
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
export function wastewaterQuery(params: Record<string, unknown>) {
  for (const key of Object.keys(params)) if (!["pathogen", "state_territory", "site", "week_from", "week_to", "limit", "offset", "expected_revision"].includes(key)) fail(`Unsupported wastewater parameter: ${key}`);
  if (!PATHOGENS.includes(params.pathogen as typeof PATHOGENS[number])) fail(`pathogen must be one of: ${PATHOGENS.join(", ")}`);
  validDate(params.week_from, "week_from"); validDate(params.week_to, "week_to");
  if (params.week_from > params.week_to) fail("week_from must not follow week_to");
  const where = [`pathogen_target=${literal(String(params.pathogen))}`, `week_end>=${literal(params.week_from)}`, `week_end<=${literal(params.week_to)}`];
  for (const key of ["state_territory", "site"]) if (params[key] !== undefined) {
    if (typeof params[key] !== "string" || !(params[key] as string).trim() || (params[key] as string).length > 150 || Array.from(params[key] as string).some(char => char.charCodeAt(0) < 32)) fail(`${key} must be a bounded exact provider value`);
    where.push(`${key}=${literal(params[key] as string)}`);
  }
  const limit = params.limit ?? 100; const offset = params.offset ?? 0;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 5000) fail("limit must be 1–5000");
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) fail("offset must be 0–1000000; narrow long queries");
  if (params.expected_revision !== undefined && (typeof params.expected_revision !== "string" || !/^\d+:\d+$/.test(params.expected_revision))) fail("expected_revision must be the token returned by a prior wastewater response");
  return {$where: where.join(" AND "), $order: "week_end ASC,state_territory ASC,site ASC,pathogen_target ASC,source ASC,:id ASC", $limit: limit, $offset: offset};
}
function context() {
  return {dataset_id: WASTEWATER_ID, methodology: {
    source_url: WASTEWATER_METHOD_URL, reviewed_on: "2026-10-04", reported_change_date: "2026-08-14", historical_values_recalculated: true,
    note: "CDC applies recalibrated methods to historical values. Do not assign old/new methodology by week_end or treat date_updated as the original historical publication date. Retain the provider footnotes and processing stamp when comparing extracts. Categories use pathogen-specific thresholds; missing/limited data is not zero or absence of infection.",
  }, atomic_snapshot_verified: false, complete_dataset_verified: false, historical_availability_verified: false};
}
export async function wastewaterRead(path: string, params: Record<string, unknown>) {
  if (!["/wastewater/metadata", "/wastewater/observations"].includes(path)) fail("Unknown wastewater route");
  const query = path.endsWith("observations") ? wastewaterQuery(params) : undefined;
  if (!query && Object.keys(params).length) fail("Wastewater metadata takes no parameters");
  const signal = AbortSignal.timeout(50000);
  const before = await read(`/api/views/${WASTEWATER_ID}`, {}, signal);
  const metadata = validateMetadata(before.data);
  const beforeRevision = revision(metadata);
  if (!query) return {metadata, _mcp: {...context(), revision: beforeRevision, metadata_provenance: before.provenance}};
  if (params.expected_revision !== undefined && params.expected_revision !== beforeRevision) fail("CDC wastewater revision changed; restart the extract rather than mixing pages", 409, {expected_revision: params.expected_revision, observed_revision: beforeRevision, incomplete: true});
  return await readVerifiedWastewaterPage(query, signal, params, beforeRevision, metadata, before);
}

async function readVerifiedWastewaterPage(query: { $where: string; $order: string; $limit: number; $offset: number; }, signal: AbortSignal, params: Record<string, unknown>, beforeRevision: string | null, metadata: Record<string, unknown>, before: { data: unknown; provenance: { source_url: string; retrieved_at: string; response_sha256: string; }; }) {
  const page = await read(`/resource/${WASTEWATER_ID}.json`, query, signal);
  if (!Array.isArray(page.data) || !page.data.every(record)) fail("CDC wastewater observations must be an array of records", 502);
  if (page.data.length > query.$limit) fail("CDC returned more observations than the requested bound", 502);
  for (const row of page.data) {
    if (row.pathogen_target !== params.pathogen || typeof row.week_end !== "string" || row.week_end < String(params.week_from) || row.week_end > String(params.week_to)
      || params.state_territory !== undefined && row.state_territory !== params.state_territory || params.site !== undefined && row.site !== params.site) fail("CDC wastewater response does not match the requested filters", 502);
  }
  const after = await read(`/api/views/${WASTEWATER_ID}`, {}, signal);
  const afterMetadata = validateMetadata(after.data);
  const afterRevision = revision(afterMetadata);
  const unchanged = beforeRevision !== null && beforeRevision === afterRevision;
  const capped = page.data.length === query.$limit;
  const nextOffset = query.$offset + page.data.length;
  return {
    data: page.data, metadata, metadata_after: afterMetadata, _mcp: {
      ...context(), request: params, query, provenance: page.provenance,
      metadata_provenance: { before: before.provenance, after: after.provenance }, revision: beforeRevision, revision_after: afterRevision,
      revision_unchanged_during_request: unchanged, query_page_exhausted: unchanged ? !capped : null,
      next_offset: unchanged && capped && nextOffset <= 1000000 ? nextOffset : null,
      warning: !unchanged ? "Metadata revision changed or is unavailable; do not combine this page with other extracts" : capped ? "Page limit reached; continue with the returned revision token and unchanged filters" : "No further page indicated by this bounded response; this is not an immutable snapshot or evidence of population coverage",
    }
  };
}
