/**
 * Session reader — reads conversation sessions from Claude Code.
 * Sessions are NDJSON files in ~/.claude/projects/-Users-happy/.
 *
 * Claude Code session format per line:
 * - type: "user"      → message.role = "user",     message.content = text
 * - type: "assistant" → message.role = "assistant", message.content = text
 * - type: "progress"   → hook events, skip
 * - type: "system"     → system messages, skip unless has content
 * Other types: skip
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

export interface SessionMessage {
  role: string;
  content: string;
  timestamp: string;
}

export interface SessionFile {
  path: string;
  sessionId: string;
  mtimeMs: number;
  messages: SessionMessage[];
}

/** Directory containing Claude Code user-level session files. */
function claudeSessionsDir(): string {
  return join(homedir(), ".claude", "projects", "-Users-happy");
}

function isRecentSession(filePath: string, sinceMs: number): boolean {
  try {
    return statSync(filePath).mtimeMs > sinceMs;
  } catch {
    return false;
  }
}

/**
 * Parse a Claude Code session NDJSON file and extract user/assistant messages.
 */
function parseSessionFile(filePath: string): SessionMessage[] {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const messages: SessionMessage[] = [];

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        continue;
      }

      const type = obj["type"] as string;

      // Only process user and assistant message types
      if (type !== "user" && type !== "assistant") continue;

      const msg = obj["message"] as Record<string, unknown> | undefined;
      if (!msg) continue;

      const role =
        (msg["role"] as string) ?? (type === "user" ? "user" : "assistant");
      const content = msg["content"] as
        | string
        | Array<Record<string, unknown>>
        | undefined;
      const timestamp = (obj["timestamp"] as string) ?? "";

      let text = "";
      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block["type"] === "text") {
            text += (block["text"] as string) ?? "";
          }
        }
      }

      if (text.trim()) {
        messages.push({ role, content: text.trim(), timestamp });
      }
    }

    return messages;
  } catch {
    return [];
  }
}

/**
 * Read all Claude Code session files modified since `sinceMs`.
 */
export function readRecentSessions(sinceMs: number): SessionFile[] {
  const results: SessionFile[] = [];
  const dir = claudeSessionsDir();

  try {
    const files = readdirSync(dir);
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;

      const filePath = join(dir, file);
      if (!isRecentSession(filePath, sinceMs)) continue;

      const messages = parseSessionFile(filePath);
      if (messages.length === 0) continue;

      // sessionId is the filename without .jsonl
      const sessionId = basename(file, ".jsonl");

      let mtimeMs = Date.now();
      try {
        mtimeMs = statSync(filePath).mtimeMs;
      } catch {
        // use current time as fallback
      }

      results.push({ path: filePath, sessionId, mtimeMs, messages });
    }
  } catch {
    // Directory might not exist
  }

  // Sort newest first
  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return results;
}

/**
 * Format sessions as plain text for LLM consumption.
 */
export function formatSessionsForLLM(sessions: SessionFile[]): string {
  const lines: string[] = [
    "# Recent Claude Code Conversation Sessions for Memory Consolidation\n",
  ];

  for (const session of sessions) {
    const date = new Date(session.mtimeMs)
      .toISOString()
      .replace("T", " ")
      .slice(0, 19);
    lines.push(`\n## Session: ${session.sessionId} (${date})\n`);

    for (const msg of session.messages) {
      const role = msg.role === "user" ? "User" : "Assistant";
      const text =
        msg.content.length > 2000
          ? msg.content.slice(0, 2000) + "\n... [truncated]"
          : msg.content;
      lines.push(`\n### ${role}:\n${text}\n`);
    }
  }

  return lines.join("\n");
}
