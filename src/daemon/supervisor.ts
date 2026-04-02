/**
 * Supervisor — the main daemon process.
 * Manages worker children, cron scheduling, IPC polling, and Feishu notifications.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { logForDebugging, logError } from "../utils/logger.ts";
import { loadFeishuConfig, sendFeishuCard } from "../utils/feishuClient.ts";
import { pollTaskResults, type TaskResult } from "./ipc.ts";
import { createCronScheduler } from "./cronScheduler.ts";
import { activateProactive, deactivateProactive } from "../proactive/index.ts";
import type { CronTask } from "../utils/cronTasks.ts";

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

  for (let i = 0; i < workerCount; i++) {
    const proc = spawn(
      "bun",
      [
        import.meta.path.replace(
          /[/\\]daemon[/\\]supervisor\.ts$/,
          "/daemon/worker.ts",
        ),
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let ready = false;

    proc.stdout?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (!ready && line.includes('"type":"ready"')) {
        const match = line.match(/"workerId":"([^"]+)"/);
        const workerId = match?.[1] ?? randomUUID();
        workers.push({ workerId, proc, busy: false });
        workerReadyCount++;
        logForDebugging(
          `[supervisor] Worker ${i} ready (${workerReadyCount}/${workerCount})`,
        );
        ready = true;
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      logError(`[worker ${i}] ${chunk.toString().trim()}`);
    });

    proc.on("exit", (code) => {
      logForDebugging(`[supervisor] Worker ${i} exited with code ${code}`);
    });
  }

  // Wait for all workers to become ready
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (workerReadyCount >= workerCount) {
        clearInterval(check);
        resolve();
      }
    }, 100);
  });

  logForDebugging(`[supervisor] All ${workerCount} workers ready`);

  // --- Task dispatch ---
  let nextWorkerIndex = 0;

  function dispatchToWorker(task: CronTask): void {
    // Find an idle worker
    let found = false;
    for (let i = 0; i < workers.length; i++) {
      const idx = (nextWorkerIndex + i) % workers.length;
      const w = workers[idx];
      if (!w.busy) {
        w.busy = true;
        nextWorkerIndex = (idx + 1) % workers.length;
        const taskId = task.id ?? randomUUID();

        const msg = JSON.stringify({
          type: "task",
          taskId,
          prompt: task.prompt,
        });
        w.proc.stdin?.write(msg + "\n");

        logForDebugging(
          `[supervisor] Dispatched task ${taskId} to worker ${w.workerId.slice(0, 8)}`,
        );
        found = true;
        break;
      }
    }

    if (!found) {
      logForDebugging(
        "[supervisor] All workers busy — task queued (not implemented)",
      );
    }
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

  // --- Start scheduler ---
  scheduler.start();

  // --- Graceful shutdown ---
  const shutdown = async () => {
    logForDebugging("[supervisor] Shutting down");
    deactivateProactive();
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
