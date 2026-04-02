/**
 * GitHub Webhook HTTP server.
 * Validates HMAC signatures and dispatches Feishu notifications for relevant events.
 */

import { createServer, type Server } from "node:http";
import { createHmac } from "node:crypto";
import { logForDebugging, logError } from "../utils/logger.ts";
import { loadFeishuConfig, sendFeishuCard } from "../utils/feishuClient.ts";

const SUPPORTED_EVENTS = new Set([
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "issue_comment",
]);

/** Verify that the request body matches the X-Hub-Signature-256 header. */
function verifySignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret)
    .update(rawBody, "utf-8")
    .digest("hex");
  return signature === `sha256=${expected}`;
}

interface GitHubPR {
  number: number;
  title: string;
  state: string;
  html_url: string;
  user?: { login: string };
}

interface GitHubComment {
  body: string;
  user?: { login: string };
  html_url: string;
}

function buildCard(event: string, payload: Record<string, unknown>): object {
  const repo =
    (payload["repository"] as Record<string, string | undefined>)?.full_name ??
    "unknown";
  const sender =
    (payload["sender"] as Record<string, string | undefined>)?.login ??
    "someone";

  switch (event) {
    case "pull_request": {
      const pr = payload["pull_request"] as GitHubPR;
      return {
        config: { wide_screen_mode: true },
        elements: [
          { tag: "markdown", content: `**PR: ${pr.title}** (#${pr.number})` },
          {
            tag: "markdown",
            content: `Repo: \`${repo}\` | State: **${pr.state}** | By: @${pr.user?.login ?? sender}`,
          },
          { tag: "markdown", content: `> ${pr.html_url}` },
        ],
      };
    }

    case "pull_request_review": {
      const pr = payload["pull_request"] as GitHubPR;
      const review = payload["review"] as Record<string, unknown>;
      return {
        config: { wide_screen_mode: true },
        elements: [
          {
            tag: "markdown",
            content: `**Review on PR #${pr.number}: ${pr.title}**`,
          },
          {
            tag: "markdown",
            content: `Repo: \`${repo}\` | By: @${review.user?.["login"] ?? sender}`,
          },
          { tag: "markdown", content: `> ${pr.html_url}` },
        ],
      };
    }

    case "pull_request_review_comment":
    case "issue_comment": {
      const comment = payload["comment"] as GitHubComment;
      const prNum =
        event === "pull_request_review_comment"
          ? ((payload["pull_request"] as GitHubPR)?.number ?? "?")
          : ((payload["issue"] as Record<string, unknown>)?.["number"] ?? "?");
      return {
        config: { wide_screen_mode: true },
        elements: [
          {
            tag: "markdown",
            content: `**New Comment on #${prNum}** — @${comment.user?.login ?? sender}`,
          },
          {
            tag: "markdown",
            content: `\`\`\`\n${(comment.body ?? "").slice(0, 500)}\n\`\`\``,
          },
          { tag: "markdown", content: `> ${comment.html_url}` },
        ],
      };
    }

    default:
      return {
        config: { wide_screen_mode: true },
        elements: [
          {
            tag: "markdown",
            content: `**GitHub Event: ${event}** in \`${repo}\``,
          },
        ],
      };
  }
}

/**
 * Start the webhook HTTP server on the given port.
 * Returns a stop function to shut it down.
 */
export function startWebhookServer(port = 3001): { stop: () => void } {
  const WEBHOOK_SECRET = process.env["KAIROS_GITHUB_WEBHOOK_SECRET"] ?? "";
  const FEISHU_NOTIFY_ID = process.env["KAIROS_FEISHU_NOTIFY_ID"] ?? "";
  const MY_INSTALLATION_ID =
    process.env["KAIROS_GITHUB_APP_INSTALLATION_ID"] ?? "";

  const feishuAccount = loadFeishuConfig();

  const server: Server = createServer(async (req, res) => {
    // Health check
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, "OK", { "Content-Type": "application/json" });
      res.end('{"status":"ok"}');
      return;
    }

    // Only handle POST /github/webhook
    if (req.method !== "POST" || req.url !== "/github/webhook") {
      res.writeHead(404);
      res.end();
      return;
    }

    const signature = req.headers["x-hub-signature-256"] ?? "";
    const event = req.headers["x-github-event"] ?? "";
    const installationId = req.headers["x-github-app-installation-id"] ?? "";

    // Reject unsupported events
    if (!SUPPORTED_EVENTS.has(event)) {
      res.writeHead(204);
      res.end();
      return;
    }

    // Self-loop guard: ignore events from our own installation
    if (MY_INSTALLATION_ID && String(installationId) === MY_INSTALLATION_ID) {
      logForDebugging(`[webhook] Ignoring self-triggered event: ${event}`);
      res.writeHead(204);
      res.end();
      return;
    }

    // Accumulate body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const rawBody = Buffer.concat(chunks).toString("utf-8");

    // Verify signature if secret is configured
    if (
      WEBHOOK_SECRET &&
      !verifySignature(rawBody, String(signature), WEBHOOK_SECRET)
    ) {
      logError("[webhook] Invalid signature — rejecting request");
      res.writeHead(401);
      res.end();
      return;
    }

    // Parse payload
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch (err) {
      logError(`[webhook] Failed to parse payload: ${String(err)}`);
      res.writeHead(400);
      res.end();
      return;
    }

    // Build card and send Feishu notification
    if (feishuAccount && FEISHU_NOTIFY_ID) {
      const card = buildCard(event, payload);
      const sent = await sendFeishuCard(feishuAccount, FEISHU_NOTIFY_ID, card);
      if (sent) {
        logForDebugging(`[webhook] Feishu notification sent for ${event}`);
      }
    }

    logForDebugging(`[webhook] Handled event: ${event}`);
    res.writeHead(204);
    res.end();
  });

  server.listen(port, () => {
    logForDebugging(`[webhook] Server listening on port ${port}`);
  });

  return {
    stop: () => {
      logForDebugging("[webhook] Stopping server");
      server.close();
    },
  };
}
