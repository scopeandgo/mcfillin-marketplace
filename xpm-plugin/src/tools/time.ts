/**
 * tools/time.ts
 * MCP tools for Xero Practice Manager Time Entries.
 *
 * Read-only. XPM API endpoints used (WorkflowMax-style):
 *   GET  time.api/list          — list time entries with filters
 *   GET  time.api/get/{uuid}    — single time entry
 *
 * Time entries are always attached to a Job in XPM.
 * Minutes are the canonical unit for duration in the XPM API.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z }         from 'zod';
import { xpmGet, truncate } from '../services/xpm-client.js';
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
