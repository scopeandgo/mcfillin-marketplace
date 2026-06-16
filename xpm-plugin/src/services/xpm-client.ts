/**
 * xpm-client.ts
 * Thin HTTP wrapper around the Xero Practice Manager REST API.
 * Automatically injects the Bearer token and xero-tenant-id header,
 * and proactively refreshes the token before each request if needed.
 *
 * NOTE: The XPM API ALWAYS responds with XML (content-type text/xml),
 * regardless of the Accept header. Responses are wrapped in a <Response>
 * envelope, e.g.:
 *   <Response>
 *     <Status>OK</Status>
 *     <Clients><Client><UUID/><Name/>…</Client>…</Clients>
 *   </Response>
 * parseXpmXml() converts this into the JSON shape the tools expect:
 *   { Clients: [ { UUID, Name, … }, … ] }
 */

import axios, { type AxiosRequestConfig } from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { XPM_BASE_URL, RATE_LIMIT_DELAY_MS } from '../constants.js';
import { getValidToken, clearTokensAndReauth } from './auth.js';

// ── XML parsing ───────────────────────────────────────────────────────────────

// parseTagValue:false keeps every value a string — this prevents fast-xml-parser
// from mangling phone numbers, ABNs, and other digit strings with leading zeros
// into numbers. Values are only ever displayed, so strings are fine.
const xmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue:    false,
  trimValues:       true,
});

/**
 * Parse an XPM XML response into the JSON shape the tools expect.
 *
 * Unwraps the <Response> envelope and collapses each WorkflowMax-style
 * collection wrapper (e.g. <Clients><Client/>…</Clients>) into a plain array
 * (`Clients: [...]`). Single-resource elements (e.g. a <Client> from a `get`)
 * are left as objects so `data.Client` still works.
 *
 * Throws if the envelope reports a non-OK <Status>.
 */
export function parseXpmXml(raw: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'string') return {};

  const parsed = xmlParser.parse(raw) as Record<string, unknown>;
  const root = (parsed?.Response ?? parsed) as Record<string, unknown>;

  const status = root?.Status;
  if (typeof status === 'string' && status.toUpperCase() !== 'OK') {
    const desc =
      (root?.ErrorDescription as string) ??
      (root?.Error as string) ??
      'Unknown XPM API error';
    throw new Error(`XPM API returned status "${status}": ${desc}`);
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(root)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const innerKeys = Object.keys(val as object);
      // A collection wrapper has a single child tag type (e.g. Clients > Client),
      // or is empty (no results). A single resource has many fields — leave it.
      if (innerKeys.length === 0) {
        out[key] = [];
        continue;
      }
      if (innerKeys.length === 1) {
        const inner = (val as Record<string, unknown>)[innerKeys[0]];
        out[key] = Array.isArray(inner) ? inner : [inner];
        continue;
      }
    }
    out[key] = val;
  }
  return out;
}

// ── Core request function ─────────────────────────────────────────────────────

export async function xpmRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path:   string,
  params?: Record<string, string | number | boolean | undefined>,
  body?:  unknown
): Promise<T> {
  const tokens = await getValidToken();

  // Strip undefined params
  const cleanParams = params
    ? Object.fromEntries(
        Object.entries(params).filter(([, v]) => v !== undefined)
      )
    : undefined;

  const config: AxiosRequestConfig = {
    method,
    url: `${XPM_BASE_URL}/${path}`,
    headers: {
      Authorization:    `Bearer ${tokens.access_token}`,
      'xero-tenant-id': tokens.tenant_id,
      Accept:           'application/xml',
    },
    params:  cleanParams,
    data:    body,
    timeout: 30_000,
    // XPM always returns XML — keep the raw string so we can parse it ourselves.
    responseType:      'text',
    transformResponse: [(d) => d],
  };

  try {
    // Small delay to avoid hammering rate limits
    await delay(RATE_LIMIT_DELAY_MS);
    const response = await axios.request<string>(config);
    return parseXpmXml(response.data) as T;
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      const status   = err.response?.status;
      const rawBody  = typeof err.response?.data === 'string' ? err.response.data : '';
      // XPM error bodies are XML too — try to surface the description.
      let message = err.message;
      try {
        const parsed = xmlParser.parse(rawBody) as { Response?: { ErrorDescription?: string } };
        message = parsed?.Response?.ErrorDescription ?? message;
      } catch { /* fall back to err.message */ }

      if (status === 401) {
        // Token was stale despite passing the expiry check — clear it and
        // start a fresh OAuth flow so Claude can surface the new auth URL.
        clearTokensAndReauth();
      }
      if (status === 403) {
        throw new Error(
          `XPM authorisation error (403): ${message}. ` +
          `Ensure the user has "Authorise 3rd Party Full Access" enabled in XPM Staff Settings.`
        );
      }
      if (status === 429) {
        throw new Error('XPM rate limit exceeded (429). Wait 60 seconds and try again.');
      }
      throw new Error(`XPM API error ${status ?? 'unknown'}: ${message}`);
    }
    throw err;
  }
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

export const xpmGet = <T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): Promise<T> => xpmRequest<T>('GET', path, params);

// ── Helpers ───────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Truncate a JSON string if it exceeds CHARACTER_LIMIT.
 * Appends a note so the model knows the response was cut.
 */
export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const truncated = text.slice(0, limit);
  return (
    truncated +
    `\n\n... [Response truncated at ${limit} characters. Use pagination ` +
    `(page/pageSize params) to fetch specific subsets of data.]`
  );
}