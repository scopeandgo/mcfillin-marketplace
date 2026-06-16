# Xero Plugin — Usage Guide

This guide covers how to use the Xero Accounting plugin for Claude Code and Claude Desktop.

---

## Getting started

Once the plugin is installed, you can interact with Xero in two ways:

1. **Tool** — type `/xero` to activate the Xero mode
2. **Natural language** — just describe what you need and Claude will use the appropriate tools

Claude will always ask for confirmation before creating, updating, or deleting any records.

---

## What you can do

| Action | Example prompt |
|---|---|
| View invoices | *"Show me all unpaid invoices"* |
| Search contacts | *"Find the contact record for Acme Corp"* |
| Create an invoice | *"Create a draft invoice for $2,000 to Smith Industries for consulting"* |
| View bank balances | *"What are my current bank account balances?"* |
| Run reports | *"Show me the P&L for this financial year"* |
| View aged receivables | *"Who owes us money and how overdue is it?"* |
| Manage chart of accounts | *"List all expense accounts"* |
| Create payments | *"Record a payment of $500 against invoice INV-001"* |
| Manage items | *"List all inventory items"* |
| Payroll | *"List all payroll employees"* |

---

## Example conversations

**Checking outstanding invoices:**
> You: Show me all overdue invoices
>
> Claude: *(fetches invoices from Xero and presents a table with contact names, invoice numbers, due dates, amounts, and how many days overdue)*

**Creating an invoice:**
> You: Create an invoice to Acme Corp for 10 hours of consulting at $150/hr
>
> Claude: I'll create a draft invoice to Acme Corp for $1,500.00 (10 x $150.00 — Consulting). Shall I go ahead?
>
> You: Yes
>
> Claude: *(creates the invoice and returns the invoice number)*

---

## Tips

- **Pagination** — Large result sets are paginated. Ask for the next page if you need more results.
- **Date formats** — Use natural language dates like *"today"*, *"last week"*, *"March 2026"*.
- **Write safety** — Claude always describes what it's about to do and waits for your confirmation before creating, updating, or deleting any records.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| "Authorisation required" with a URL | This is expected on first use. Open the URL in your browser to authorise the app. |
| "XERO_CLIENT_ID is not set" | Credentials haven't been provisioned in the OS credential store. Contact your system administrator. |
| MCP server not connected | Check that Node.js v18+ is installed and credentials are provisioned. |
| "Access token expiring soon" | Normal — the plugin refreshes tokens automatically. |
| Stale tokens after password change | Delete `~/.xero-mcp-tokens.json` and retry to re-authenticate. |
| Rate limit exceeded (429) | Xero enforces 60 API calls per minute. Wait 60 seconds and try again. |

