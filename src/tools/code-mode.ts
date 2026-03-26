import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { cdcCatalog } from "../spec/catalog";
import { createCdcApiFetch } from "../lib/api-adapter";

interface CodeModeEnv {
	CDC_DATA_DO: DurableObjectNamespace;
	CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(
	server: McpServer,
	env: CodeModeEnv,
): void {
	const apiFetch = createCdcApiFetch();

	const searchTool = createSearchTool({
		prefix: "cdc",
		catalog: cdcCatalog,
	});
	searchTool.register(server as unknown as { tool: (...args: unknown[]) => void });

	const executeTool = createExecuteTool({
		prefix: "cdc",
		catalog: cdcCatalog,
		apiFetch,
		doNamespace: env.CDC_DATA_DO,
		loader: env.CODE_MODE_LOADER,
	});
	executeTool.register(server as unknown as { tool: (...args: unknown[]) => void });
}
