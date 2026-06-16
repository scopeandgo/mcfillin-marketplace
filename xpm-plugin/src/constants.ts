// ── XPM API ───────────────────────────────────────────────────────────────────
// Base URL for Xero Practice Manager v3.1 API.
// XPM exposes WorkflowMax-style endpoints under this base, e.g. `client.api/list`.
export const XPM_BASE_URL = 'https://api.xero.com/practicemanager/3.1';

// Xero OAuth2 endpoints
export const XERO_TOKEN_URL   = 'https://identity.xero.com/connect/token';
export const XERO_AUTH_URL    = 'https://login.xero.com/identity/connect/authorize';
export const XERO_CONNECT_URL = 'https://api.xero.com/connections';

// Required OAuth2 scopes for XPM (granular scopes, replacing broad 'practicemanager').
// READ-ONLY: this integration only reads from XPM, so no write scopes are requested.
// See: https://developer.xero.com/documentation/guides/oauth2/scopes/
export const XPM_SCOPES = [
  'offline_access',
  'openid',
  'profile',
  'email',
  // Clients (read-only)
  'practicemanager.client.read',
  // Time entries (read-only)
  'practicemanager.time.read',
  // Jobs (tasks)
  'practicemanager.job.read',
  // Staff
  'practicemanager.staff.read',
].join(' ');

// ── Token ─────────────────────────────────────────────────────────────────────
// XPM access tokens expire after 30 minutes; refresh 2 mins early to be safe
export const TOKEN_EXPIRY_BUFFER_MS = 2 * 60 * 1000;

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Xero enforces 60 calls/min — we add a small safety margin
export const RATE_LIMIT_DELAY_MS = 100;

// ── Pagination & output ───────────────────────────────────────────────────────
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE     = 100;
export const CHARACTER_LIMIT   = 50_000;

// ── Token storage path ────────────────────────────────────────────────────────
// Tokens are persisted locally so the server can resume without re-auth.
// The sysadmin should ensure this path is appropriate per machine.
import path from 'path';
import os from 'os';
export const TOKEN_STORE_PATH = path.join(
  process.env.XPM_TOKEN_DIR ?? os.homedir(),
  '.xpm-mcp-tokens.json'
);
