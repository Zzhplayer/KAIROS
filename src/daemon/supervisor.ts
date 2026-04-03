/**
 * Supervisor — the main daemon process.
 * Manages worker children, cron scheduling, IPC polling, and Feishu notifications.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { logForDebugging, logError } from "../utils/logger.ts";
import { loadFeishuConfig, sendFeishuCard } from "../utils/feishuClient.ts";
import { pollTaskResults, type TaskResult } from "./ipc.ts";
import { createCronScheduler } from "./cronScheduler.ts";
import { createDreamScheduler } from "./dreamScheduler.ts";
import {
  activateProactive,
  deactivateProactive,
  onTick,
  offTick,
} from "../proactive/index.ts";
import {
  loadCronTasks,
  saveCronTasks,
  type CronTask,
} from "../utils/cronTasks.ts";
import { computeNextCronRun } from "../utils/cron.ts";

type WorkerEntry = {
  workerId: string;
  proc: ReturnType<typeof spawn>;
  busy: boolean;
};

const FEISHU_NOTIFY_ID = process.env["KAIROS_FEISHU_NOTIFY_ID"] ?? "";
const DEFAULT_WORKER_COUNT = parseInt(
  process.env["KAIROS_WORKER_COUNT"] ?? "2",
  10,
);

function buildFeishuCard(result: TaskResult): object {
  return {
    config: { wide_screen_mode: true },
    elements: [
      {
        tag: "markdown",
        content: result.success
          ? `**KAIROS Task Completed**\nTask: \`${result.taskId}\`\nStatus: Success`
          : `**KAIROS Task Failed**\nTask: \`${result.taskId}\`\nError: ${result.error ?? "Unknown error"}`,
      },
    ],
  };
}

export async function runSupervisor(
  workerCount = DEFAULT_WORKER_COUNT,
): Promise<void> {
  logForDebugging("[supervisor] Starting");

  const feishuAccount = loadFeishuConfig();
  if (!feishuAccount) {
    logForDebugging(
      "[supervisor] No Feishu config found — notifications disabled",
    );
  }

  // --- Worker pool ---
  const workers: WorkerEntry[] = [];
  let workerReadyCount = 0;
  let running = false;

  /**
   * Spawn a single worker and register its event handlers.
   * Returns a promise that resolves when the worker is ready.
   */
  function spawnWorker(): Promise<WorkerEntry> {
    return new Promise((resolve) => {
      const workerScript = fileURLToPath(import.meta.url).replace(
        /[/\\]daemon[/\\]supervisor\.ts$/,
        "/daemon/worker.ts",
      );

      const proc = spawn("bun", [workerScript], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      proc.stdout?.on("data", (chunk: Buffer) => {
        const line = chunk.toString().trim();
        if (line.includes('"type":"ready"')) {
          const match = line.match(/"workerId":"([^"]+)"/);
          const workerId = match?.[1] ?? randomUUID();
          const entry: WorkerEntry = { workerId, proc, busy: false };
          workers.push(entry);
          workerReadyCount++;
          logForDebugging(
            `[supervisor] Worker ready ${workerId.slice(0, 8)} (${workerReadyCount}/${workerCount})`,
          );
          resolve(entry);
        }
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        logError(`[worker] ${chunk.toString().trim()}`);
      });

      proc.on("exit", (code) => {
        logForDebugging(
          `[supervisor] Worker exited code ${code} — removing from pool`,
        );
        // Remove dead worker from pool
        const idx = workers.findIndex((w) => w.proc === proc);
        if (idx !== -1) {
          workers.splice(idx, 1);
          workerReadyCount = Math.max(0, workerReadyCount - 1);
        }
        // Respawn to maintain pool size
        if (running) {
          spawnWorker().catch((err) => {
            logError(`[supervisor] Failed to respawn worker: ${err}`);
          });
        }
      });
    });
  }

  // Spawn initial workers in parallel
  const spawnPromises: Promise<WorkerEntry>[] = [];
  for (let i = 0; i < workerCount; i++) {
    spawnPromises.push(spawnWorker());
  }

  // Wait for all workers to become ready
  running = true;
  await Promise.all(spawnPromises);

  logForDebugging(`[supervisor] All ${workerCount} workers ready`);

  // --- Shared dispatch state ---
  // Tracks tasks recently fired to prevent double-fire between tick and cronScheduler.
  // Updated by BOTH dispatchToWorker (on cronScheduler fire) AND tickEvaluateTasks.
  const recentlyFired = new Map<string, number>(); // taskId → timestamp
  const FIRE_COOLDOWN_MS = 90_000; // 90s — covers cronScheduler jitter window

  // --- Task dispatch ---
  let nextWorkerIndex = 0;

  function dispatchToWorker(task: CronTask): boolean {
    // Check cooldown — skip if recently fired by either tick or cronScheduler
    const lastFired = recentlyFired.get(task.id);
    if (lastFired !== undefined && Date.now() - lastFired < FIRE_COOLDOWN_MS) {
      return false;
    }

    // Find an idle worker
    for (let i = 0; i < workers.length; i++) {
      const idx = (nextWorkerIndex + i) % workers.length;
      const w = workers[idx];
      if (!w.busy) {
        w.busy = true;
        nextWorkerIndex = (idx + 1) % workers.length;
        // Always use a random UUID as the dispatch taskId so each IPC result
        // file is unique and the poller never skips a result due to a stale
        // "seen" entry for the same task.id (e.g. "tick-test" dispatched twice).
        const taskId = randomUUID();

        // Mark as fired immediately to prevent double-dispatch
        recentlyFired.set(task.id, Date.now());

        const msg = JSON.stringify({
          type: "task",
          taskId,
          prompt: task.prompt,
        });
        w.proc.stdin?.write(msg + "\n");

        logForDebugging(
          `[supervisor] Dispatched task ${taskId} to worker ${w.workerId.slice(0, 8)}`,
        );
        return true;
      }
    }

    logForDebugging(
      "[supervisor] All workers busy — task queued (not implemented)",
    );
    return false;
  }

  // --- Dream dispatch ---
  function dispatchDreamToWorker(): void {
    const dreamTaskId = `dream-${Date.now()}`;
    // Find an idle worker
    for (let i = 0; i < workers.length; i++) {
      const idx = (nextWorkerIndex + i) % workers.length;
      const w = workers[idx];
      if (!w.busy) {
        w.busy = true;
        nextWorkerIndex = (idx + 1) % workers.length;
        const msg = JSON.stringify({
          type: "dream:trigger",
          taskId: dreamTaskId,
        });
        w.proc.stdin?.write(msg + "\n");
        logForDebugging(
          `[supervisor] Dispatched dream consolidation to worker ${w.workerId.slice(0, 8)}`,
        );
        return;
      }
    }
    logForDebugging("[supervisor] All workers busy — dream queued");
  }

  // --- Cron scheduler ---
  const scheduler = createCronScheduler({
    onFireTask: dispatchToWorker,
    dir: undefined,
  });

  // --- IPC result poller ---
  const stopPoller = await pollTaskResults(async (result: TaskResult) => {
    logForDebugging(
      `[supervisor] Result received: ${result.taskId} success=${result.success}`,
    );

    // Mark worker idle
    const w = workers.find((wk) => wk.workerId === result.workerId);
    if (w) w.busy = false;

    // Send Feishu notification
    if (feishuAccount && FEISHU_NOTIFY_ID) {
      const card = buildFeishuCard(result);
      const sent = await sendFeishuCard(feishuAccount, FEISHU_NOTIFY_ID, card);
      if (sent) {
        logForDebugging(
          `[supervisor] Feishu notification sent for ${result.taskId}`,
        );
      }
    }
  });

  // --- Proactive heartbeat ---
  activateProactive("supervisor");

  // --- Dream scheduler (24h memory consolidation) ---
  const DREAM_INTERVAL_MS = parseInt(
    process.env["KAIROS_DREAM_INTERVAL_MS"] ?? String(24 * 60 * 60 * 1000),
    10,
  );
  const stopDreamScheduler = createDreamScheduler({
    onDreamFire: dispatchDreamToWorker,
    intervalMs: DREAM_INTERVAL_MS,
  });

  // --- Tick handler: proactive task evaluation every 30s ---
  // dispatchToWorker now handles cooldown internally
  function tickEvaluateTasks(_now: Date): void {
    if (!running) return;

    const tasks = loadCronTasks();
    const now = new Date();

    let fired = 0;
    for (const task of tasks) {
      try {
        // Check if task is due: nextCronRun from current minute <= now
        const currentMinute = new Date(now);
        currentMinute.setSeconds(0, 0);
        const nextRun = computeNextCronRun(task.schedule, currentMinute);
        if (nextRun > currentMinute) continue;

        // Try to dispatch (cooldown checked inside dispatchToWorker)
        if (dispatchToWorker(task)) {
          fired++;

          // Send proactive Feishu notification
          if (feishuAccount && FEISHU_NOTIFY_ID) {
            const card = {
              config: { wide_screen_mode: true },
              elements: [
                {
                  tag: "markdown",
                  content: `**KAIROS Tick — Task Triggered**\nTask: \`${task.id}\`\nPrompt: \`${task.prompt.slice(0, 80)}${task.prompt.length > 80 ? "..." : ""}\`\nSchedule: \`${task.schedule}\`\nStatus: Dispatching to worker...`,
                },
              ],
            };
            sendFeishuCard(feishuAccount, FEISHU_NOTIFY_ID, card).catch(
              () => {},
            );
          }
        }
      } catch {
        // Invalid cron expression — skip
      }
    }

    if (fired > 0) {
      logForDebugging(`[supervisor] Tick fired ${fired} task(s)`);
    }
  }

  // Register tick handler with the proactive module
  onTick(tickEvaluateTasks);

  // --- Start scheduler ---
  scheduler.start();

  // --- Graceful shutdown ---
  const shutdown = async () => {
    logForDebugging("[supervisor] Shutting down");
    running = false;
    offTick();
    deactivateProactive();
    stopDreamScheduler();
    scheduler.stop();
    stopPoller();

    for (const w of workers) {
      w.proc.stdin?.write(JSON.stringify({ type: "shutdown" }) + "\n");
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    for (const w of workers) {
      w.proc.kill();
    }

    logForDebugging("[supervisor] Exit");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  logForDebugging("[supervisor] Supervisor running");
}
