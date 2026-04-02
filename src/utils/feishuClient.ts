/**
 * Feishu (Lark) API client — reads config from ~/.openclaw/openclaw.json
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface FeishuAccount {
  appId: string;
  appSecret: string;
  brand?: "feishu" | "lark";
}

/** Load feishu config from the openclaw config file. */
export function loadFeishuConfig(): FeishuAccount | null {
  try {
    const configPath = join(homedir(), ".openclaw", "openclaw.json");
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;

    // Try feishu/lark top-level keys first
    const appId = (config["feishu_app_id"] ?? config["lark_app_id"]) as
      | string
      | undefined;
    const appSecret = (config["feishu_app_secret"] ??
      config["lark_app_secret"]) as string | undefined;

    if (appId && appSecret) {
      const brand = config["lark_app_id"] ? "lark" : "feishu";
      return { appId, appSecret, brand };
    }

    // Try nested agents[].config
    const agents = config["agents"] as
      | Array<Record<string, unknown>>
      | undefined;
    if (Array.isArray(agents)) {
      for (const agent of agents) {
        const agentConfig = agent["config"] as
          | Record<string, unknown>
          | undefined;
        if (!agentConfig) continue;
        const aId = (agentConfig["feishu_app_id"] ??
          agentConfig["lark_app_id"]) as string | undefined;
        const aSecret = (agentConfig["feishu_app_secret"] ??
          agentConfig["lark_app_secret"]) as string | undefined;
        if (aId && aSecret) {
          const brand = agentConfig["lark_app_id"] ? "lark" : "feishu";
          return { appId: aId, appSecret: aSecret, brand };
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/** Derive the base domain for the feishu/lark API. */
function feishuBase(account: FeishuAccount): string {
  if (account.brand === "lark") return "https://open.larkoffice.com";
  return "https://open.feishu.cn";
}

/** Obtain a fresh tenant_access_token. */
async function getTenantToken(account: FeishuAccount): Promise<string | null> {
  const base = feishuBase(account);
  const url = `${base}/open-apis/auth/v3/tenant_access_token/internal`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: account.appId,
        app_secret: account.appSecret,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      code: number;
      tenant_access_token?: string;
    };
    if (json.code !== 0 || !json.tenant_access_token) return null;
    return json.tenant_access_token;
  } catch {
    return null;
  }
}

/** Determine the receive_id_type based on the ID prefix. */
function receiveIdType(to: string): "chat_id" | "open_id" {
  if (to.startsWith("oc_")) return "chat_id";
  if (to.startsWith("ou_")) return "open_id";
  return "open_id"; // default
}

/**
 * Send a Feishu card (interactive card payload) to a user or chat.
 * @param account - Feishu account config
 * @param to - oc_xxx (chat_id) or ou_xxx (open_id)
 * @param card - Card element tree
 * @returns messageId on success, null on failure
 */
export async function sendFeishuCard(
  account: FeishuAccount,
  to: string,
  card: object,
): Promise<{ messageId: string } | null> {
  const token = await getTenantToken(account);
  if (!token) return null;

  const base = feishuBase(account);
  const receiveIdTypeVal = receiveIdType(to);

  try {
    const res = await fetch(
      `${base}/open-apis/im/v1/messages?receive_id_type=${receiveIdTypeVal}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          receive_id: to,
          msg_type: "interactive",
          content: JSON.stringify(card),
        }),
      },
    );

    if (!res.ok) return null;
    const json = (await res.json()) as {
      code: number;
      data?: { message_id?: string };
    };
    if (json.code !== 0 || !json.data?.message_id) return null;
    return { messageId: json.data.message_id };
  } catch {
    return null;
  }
}
