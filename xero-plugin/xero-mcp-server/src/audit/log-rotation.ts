import fs from "fs";
import { MAX_LOG_SIZE_BYTES, MAX_ROTATED_FILES } from "./constants.js";

/**
 * Rotate the log file if it exceeds MAX_LOG_SIZE_BYTES.
 *
 * Rotation scheme: audit.log → audit.log.1 → audit.log.2 → … → audit.log.N
 * The oldest file beyond MAX_ROTATED_FILES is deleted.
 */
export function rotateIfNeeded(logPath: string): void {
  try {
    if (!fs.existsSync(logPath)) return;

    const stats = fs.statSync(logPath);
    if (stats.size < MAX_LOG_SIZE_BYTES) return;

    // Shift existing rotated files
    for (let i = MAX_ROTATED_FILES; i >= 1; i--) {
      const older = `${logPath}.${i}`;
      if (i === MAX_ROTATED_FILES && fs.existsSync(older)) {
        fs.unlinkSync(older);
      }
      const newer = i === 1 ? logPath : `${logPath}.${i - 1}`;
      if (fs.existsSync(newer)) {
        fs.renameSync(newer, older);
      }
    }
  } catch {
    // Rotation failure should not break the server
  }
}