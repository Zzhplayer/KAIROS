/**
 * Session reader — reads conversation sessions from OpenClaw agents.
 * Sessions are NDJSON files in ~/.openclaw/agents/{agent}/sessions/.
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
  mtimeMs: number;
  messages: SessionMessage[];
}

/** Agents whose sessions should be consolidated. */
const DREAM_AGENTS = ["main", "bot6"];

function sessionsDir(agent: string): string {
  return join(homedir(), ".openclaw", "agents", agent, "sessions");
}

function isRecentSession(filePath: string, sinceMs: number): boolean {
  try {
    const mtime = statSync(filePath).mtimeMs;
    return mtime > sinceMs;
  } catch {
    return false;
  }
}

/**
 * Parse a session NDJSON file and extract text messages.
 */
function parseSessionFile(filePath: string): SessionMessage[] {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const messages: SessionMessage[] = [];

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const obj = JSON.parse(trimmed);

        // Only process message events
        if (obj["type"] !== "message") continue;

        const msg = obj["message"] as Record<string, unknown> | undefined;
        if (!msg) continue;

        const role = (msg["role"] as string) ?? "";
        const content = msg["content"] as
          | string
          | Array<Record<string, unknown>>
          | undefined;
        const timestamp = (obj["timestamp"] as string) ?? "";

        // Extract text content
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
      } catch {
        // Skip malformed lines
      }
    }

    return messages;
  } catch {
    return [];
  }
}

/**
 * Read all session files from dream agents that were modified since `sinceMs`.
 */
export function readRecentSessions(sinceMs: number): SessionFile[] {
  const results: SessionFile[] = [];

  for (const agent of DREAM_AGENTS) {
    const dir = sessionsDir(agent);
    try {
      const files = readdirSync(dir);
      for (const file of files) {
        // Skip deleted and reset files
        if (file.includes(".deleted.") || file.includes(".reset.")) continue;
        if (!file.endsWith(".jsonl")) continue;

        const filePath = join(dir, file);
        if (!isRecentSession(filePath, sinceMs)) continue;

        const messages = parseSessionFile(filePath);
        if (messages.length === 0) continue;

        try {
          const mtime = statSync(filePath).mtimeMs;
          results.push({ path: filePath, mtimeMs: mtime, messages });
        } catch {
          // Skip
        }
      }
    } catch {
      // Agent dir might not exist
    }
  }

  // Sort newest first
  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return results;
}

/**
 * Format sessions as plain text for LLM consumption.
 * Returns a summary with agent, session info, and message content.
 */
export function formatSessionsForLLM(sessions: SessionFile[]): string {
  const lines: string[] = [
    "# Recent Conversation Sessions for Memory Consolidation\n",
  ];

  for (const session of sessions) {
    const sessionId = basename(session.path, ".jsonl");
    const date = new Date(session.mtimeMs)
      .toISOString()
      .replace("T", " ")
      .slice(0, 19);
    lines.push(`\n## Session: ${sessionId} (${date})\n`);

    for (const msg of session.messages) {
      const role = msg.role === "user" ? "User" : "Assistant";
      // Truncate very long messages
      const text =
        msg.content.length > 2000
          ? msg.content.slice(0, 2000) + "\n... [truncated]"
          : msg.content;
      lines.push(`\n### ${role}:\n${text}\n`);
    }
  }

  return lines.join("\n");
}
