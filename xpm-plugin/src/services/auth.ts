/**
 * auth.ts
 * Handles Xero OAuth2 token lifecycle for XPM:
 *   - Load/save tokens from disk (persisted across restarts)
 *   - Proactive token refresh before expiry
 *   - Initial auth-code exchange (triggered on first run)
 *
 * XPM uses user-based OAuth2 (authorization code flow).
 * Access tokens expire after 30 minutes.
 * Refresh tokens are long-lived but can expire if unused for 60 days.
 */

import crypto from 'crypto';
import fs   from 'fs';
import http from 'http';
import axios from 'axios';
import { TOKEN_STORE_PATH, XERO_TOKEN_URL, XERO_AUTH_URL, XPM_SCOPES, TOKEN_EXPIRY_BUFFER_MS } from '../constants.js';
import type { TokenSet } from '../types.js';

/**
 * Thrown when no tokens exist and the user must complete the OAuth flow.
 * The message contains the auth URL so tool responses can surface it to the user.
 */
export class AuthRequiredError extends Error {
  public readonly authUrl: string;

  constructor(authUrl: string) {
    super(
      `To connect to Xero Practice Manager, please open this link and sign in:\n\n${authUrl}\n\nOnce you've approved the connection, come back here and try your request again.`,
    );
    this.name = 'AuthRequiredError';
    this.authUrl = authUrl;
  }
}

// ── Token encryption ─────────────────────────────────────────────────────────
// Tokens are encrypted at rest using AES-256-GCM.  The key is derived from
// the OAuth client credentials (already in env via the launcher script).

function deriveEncryptionKey(): Buffer {
  const id     = process.env.XERO_CLIENT_ID     ?? '';
  const secret = process.env.XERO_CLIENT_SECRET ?? '';
  if (!id || !secret) {
    throw new Error('[xpm-auth] Cannot encrypt/decrypt tokens: client credentials not available in env.');
  }
  return crypto.createHash('sha256').update(id + secret).digest();
}

function encryptToken(plaintext: string): string {
  const key        = deriveEncryptionKey();
  const iv         = crypto.randomBytes(12);
  const cipher     = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag        = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

function decryptToken(data: string): string {
  const key        = deriveEncryptionKey();
  const [ivB64, tagB64, ctB64] = data.split(':');
  const decipher   = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return decipher.update(Buffer.from(ctB64, 'base64')) + decipher.final('utf8');
}

// ── Token persistence ─────────────────────────────────────────────────────────

export function loadTokens(): TokenSet | null {
  try {
    if (!fs.existsSync(TOKEN_STORE_PATH)) return null;
    const raw = fs.readFileSync(TOKEN_STORE_PATH, 'utf8');
    return JSON.parse(decryptToken(raw)) as TokenSet;
  } catch {
    return null;
  }
}

function saveTokens(tokens: TokenSet): void {
  fs.writeFileSync(TOKEN_STORE_PATH, encryptToken(JSON.stringify(tokens)), {
    mode: 0o600, // owner read/write only
  });
}

// ── Token refresh ─────────────────────────────────────────────────────────────

async function refreshAccessToken(tokens: TokenSet): Promise<TokenSet> {
  const clientId     = requireEnv('XERO_CLIENT_ID');
  const clientSecret = requireEnv('XERO_CLIENT_SECRET');

  const params = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id:     clientId,
    client_secret: clientSecret,
  });

  const response = await axios.post<{
    access_token:  string;
    refresh_token: string;
    expires_in:    number;
  }>(XERO_TOKEN_URL, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const updated: TokenSet = {
    access_token:  response.data.access_token,
    refresh_token: response.data.refresh_token ?? tokens.refresh_token,
    expires_at:    Date.now() + response.data.expires_in * 1000,
    tenant_id:     tokens.tenant_id,
  };

  saveTokens(updated);
  return updated;
}

// ── Main: get a valid access token ───────────────────────────────────────────

export async function getValidToken(): Promise<TokenSet> {
  let tokens = loadTokens();

  if (!tokens) {
    startAuthFlow(); // throws AuthRequiredError — never returns
  }

  // Proactively refresh if within buffer window
  if (Date.now() >= tokens.expires_at - TOKEN_EXPIRY_BUFFER_MS) {
    console.error('[xpm-auth] Access token expiring soon — refreshing...');
    try {
      tokens = await refreshAccessToken(tokens);
    } catch (err) {
      // Refresh token may be expired (e.g. unused for 60 days) — clear
      // stale tokens and start a fresh auth flow so Claude can surface
      // the new OAuth URL instead of a generic error.
      console.error(`[xpm-auth] Token refresh failed: ${err instanceof Error ? err.message : err}`);
      clearTokensAndReauth();
    }
  }

  return tokens;
}

/**
 * Deletes stale tokens and starts a fresh OAuth flow.
 * Always throws AuthRequiredError with a new auth URL.
 */
export function clearTokensAndReauth(): never {
  try { fs.unlinkSync(TOKEN_STORE_PATH); } catch { /* may already be gone */ }
  startAuthFlow(); // throws AuthRequiredError — never returns
}

// ── Initial auth code flow ────────────────────────────────────────────────────

// Track pending auth flow so repeated tool calls reuse the same state/URL
let pendingAuthUrl: string | null = null;

/**
 * Builds the auth URL, starts the callback listener in the background,
 * and throws AuthRequiredError so the URL surfaces in the tool response.
 *
 * If a flow is already in progress (listener running), reuses the same URL
 * so the state matches when the browser redirects back.
 */
function startAuthFlow(): never {
  // If a flow is already pending, reuse the same URL
  if (pendingAuthUrl) {
    throw new AuthRequiredError(pendingAuthUrl);
  }

  const clientId     = requireEnv('XERO_CLIENT_ID');
  const clientSecret = requireEnv('XERO_CLIENT_SECRET');
  const redirectUri  = 'http://localhost:5000/callback';

  const expectedState = generateState();

  const authUrl =
    `${XERO_AUTH_URL}?` +
    new URLSearchParams({
      response_type: 'code',
      client_id:     clientId,
      redirect_uri:  redirectUri,
      scope:         XPM_SCOPES,
      state:         expectedState,
    }).toString();

  pendingAuthUrl = authUrl;

  // Start callback listener in the background — it will save tokens when the
  // user completes the browser flow, so the next tool call succeeds.
  waitForAuthCode(5000, expectedState)
    .then(async (code) => {
      const params = new URLSearchParams({
        grant_type:   'authorization_code',
        code,
        redirect_uri:  redirectUri,
        client_id:     clientId,
        client_secret: clientSecret,
      });

      const tokenResponse = await axios.post<{
        access_token:  string;
        refresh_token: string;
        expires_in:    number;
      }>(XERO_TOKEN_URL, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const { access_token, refresh_token, expires_in } = tokenResponse.data;

      const connectionsResponse = await axios.get<Array<{ tenantId: string; tenantType: string }>>(
        'https://api.xero.com/connections',
        { headers: { Authorization: `Bearer ${access_token}` } }
      );

      const xpmTenant = connectionsResponse.data.find(
        (t) => t.tenantType === 'PRACTICEMANAGER'
      ) ?? connectionsResponse.data[0];

      if (!xpmTenant) {
        console.error(
          '[xpm-auth] No XPM tenant found after authorisation. Check your Xero Practice Manager subscription.'
        );
        return;
      }

      const tokens: TokenSet = {
        access_token,
        refresh_token,
        expires_at: Date.now() + expires_in * 1000,
        tenant_id:  xpmTenant.tenantId,
      };

      saveTokens(tokens);
      console.error(`[xpm-auth] Authorisation complete. Tenant ID: ${tokens.tenant_id}`);
    })
    .catch((err) => {
      console.error(`[xpm-auth] Background auth flow failed: ${err.message}`);
    })
    .finally(() => {
      pendingAuthUrl = null;
    });

  throw new AuthRequiredError(authUrl);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(
      `[xpm-auth] Required environment variable "${name}" is not set. ` +
      'Ensure credentials are provisioned in the OS credential store and injected via the launcher script.'
    );
  }
  return val;
}

function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** Spins up a temporary HTTP server to capture the OAuth2 redirect code */
function waitForAuthCode(port: number, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url    = new URL(req.url ?? '/', `http://localhost:${port}`);
      const code   = url.searchParams.get('code');
      const error  = url.searchParams.get('error');
      const state  = url.searchParams.get('state');

      if (error) {
        res.writeHead(400);
        const safeError = error.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        res.end(`<html><body><h2>Authorisation failed: ${safeError}</h2><p>You may close this tab.</p></body></html>`);
        server.close();
        reject(new Error(`[xpm-auth] Xero denied authorisation: ${error}`));
        return;
      }

      if (code) {
        if (!state || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expectedState))) {
          res.writeHead(403);
          res.end('<html><body><h2>Authorisation failed: state mismatch</h2><p>Possible CSRF attack. You may close this tab.</p></body></html>');
          server.close();
          reject(new Error('[xpm-auth] OAuth2 state mismatch — possible CSRF attack.'));
          return;
        }

        res.writeHead(200);
        res.end('<html><body><h2>Connected to Xero Practice Manager</h2><p>You may close this tab and return to Claude Code.</p></body></html>');
        server.close();
        resolve(code);
        return;
      }

      res.writeHead(200);
      res.end('<html><body><p>Waiting for authorisation...</p></body></html>');
    });

    server.listen(port, () => {
      console.error(`[xpm-auth] Callback listener started on port ${port}`);
    });

    server.on('error', (err) => {
      reject(new Error(`[xpm-auth] Failed to start callback server: ${err.message}`));
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('[xpm-auth] Timed out waiting for Xero authorisation (5 min).'));
    }, 5 * 60 * 1000);
  });
}
