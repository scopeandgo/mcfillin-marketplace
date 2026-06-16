import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { auditLogger } from "./audit-logger.js";

/** Max characters to store in result_summary. */
const SUMMARY_LIMIT = 500;

/**
 * Extract a short text summary from a CallToolResult for audit logging.
 */
function extractResultSummary(result: {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}): string {
  if (!result.content?.length) return "(empty)";

  const firstText = result.content.find((c) => c.type === "text")?.text ?? "";
  if (firstText.length <= SUMMARY_LIMIT) return firstText;
  return firstText.slice(0, SUMMARY_LIMIT) + "…";
}

/**
 * Drop-in replacement for `server.registerTool` that wraps the handler
 * with audit logging. Accepts the same arguments as `McpServer.registerTool`.
 */
export function registerToolWithAudit(
  server: McpServer,
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (...args: any[]) => any,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrappedHandler = async (...args: any[]) => {
    const params = args[0];
    const start = Date.now();

    try {
      const result = await handler(...args);
      const duration = Date.now() - start;
      const isError = result?.isError === true;
      const summary = extractResultSummary(result);

      auditLogger.logToolCall(name, params, summary, isError, duration);
      return result;
    } catch (err) {
      const duration = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);

      auditLogger.logToolCall(
        name,
        params,
        `EXCEPTION: ${message}`,
        true,
        duration,
      );
      throw err;
    }
  };

  server.registerTool(name, config, wrappedHandler);
}