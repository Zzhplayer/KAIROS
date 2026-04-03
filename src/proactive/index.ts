/**
 * Proactive heartbeat controller + tick mechanism.
 *
 * The tick mechanism fires every TICK_INTERVAL_MS (default 30s) and calls
 * the registered onTick callback. This allows the supervisor to evaluate
 * scheduled tasks proactively — not just at cron minute boundaries — and
 * send proactive Feishu notifications before tasks execute.
 *
 * Architecture:
 *   - Heartbeat: logs a heartbeat line every HEARTBEAT_INTERVAL_MS (30s)
 *   - Tick: fires every TICK_INTERVAL_MS, calls onTick(toNow()) to check tasks
 *
 * Both share the same interval timer internally — the tick is a more
 * informative heartbeat that carries a timestamp for task evaluation.
 */

import { logForDebugging } from "../utils/logger.ts";

let _heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let _tickCallback: ((now: Date) => void) | null = null;
let _isActive = false;

const DEFAULT_HEARTBEAT_INTERVAL_MS = parseInt(
  process.env["KAIROS_HEARTBEAT_INTERVAL_MS"] ?? "30000",
  10,
);
const DEFAULT_TICK_INTERVAL_MS = parseInt(
  process.env["KAIROS_TICK_INTERVAL_MS"] ?? "30000",
  10,
);

/**
 * Register a tick callback. Called every TICK_INTERVAL_MS with the current time.
 * @param cb - Function to call on each tick with the current Date
 */
export function onTick(cb: (now: Date) => void): void {
  _tickCallback = cb;
}

/** Stop receiving tick callbacks. */
export function offTick(): void {
  _tickCallback = null;
}

/**
 * Activate the proactive heartbeat + tick mechanism.
 * Starts the interval that fires both heartbeat logs and tick callbacks.
 *
 * @param label - Optional label included in each heartbeat log line
 */
export function activateProactive(label?: string): void {
  if (_isActive) return;
  _isActive = true;

  logForDebugging(
    `[proactive] Activated (heartbeat=${DEFAULT_HEARTBEAT_INTERVAL_MS}ms, tick=${DEFAULT_TICK_INTERVAL_MS}ms)`,
  );

  // Single timer handles both heartbeat and tick
  _heartbeatInterval = setInterval(() => {
    const now = new Date();
    const ts = now.toISOString();

    // Always log heartbeat
    logForDebugging(`[proactive] heartbeat ${ts}`);

    // Fire tick callback if registered
    if (_tickCallback) {
      try {
        _tickCallback(now);
      } catch (err) {
        logForDebugging(`[proactive] tick callback error: ${String(err)}`);
      }
    }
  }, DEFAULT_TICK_INTERVAL_MS);

  // Don't keep process alive purely for heartbeats
  _heartbeatInterval.unref?.();
}

/** Deactivate the heartbeat and tick mechanism. */
export function deactivateProactive(): void {
  if (!_isActive) return;

  logForDebugging("[proactive] Deactivated");

  if (_heartbeatInterval !== null) {
    clearInterval(_heartbeatInterval);
    _heartbeatInterval = null;
  }

  _tickCallback = null;
  _isActive = false;
}

/** Returns true if the proactive mechanism is currently active. */
export function isProactiveActive(): boolean {
  return _isActive;
}
