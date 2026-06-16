#!/usr/bin/env node
/**
 * xpm-start.js
 * Cross-platform launcher for the XPM MCP server.
 * Loads OAuth client credentials from the OS credential store, then starts the
 * MCP server *in-process*. Running in-process (rather than spawning a child)
 * means this script works as a direct stdio target for Claude Desktop, the MCP
 * Inspector, or any MCP client — the server inherits this process's stdin/stdout.
 *
 * XPM shares the same Xero OAuth2 app credentials as the Xero plugin, so it
 * reads the identical credential-store entries and XERO_CLIENT_ID/SECRET env vars.
 *
 * If credentials are not found, the server still starts — auth errors surface
 * via tool responses.
 *
 * Windows : Windows Credential Manager (CredentialManager module)
 *           Target names: XERO_CLIENT_ID, XERO_CLIENT_SECRET
 * macOS   : macOS Keychain (security CLI)
 *           Service name: xero  (accounts: XERO_CLIENT_ID, XERO_CLIENT_SECRET)
 *
 * Credentials must be pre-provisioned by a system administrator.
 */

'use strict';

const { execSync }      = require('child_process');
const path              = require('path');
const { pathToFileURL } = require('url');

// ─── Credential fetch ────────────────────────────────────────────────────────

function getSecret(key) {
  try {
    if (process.platform === 'win32') {
      return execSync(
        `powershell -NonInteractive -Command "$cred = Get-StoredCredential -Target '${key}'; [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($cred.Password))"`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();

    } else if (process.platform === 'darwin') {
      return execSync(
        `security find-generic-password -a xero -s ${key} -w`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();

    } else {
      return null;
    }
  } catch (err) {
    console.error(`[xpm-launcher] Could not retrieve "${key}" from credential store: ${err.message}`);
    return null;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

if (process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET) {
  console.error('[xpm-launcher] Credentials found in environment.');
} else {
  console.error('[xpm-launcher] Loading credentials from OS credential store...');

  const clientId     = getSecret('XERO_CLIENT_ID');
  const clientSecret = getSecret('XERO_CLIENT_SECRET');

  if (clientId && clientSecret) {
    process.env.XERO_CLIENT_ID     = clientId;
    process.env.XERO_CLIENT_SECRET = clientSecret;
    console.error('[xpm-launcher] Credentials loaded.');
  } else {
    console.error('[xpm-launcher] Credentials not found — server will start but auth errors will surface via tool responses.');
  }
}

console.error('[xpm-launcher] Starting XPM MCP server...');

// Run the (ESM) server in this same process. Dynamic import() works from a
// CommonJS module; pathToFileURL keeps it correct on Windows (C:\… paths).
const serverEntry = path.resolve(__dirname, '..', 'dist', 'index.js');

import(pathToFileURL(serverEntry).href).catch((err) => {
  console.error(`[xpm-launcher] Failed to start MCP server: ${err.message}`);
  process.exit(1);
});