/**
 * xero-client.ts
 * Handles Xero OAuth2 token lifecycle for the MCP server:
 *   - Load/save tokens from disk (persisted across restarts)
 *   - Proactive token refresh before expiry
 *   - Initial auth-code exchange (triggered on first run)
 *
 * Mirrors the auth pattern used by the XPM MCP server.
 */

import crypto from "crypto";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import axios, { AxiosError } from "axios";
import { IXeroClientConfig, Organisation, XeroClient } from "xero-node";

import { ensureError } from "../helpers/ensure-error.js";

// ── Constants ────────────────────────────────────────────────────────────────

const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_AUTH_URL =
  "https://login.xero.com/identity/connect/authorize";
const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";

// Granular scopes (replacing deprecated broad scopes from March 2026)
// See: https://developer.xero.com/documentation/guides/oauth2/scopes/
const DEFAULT_SCOPES = [
  "offline_access",
  "openid",
  "profile",
  "email",
  // Accounting – invoices, credit notes, quotes
  "accounting.invoices",
  "accounting.invoices.read",
  // Payments
  "accounting.payments",
  "accounting.payments.read",
  // Bank transactions
  "accounting.banktransactions",
  "accounting.banktransactions.read",
  // Manual journals
  "accounting.manualjournals",
  "accounting.manualjournals.read",
  // Contacts & contact groups
  "accounting.contacts",
  "accounting.contacts.read",
  // Settings – accounts, items, tracking categories, tax rates
  "accounting.settings",
  "accounting.settings.read",
  // Reports
  "accounting.reports.aged.read",
  "accounting.reports.balancesheet.read",
  "accounting.reports.profitandloss.read",
  "accounting.reports.trialbalance.read",
  // Payroll (NZ)
  "payroll.settings",
  "payroll.settings.read",
  "payroll.employees",
  "payroll.employees.read",
  "payroll.timesheets",
  "payroll.timesheets.read",
].join(" ");

const TOKEN_EXPIRY_BUFFER_MS = 2 * 60 * 1000; // refresh 2 min early

const TOKEN_STORE_PATH = path.join(
  process.env.XERO_TOKEN_DIR ?? os.homedir(),
  ".xero-mcp-tokens.json",
);

// ── Types ────────────────────────────────────────────────────────────────────

interface StoredTokenSet {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp (ms)
  tenant_id: string;
}

/**
 * Thrown when no tokens exist and the user must complete the OAuth flow.
 * The message contains the auth URL so handlers can surface it in the tool response.
 */
export class AuthRequiredError extends Error {
  public readonly authUrl: string;

  constructor(authUrl: string) {
    super(
      `To connect to Xero, please open this link and sign in:\n\n${authUrl}\n\nOnce you've approved the connection, come back here and try your request again.`,
    );
    this.name = "AuthRequiredError";
    this.authUrl = authUrl;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(
      `[xero-auth] Required environment variable "${name}" is not set. ` +
        "Ensure credentials are provisioned in the OS credential store and injected via the launcher script.",
    );
  }
  return val;
}

// ── Token encryption ────────────────────────────────────────────────────────
// Tokens are encrypted at rest using AES-256-GCM.  The key is derived from
// the OAuth client credentials (already in env via the launcher script).

function deriveEncryptionKey(): Buffer {
  const id     = process.env.XERO_CLIENT_ID     ?? "";
  const secret = process.env.XERO_CLIENT_SECRET ?? "";
  if (!id || !secret) {
    throw new Error(
      "[xero-auth] Cannot encrypt/decrypt tokens: client credentials not available in env.",
    );
  }
  return crypto.createHash("sha256").update(id + secret).digest();
}

function encryptToken(plaintext: string): string {
  const key       = deriveEncryptionKey();
  const iv        = crypto.randomBytes(12);
  const cipher    = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag       = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

function decryptToken(data: string): string {
  const key      = deriveEncryptionKey();
  const [ivB64, tagB64, ctB64] = data.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return decipher.update(Buffer.from(ctB64, "base64")) + decipher.final("utf8");
}

// ── Token persistence ────────────────────────────────────────────────────────

function loadTokens(): StoredTokenSet | null {
  try {
    if (!fs.existsSync(TOKEN_STORE_PATH)) return null;
    const raw = fs.readFileSync(TOKEN_STORE_PATH, "utf8");
    return JSON.parse(decryptToken(raw)) as StoredTokenSet;
  } catch {
    return null;
  }
}

function saveTokens(tokens: StoredTokenSet): void {
  fs.writeFileSync(TOKEN_STORE_PATH, encryptToken(JSON.stringify(tokens)), {
    mode: 0o600, // owner read/write only
  });
}

// ── Token refresh ────────────────────────────────────────────────────────────

async function refreshAccessToken(
  tokens: StoredTokenSet,
): Promise<StoredTokenSet> {
  const clientId = requireEnv("XERO_CLIENT_ID");
  const clientSecret = requireEnv("XERO_CLIENT_SECRET");

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await axios.post<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }>(XERO_TOKEN_URL, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  const updated: StoredTokenSet = {
    access_token: response.data.access_token,
    refresh_token: response.data.refresh_token ?? tokens.refresh_token,
    expires_at: Date.now() + response.data.expires_in * 1000,
    tenant_id: tokens.tenant_id,
  };

  saveTokens(updated);
  return updated;
}

// ── Initial auth code flow ───────────────────────────────────────────────────

function generateState(): string {
  return crypto.randomBytes(16).toString("hex");
}

function waitForAuthCode(
  port: number,
  expectedState: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      const state = url.searchParams.get("state");

      if (error) {
        res.writeHead(400);
        const safeError = error
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
        res.end(
          `<html><body><h2>Authorisation failed: ${safeError}</h2><p>You may close this tab.</p></body></html>`,
        );
        server.close();
        reject(new Error(`[xero-auth] Xero denied authorisation: ${error}`));
        return;
      }

      if (code) {
        if (
          !state ||
          !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expectedState))
        ) {
          res.writeHead(403);
          res.end(
            "<html><body><h2>Authorisation failed: state mismatch</h2><p>Possible CSRF attack. You may close this tab.</p></body></html>",
          );
          server.close();
          reject(
            new Error("[xero-auth] OAuth2 state mismatch — possible CSRF attack."),
          );
          return;
        }

        res.writeHead(200);
        res.end(
          "<html><body><h2>Connected to Xero</h2><p>You may close this tab and return to Claude Code.</p></body></html>",
        );
        server.close();
        resolve(code);
        return;
      }

      res.writeHead(200);
      res.end(
        "<html><body><p>Waiting for authorisation...</p></body></html>",
      );
    });

    server.listen(port, () => {
      console.error(`[xero-auth] Callback listener started on port ${port}`);
    });

    server.on("error", (err) => {
      reject(
        new Error(
          `[xero-auth] Failed to start callback server: ${err.message}`,
        ),
      );
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(
        new Error("[xero-auth] Timed out waiting for Xero authorisation (5 min)."),
      );
    }, 5 * 60 * 1000);
  });
}

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

  const clientId = requireEnv("XERO_CLIENT_ID");
  const clientSecret = requireEnv("XERO_CLIENT_SECRET");
  const redirectUri = "http://localhost:5001/callback";
  const scopes = process.env.XERO_SCOPES || DEFAULT_SCOPES;

  const expectedState = generateState();

  const authUrl =
    `${XERO_AUTH_URL}?` +
    new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scopes,
      state: expectedState,
    }).toString();

  pendingAuthUrl = authUrl;

  // Start callback listener in the background — it will save tokens when the
  // user completes the browser flow, so the next tool call succeeds.
  waitForAuthCode(5001, expectedState)
    .then(async (code) => {
      const params = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      });

      const tokenResponse = await axios.post<{
        access_token: string;
        refresh_token: string;
        expires_in: number;
      }>(XERO_TOKEN_URL, params.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });

      const { access_token, refresh_token, expires_in } = tokenResponse.data;

      const connectionsResponse = await axios.get<
        Array<{ tenantId: string; tenantType: string }>
      >(XERO_CONNECTIONS_URL, {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      const tenant = connectionsResponse.data[0];

      if (!tenant) {
        console.error(
          "[xero-auth] No tenant found after authorisation. Check your Xero subscription.",
        );
        return;
      }

      const tokens: StoredTokenSet = {
        access_token,
        refresh_token,
        expires_at: Date.now() + expires_in * 1000,
        tenant_id: tenant.tenantId,
      };

      saveTokens(tokens);
      console.error(
        `[xero-auth] Authorisation complete. Tenant ID: ${tokens.tenant_id}`,
      );
    })
    .catch((err) => {
      console.error(`[xero-auth] Background auth flow failed: ${err.message}`);
    })
    .finally(() => {
      pendingAuthUrl = null;
    });

  throw new AuthRequiredError(authUrl);
}

// ── Get a valid token (load → refresh if needed → auth flow if none) ─────────

async function getValidToken(): Promise<StoredTokenSet> {
  let tokens = loadTokens();

  if (!tokens) {
    startAuthFlow(); // throws AuthRequiredError — never returns
  }

  // Proactively refresh if within buffer window
  if (Date.now() >= tokens.expires_at - TOKEN_EXPIRY_BUFFER_MS) {
    console.error("[xero-auth] Access token expiring soon — refreshing...");
    try {
      tokens = await refreshAccessToken(tokens);
    } catch (err) {
      // Refresh token may be expired (e.g. unused for 60 days) — clear
      // stale tokens and start a fresh auth flow so Claude can surface
      // the new OAuth URL instead of a generic error.
      console.error(`[xero-auth] Token refresh failed: ${err instanceof Error ? err.message : err}`);
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

// ── MCP Xero Client ──────────────────────────────────────────────────────────

class MCPXeroClient extends XeroClient {
  public tenantId: string;
  private shortCode: string;

  constructor(config?: IXeroClientConfig) {
    super(config);
    this.tenantId = "";
    this.shortCode = "";
  }

  public async authenticate(): Promise<void> {
    const tokens = await getValidToken();

    this.tenantId = tokens.tenant_id;

    this.setTokenSet({
      access_token: tokens.access_token,
      token_type: "Bearer",
    });
  }

  private async getOrganisation(): Promise<Organisation> {
    await this.authenticate();

    const organisationResponse = await this.accountingApi.getOrganisations(
      this.tenantId || "",
    );

    const organisation = organisationResponse.body.organisations?.[0];

    if (!organisation) {
      throw new Error("Failed to retrieve organisation");
    }

    return organisation;
  }

  public async getShortCode(): Promise<string | undefined> {
    if (!this.shortCode) {
      try {
        const organisation = await this.getOrganisation();
        this.shortCode = organisation.shortCode ?? "";
      } catch (error: unknown) {
        const err = ensureError(error);

        throw new Error(
          `Failed to get Organisation short code: ${err.message}`,
        );
      }
    }
    return this.shortCode;
  }
}

// ── Export singleton ─────────────────────────────────────────────────────────

export const xeroClient = new MCPXeroClient({
  clientId: process.env.XERO_CLIENT_ID || "",
  clientSecret: process.env.XERO_CLIENT_SECRET || "",
  grantType: "authorization_code",
});