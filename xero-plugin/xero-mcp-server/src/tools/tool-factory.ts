import { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";

import AuthenticateTool from "./authenticate.tool.js";
import { CreateTools } from "./create/index.js";
import { DeleteTools } from "./delete/index.js";
import { GetTools } from "./get/index.js";
import { ListTools } from "./list/index.js";
import { UpdateTools } from "./update/index.js";
import { auditLogger } from "../audit/audit-logger.js";
import { extractResultSummary, wrapHandlerWithAudit } from "../audit/wrap-handler.js";

export function ToolFactory(server: McpServer) {
  const allTools = [
    AuthenticateTool,
    ...DeleteTools,
    ...GetTools,
    ...CreateTools,
    ...ListTools,
    ...UpdateTools,
  ];

  for (const toolFn of allTools) {
    const tool = toolFn();
    server.tool(
      tool.name,
      tool.description,
      tool.schema,
      wrapHandlerWithAudit(tool.name, tool.handler as ToolCallback<ZodRawShapeCompat>),
    );
  }
}
