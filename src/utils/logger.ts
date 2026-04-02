/**
 * Logger utility — writes to ~/.claude/debug/kairos.log
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const LOG_DIR = join(homedir(), ".claude", "debug");
const LOG_FILE = join(LOG_DIR, "kairos.log");

function ensureLogDir() {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

function write(level: string, msg: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}\n`;
  ensureLogDir();
  try {
    appendFileSync(LOG_FILE, line, "utf-8");
  } catch {
    // ignore write errors
  }
}

/**
 * Info-level log for general debugging output.
 */
export function logForDebugging(msg: string): void {
  write("INFO", msg);
}

/**
 * Error-level log for errors and exceptions.
 */
export function logError(msg: string): void {
  write("ERROR", msg);
}
