import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import type { McpServer } from "@bio-mcp/shared/mcp";
import { createCdcApiFetch } from "../lib/api-adapter";
import { cdcResponse } from "../lib/tool-result";
import { cdcCatalog } from "../spec/catalog";

interface CodeModeEnv {
	CDC_DATA_DO: DurableObjectNamespace;
	CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(
	server: McpServer,
	env: CodeModeEnv,
): void {
	const apiFetch = createCdcApiFetch();

    const registrar = {tool: (...args: unknown[]) => {
        const [name, ...rest] = args;
        const handler = rest.pop() as (args: unknown, extra: unknown) => ReturnType<Parameters<typeof cdcResponse>[0]>;
        const respond = (args: unknown, extra: unknown) => cdcResponse(() => handler(args, extra), env, String(name), extra, args);
        const register = server.tool.bind(server) as (...values: unknown[]) => void;
        register(name, ...rest, respond); register(`mcp_${String(name)}`, ...rest, respond);
    }};
    const searchTool = createSearchTool({
		prefix: "cdc",
		catalog: cdcCatalog,
	});
	searchTool.register(registrar);

	const executeTool = createExecuteTool({
		prefix: "cdc",
		// Verifiable provenance: cdc_execute results carry a _meta.citation.
		source: { id: "cdc", name: "CDC Open Data", url: "https://data.cdc.gov", license: "U.S. Public Domain" },
		catalog: cdcCatalog,
		apiFetch,
        preserveApiErrors: true,
        stagingThreshold: 30 * 1024,
        maxInlineBytes: 30 * 1024,
        timeout: 90_000,
		doNamespace: env.CDC_DATA_DO,
		loader: env.CODE_MODE_LOADER,
	});
	executeTool.register(registrar);
}
