import { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { auditLogger } from "./audit-logger.js";

/** Max characters to store in result_summary. */
const SUMMARY_LIMIT = 500;

/**
 * Extract a short text summary from a CallToolResult for audit logging.
 */
export function extractResultSummary(result: {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}): string {
  if (!result.content?.length) return "(empty)";

  const firstText = result.content.find((c) => c.type === "text")?.text ?? "";
  if (firstText.length <= SUMMARY_LIMIT) return firstText;
  return firstText.slice(0, SUMMARY_LIMIT) + "…";
}

/**
 * Wrap a tool handler to automatically log every call to the audit log.
 */
export function wrapHandlerWithAudit<Args extends ZodRawShapeCompat>(
  toolName: string,
  handler: ToolCallback<Args>,
): ToolCallback<Args> {
  // The handler signature varies depending on whether Args is defined.
  // We use a rest-args wrapper to handle both cases transparently.
  return (async (...args: unknown[]) => {
    const params = args[0]; // may be the args object or the extra object
    const start = Date.now();

    try {
      const result = await (handler as Function)(...args);
      const duration = Date.now() - start;
      const isError = result?.isError === true;
      const summary = extractResultSummary(result);

      auditLogger.logToolCall(toolName, params, summary, isError, duration);
      return result;
    } catch (err) {
      const duration = Date.now() - start;
      const message =
        err instanceof Error ? err.message : String(err);

      auditLogger.logToolCall(
        toolName,
        params,
        `EXCEPTION: ${message}`,
        true,
        duration,
      );
      throw err;
    }
  }) as ToolCallback<Args>;
}