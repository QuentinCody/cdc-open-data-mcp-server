import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

export const cdcCatalog: ApiCatalog = {
	name: "CDC Open Data (Socrata)",
	baseUrl: "https://data.cdc.gov",
	version: "2.1",
	auth: "none",
	endpointCount: 3,
	notes:
		"- CDC hosts 1,105+ datasets on Socrata covering disease surveillance, mortality, vaccination, chronic disease, and environmental health\n" +
		"- Workflow: 1) discover datasets with /discover, 2) inspect schema with /meta/{id}.json, 3) query data with /data/{id}.json\n" +
		"- Virtual path prefixes route to different upstream APIs:\n" +
		"  /data/* → data.cdc.gov/resource/* (SODA query API)\n" +
		"  /discover/* → api.us.socrata.com/api/catalog/v1/* (Socrata Discovery API)\n" +
		"  /meta/* → data.cdc.gov/api/views/* (dataset metadata API)\n" +
		"- SoQL (Socrata Query Language) reference for /data/ queries:\n" +
		"  $select — columns to return (supports aggregates: count(*), sum(col), avg(col), max(col), min(col))\n" +
		"  $where — filter condition, SQL-like syntax (e.g. \"state='New York' AND year>'2020'\")\n" +
		"  $group — group by column(s) for aggregation\n" +
		"  $order — sort results (e.g. \"total_deaths DESC\")\n" +
		"  $having — filter after aggregation\n" +
		"  $limit/$offset — pagination (default limit 1000, max 50000)\n" +
		"- Common SoQL patterns:\n" +
		"  $where=year='2023'\n" +
		"  $select=state,sum(deaths) as total&$group=state\n" +
		"  $order=total DESC&$limit=10\n" +
		"- Dataset IDs are alphanumeric slugs like: 9bhg-hcku, muzy-jte6, bi63-dtpu\n" +
		"- Key high-value datasets:\n" +
		"  9bhg-hcku — Provisional COVID-19 deaths by sex and age\n" +
		"  bi63-dtpu — NCHS death counts by state and cause\n" +
		"  5cdq-3998 — US chronic disease indicators (CDI)\n" +
		"- No auth required; optional Socrata app token increases rate limits\n" +
		"- Rate limit: ~1000 requests/hour without token\n" +
		"- Results from /data/ are JSON arrays; use $limit to control response size",
	endpoints: [
		{
			method: "GET",
			path: "/discover",
			summary:
				"Search CDC datasets by keyword. Use this first to find dataset IDs before querying data. Returns dataset names, descriptions, column info, and resource IDs.",
			category: "discovery",
			queryParams: [
				{
					name: "domains",
					type: "string",
					required: false,
					description: "Domain to search (default: data.cdc.gov)",
				},
				{
					name: "q",
					type: "string",
					required: false,
					description: "Keyword search query (e.g. 'covid deaths', 'vaccination rates')",
				},
				{
					name: "categories",
					type: "string",
					required: false,
					description: "Filter by category",
				},
				{
					name: "tags",
					type: "string",
					required: false,
					description: "Filter by tag",
				},
				{
					name: "only",
					type: "string",
					required: false,
					description: "Filter result type (e.g. 'datasets' to exclude charts/maps)",
				},
				{
					name: "limit",
					type: "number",
					required: false,
					description: "Number of results to return (default: 10)",
				},
				{
					name: "offset",
					type: "number",
					required: false,
					description: "Offset for pagination",
				},
			],
		},
		{
			method: "GET",
			path: "/data/{dataset_id}.json",
			summary:
				"Query a specific CDC dataset using SoQL (Socrata Query Language). Supports filtering, aggregation, sorting, and pagination. Returns an array of records whose schema varies by dataset.",
			category: "query",
			pathParams: [
				{
					name: "dataset_id",
					type: "string",
					required: true,
					description: "Socrata dataset identifier (e.g. '9bhg-hcku', 'bi63-dtpu')",
				},
			],
			queryParams: [
				{
					name: "$select",
					type: "string",
					required: false,
					description:
						"Columns to return. Supports aggregates: count(*), sum(col), avg(col), max(col), min(col). Example: 'state,sum(deaths) as total'",
				},
				{
					name: "$where",
					type: "string",
					required: false,
					description:
						"Filter condition using SoQL syntax. Example: \"state='New York' AND year>'2020'\"",
				},
				{
					name: "$group",
					type: "string",
					required: false,
					description: "Group by column(s) for aggregation. Example: 'state,year'",
				},
				{
					name: "$order",
					type: "string",
					required: false,
					description: "Sort order. Example: 'total_deaths DESC'",
				},
				{
					name: "$limit",
					type: "number",
					required: false,
					description: "Maximum rows to return (default: 1000, max: 50000)",
				},
				{
					name: "$offset",
					type: "number",
					required: false,
					description: "Offset for pagination",
				},
				{
					name: "$having",
					type: "string",
					required: false,
					description: "Filter after aggregation. Example: 'sum(deaths) > 1000'",
				},
			],
		},
		{
			method: "GET",
			path: "/meta/{dataset_id}.json",
			summary:
				"Get metadata for a specific dataset including column names, data types, and descriptions. Use this to understand a dataset's schema before querying it.",
			category: "metadata",
			pathParams: [
				{
					name: "dataset_id",
					type: "string",
					required: true,
					description: "Socrata dataset identifier (e.g. '9bhg-hcku')",
				},
			],
		},
	],
};
