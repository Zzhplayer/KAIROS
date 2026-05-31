# Security Policy

KAIROS runs local automation, receives GitHub webhook events, and may touch maintainer workflow data. Treat changes to webhook handling, worker execution, logging, and local file access as security-sensitive.

## Supported Versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## Reporting A Vulnerability

Please report security issues privately to the maintainer before opening a public issue.

Include:

- A short description of the issue.
- Steps to reproduce.
- Affected files or configuration.
- Whether any secrets, webhook payloads, or local session data could be exposed.

The maintainer will acknowledge valid reports as soon as practical and coordinate a fix before public disclosure.

## Security Expectations

- Set `KAIROS_GITHUB_WEBHOOK_SECRET` in production webhook deployments.
- Never commit Feishu app secrets, webhook secrets, GitHub tokens, or private Claude Code session logs.
- Review any code that spawns agent or shell processes.
- Avoid logging full webhook payloads or prompt/session content unless explicitly needed for local debugging.
- Keep daemon filesystem reads scoped to documented local paths.
