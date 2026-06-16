# McFillin Marketplace

A marketplace of Xero integrations for Claude Code and Claude Desktop, built for [McFillin Accounting](https://mcfillin.com.au/).

Each plugin bundles a local MCP (Model Context Protocol) server, Claude skills, and a cross-platform launcher that loads credentials securely from the OS credential store at runtime.

## Plugins

| Plugin | Description |
|--------|-------------|
| [xero-plugin](./xero-plugin/) | **Xero Accounting** — contacts, invoices, bank transactions, payments, manual journals, reports (P&L, balance sheet, trial balance, aged receivables/payables), chart of accounts, items, tracking categories, and payroll |
| [xpm-plugin](./xpm-plugin/) | **Xero Practice Manager** — clients, tasks, and time entries |

Each plugin is self-contained and can be installed independently. Both share a single Xero OAuth2 app and read their credentials from the OS credential store.

## How it works

```
Claude Code / Desktop
  └── MCP server (stdio)            ← launched by scripts/{xero,xpm}-start.js
        ├── reads XERO_CLIENT_ID / XERO_CLIENT_SECRET from OS credential store
        ├── OAuth2 authorisation (browser, first use only)
        ├── tool handlers → Xero / XPM APIs
        └── audit log (NDJSON, rotated)
```

- **Credentials** are never stored in the repo. The launcher (`scripts/*-start.js`) fetches `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` from the macOS Keychain or Windows Credential Manager and passes them to the server as environment variables. If credentials are missing the server still starts; the auth error surfaces through tool responses.
- **Authorisation** happens in the browser on first use via OAuth2. Tokens are persisted to `~/.xero-mcp-tokens.json` and refreshed automatically before expiry.
- **Every tool call is audited.** Each handler is wrapped to write an NDJSON entry (timestamp, OS user, PID, tool, params, truncated result, status, duration) to an OS-specific log directory, with automatic rotation at 10 MB (5 files kept).
- **Write operations require confirmation.** The skills instruct Claude to summarise and confirm before any create, update, or delete.

## Requirements

- Claude Code or Claude Desktop
- Node.js v18+
- A Xero OAuth2 app ([Xero Developer Portal](https://developer.xero.com/app/manage)) with redirect URI `http://localhost:5001/callback`
- PowerShell 5.1+ with the CredentialManager module (Windows only)

## Setup

1. **Provision credentials** in the OS credential store (one set, shared by both plugins).

   **macOS:**
   ```bash
   security add-generic-password -a xero -s XERO_CLIENT_ID -w "your_client_id"
   security add-generic-password -a xero -s XERO_CLIENT_SECRET -w "your_client_secret"
   ```

   **Windows:**
   ```powershell
   Install-Module CredentialManager -Scope CurrentUser
   cmdkey /generic:XERO_CLIENT_ID /user:xero /pass:your_client_id
   cmdkey /generic:XERO_CLIENT_SECRET /user:xero /pass:your_client_secret
   ```

2. **Build the servers** (each plugin compiles TypeScript to `dist/`):
   ```bash
   cd xero-plugin/xero-mcp-server && npm install && npm run build
   cd xpm-plugin && npm install && npm run build
   ```

3. **Enable the MCP servers.** The root [`.mcp.json`](./.mcp.json) registers both `xero` and `xpm` servers via their launch scripts. Approve them in Claude Code (or rely on `.claude/settings.local.json`).

4. **Authorise on first use.** The first tool call returns an OAuth URL — open it, authorise, and the callback completes automatically.

## Usage

Use a skill or just describe what you need in natural language:

| Skill | What it does |
|---|---|
| `/xero` | Query or update Xero accounting data |
| `/xpm` | Query or update Xero Practice Manager data |

See [xero-plugin/README.md](./xero-plugin/README.md) and [xero-plugin/USAGE_GUIDE.md](./xero-plugin/USAGE_GUIDE.md) for detailed scopes, examples, and troubleshooting.

## Repository structure

```
mcfillin-marketplace/
├── .mcp.json                 # Registers the xero + xpm MCP servers
├── README.md
├── CLAUDE.md                 # Guidance for Claude Code working in this repo
├── xero-plugin/
│   ├── .claude-plugin/plugin.json
│   ├── .mcp.json
│   ├── README.md · USAGE_GUIDE.md
│   ├── skills/xero/SKILL.md
│   ├── scripts/xero-start.js     # Credential loader + launcher
│   └── xero-mcp-server/          # Fork of XeroAPI/xero-mcp-server
│       └── src/{clients,server,tools,handlers,audit,helpers,consts,types}
└── xpm-plugin/
    ├── .claude-plugin/plugin.json
    ├── .mcp.json
    ├── skills/xpm/SKILL.md
    ├── scripts/xpm-start.js
    └── src/{services,tools,audit}
```

## Credits

The Xero Accounting server is a local fork of [XeroAPI/xero-mcp-server](https://github.com/XeroAPI/xero-mcp-server) (MIT).