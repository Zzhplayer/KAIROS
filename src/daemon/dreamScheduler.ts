/**
 * Dream Scheduler — fires the memory consolidation cycle every 24 hours.
 * Sends dream:trigger messages to workers via the shared IPC directory.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { logForDebugging } from "../utils/logger.ts";

const IPC_DIR = join(homedir(), ".claude", "debug", "kairos-ipc");
const DREAM_QUEUE_DIR = join(IPC_DIR, "dream");

function ensureDir() {
  mkdirSync(DREAM_QUEUE_DIR, { recursive: true });
}

export interface DreamSchedulerOptions {
  /** Called when dream should be dispatched to a worker. */
  onDreamFire: () => void;
  /** Interval in ms (default 24 hours). */
  intervalMs?: number;
}

/**
 * Start the dream scheduler.
 * Returns a stop function.
 */
export function createDreamScheduler(opts: DreamSchedulerOptions): () => void {
  const { onDreamFire, intervalMs = 24 * 60 * 60 * 1000 } = opts;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function scheduleNext() {
    if (stopped) return;
    timer = setTimeout(() => {
      if (!stopped) {
        logForDebugging("[dreamScheduler] Firing dream consolidation");
        onDreamFire();
        scheduleNext();
      }
    }, intervalMs);
  }

  function start() {
    logForDebugging(
      `[dreamScheduler] Starting (interval: ${intervalMs / 1000 / 60 / 60}h)`,
    );
    scheduleNext();
  }

  function stop() {
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    logForDebugging("[dreamScheduler] Stopped");
  }

  start();
  return stop;
}
