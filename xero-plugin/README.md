# Xero Plugin for Claude Code

Connects Claude Code to **Xero Accounting** — powered by a local fork of the [Xero MCP server](https://github.com/XeroAPI/xero-mcp-server). Contacts, invoices, bank transactions, payments, manual journals, reports, payroll, and more.

Credentials are loaded securely from the OS credential store at runtime. On first use, the plugin prompts the user to authorise via OAuth in their browser. Tokens are persisted to disk and refreshed automatically.

---

## Requirements

- Claude Code or Claude Desktop
- Node.js v18+
- PowerShell 5.1+ with CredentialManager module (Windows only)

---

## Creating the Xero OAuth2 app

Create an OAuth2 app in the [Xero Developer Portal](https://developer.xero.com/app/manage).

### Redirect URI

Add this redirect URI to your app:

```
http://localhost:5001/callback
```

### Granular scopes

The plugin requests these [granular scopes](https://developer.xero.com/documentation/guides/oauth2/scopes/) (replacing deprecated broad scopes from March 2026):

| Scope | Purpose |
|---|---|
| `accounting.invoices`, `accounting.invoices.read` | Invoices, credit notes, quotes |
| `accounting.payments`, `accounting.payments.read` | Payments |
| `accounting.banktransactions`, `accounting.banktransactions.read` | Bank transactions |
| `accounting.manualjournals`, `accounting.manualjournals.read` | Manual journals |
| `accounting.contacts`, `accounting.contacts.read` | Contacts, contact groups |
| `accounting.settings`, `accounting.settings.read` | Accounts, items, tracking categories, tax rates |
| `accounting.reports.aged.read` | Aged receivables/payables |
| `accounting.reports.balancesheet.read` | Balance sheet |
| `accounting.reports.profitandloss.read` | Profit and loss |
| `accounting.reports.trialbalance.read` | Trial balance |
| `payroll.settings`, `payroll.settings.read` | Payroll settings |
| `payroll.employees`, `payroll.employees.read` | Payroll employees |
| `payroll.timesheets`, `payroll.timesheets.read` | Payroll timesheets |

The `offline_access`, `openid`, `profile`, and `email` scopes are requested automatically during the OAuth2 flow. You can override scopes via the `XERO_SCOPES` environment variable.

---

## Credential provisioning

Credentials must be stored in the OS credential store before the plugin will function. If credentials are not found, the server still starts — the auth error surfaces via tool responses.

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

---

## First-time authorisation

On the first tool call, the plugin will return an OAuth authorisation URL. Open it in your browser, authorise the app, and the callback is handled automatically. Tokens are saved to `~/.xero-mcp-tokens.json` and refreshed before expiry on subsequent calls.

---

## Usage

Use the `/xero` tool or describe what you need in natural language:

- *"List all unpaid invoices"*
- *"Find the contact record for Acme Corp"*
- *"Create an invoice for $1,500 for consulting services to Smith Industries"*

Claude will always confirm before creating, updating, or deleting any records.
