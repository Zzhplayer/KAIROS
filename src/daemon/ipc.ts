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
  statSync,
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
 * Deletes result file and pending marker after processing each result.
 * Returns a stop function — call it to terminate the poller.
 */
export async function pollTaskResults(
  onResult: (result: TaskResult) => void,
  intervalMs = 500,
): Promise<() => void> {
  const seen = new Set<string>();
  let stopped = false;

  // Clean stale pending markers older than 1 hour (crash recovery)
  function cleanStalePending() {
    try {
      if (!existsSync(pendingDir())) return;
      const pendingFiles = readdirSync(pendingDir());
      const staleMs = 60 * 60 * 1000;
      const now = Date.now();
      for (const file of pendingFiles) {
        if (!file.startsWith("pending-") || !file.endsWith(".json")) continue;
        const filePath = join(pendingDir(), file);
        try {
          const mtimeMs = statSync(filePath).mtimeMs;
          if (now - mtimeMs > staleMs) {
            unlinkSync(filePath);
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  const tick = async () => {
    if (stopped) return;
    try {
      if (!existsSync(IPC_DIR)) return;

      // Clean stale pending files every tick
      cleanStalePending();

      const files = readdirSync(IPC_DIR);
      for (const file of files) {
        if (!file.startsWith("result-") || !file.endsWith(".ndjson")) continue;
        const taskId = file.replace(/^result-/, "").replace(/\.ndjson$/, "");
        if (seen.has(taskId)) continue;
        seen.add(taskId);

        const path = join(IPC_DIR, file);
        let raw = "";
        try {
          raw = readFileSync(path, "utf-8");
        } catch {
          // File may have been deleted since readdir
          seen.delete(taskId);
          continue;
        }

        let hasContent = false;
        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const result = JSON.parse(trimmed) as TaskResult;
            onResult(result);
            hasContent = true;
          } catch {
            // skip malformed lines
          }
        }

        // Delete result file after processing so it doesn't pile up
        if (hasContent) {
          try {
            unlinkSync(path);
          } catch {
            // ignore if already gone
          }
        }
      }
    } catch {
      // ignore poll errors
    }
  };

  const id = setInterval(tick, intervalMs);
  // Run once immediately on start
  await tick();

  return () => {
    stopped = true;
    clearInterval(id);
  };
}
