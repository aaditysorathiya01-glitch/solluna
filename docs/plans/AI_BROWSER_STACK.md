# AI browser stack: "learn once, repeat cheap" (owner decision pending, 16 Nov 2026)

Goal: the bot does seller-portal work (reports, CA files, later listings and support tickets) for every client with as few stops as possible, and gets cheaper over time because the same tasks repeat every month.

## Principle
1. **First run of a task: AI drives** (Claude Haiku 5.5 via Stagehand) and the steps that worked are saved as a **recipe**.
2. **Every later run: the recipe replays** with plain Playwright. No AI call, no token cost.
3. **Page changed or a step fails:** AI takes over for that step only ("self-heal"), and the recipe is updated.
4. **Captcha, bank/payment/settings page, or an unknown error:** stop, alert the team, never guess.

## Stack (free unless marked)
| Layer | Pick | Licence / cost | Why |
|---|---|---|---|
| Browser control | Playwright | Apache-2.0, free | Already in our tests |
| AI driver + action cache | Stagehand | MIT, free | TypeScript (fits NestJS), act/extract/observe, caches actions |
| Model | Claude Haiku 5.5 | **Paid** ($0.10 / $0.50 per M tokens) | Cheapest Claude; only on first runs and self-heal |
| Browser runtime | Steel browser (self-hosted) | Apache-2.0, free | Sessions, cookies, CDP; Browserbase-like on our own server |
| Server | Oracle Cloud Always Free, Mumbai | Free | Indian IP, data stays in India. Fallback: DigitalOcean Bangalore (~$12/month) |
| Pilot only | Browserbase Free | Free | 5-minute start while Oracle is set up |
| Login memory | Persistent browser profile per client per marketplace | Free | Fewer logins, fewer OTPs |
| OTP | Ops mailbox (Cloudflare Worker → SOLLUNA) | Free, built | Bot reads the code in seconds |
| Recipes | `PortalRecipe` table in our Postgres | Free | Learned steps per task × marketplace, versioned |
| Job queue | Postgres-based queue (pg-boss, MIT) or our worker loops | Free | No Redis bill |
| Recording | Playwright Trace + screenshots + action log, 30 days | Free | Audit (CLAUDE.md rules 4, 6) |
| Alerts | Admin notifications + Resend email | Free tier | Team hears about captcha / failures at once |
| Report parsing | Our own xlsx/CSV parsers | Free | Numbers never go through the model |

## Not used
- Captcha solvers and "stealth" / fingerprint tools (Camoufox, Patchright, Nodriver, Browserbase stealth): bypassing marketplace protections risks client account suspension.
- Browserless (SSPL licence risk), Browser Use (Python; we borrow its record-and-replay idea), Replay.io / OpenJam (developer debugging tools).

## Honest limits
- "Never stops" is not possible: marketplaces change pages, ask captchas, expire sessions. The design makes stops rare and short (self-heal + instant alert + human handoff).
- Recipes are per marketplace page flow, not per client; one learned recipe serves every client.

## Cost estimate (rough)
| Clients | Portal runs/month | AI runs (first time + ~5% self-heal) | AI cost/month |
|---|---|---|---|
| 10 | ~100 | ~15 | ~₹50 |
| 100 | ~1,000 | ~60 | ~₹200 |
Server: ₹0 on Oracle free (₹1,050–2,100 on DigitalOcean if needed).
