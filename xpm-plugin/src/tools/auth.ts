/**
 * tools/auth.ts
 * MCP tool to initiate or verify the XPM OAuth connection.
 *
 * When no valid token exists this triggers the OAuth flow and returns the
 * authorisation URL so Claude can present it to the user.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z }         from 'zod';
import { getValidToken, AuthRequiredError } from '../services/auth.js';
import { registerToolWithAudit }            from '../audit/wrap-handler.js';

export function registerAuthTool(server: McpServer): void {
  registerToolWithAudit(server,
    'xpm_authenticate',
    {
      title: 'Connect to Xero Practice Manager',
      description:
        `Initiate or verify the OAuth connection to Xero Practice Manager (XPM).

Call this tool when the user wants to connect to XPM or when an XPM tool
reports an authentication error. If a valid session exists it confirms the
connection; otherwise it returns an authorisation URL that the user must
open in their browser to complete the OAuth flow.

XPM uses its own OAuth connection, separate from the Xero accounting connection.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        await getValidToken();
        return {
          content: [{ type: 'text' as const, text: 'XPM connection is active.' }],
        };
      } catch (err) {
        if (err instanceof AuthRequiredError) {
          return {
            content: [{
              type: 'text' as const,
              text: err.message,
            }],
          };
        }
        throw err;
      }
    },
  );
}