# XPM Plugin — Usage Guide

This guide covers how to use the Xero Practice Manager (XPM) plugin for Claude Code and Claude Desktop.

---

## Getting started

Once the plugin is installed, you can interact with XPM in two ways:

1. **Tool** — type `/xpm` to activate the XPM mode
2. **Natural language** — just describe what you need and Claude will use the appropriate tools

This integration is **read-only** — it reports on XPM data but cannot create, update, or delete records.

---

## What you can do

| Action | Example prompt |
|---|---|
| List clients | *"Show me all active clients"* |
| Search clients | *"Find the client record for Acme Corp"* |
| View a client | *"Get the details for client Acme Corp"* |
| List tasks | *"What task types are available?"* |
| List time entries | *"Show my time entries for last week"* |
| View a time entry | *"Get the details of that time entry"* |
| Summarise time | *"How much time was logged against job JOB-001 this month?"* |

---

## Tools

All tools are read-only.

| Category | Tools |
|---|---|
| **Clients** | `xpm_list_clients`, `xpm_search_clients`, `xpm_get_client` |
| **Tasks** | `xpm_list_tasks`, `xpm_get_task` |
| **Time entries** | `xpm_list_time_entries`, `xpm_get_time_entry` |

---

## Example conversations

**Reviewing the week:**
> You: How much time did I log last week?
>
> Claude: *(lists time entries for the date range and totals the minutes, broken down by client/job)*

**Finding a client:**
> You: What's the email on file for Acme Corp?
>
> Claude: *(searches clients, returns the matching record's contact details)*

---

## Tips

- **Read-only** — this integration only reads from XPM. It cannot create, update, or delete records, and the OAuth token is granted read-only scopes. If you ask Claude to change something, it will explain that the connection is read-only.
- **Time is in minutes** — XPM stores durations in minutes (60 minutes = 1 hour). Claude reports durations in minutes and can total them for you.
- **Time entries belong to a job** — every time entry is attached to a Job (task), so you can filter by job number or UUID.
- **Pagination** — large result sets are paginated (default 50, max 100 per page). Ask for the next page if you need more results.
- **Date formats** — use natural language dates like *"last week"* or *"March 2026"*; filters are sent to XPM as `YYYY-MM-DD`.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| "Authorisation required" with a URL | This is expected on first use. Open the URL in your browser to authorise the app. The callback is handled on `http://localhost:5000/callback`. |
| "XERO_CLIENT_ID is not set" | Credentials haven't been provisioned in the OS credential store. See the README, or contact your system administrator. |
| MCP server not connected | Check that Node.js v18+ is installed, the server has been built (`npm run build`), and credentials are provisioned. |
| Token expired / session lost | Normal — the plugin refreshes tokens automatically (XPM tokens last 30 minutes). |
| Stale tokens after password change | Delete `~/.xpm-mcp-tokens.json` and retry to re-authenticate. |
| Rate limit exceeded (429) | Xero enforces 60 API calls per minute. Wait 60 seconds and try again. |