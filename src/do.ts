import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import { flattenObject, type SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

type Row = Record<string, unknown>;
const record = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value);
const row = (value: unknown, path: string, index: number): Row => ({
  ...(record(value) ? { ...flattenObject(value, 2), ...Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, item !== null && typeof item === "object" ? JSON.stringify(item) : item])) } : { value }),
  native_json: JSON.stringify(value), source_path: path, source_index: index,
});

/** Lossless SQL projections retain provider metadata and exact numeric strings. */
export class CdcDataDO extends RestStagingDO {
  protected getTabularData(value: unknown): unknown {
    const data = record(value) && Array.isArray(value.content) && record(value.structuredContent) && "data" in value.structuredContent
      ? value.structuredContent.data : value;
    if (Array.isArray(data)) return { observations: data.map((v, i) => row(v, `/${i}`, i)) };
    if (!record(data)) return data;
    if (typeof data.sql === "string" && Array.isArray(data.rows)) return { query_rows: data.rows.map((v, i) => row(v, `/rows/${i}`, i)) };
    const key = Array.isArray(data.data) ? "data" : Array.isArray(data.results) ? "results" : "columns";
    const values = data[key];
    if (Array.isArray(values)) {
      const context = { ...data }; delete context[key];
      const table = key === "data" ? "observations" : key === "results" ? "datasets" : "metadata_columns";
      return { [table]: values.map((v, i) => row(v, `/${key}/${i}`, i)), response_context: [{ native_json: JSON.stringify(context) }],
        ...(record(data._mcp) ? { revision_context: [{ native_json: JSON.stringify(data._mcp) }] } : {}) };
    }
    return { native_objects: [row(data, "", 0)], response_context: [{ native_json: JSON.stringify(data) }] };
  }

  protected getSchemaHints(value: unknown): SchemaHints {
    const tables = this.getTabularData(value);
    const columnTypes: Record<string, string> = { native_json: "TEXT", source_path: "TEXT" };
    if (record(tables)) for (const values of Object.values(tables)) {
      if (!Array.isArray(values)) continue;
      for (const item of values) if (record(item)) for (const [key, value] of Object.entries(item)) {
        if (typeof value === "string") columnTypes[key] = "TEXT";
      }
    }
    return { columnTypes };
  }
}
