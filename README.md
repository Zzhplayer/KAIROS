# KAIROS

> 主动式 Agent 框架，让 AI 主动行动，而非被动等待指令。

KAIROS 是一个长期运行的 daemon 系统，基于 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 构建，负责定时触发任务、结果推送、记忆整合。

## 特性

- **定时任务执行** ✅ — cron 表达式调度，自动触发 Claude Code 执行 prompt
- **飞书通知** ✅ — 任务完成/失败自动推送 Feishu 卡片到群
- **GitHub Webhook** ✅ — PR 事件（opened/closed/merged/review）实时推送飞书
- **Proactive 心跳** ✅ — 30 秒心跳保活，always-on 后台运行
- **Tick 主动调度** ✅ — 每30秒评估任务，cron边界外也能主动触发（与cronScheduler共用90s冷却防止重复）
- **记忆整合（DREAM）** ✅ — 每24小时从 Claude Code 会话（`~/.claude/projects/-Users-happy/*.jsonl`）中提取关键事实、决策、教训，写入 `~/.claude/dream-memories/memories.md` 并注册 qmd

## 安装

```bash
git clone https://github.com/Zzhplayer/KAIROS.git
cd KAIROS
bun install
```

## 快速开始

### 配置定时任务

编辑 `~/.claude/scheduled_tasks.json`：

```json
[
  {
    "id": "daily-report",
    "prompt": "分析今天的 git 提交，写一份工作总结",
    "schedule": "0 9 * * *",
    "permanent": true
  }
]
```

### 启动 Daemon

```bash
KAIROS_ENABLED=true bun run src/entrypoints/cli.tsx
```

### 开机自启（macOS launchd）

```bash
launchctl load ~/Library/LaunchAgents/com.launch.kairos.daemon.plist
```

守护进程由 `~/.claude/scripts/kairos-keepalive.sh` 管理，崩溃自动重启。

### 配置飞书通知

KAIROS 从 `~/.openclaw/openclaw.json` 读取飞书 bot 凭证（与 OpenClaw 共用）：

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "appId": "cli_xxxxxx",
      "appSecret": "xxxxxx"
    }
  }
}
```

设置通知目标：
```bash
export KAIROS_FEISHU_NOTIFY_ID="oc_YOUR_REAL_FEISHU_ID"
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `KAIROS_ENABLED` | `false` | 设为 `true` 启动 daemon |
| `KAIROS_FEISHU_NOTIFY_ID` | — | 飞书通知目标（oc_xxx 或 ou_xxx）|
| `KAIROS_WORKER_COUNT` | `2` | Worker 进程数 |
| `KAIROS_HEARTBEAT_INTERVAL_MS` | `30000` | 心跳间隔（毫秒）|
| `KAIROS_CRON_JITTER_MS` | `60000` | Cron 抖动上限 |
| `KAIROS_DREAM_INTERVAL_MS` | `86400000` | DREAM 记忆整合间隔（毫秒，默认24小时）|
| `KAIROS_GITHUB_WEBHOOK_SECRET` | — | GitHub Webhook HMAC 密钥 |
| `KAIROS_GITHUB_APP_INSTALLATION_ID` | — | 自循环防护的 GitHub App 安装 ID |

## Webhook 服务器

接收 GitHub PR 事件并推送飞书通知：

```bash
bun run src/entrypoints/cli.tsx webhook
```

## 项目结构

```
src/
├── entrypoints/
│   └── cli.tsx              # CLI 入口
├── daemon/
│   ├── supervisor.ts        # 主进程（Supervisor）
│   ├── worker.ts            # Worker 进程
│   ├── ipc.ts              # 文件轮询 IPC
│   ├── cronScheduler.ts     # Cron 调度器
│   ├── dreamScheduler.ts    # DREAM 记忆整合调度器（24h）
│   └── webhookServer.ts     # GitHub Webhook 服务器
├── proactive/
│   └── index.ts            # 心跳控制器
├── services/autoDream/
│   ├── autoDream.ts        # 记忆整合主逻辑
│   ├── dreamMeta.ts        # consolidation 元数据
│   └── sessionReader.ts    # Claude Code 会话读取器
└── utils/
    ├── cron.ts             # Cron 表达式解析
    ├── cronTasks.ts        # 任务配置读写
    ├── feishuClient.ts     # 飞书 API 客户端
    └── logger.ts           # 日志
```

## License

MIT
