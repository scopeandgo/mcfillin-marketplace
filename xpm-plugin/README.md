# XPM Plugin for Claude Code

Connects Claude Code to **Xero Practice Manager (XPM)** — clients, tasks (jobs), and time entries, via a local MCP server built on the XPM v3.1 API.

XPM shares the same Xero OAuth2 app as the [Xero Accounting plugin](../xero-plugin/), so credentials are loaded securely from the same OS credential store entries at runtime. On first use, the plugin prompts the user to authorise via OAuth in their browser. Tokens are persisted to disk and refreshed automatically.

---

## Requirements

- Claude Code or Claude Desktop
- Node.js v18+
- PowerShell 5.1+ with CredentialManager module (Windows only)

---

## Creating the Xero OAuth2 app

XPM uses the **same OAuth2 app** as the Xero Accounting plugin, created in the [Xero Developer Portal](https://developer.xero.com/app/manage). If you already set up the Xero plugin, you only need to add the XPM redirect URI and scopes to the existing app.

### Redirect URI

Add this redirect URI to your app (in addition to the Xero plugin's `http://localhost:5001/callback`):

```
http://localhost:5000/callback
```

### Granular scopes

The plugin requests these [granular scopes](https://developer.xero.com/documentation/guides/oauth2/scopes/) (replacing the deprecated broad `practicemanager` scope):

| Scope | Purpose |
|---|---|
| `practicemanager.client`, `practicemanager.client.read` | Clients |
| `practicemanager.time`, `practicemanager.time.read` | Time entries |
| `practicemanager.job.read` | Jobs / tasks |
| `practicemanager.staff.read` | Staff |

The `offline_access`, `openid`, `profile`, and `email` scopes are requested automatically during the OAuth2 flow.

---

## Credential provisioning

XPM reads the **same** credential-store entries as the Xero plugin (`XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`). If you have already provisioned them for the Xero plugin, there is nothing more to do. Otherwise:

### macOS

```bash
security add-generic-password -a xero -s XERO_CLIENT_ID -w "your_client_id"
security add-generic-password -a xero -s XERO_CLIENT_SECRET -w "your_client_secret"
```

### Windows

```powershell
Install-Module CredentialManager -Scope CurrentUser

cmdkey /generic:XERO_CLIENT_ID /user:xero /pass:your_client_id
cmdkey /generic:XERO_CLIENT_SECRET /user:xero /pass:your_client_secret
```

If credentials are not found, the server still starts — the auth error surfaces via tool responses.

---

## First-time authorisation

On the first tool call, the plugin will return an OAuth authorisation URL. Open it in your browser, authorise the app, and the callback is handled automatically on `http://localhost:5000/callback`. Tokens are saved to `~/.xpm-mcp-tokens.json` and refreshed before expiry on subsequent calls.

> XPM access tokens expire after 30 minutes and are refreshed automatically a couple of minutes early. To override the token storage location, set the `XPM_TOKEN_DIR` environment variable.

---

## Usage

Use the `/xpm` tool or describe what you need in natural language:

- *"List my time entries for last week"*
- *"Find the client record for Acme Corp"*
- *"Log 90 minutes against job JOB-001 for client review"*

Claude will always confirm before creating, updating, or deleting any records. Time entries are measured in minutes (60 minutes = 1 hour).