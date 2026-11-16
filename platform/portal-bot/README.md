# SOLLUNA portal bot

The AI browser that does seller-portal work (reports, CA files) for clients. Runs on its own server (plan: Steel on Oracle Cloud Mumbai) and talks to the SOLLUNA API; it is not part of the Render web build. Plan: `docs/plans/AI_BROWSER_STACK.md`.

| Package | Version | Licence | Why |
|---|---|---|---|
| playwright-core | 1.63.0 | Apache-2.0 | Browser control, downloads, trace recording |
| @browserbasehq/stagehand | 3.7.3 (pinned) | MIT | AI act/observe/extract with a local action cache and self-heal. v4 is not used: it sends AI calls (and page content) through Browserbase's hosted API |
| pg-boss | 12.38.2 | MIT | Job queue on our own Postgres (no Redis) |

`npm run smoke` checks the three on this machine (no marketplace, no real model call). Set `CHROME_PATH` and `BOSS_DATABASE_URL` if they differ from the defaults.
