# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

McFillin Marketplace is a collection of Claude Code / Claude Desktop plugins that connect Claude to Xero. It contains two independent plugins, each bundling a local MCP server, skills, and a launcher script:

- **`xero-plugin/`** — Xero Accounting. The MCP server (`xero-plugin/xero-mcp-server/`) is a local fork of [XeroAPI/xero-mcp-server](https://github.com/XeroAPI/xero-mcp-server), ESM TypeScript, using the official `xero-node` SDK.
- **`xpm-plugin/`** — Xero Practice Manager. A from-scratch MCP server (`xpm-plugin/src/`) using `axios` against the XPM API. Covers clients, tasks, and time entries.

Both plugins share one Xero OAuth2 app and read `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` from the OS credential store.

## Build & run

Each server compiles TypeScript to `dist/`. There are no tests in this repo.

```bash
# Xero Accounting server
cd xero-plugin/xero-mcp-server
npm install
npm run build      # tsc + chmod +x dist/*.js
npm run watch      # tsc --watch
npm run lint       # eslint .

# XPM server
cd xpm-plugin
npm install
npm run build      # tsc
npm run dev        # ts-node src/index.ts
```

The MCP servers are not run directly — they are launched by `scripts/{xero,xpm}-start.js`, which load credentials then `spawn` the compiled `dist/index.js` over stdio. The root `.mcp.json` registers both servers for Claude Code; the per-plugin `.mcp.json` files register each plugin standalone (using `${CLAUDE_PLUGIN_ROOT}`).

**After changing server source, run `npm run build`** — the launcher executes the compiled `dist/`, not the TypeScript source.

## Architecture notes

### Credential & auth flow
- `scripts/*-start.js` fetch credentials from the macOS Keychain (`security find-generic-password -a xero -s <KEY> -w`) or Windows Credential Manager (PowerShell `Get-StoredCredential`). On Linux they return `null`.
- If credentials are absent the server still starts; auth errors surface through tool responses rather than crashing the launcher.
- OAuth2 runs in the browser on first use (redirect URI `http://localhost:5001/callback`). Tokens persist to `~/.xero-mcp-tokens.json` and auto-refresh.
- Scopes are granular (see `xero-plugin/README.md`), overridable via `XERO_SCOPES`. The broad legacy scopes are being deprecated (March 2026).

### Tool / handler structure (xero-mcp-server)
- `src/tools/` holds tool definitions grouped by operation: `create/`, `update/`, `delete/`, `get/`, `list/`, plus `authenticate.tool.ts`.
- `src/handlers/` holds one handler per tool (~57 files) calling Xero via `xero-node`.
- `src/tools/tool-factory.ts` registers every tool with the MCP server and wraps each handler with audit logging.
- `src/clients/xero-client.ts` owns the OAuth2 client and token lifecycle.

To add a tool: create the handler in `src/handlers/`, the tool definition in the matching `src/tools/<op>/` folder, and register it in `tool-factory.ts`.

### XPM server structure
- `src/services/auth.ts` (OAuth2 / PKCE) and `src/services/xpm-client.ts` (axios HTTP client + token refresh).
- `src/tools/{auth,clients,tasks,time}.ts` define the tools; registered in `src/index.ts`.
- Time entries are measured in **minutes** (60 = 1 hour).

### Audit logging (both plugins, identical design)
`src/audit/` wraps every handler and writes NDJSON entries (timestamp, OS user, PID, tool, params, truncated result, status, duration). Logs rotate at 10 MB keeping 5 files. Log location per `audit/constants.ts`:
- macOS: `/Library/Application Support/ClaudeMCP/<mcp>/audit.log`
- Windows: `%LOCALAPPDATA%\ClaudeMCP\<mcp>\audit.log`
- Linux: `/var/log/ClaudeMCP/<mcp>/`

Keep audit wrapping intact when adding or editing handlers — it is applied centrally at registration, so new tools are covered automatically as long as they go through the factory/registration path.

## Conventions

- **UK / Australian English** in docs and user-facing strings.
- **Currency**: AUD by default, unless the Xero organisation uses a different base currency.
- **Write safety**: skills require Claude to summarise and confirm before any create/update/delete. Preserve this behaviour when editing `skills/*/SKILL.md`.
- Keep the two `audit/` implementations in sync if you change one.
- Do not commit credentials or tokens. `node_modules/` and `dist/` are gitignored.