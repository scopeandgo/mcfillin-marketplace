/**
 * tools/time.ts
 * MCP tools for Xero Practice Manager Time Entries.
 *
 * XPM API endpoints used (WorkflowMax-style):
 *   GET  time.api/list          — list time entries with filters
 *   GET  time.api/get/{uuid}    — single time entry
 *   POST time.api/add           — create time entry
 *   PUT  time.api/update        — update time entry
 *   POST time.api/delete        — delete time entry
 *
 * Time entries are always attached to a Job in XPM.
 * Minutes are the canonical unit for duration in the XPM API.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z }         from 'zod';
import { xpmGet, xpmPost, xpmPut, truncate } from '../services/xpm-client.js';
import { CHARACTER_LIMIT, DEFAULT_PAGE_SIZE } from '../constants.js';
import type { XpmTimeEntry, XpmListResponse } from '../types.js';
import { registerToolWithAudit } from '../audit/wrap-handler.js';

export function registerTimeTools(server: McpServer): void {

  // ── List time entries ───────────────────────────────────────────────────────
  registerToolWithAudit(server,
    'xpm_list_time_entries',
    {
      title: 'List XPM Time Entries',
      description: `List time entries from Xero Practice Manager with optional filters.

Time entries are always associated with a Job. Filter by staff, date range,
client, or job to narrow results. All filters are optional but at least one
date filter is recommended to avoid large result sets.

Args:
  - staffUuid (string): Filter by staff member UUID
  - jobNumber (string): Filter by job number (e.g. "JOB-001")
  - clientUuid (string): Filter by client UUID
  - dateFrom (string): Start date filter — ISO format YYYY-MM-DD
  - dateTo (string): End date filter — ISO format YYYY-MM-DD
  - invoiced (boolean): Filter by invoiced status
  - page (number): Page number, 1-based (default: 1)
  - pageSize (number): Results per page, 1-100 (default: 50)

Returns JSON array of time entry objects:
  [{ UUID, Job, Task, Staff, Client, DateUtc, Minutes, Description,
     IsBillable, IsInvoiced, CostRate, BillableRate }]

Note: Minutes = duration (60 minutes = 1 hour).`,
      inputSchema: z.object({
        staffUuid:  z.string().uuid().optional().describe('Filter by staff UUID'),
        jobNumber:  z.string().optional().describe('Filter by job number (e.g. "JOB-001")'),
        clientUuid: z.string().uuid().optional().describe('Filter by client UUID'),
        dateFrom:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Start date YYYY-MM-DD'),
        dateTo:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('End date YYYY-MM-DD'),
        invoiced:   z.boolean().optional().describe('Filter by invoiced status'),
        page:       z.number().int().min(1).default(1).describe('Page number (1-based)'),
        pageSize:   z.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE).describe('Results per page'),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ staffUuid, jobNumber, clientUuid, dateFrom, dateTo, invoiced, page, pageSize }) => {
      const data = await xpmGet<XpmListResponse<XpmTimeEntry>>('time.api/list', {
        staffuuid:  staffUuid,
        jobnumber:  jobNumber,
        clientuuid: clientUuid,
        datefrom:   dateFrom,
        dateto:     dateTo,
        invoiced:   invoiced,
        page,
        pagesize:   pageSize,
      });

      const entries = normaliseArray(data.Times ?? data.Time);

      if (!entries.length) {
        return { content: [{ type: 'text', text: 'No time entries found matching the specified filters.' }] };
      }

      const result = JSON.stringify(entries.map(formatTimeEntry), null, 2);
      return { content: [{ type: 'text', text: truncate(result, CHARACTER_LIMIT) }] };
    }
  );

  // ── Get time entry by UUID ──────────────────────────────────────────────────
  registerToolWithAudit(server,
    'xpm_get_time_entry',
    {
      title: 'Get XPM Time Entry',
      description: `Retrieve full details for a single time entry from Xero Practice Manager.

Use xpm_list_time_entries to obtain the UUID first.

Args:
  - uuid (string): Time entry UUID from XPM

Returns a single time entry object:
  { UUID, Job, Task, Staff, Client, DateUtc, Minutes, Description,
    IsBillable, IsInvoiced, CostRate, BillableRate }`,
      inputSchema: z.object({
        uuid: z.string().uuid().describe('Time entry UUID from XPM'),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ uuid }) => {
      const data  = await xpmGet<XpmListResponse<XpmTimeEntry>>(`time.api/get/${uuid}`);
      const entry = Array.isArray(data.Times) ? data.Times[0] : data.Time;

      if (!entry) {
        return { content: [{ type: 'text', text: `No time entry found with UUID "${uuid}".` }] };
      }

      return { content: [{ type: 'text', text: JSON.stringify(formatTimeEntry(entry), null, 2) }] };
    }
  );

  // ── Add time entry ──────────────────────────────────────────────────────────
  registerToolWithAudit(server,
    'xpm_add_time_entry',
    {
      title: 'Add XPM Time Entry',
      description: `Create a new time entry in Xero Practice Manager.

CONFIRM with the user before calling — this creates a live time record in XPM.
Time entries must be linked to a Job UUID and a Task UUID.

Args:
  - jobUuid (string): UUID of the job this time is recorded against (required)
  - taskUuid (string): UUID of the task type (required) — use xpm_list_tasks
  - staffUuid (string): UUID of the staff member recording time (required)
  - date (string): Date of the time entry — ISO format YYYY-MM-DD (required)
  - minutes (number): Duration in minutes e.g. 90 = 1.5 hours (required, min 1)
  - description (string): Notes or description of work performed
  - isBillable (boolean): Whether the time is billable (default: true)

Returns the UUID of the created time entry on success.`,
      inputSchema: z.object({
        jobUuid:     z.string().uuid().describe('Job UUID to record time against'),
        taskUuid:    z.string().uuid().describe('Task UUID — use xpm_list_tasks'),
        staffUuid:   z.string().uuid().describe('Staff UUID recording this time'),
        date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date YYYY-MM-DD'),
        minutes:     z.number().int().min(1).describe('Duration in minutes (60 = 1 hour)'),
        description: z.string().optional().describe('Work description or notes'),
        isBillable:  z.boolean().default(true).describe('Whether the time is billable'),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ jobUuid, taskUuid, staffUuid, date, minutes, description, isBillable }) => {
      const payload = {
        Job:         { UUID: jobUuid },
        Task:        { UUID: taskUuid },
        Staff:       { UUID: staffUuid },
        DateUtc:     date,
        Minutes:     minutes,
        Description: description,
        IsBillable:  isBillable,
      };

      const data  = await xpmPost<XpmListResponse<XpmTimeEntry>>('time.api/add', payload);
      const entry = Array.isArray(data.Times) ? data.Times[0] : data.Time;

      return {
        content: [{
          type: 'text',
          text: entry
            ? `Time entry created successfully. UUID: ${entry.UUID ?? 'N/A'}\n${JSON.stringify(formatTimeEntry(entry), null, 2)}`
            : 'Time entry created but UUID not returned. Check XPM to confirm.',
        }],
      };
    }
  );

  // ── Update time entry ───────────────────────────────────────────────────────
  registerToolWithAudit(server,
    'xpm_update_time_entry',
    {
      title: 'Update XPM Time Entry',
      description: `Update an existing time entry in Xero Practice Manager.

CONFIRM with the user before calling — this modifies a live record.
Cannot update entries that have already been invoiced (IsInvoiced = true).
Only provided fields are updated; omitted fields are left unchanged.

Args:
  - uuid (string): Time entry UUID to update (required)
  - minutes (number): Updated duration in minutes
  - description (string): Updated work description
  - date (string): Updated date YYYY-MM-DD
  - isBillable (boolean): Updated billable flag

Returns confirmation on success.`,
      inputSchema: z.object({
        uuid:        z.string().uuid().describe('Time entry UUID to update'),
        minutes:     z.number().int().min(1).optional().describe('Updated duration in minutes'),
        description: z.string().optional().describe('Updated description'),
        date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Updated date YYYY-MM-DD'),
        isBillable:  z.boolean().optional().describe('Updated billable flag'),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ uuid, minutes, description, date, isBillable }) => {
      const payload: Record<string, unknown> = { UUID: uuid };
      if (minutes     !== undefined) payload['Minutes']     = minutes;
      if (description !== undefined) payload['Description'] = description;
      if (date        !== undefined) payload['DateUtc']     = date;
      if (isBillable  !== undefined) payload['IsBillable']  = isBillable;

      await xpmPut<XpmListResponse<XpmTimeEntry>>('time.api/update', payload);
      return { content: [{ type: 'text', text: `Time entry ${uuid} updated successfully.` }] };
    }
  );

  // ── Delete time entry ───────────────────────────────────────────────────────
  registerToolWithAudit(server,
    'xpm_delete_time_entry',
    {
      title: 'Delete XPM Time Entry',
      description: `Delete a time entry from Xero Practice Manager.

⚠️  DESTRUCTIVE — this permanently removes the time record.
ALWAYS confirm with the user before calling this tool.
Cannot delete entries that have already been invoiced.

Args:
  - uuid (string): Time entry UUID to delete

Returns confirmation on success.`,
      inputSchema: z.object({
        uuid: z.string().uuid().describe('Time entry UUID to delete'),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ uuid }) => {
      await xpmPost<unknown>('time.api/delete', { UUID: uuid });
      return { content: [{ type: 'text', text: `Time entry ${uuid} deleted successfully.` }] };
    }
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normaliseArray<T>(val: T | T[] | undefined): T[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function formatTimeEntry(t: XpmTimeEntry): Partial<XpmTimeEntry> {
  return {
    UUID:         t.UUID,
    Job:          t.Job,
    Task:         t.Task,
    Staff:        t.Staff,
    Client:       t.Client,
    DateUtc:      t.DateUtc,
    Minutes:      t.Minutes,
    Description:  t.Description,
    IsBillable:   t.IsBillable,
    IsInvoiced:   t.IsInvoiced,
    CostRate:     t.CostRate,
    BillableRate: t.BillableRate,
  };
}
