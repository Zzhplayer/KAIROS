import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const workerScript = fileURLToPath(import.meta.url)
  .replace(/[/\\]daemon[/\\]supervisor\.ts$/, "/daemon/worker.ts")
  .replace("/scripts/dispatch-test.ts", "/src/daemon/worker.ts");

console.log("Worker script:", workerScript);

const proc = spawn("bun", [workerScript], {
  stdio: ["pipe", "pipe", "pipe"],
});

proc.stdout?.on("data", (chunk: Buffer) => {
  console.log("[worker stdout]:", chunk.toString().trim());
});

proc.stderr?.on("data", (chunk: Buffer) => {
  console.log("[worker stderr]:", chunk.toString().trim());
});

proc.on("exit", (code: number | null) => {
  console.log("[worker exit] code:", code);
});

// Wait for ready
await new Promise((r) => setTimeout(r, 1000));

// Send a task
const taskId = randomUUID();
const msg =
  JSON.stringify({ type: "task", taskId, prompt: "echo HELLO_FROM_WORKER" }) +
  "\n";
console.log("[supervisor] sending:", msg.trim());
proc.stdin?.write(msg);

// Wait for result (30s for claude -p to respond)
await new Promise((r) => setTimeout(r, 30000));
console.log("done");
