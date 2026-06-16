/**
 * index.ts
 * XPM MCP Server — entry point.
 *
 * Transport: stdio (for Claude Code / Claude Desktop integration)
 *
 * Environment variables required (injected by OS-keychain launcher):
 *   XERO_CLIENT_ID      — Xero OAuth2 app Client ID (shared with the Xero plugin)
 *   XERO_CLIENT_SECRET  — Xero OAuth2 app Client Secret (shared with the Xero plugin)
 *
 * Optional:
 *   XPM_TOKEN_DIR       — Directory to store the token cache (default: $HOME)
 */

import { McpServer }          from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerClientTools }  from './tools/clients.js';
import { registerTaskTools }    from './tools/tasks.js';
import { registerTimeTools }    from './tools/time.js';
import { registerAuthTool }     from './tools/auth.js';
import { auditLogger }          from './audit/audit-logger.js';

// ── Server initialisation ─────────────────────────────────────────────────────

const server = new McpServer({
  name:    'xpm-mcp-server',
  version: '1.0.0',
});

// ── Initialise audit logging ──────────────────────────────────────────────────

auditLogger.ensureLogDirectory();

// ── Register all tools ────────────────────────────────────────────────────────

registerAuthTool(server);
registerClientTools(server);
registerTaskTools(server);
registerTimeTools(server);

// ── Start ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  validateEnv();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[xpm-mcp] Server started (read-only). Available tools:');
  console.error('  Clients    : xpm_list_clients, xpm_search_clients, xpm_get_client');
  console.error('  Tasks      : xpm_list_tasks, xpm_get_task');
  console.error('  Time       : xpm_list_time_entries, xpm_get_time_entry');
}

function validateEnv(): void {
  const missing: string[] = [];
  if (!process.env['XERO_CLIENT_ID'])     missing.push('XERO_CLIENT_ID');
  if (!process.env['XERO_CLIENT_SECRET']) missing.push('XERO_CLIENT_SECRET');

  if (missing.length) {
    console.error(
      `[xpm-mcp] WARNING: Missing environment variables: ${missing.join(', ')}\n` +
      'Ensure credentials are provisioned in the OS credential store and injected via the launcher script.\n' +
      'Auth errors will surface via tool responses when tools are invoked.'
    );
  }
}

main().catch((err: unknown) => {
  console.error('[xpm-mcp] Fatal error:', err);
  process.exit(1);
});
