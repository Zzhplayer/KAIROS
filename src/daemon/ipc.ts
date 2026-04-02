/**
 * File-based IPC between Supervisor and Workers.
 * Workers write NDJSON result files; Supervisor polls them.
 */

import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const IPC_DIR = join(homedir(), ".claude", "debug", "kairos-ipc");

function ensureIpcDir() {
  mkdirSync(IPC_DIR, { recursive: true });
}

function resultPath(taskId: string): string {
  return join(IPC_DIR, `result-${taskId}.ndjson`);
}

function pendingDir() {
  return join(IPC_DIR, "pending");
}

/** A result written by a worker after completing a task. */
export interface TaskResult {
  taskId: string;
  workerId: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Worker-side: write a TaskResult to disk.
 * The file name encodes the taskId so the supervisor can retrieve it.
 */
export function writeTaskResult(result: TaskResult): void {
  ensureIpcDir();
  const path = resultPath(result.taskId);
  appendFileSync(path, JSON.stringify(result) + "\n", "utf-8");
}

/**
 * Mark a task as pending so the supervisor knows it is in-flight.
 */
export function markTaskPending(taskId: string): void {
  ensureIpcDir();
  const pending = join(pendingDir(), `pending-${taskId}.json`);
  mkdirSync(pendingDir(), { recursive: true });
  writeFileSync(pending, JSON.stringify({ taskId, ts: Date.now() }), "utf-8");
}

/**
 * Remove the pending marker for a completed task.
 */
export function clearTaskPending(taskId: string): void {
  try {
    const pending = join(pendingDir(), `pending-${taskId}.json`);
    unlinkSync(pending);
  } catch {
    // ignore
  }
}

/**
 * Supervisor-side: poll for new task results.
 * Calls `onResult` for each new result file discovered.
 * Returns a stop function — call it to terminate the poller.
 */
export async function pollTaskResults(
  onResult: (result: TaskResult) => void,
  intervalMs = 500,
): Promise<() => void> {
  const seen = new Set<string>();
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      if (!existsSync(IPC_DIR)) return;
      const files = readdirSync(IPC_DIR);
      for (const file of files) {
        if (!file.startsWith("result-") || !file.endsWith(".ndjson")) continue;
        const taskId = file.replace(/^result-/, "").replace(/\.ndjson$/, "");
        if (seen.has(taskId)) continue;
        seen.add(taskId);

        const path = join(IPC_DIR, file);
        const raw = readFileSync(path, "utf-8");
        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const result = JSON.parse(trimmed) as TaskResult;
            onResult(result);
          } catch {
            // skip malformed lines
          }
        }
        // Clean up result file after all lines are processed
        try {
          unlinkSync(path);
        } catch {
          // File may already be deleted; ignore
        }
      }
    } catch {
      // ignore poll errors
    }
  };

  // Use self-rescheduling async loop instead of setInterval with async callback.
  // Bun's setInterval does not reliably execute async callbacks — the interval
  // fires but the async tick() is not awaited, causing poll stalls. A explicit
  // setTimeout chain ensures each tick completes before the next is scheduled.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const scheduleNext = () => {
    if (stopped) return;
    timer = setTimeout(async () => {
      await tick();
      scheduleNext();
    }, intervalMs);
  };

  // Run once immediately on start
  await tick();
  scheduleNext();

  return () => {
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
