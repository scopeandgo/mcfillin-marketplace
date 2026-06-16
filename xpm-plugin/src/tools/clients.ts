/**
 * tools/clients.ts
 * MCP tools for Xero Practice Manager Clients.
 *
 * XPM API endpoints used (WorkflowMax-style):
 *   GET  client.api/list          — paginated list of all clients
 *   GET  client.api/search        — search clients by name/email
 *   GET  client.api/get/{uuid}    — single client detail
 *   POST client.api/add           — create a client
 *   PUT  client.api/update        — update a client
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z }         from 'zod';
import { xpmGet, xpmPost, xpmPut, truncate } from '../services/xpm-client.js';
import { CHARACTER_LIMIT, DEFAULT_PAGE_SIZE } from '../constants.js';
import type { XpmClient, XpmListResponse } from '../types.js';
import { registerToolWithAudit } from '../audit/wrap-handler.js';

export function registerClientTools(server: McpServer): void {

  // ── List clients ────────────────────────────────────────────────────────────
  registerToolWithAudit(server,
    'xpm_list_clients',
    {
      title: 'List XPM Clients',
      description: `Retrieve a paginated list of all clients from Xero Practice Manager.

Returns client records including UUID, name, email, phone, and address details.
Use the search tool for keyword-based lookup. Use UUID from results in other tools.

Args:
  - page (number): Page number, 1-based (default: 1)
  - pageSize (number): Results per page, 1-100 (default: 50)
  - includeArchived (boolean): Include archived clients (default: false)

Returns JSON array of client objects:
  [{ UUID, Name, Email, Phone, Address, City, IsArchived, BusinessNumber }]`,
      inputSchema: z.object({
        page:            z.number().int().min(1).default(1).describe('Page number (1-based)'),
        pageSize:        z.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE).describe('Results per page (max 100)'),
        includeArchived: z.boolean().default(false).describe('Include archived clients'),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ page, pageSize, includeArchived }) => {
      const data = await xpmGet<XpmListResponse<XpmClient>>('client.api/list', {
        page,
        pagesize:        pageSize,
        includearchived: includeArchived,
      });

      const clients = normaliseArray(data.Clients ?? data.Client);
      const result  = JSON.stringify(clients.map(formatClient), null, 2);

      return {
        content: [{ type: 'text', text: truncate(result, CHARACTER_LIMIT) }],
      };
    }
  );

  // ── Search clients ──────────────────────────────────────────────────────────
  registerToolWithAudit(server,
    'xpm_search_clients',
    {
      title: 'Search XPM Clients',
      description: `Search Xero Practice Manager clients by name or email address.

Performs a partial-match search across client names and email addresses.
Returns matching client records. Prefer this over list for keyword lookups.

Args:
  - query (string): Search term — matches against name and email (min 2 chars)
  - page (number): Page number, 1-based (default: 1)
  - pageSize (number): Results per page, 1-100 (default: 50)

Returns JSON array of matching client objects:
  [{ UUID, Name, Email, Phone, Address, City, IsArchived }]`,
      inputSchema: z.object({
        query:    z.string().min(2).describe('Search term — name or email (min 2 chars)'),
        page:     z.number().int().min(1).default(1).describe('Page number (1-based)'),
        pageSize: z.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE).describe('Results per page'),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ query, page, pageSize }) => {
      const data = await xpmGet<XpmListResponse<XpmClient>>('client.api/search', {
        query,
        page,
        pagesize: pageSize,
      });

      const clients = normaliseArray(data.Clients ?? data.Client);

      if (!clients.length) {
        return { content: [{ type: 'text', text: `No clients found matching "${query}".` }] };
      }

      const result = JSON.stringify(clients.map(formatClient), null, 2);
      return { content: [{ type: 'text', text: truncate(result, CHARACTER_LIMIT) }] };
    }
  );

  // ── Get client by UUID ──────────────────────────────────────────────────────
  registerToolWithAudit(server,
    'xpm_get_client',
    {
      title: 'Get XPM Client',
      description: `Retrieve full details for a single Xero Practice Manager client by UUID.

Returns complete client record including all contact details, notes, and metadata.
Use xpm_search_clients or xpm_list_clients to obtain the UUID first.

Args:
  - uuid (string): Client UUID from XPM (e.g. "a1b2c3d4-e5f6-...")

Returns a single client object:
  { UUID, Name, Email, Phone, Address, City, Region, PostCode, Country,
    BusinessNumber, CompanyNumber, Website, Notes, IsArchived }`,
      inputSchema: z.object({
        uuid: z.string().uuid().describe('Client UUID from XPM'),
      }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ uuid }) => {
      const data = await xpmGet<XpmListResponse<XpmClient>>(`client.api/get/${uuid}`);
      const client = Array.isArray(data.Clients) ? data.Clients[0] : data.Client;

      if (!client) {
        return { content: [{ type: 'text', text: `No client found with UUID "${uuid}".` }] };
      }

      return { content: [{ type: 'text', text: JSON.stringify(formatClient(client), null, 2) }] };
    }
  );

  // ── Create client ───────────────────────────────────────────────────────────
  registerToolWithAudit(server,
    'xpm_create_client',
    {
      title: 'Create XPM Client',
      description: `Create a new client record in Xero Practice Manager.

CONFIRM with the user before calling this tool — it creates a live record in XPM.

Args:
  - name (string): Client name (required)
  - email (string): Primary email address
  - phone (string): Phone number
  - address (string): Street address
  - city (string): City/suburb
  - region (string): State or region
  - postCode (string): Postal/zip code
  - country (string): Country
  - businessNumber (string): ABN, NZBN, or equivalent
  - website (string): Website URL
  - notes (string): Internal notes

Returns the UUID of the newly created client on success.`,
      inputSchema: z.object({
        name:           z.string().min(1).describe('Client name (required)'),
        email:          z.string().email().optional().describe('Primary email address'),
        phone:          z.string().optional().describe('Phone number'),
        address:        z.string().optional().describe('Street address'),
        city:           z.string().optional().describe('City or suburb'),
        region:         z.string().optional().describe('State or region'),
        postCode:       z.string().optional().describe('Postal or zip code'),
        country:        z.string().optional().describe('Country'),
        businessNumber: z.string().optional().describe('ABN, NZBN, or equivalent'),
        website:        z.string().url().optional().describe('Website URL'),
        notes:          z.string().optional().describe('Internal notes'),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      const payload = {
        Name:           params.name,
        Email:          params.email,
        Phone:          params.phone,
        Address:        params.address,
        City:           params.city,
        Region:         params.region,
        PostCode:       params.postCode,
        Country:        params.country,
        BusinessNumber: params.businessNumber,
        Website:        params.website,
        Notes:          params.notes,
      };

      const data = await xpmPost<XpmListResponse<XpmClient>>('client.api/add', payload);
      const created = Array.isArray(data.Clients) ? data.Clients[0] : data.Client;

      return {
        content: [{
          type: 'text',
          text: created
            ? `Client created successfully. UUID: ${created.UUID}\n${JSON.stringify(formatClient(created), null, 2)}`
            : 'Client created but UUID not returned. Check XPM to confirm.',
        }],
      };
    }
  );

  // ── Update client ───────────────────────────────────────────────────────────
  registerToolWithAudit(server,
    'xpm_update_client',
    {
      title: 'Update XPM Client',
      description: `Update an existing client record in Xero Practice Manager.

CONFIRM with the user before calling — this modifies a live record.
Only provided fields are updated; omitted fields are left unchanged.

Args:
  - uuid (string): Client UUID to update (required)
  - name, email, phone, address, city, region, postCode, country,
    businessNumber, website, notes: Fields to update (all optional)

Returns confirmation with the updated client record.`,
      inputSchema: z.object({
        uuid:           z.string().uuid().describe('Client UUID to update'),
        name:           z.string().min(1).optional().describe('Updated client name'),
        email:          z.string().email().optional().describe('Updated email'),
        phone:          z.string().optional().describe('Updated phone'),
        address:        z.string().optional().describe('Updated address'),
        city:           z.string().optional().describe('Updated city'),
        region:         z.string().optional().describe('Updated region'),
        postCode:       z.string().optional().describe('Updated postcode'),
        country:        z.string().optional().describe('Updated country'),
        businessNumber: z.string().optional().describe('Updated ABN/NZBN'),
        website:        z.string().url().optional().describe('Updated website URL'),
        notes:          z.string().optional().describe('Updated internal notes'),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ uuid, ...fields }) => {
      const payload: Record<string, string | undefined> = {
        UUID:           uuid,
        Name:           fields.name,
        Email:          fields.email,
        Phone:          fields.phone,
        Address:        fields.address,
        City:           fields.city,
        Region:         fields.region,
        PostCode:       fields.postCode,
        Country:        fields.country,
        BusinessNumber: fields.businessNumber,
        Website:        fields.website,
        Notes:          fields.notes,
      };

      // Strip undefined values
      const clean = Object.fromEntries(
        Object.entries(payload).filter(([, v]) => v !== undefined)
      );

      await xpmPut<XpmListResponse<XpmClient>>('client.api/update', clean);
      return { content: [{ type: 'text', text: `Client ${uuid} updated successfully.` }] };
    }
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normaliseArray<T>(val: T | T[] | undefined): T[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function formatClient(c: XpmClient): Partial<XpmClient> {
  return {
    UUID:           c.UUID,
    Name:           c.Name,
    Email:          c.Email,
    Phone:          c.Phone,
    Address:        c.Address,
    City:           c.City,
    Region:         c.Region,
    PostCode:       c.PostCode,
    Country:        c.Country,
    BusinessNumber: c.BusinessNumber,
    CompanyNumber:  c.CompanyNumber,
    Website:        c.Website,
    Notes:          c.Notes,
    IsArchived:     c.IsArchived,
  };
}
