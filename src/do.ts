import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

export class CdcDataDO extends RestStagingDO {
	protected getSchemaHints(data: unknown): SchemaHints | undefined {
		if (!data || typeof data !== "object") return undefined;

		// SODA API returns arrays of records
		if (Array.isArray(data)) {
			const sample = data[0];
			if (sample && typeof sample === "object") {
				return {
					tableName: "records",
					indexes: [],
				};
			}
		}

		// Discovery API results
		const obj = data as Record<string, unknown>;
		if (obj.results && Array.isArray(obj.results)) {
			return {
				tableName: "datasets",
				indexes: [],
			};
		}

		// Dataset metadata (single object from /api/views/{id})
		if (obj.columns && Array.isArray(obj.columns) && obj.name) {
			return {
				tableName: "metadata",
				indexes: ["name"],
			};
		}

		return undefined;
	}
}
