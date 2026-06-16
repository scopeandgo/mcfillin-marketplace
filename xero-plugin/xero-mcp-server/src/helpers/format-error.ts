import { AxiosError } from "axios";
import { clearTokensAndReauth } from "../clients/xero-client.js";

/**
 * Format error messages in a user-friendly way.
 *
 * NOTE: For 401 errors, this function throws AuthRequiredError (via
 * clearTokensAndReauth) instead of returning a string. This allows the
 * new OAuth URL to surface through the MCP error path so Claude can
 * present it to the user, rather than returning a dead-end message.
 */
export function formatError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    const detail = error.response?.data?.Detail;

    switch (status) {
      case 401:
        // Token was stale — clear it and start a fresh OAuth flow so
        // Claude can surface the new auth URL.
        clearTokensAndReauth();
      case 403:
        return "You don't have permission to access this resource in Xero.";
      case 404:
        return "The requested resource was not found in Xero.";
      case 429:
        return "Too many requests to Xero. Please try again in a moment.";
      default:
        return detail || "An error occurred while communicating with Xero.";
    }
  }
  return error instanceof Error
    ? error.message
    : `An unexpected error occurred: ${error}`;
}
