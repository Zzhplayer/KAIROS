/**
 * Worker process — spawned by Supervisor, receives tasks via stdin.
 * Supports three message types:
 *   { type: "task", taskId, prompt }
 *   { type: "dream:trigger", taskId }
 *   { type: "shutdown" }
 * Results are written to disk; "ready" is printed to stdout on startup.
 */

import { writeTaskResult, markTaskPending, clearTaskPending } from "./ipc.ts";
import { executeAutoDream } from "../services/autoDream/autoDream.ts";
import { logForDebugging, logError } from "../utils/logger.ts";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

type InboundMessage =
  | { type: "task"; taskId: string; prompt: string }
  | { type: "dream:trigger"; taskId: string }
  | { type: "shutdown" };

const WORKER_ID = randomUUID();

// Run worker immediately when this module is loaded
runWorker().catch((err) => {
  logError(`[worker] fatal error: ${err}`);
  process.exit(1);
});

async function runClaudePrompt(
  prompt: string,
): Promise<{ data?: unknown; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      "bun",
      ["run", "claude", "-p", "--dangerously-skip-permissions", prompt],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ data: stdout.trim() });
      } else {
        resolve({ error: stderr || `claude exited with code ${code}` });
      }
    });

    child.on("error", (err) => {
      resolve({ error: String(err) });
    });
  });
}

function handleMessage(msg: InboundMessage): void {
  switch (msg.type) {
    case "task": {
      const { taskId, prompt } = msg;
      logForDebugging(
        `[worker ${WORKER_ID.slice(0, 8)}] task ${taskId} started`,
      );
      markTaskPending(taskId);

      runClaudePrompt(prompt).then(({ data, error }) => {
        clearTaskPending(taskId);
        writeTaskResult({
          taskId,
          workerId: WORKER_ID,
          success: !error,
          data,
          error,
        });
        logForDebugging(
          `[worker ${WORKER_ID.slice(0, 8)}] task ${taskId} done (success=${!error})`,
        );
      });
      break;
    }

    case "dream:trigger": {
      const { taskId } = msg;
      logForDebugging(
        `[worker ${WORKER_ID.slice(0, 8)}] dream:trigger ${taskId}`,
      );
      executeAutoDream()
        .then(() => {
          writeTaskResult({
            taskId,
            workerId: WORKER_ID,
            success: true,
          });
        })
        .catch((err) => {
          writeTaskResult({
            taskId,
            workerId: WORKER_ID,
            success: false,
            error: String(err),
          });
        });
      break;
    }

    case "shutdown": {
      logForDebugging(`[worker ${WORKER_ID.slice(0, 8)}] shutdown`);
      process.exit(0);
    }

    default: {
      logError(`[worker ${WORKER_ID.slice(0, 8)}] unknown message type`);
    }
  }
}

/** Main entry point — sets up stdin line reader and waits for messages. */
export async function runWorker(
  _workerKind: "main" | "dream" = "main",
): Promise<void> {
  logForDebugging(`[worker ${WORKER_ID.slice(0, 8)}] ready`);

  // Signal ready to supervisor (stdout is used for control messages)
  console.log(JSON.stringify({ type: "ready", workerId: WORKER_ID }));

  // Line-by-line NDJSON reader on stdin
  let buffer = "";

  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as InboundMessage;
        handleMessage(msg);
      } catch (err) {
        logError(`[worker] failed to parse stdin: ${String(err)}`);
      }
    }
  });

  process.stdin.on("end", () => {
    logForDebugging(`[worker ${WORKER_ID.slice(0, 8)}] stdin closed`);
  });
}
