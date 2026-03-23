import { restFetch } from "@bio-mcp/shared/http/rest-fetch";
import type { RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";

const CDC_SODA_BASE = "https://data.cdc.gov";
const DISCOVERY_BASE = "https://api.us.socrata.com/api/catalog/v1";

export interface CdcFetchOptions extends Omit<RestFetchOptions, "retryOn"> {
	baseUrl?: string;
}

/**
 * Fetch from CDC SODA API, Socrata Discovery API, or CDC metadata API.
 *
 * Virtual path prefixes:
 *   /data/*     → https://data.cdc.gov/resource/*        (SODA query)
 *   /discover/* → https://api.us.socrata.com/api/catalog/v1/*  (Discovery)
 *   /meta/*     → https://data.cdc.gov/api/views/*       (Dataset metadata)
 */
export async function cdcFetch(
	path: string,
	params?: Record<string, unknown>,
	opts?: CdcFetchOptions,
): Promise<Response> {
	let baseUrl: string;
	let actualPath = path;

	if (path.startsWith("/discover")) {
		baseUrl = DISCOVERY_BASE;
		actualPath = path.replace("/discover", "");
	} else if (path.startsWith("/meta/")) {
		baseUrl = CDC_SODA_BASE;
		actualPath = `/api/views${path.replace("/meta", "")}`;
	} else if (path.startsWith("/data/")) {
		baseUrl = CDC_SODA_BASE;
		actualPath = `/resource${path.replace("/data", "")}`;
	} else {
		baseUrl = opts?.baseUrl ?? CDC_SODA_BASE;
	}

	return restFetch(baseUrl, actualPath, params, {
		...opts,
		headers: { Accept: "application/json", ...(opts?.headers ?? {}) },
		retryOn: [429, 500, 502, 503],
		retries: opts?.retries ?? 3,
		timeout: opts?.timeout ?? 30_000,
		userAgent: "cdc-open-data-mcp-server/1.0 (bio-mcp)",
	});
}
