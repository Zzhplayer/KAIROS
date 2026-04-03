/**
 * CLI entry point for KAIROS.
 *
 * Usage:
 *   bun run src/entrypoints/cli.tsx --help           # Show this help
 *   KAIROS_ENABLED=true bun run src/entrypoints/cli.tsx --assistant  # Run supervisor daemon
 *   bun run src/entrypoints/cli.tsx webhook          # Run webhook server
 *
 * @module kairos/entrypoints/cli
 */

import { runSupervisor } from "../daemon/supervisor.ts";
import { startWebhookServer } from "../daemon/webhookServer.ts";
import { cronToHuman } from "../utils/cron.ts";
import { loadCronTasks } from "../utils/cronTasks.ts";
import { logForDebugging } from "../utils/logger.ts";

// Minimal help text — avoids external deps
function printHelp() {
  console.log(
    `
KAIROS — 主动式 Agent 框架

用法:
  kairos --help                  显示此帮助
  kairos --assistant             以 daemon 模式运行（需 KAIROS_ENABLED=true）
  kairos webhook                 运行 GitHub Webhook 服务器

环境变量:
  KAIROS_ENABLED                 设为 true 启用 daemon 模式
  KAIROS_FEISHU_NOTIFY_ID        飞书通知目标 ID（oc_xxx 或 ou_xxx）
  KAIROS_WORKER_COUNT            Worker 进程数量（默认 2）
  KAIROS_HEARTBEAT_INTERVAL_MS   心跳间隔（默认 30000ms）
  KAIROS_CRON_JITTER_MS          Cron 抖动上限（默认 60000ms）
  KAIROS_GITHUB_WEBHOOK_SECRET   GitHub Webhook HMAC 密钥
  KAIROS_GITHUB_APP_INSTALLATION_ID  当前安装 ID（用于自循环防护）

守护进程模式:
  ~/.claude/scheduled_tasks.json  — 定时任务配置
  ~/.claude/debug/kairos.log      — 日志文件

Webhook 模式:
  监听 POST /github/webhook，支持:
    pull_request, pull_request_review,
    pull_request_review_comment, issue_comment
`.trim(),
  );
}

// Show current schedule summary
function printSchedule() {
  const tasks = loadCronTasks();
  if (tasks.length === 0) {
    console.log("  (no scheduled tasks)");
    return;
  }
  for (const task of tasks) {
    const human = cronToHuman(task.schedule);
    console.log(
      `  - ${task.id}: ${human} — ${task.prompt.slice(0, 60)}${task.prompt.length > 60 ? "..." : ""}`,
    );
  }
}

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (args.includes("webhook")) {
  // Standalone webhook server
  const port = parseInt(process.env["KAIROS_WEBHOOK_PORT"] ?? "3001", 10);
  logForDebugging(`[cli] Starting webhook server on port ${port}`);
  const { stop } = startWebhookServer(port);
  process.on("SIGINT", () => {
    stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stop();
    process.exit(0);
  });
}

if (process.env["KAIROS_ENABLED"] === "true") {
  // Full supervisor daemon
  const workers = parseInt(process.env["KAIROS_WORKER_COUNT"] ?? "2", 10);
  console.log(`KAIROS Supervisor (workers=${workers})`);
  printSchedule();
  runSupervisor(workers).catch((err) => {
    console.error("Supervisor fatal error:", err);
    process.exit(1);
  });
} else {
  // Default: show help
  printHelp();
  console.log("\n提示: 设置 KAIROS_ENABLED=true 以启动 daemon 模式");
}
