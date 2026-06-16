/**
 * xpm-client.ts
 * Thin HTTP wrapper around the Xero Practice Manager REST API.
 * Automatically injects the Bearer token and xero-tenant-id header,
 * and proactively refreshes the token before each request if needed.
 */

import axios, { type AxiosRequestConfig } from 'axios';
import { XPM_BASE_URL, RATE_LIMIT_DELAY_MS } from '../constants.js';
import { getValidToken, clearTokensAndReauth } from './auth.js';

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
      'Content-Type':   'application/json',
      Accept:           'application/json',
    },
    params:  cleanParams,
    data:    body,
    timeout: 30_000,
  };

  try {
    // Small delay to avoid hammering rate limits
    await delay(RATE_LIMIT_DELAY_MS);
    const response = await axios.request<T>(config);
    return response.data;
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      const status  = err.response?.status;
      const message = (err.response?.data as { Message?: string })?.Message ?? err.message;

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

export const xpmPost = <T>(path: string, body: unknown): Promise<T> =>
  xpmRequest<T>('POST', path, undefined, body);

export const xpmPut = <T>(path: string, body: unknown): Promise<T> =>
  xpmRequest<T>('PUT', path, undefined, body);

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
