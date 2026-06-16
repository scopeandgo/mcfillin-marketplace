import fs from "fs";
import { AUDIT_LOG_DIR, AUDIT_LOG_FILE, OS_USERNAME } from "./constants.js";
import { rotateIfNeeded } from "./log-rotation.js";

export interface AuditLogEntry {
  timestamp: string;
  level: "ACCESS";
  user: string;
  pid: number;
  tool: string;
  event: string;
  params: unknown;
  result_summary: string;
  is_error: boolean;
  status: "success" | "failure";
  duration_ms: number;
}

/**
 * Audit logger that writes every tool call to a machine-wide NDJSON log file.
 *
 * Log location:
 * - Mac: /Library/Application Support/ClaudeMCP/xero-mcp/audit.log
 * - Windows: C:\ProgramData\ClaudeMCP\xero-mcp\audit.log
 */
class AuditLoggerImpl {
  private ready = false;

  /**
   * Ensure the audit log directory exists.
   * This may require elevated permissions — the directory should be
   * pre-created by an administrator during installation.
   */
  ensureLogDirectory(): void {
    try {
      if (!fs.existsSync(AUDIT_LOG_DIR)) {
        fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true });
      }
      this.ready = true;
    } catch (err) {
      const error = err as Error;
      console.error(
        `[mcfillin-xero] Warning: Cannot create audit log directory "${AUDIT_LOG_DIR}": ${error.message}`,
      );
      console.error(
        `[mcfillin-xero] Ensure the directory has been created by your system administrator with appropriate write permissions.`,
      );
    }
  }

  /**
   * Log a tool call and its result to the audit log.
   */
  logToolCall(
    toolName: string,
    params: unknown,
    resultSummary: string,
    isError: boolean,
    durationMs: number,
  ): void {
    if (!this.ready) return;

    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      level: "ACCESS",
      user: OS_USERNAME,
      pid: process.pid,
      tool: toolName,
      event: `Tool call: ${toolName}`,
      params,
      result_summary: resultSummary,
      is_error: isError,
      status: isError ? "failure" : "success",
      duration_ms: durationMs,
    };

    const line = JSON.stringify(entry) + "\n";

    try {
      rotateIfNeeded(AUDIT_LOG_FILE);
      fs.appendFileSync(AUDIT_LOG_FILE, line, { encoding: "utf8" });
    } catch (err) {
      const error = err as Error;
      console.error(
        `[mcfillin-xero] Warning: Failed to write audit log: ${error.message}`,
      );
    }
  }
}

/** Singleton audit logger instance. */
export const auditLogger = new AuditLoggerImpl();