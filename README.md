# McFillin Marketplace

A pair of local MCP (Model Context Protocol) servers that connect Claude Desktop to Xero, built for [McFillin Accounting](https://mcfillin.com.au/).

Each server ships with a cross-platform launcher that loads credentials securely from the OS credential store at runtime.

## Servers

| Server | Description |
|--------|-------------|
| [xero-plugin](./xero-plugin/) | **Xero Accounting** — contacts, invoices, bank transactions, payments, manual journals, reports (P&L, balance sheet, trial balance, aged receivables/payables), chart of accounts, items, tracking categories, and payroll |
| [xpm-plugin](./xpm-plugin/) | **Xero Practice Manager** — clients, tasks, and time entries |

Each server is self-contained and can be installed independently. Both share a single Xero OAuth2 app and read their credentials from the OS credential store.

## How it works

```
Claude Desktop
  └── MCP server (stdio)            ← launched by scripts/{xero,xpm}-start.js
        ├── reads XERO_CLIENT_ID / XERO_CLIENT_SECRET from OS credential store
        ├── OAuth2 authorisation (browser, first use only)
        ├── tool handlers → Xero / XPM APIs
        └── audit log (NDJSON, rotated)
```

- **Credentials** are never stored in the repo. The launcher (`scripts/*-start.js`) fetches `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` from the macOS Keychain or Windows Credential Manager and passes them to the server as environment variables. If credentials are missing the server still starts; the auth error surfaces through tool responses.
- **Authorisation** happens in the browser on first use via OAuth2. Tokens are persisted to disk (`~/.xero-mcp-tokens.json`, `~/.xpm-mcp-tokens.json`) and refreshed automatically before expiry.
- **Every tool call is audited.** Each handler is wrapped to write an NDJSON entry (timestamp, OS user, PID, tool, params, truncated result, status, duration) to an OS-specific log directory, with automatic rotation at 10 MB (5 files kept).

## Requirements

- Claude Desktop (or any MCP-compatible client)
- Node.js v18+
- A Xero OAuth2 app ([Xero Developer Portal](https://developer.xero.com/app/manage)) with redirect URIs `http://localhost:5001/callback` (Xero) and `http://localhost:5000/callback` (XPM)
- PowerShell 5.1+ with the CredentialManager module (Windows only)

## Setup

1. **Provision credentials** in the OS credential store (one set, shared by both servers).

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

2. **Build the servers** (each compiles TypeScript to `dist/`):
   ```bash
   cd xero-plugin/xero-mcp-server && npm install && npm run build
   cd xpm-plugin && npm install && npm run build
   ```

3. **Register the servers with Claude Desktop.** Open **Settings → Developer → Edit Config** and add the servers to `claude_desktop_config.json`, using absolute paths to the launcher scripts:

   ```json
   {
     "mcpServers": {
       "xero": {
         "command": "node",
         "args": ["/absolute/path/to/mcfillin-marketplace/xero-plugin/scripts/xero-start.js"]
       },
       "xpm": {
         "command": "node",
         "args": ["/absolute/path/to/mcfillin-marketplace/xpm-plugin/scripts/xpm-start.js"]
       }
     }
   }
   ```

   The config file lives at `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows). Fully quit and restart Claude Desktop after editing.

   > If a bare `"node"` fails to resolve (Claude Desktop may not share your shell's `PATH`), use the absolute path to your Node binary (`which node`) as the `command`.

4. **Authorise on first use.** The first tool call returns an OAuth URL — open it, authorise, and the callback completes automatically.

## Usage

Describe what you need in natural language and Claude will use the appropriate tools:

- *"List all unpaid invoices"* (Xero)
- *"Create a draft invoice for $1,500 to Smith Industries for consulting"* (Xero)
- *"Log 90 minutes against job JOB-001 for the client review"* (XPM)
- *"Find the client record for Acme Corp"* (XPM)

See [xero-plugin/README.md](./xero-plugin/README.md) · [xero-plugin/USAGE_GUIDE.md](./xero-plugin/USAGE_GUIDE.md) and [xpm-plugin/README.md](./xpm-plugin/README.md) · [xpm-plugin/USAGE_GUIDE.md](./xpm-plugin/USAGE_GUIDE.md) for detailed scopes, examples, and troubleshooting.

## Repository structure

```
mcfillin-marketplace/
├── README.md
├── xero-plugin/
│   ├── README.md · USAGE_GUIDE.md
│   ├── scripts/xero-start.js     # Credential loader + launcher
│   └── xero-mcp-server/          # Fork of XeroAPI/xero-mcp-server
│       └── src/{clients,server,tools,handlers,audit,helpers,consts,types}
└── xpm-plugin/
    ├── README.md · USAGE_GUIDE.md
    ├── scripts/xpm-start.js
    └── src/{services,tools,audit}
```

## Credits

The Xero Accounting server is a local fork of [XeroAPI/xero-mcp-server](https://github.com/XeroAPI/xero-mcp-server) (MIT).