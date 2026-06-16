/**
 * tools/tasks.ts
 * MCP tools for Xero Practice Manager Tasks.
 *
 * XPM API endpoints used (WorkflowMax-style):
 *   GET  task.api/list       — all tasks (lookup table, typically small)
 *   GET  task.api/get/{id}   — single task detail
 *
 * Tasks in XPM are effectively a catalogue of billable/non-billable
 * activity types that can be assigned to jobs. They are read-only
 * from a practice configuration standpoint.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z }         from 'zod';
import { xpmGet, truncate } from '../services/xpm-client.js';
import { CHARACTER_LIMIT }  from '../constants.js';
import type { XpmTask, XpmListResponse } from '../types.js';
import { registerToolWithAudit } from '../audit/wrap-handler.js';

export function registerTaskTools(server: McpServer): void {

  // ── List all tasks ──────────────────────────────────────────────────────────
  registerToolWithAudit(server,
    'xpm_list_tasks',
    {
      title: 'List XPM Tasks',
      description: `Retrieve all task types configured in Xero Practice Manager.

Tasks are the catalogue of billable/non-billable activity types used when
recording time entries. This list is typically small (< 100 items).

Returns JSON array of task objects:
  [{ UUID, Name, Description, BillableRate, IsChargeable }]

Use UUID values to filter time records in xpm_list_time_entries.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const data  = await xpmGet<XpmListResponse<XpmTask>>('task.api/list');
      const tasks = normaliseArray(data.Tasks ?? data.Task);

      if (!tasks.length) {
        return { content: [{ type: 'text', text: 'No tasks found in this XPM account.' }] };
      }

      const result = JSON.stringify(tasks.map(formatTask), null, 2);
      return { content: [{ type: 'text', text: truncate(result, CHARACTER_LIMIT) }] };
    }
  );

  // ── Get task by UUID ────────────────────────────────────────────────────────
  registerToolWithAudit(server,
    'xpm_get_task',
    {
      title: 'Get XPM Task',
      description: `Retrieve full details for a single task type from Xero Practice Manager.

Use xpm_list_tasks to obtain the UUID first.

Args:
  - uuid (string): Task UUID from XPM

Returns a single task object:
  { UUID, Name, Description, BillableRate, IsChargeable }`,
      inputSchema: z.object({
        uuid: z.string().uuid().describe('Task UUID from XPM'),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ uuid }) => {
      const data = await xpmGet<XpmListResponse<XpmTask>>(`task.api/get/${uuid}`);
      const task = Array.isArray(data.Tasks) ? data.Tasks[0] : data.Task;

      if (!task) {
        return { content: [{ type: 'text', text: `No task found with UUID "${uuid}".` }] };
      }

      return { content: [{ type: 'text', text: JSON.stringify(formatTask(task), null, 2) }] };
    }
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normaliseArray<T>(val: T | T[] | undefined): T[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function formatTask(t: XpmTask): Partial<XpmTask> {
  return {
    UUID:         t.UUID,
    Name:         t.Name,
    Description:  t.Description,
    BillableRate: t.BillableRate,
    IsChargeable: t.IsChargeable,
  };
}
