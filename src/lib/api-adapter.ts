import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { cdcFetch } from "./http";
import { cdcHttpError, readCdcResponse } from "./read-response";
import {fail, wastewaterRead} from "./wastewater";

export function createCdcApiFetch(): ApiFetchFn {
	return async (request) => {
		if (request.method !== "GET" || request.body !== undefined) fail("CDC dataset adapters support GET reads");
        if (request.path.startsWith("/wastewater/")) return {status: 200, data: await wastewaterRead(request.path, request.params ?? {})};
        const params = request.path === "/discover" ? {domains: "data.cdc.gov", ...request.params} : request.params;
        const response = await cdcFetch(request.path, params);

		const raw = await readCdcResponse(response);
		if (!response.ok) cdcHttpError(response, raw);

		const contentType = response.headers.get("content-type") || "";
		if (!contentType.includes("json")) {
			return { status: response.status, data: raw };
		}

		let data: unknown;
		try { data = JSON.parse(raw); } catch { fail("CDC response is not JSON", 502, {response: raw, incomplete: true}); }
		return { status: response.status, data };
	};
}
