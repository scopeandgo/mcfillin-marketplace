// ── OAuth token store ─────────────────────────────────────────────────────────

export interface TokenSet {
  access_token:  string;
  refresh_token: string;
  expires_at:    number; // Unix timestamp (ms)
  tenant_id:     string;
}

// ── XPM API response wrappers ─────────────────────────────────────────────────

export interface XpmListResponse<T> {
  Clients?:     T[];
  Client?:      T;
  Tasks?:       T[];
  Task?:        T;
  Times?:       T[];
  Time?:        T;
}

// ── Client ────────────────────────────────────────────────────────────────────

export interface XpmClient {
  UUID:          string;
  Name:          string;
  Email?:        string;
  Phone?:        string;
  Address?:      string;
  City?:         string;
  Region?:       string;
  PostCode?:     string;
  Country?:      string;
  IsArchived?:   boolean;
  BusinessNumber?: string;
  CompanyNumber?:  string;
  Website?:      string;
  Notes?:        string;
}

// ── Task ──────────────────────────────────────────────────────────────────────

export interface XpmTask {
  UUID:        string;
  Name:        string;
  Description?: string;
  BillableRate?: number;
  IsChargeable?: boolean;
}

// ── Time entry ────────────────────────────────────────────────────────────────

export interface XpmTimeEntry {
  UUID?:         string;
  Job?:          { UUID: string; Name?: string; Number?: string };
  Task?:         { UUID: string; Name?: string };
  Staff?:        { UUID: string; Name?: string };
  Client?:       { UUID: string; Name?: string };
  DateUtc?:      string;
  Minutes?:      number;
  Description?:  string;
  IsBillable?:   boolean;
  IsInvoiced?:   boolean;
  CostRate?:     number;
  BillableRate?: number;
}

// ── Tool response helpers ─────────────────────────────────────────────────────

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
}
