# CDC MCP Server

This is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. It lets MCP clients (Claude Desktop, Claude Code, Continue, etc.) query the upstream CDC API in natural language. It is one of 100+ servers in the [Bio MCP](../../README.md) monorepo.

## Connect

The configured production endpoint is:

```
https://cdc-open-data-mcp-server.quentincody.workers.dev/mcp
```

Add it to your MCP client (Claude Desktop → Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "cdc": {
      "command": "npx",
      "args": ["mcp-remote", "https://cdc-open-data-mcp-server.quentincody.workers.dev/mcp"]
    }
  }
}
```

For local development the server runs at `http://localhost:8858/mcp` (start it with `./scripts/dev-servers.sh cdc`):

```json
{
  "mcpServers": {
    "cdc-local": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:8858/mcp"]
    }
  }
}
```

## Tools

- `cdc_search` — discover available API operations (Code Mode catalog search)
- `cdc_execute` — **Code Mode**: write JavaScript in a V8 isolate (`api.get()` / `api.post()` / `searchSpec()`) instead of issuing tool calls one by one
- `cdc_query_data` — run SQL over large responses auto-staged into a per-session SQLite database
- `cdc_get_schema` — inspect the inferred schema of a staged dataset

Large responses (>30KB) are auto-staged into a queryable SQLite database; the tools return a `data_access_id` you can query with SQL.

Every tool returns both a human-readable `content` summary and a structured `structuredContent` payload.

## Wastewater workflows

The curated routes use the combined [CDC WVAL dataset](https://data.cdc.gov/api/views/atcp-73re)
for SARS-CoV-2, influenza A and RSV:

- `/wastewater/metadata` returns current native metadata, field definitions, footnotes
  and a revision token based on provider update stamps.
- `/wastewater/observations` accepts an exact pathogen, a week range, optional exact
  state/site values, and bounded pagination. Results retain native rows, metadata
  before/after the query, processing dates, source URLs and response hashes.

The catalog contains one recipe per pathogen and a bounded paging recipe. A revision
change stops continuation; an expected-revision mismatch fails before fetching another
page. Metadata checks reduce mixing risk but do not establish an atomic snapshot.
Full before/after metadata normally makes a page large enough to stage. The paging
recipe reads its bounded `revision_context` SQL table and retains each full page
handle, so staging does not prevent continuation. Use `observations` for rows and
`response_context` for source metadata; `payloads` retains the original response.
`native_json` preserves each record, including missing fields and unknown extensions.
Numeric strings remain TEXT; cast explicitly only when a calculation requires it.
Generic discovery/data/metadata routes remain available with their native response
shapes. Discovery now defaults to the CDC domain.

[CDC's August 2026 recalibration](https://www.cdc.gov/wastewater/about/wval.html)
was applied to historical values. It changes outlier handling, new-site baselines,
national aggregation and pathogen-specific thresholds. Do not infer calculation method
from `week_end`, or treat `date_updated` as original historical availability. Preserve
missing/limited observations and native categories; WVAL is not an infection count.
Use exact provider geography values: observed rows say “Alabama” despite a metadata
description mentioning state abbreviations.

All tools have `cdc_*` and `mcp_cdc_*` aliases with verifiable citations on success
and failure. Reads have a 4 MiB response cap and an independent 15-second body
deadline. Wastewater requests also have a 50-second overall timeout. Full provider
errors and composed MCP responses above 30 KiB stage through the existing Durable
Object. Query large JSON fields in bounded `substr` chunks when necessary.

A fixture retains the first three real public records observed on September 28, 2026,
with a capture note. This is a partial transcribed example, not a byte-exact archive
or validation of filtered queries. Other tests use synthetic metadata/edge cases.
October 4 native/local Worker acceptance passed **338 MCP calls**, including all
four recipes, eight weekly observations per pathogen for Alabama site `ID:4`,
150 observations across two staged Alabama pages, a 500-row sample, native errors
and generic Socrata reads. Full source metadata and result hashes matched; discovery
request timings varied and remained preserved. Fifty-five focused tests and 203
catalog checks pass. Mid-request revision changes remain fixture-tested; no atomic
snapshot, historical publication vintage or national representativeness is asserted.
See the [receipt](../../scratch/2026-10-04-cdc/verification.json) and
[implementation tracker](../../docs/plans/2026-09-26-upstream-api-implementation.md).
These changes have not been deployed.

## Development

```bash
./scripts/dev-servers.sh cdc            # run locally (port 8858)
pnpm --filter cdc-open-data-mcp-server run deploy   # deploy to Cloudflare Workers
```

See [`docs/adding-mcp-servers.md`](../../docs/adding-mcp-servers.md) and the root [README](../../README.md) for the full architecture (Code Mode, staging, portals).

---

*Auto-generated baseline README — refine with server-specific detail as needed.*

<!-- license-and-data-terms:start -->
## License and data terms

The code in this repository is licensed under the Apache License 2.0 (see `LICENSE`).
If you use it in your work, please cite it (see `CITATION.cff`). Citation is requested, not required.

The license covers the code only. Data that this server returns comes from CDC open data and stays under the terms of that source: US public domain.
You are responsible for your use of the data under those terms.
<!-- license-and-data-terms:end -->
