import path from "path";
import os from "os";

export const OS_USERNAME = os.userInfo().username;

const APP_NAME = "ClaudeMCP";
const MCP_NAME = "xero-mcp";

function getAuditLogDir(): string {
  switch (process.platform) {
    case "darwin":
      return path.join("/Library/Application Support", APP_NAME, MCP_NAME);
    case "win32":
      return path.join(
        process.env["LOCALAPPDATA"] ?? path.join(os.homedir(), "AppData", "Local"),
        APP_NAME,
        MCP_NAME,
      );
    default:
      return path.join("/var/log", APP_NAME, MCP_NAME);
  }
}

export const AUDIT_LOG_DIR = getAuditLogDir();
export const AUDIT_LOG_FILE = path.join(AUDIT_LOG_DIR, "audit.log");

/** Maximum audit log size before rotation (10 MB). */
export const MAX_LOG_SIZE_BYTES = 10 * 1024 * 1024;

/** Number of rotated log files to keep. */
export const MAX_ROTATED_FILES = 5;