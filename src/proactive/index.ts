/**
 * Proactive heartbeat controller.
 * Periodically logs a heartbeat signal — does NOT invoke any LLM.
 */

import { logForDebugging } from "../utils/logger.ts";

let _intervalId: ReturnType<typeof setInterval> | null = null;

const DEFAULT_INTERVAL_MS = parseInt(
  process.env["KAIROS_HEARTBEAT_INTERVAL_MS"] ?? "30000",
  10,
);

/**
 * Start the proactive heartbeat.
 * @param label - Optional label to include in each heartbeat log line
 */
export function activateProactive(label?: string): void {
  if (_intervalId !== null) return;

  const tag = label ? `[${label}] ` : "";
  logForDebugging(
    `[proactive] Heartbeat activated (interval=${DEFAULT_INTERVAL_MS}ms)`,
  );

  _intervalId = setInterval(() => {
    logForDebugging(`${tag}[proactive] heartbeat ${new Date().toISOString()}`);
  }, DEFAULT_INTERVAL_MS);
}

/** Stop the proactive heartbeat. */
export function deactivateProactive(): void {
  if (_intervalId === null) return;
  clearInterval(_intervalId);
  _intervalId = null;
  logForDebugging("[proactive] Heartbeat deactivated");
}

/** Returns true if the heartbeat is currently active. */
export function isProactiveActive(): boolean {
  return _intervalId !== null;
}
