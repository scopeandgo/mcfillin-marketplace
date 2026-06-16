#!/usr/bin/env node
/**
 * xero-start.js
 * Cross-platform launcher for the Xero MCP server.
 * Attempts to fetch credentials from the OS credential store. If credentials
 * are not found, the server still starts — auth errors surface via tool responses.
 *
 * Windows : Windows Credential Manager (CredentialManager module)
 * macOS   : macOS Keychain (security CLI)
 *
 * Credentials must be pre-provisioned by a system administrator.
 * Windows target names : XERO_CLIENT_ID, XERO_CLIENT_SECRET
 * macOS service name: xero  (accounts: XERO_CLIENT_ID, XERO_CLIENT_SECRET)
 */

'use strict';

const { execSync } = require('child_process');
const { spawn }    = require('child_process');
const path         = require('path');

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
    console.error(`[xero-plugin] Could not retrieve "${key}" from credential store: ${err.message}`);
    return null;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

if (process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET) {
  console.error('[xero-plugin] Credentials found in environment.');
} else {
  console.error('[xero-plugin] Loading credentials from OS credential store...');
  const clientId     = getSecret('XERO_CLIENT_ID');
  const clientSecret = getSecret('XERO_CLIENT_SECRET');

  if (clientId && clientSecret) {
    process.env.XERO_CLIENT_ID     = clientId;
    process.env.XERO_CLIENT_SECRET = clientSecret;
    console.error('[xero-plugin] Credentials loaded.');
  } else {
    console.error('[xero-plugin] Credentials not found — server will start but auth errors will surface via tool responses.');
  }
}

console.error('[xero-plugin] Starting Xero MCP server...');

const serverDir = path.resolve(__dirname, '..', 'xero-mcp-server');
const server = spawn(
  process.execPath,
  [path.join(serverDir, 'dist', 'index.js')],
  {
    stdio: 'inherit',
    env:   process.env,
    cwd:   serverDir
  }
);

server.on('error', (err) => {
  console.error(`[xero-plugin] Failed to start MCP server: ${err.message}`);
  process.exit(1);
});

server.on('exit', (code) => {
  process.exit(code ?? 0);
});
