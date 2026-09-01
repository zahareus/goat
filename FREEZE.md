# GOAT — FROZEN (2026-09-01)

Fantasy game on goatapp.club, put on hold before GW3 of the 2026/27 season
(GW3 cancelled, picks never scored). Players were notified by the owner in advance.

## Was / Now

| Component | Was | Now |
|---|---|---|
| goatapp.club (Vercel) | full Telegram Mini App | Coming Soon landing for ALL clients (`FROZEN` flag in `app.js`, commit 94ba1b2); app never boots, zero network calls |
| Supabase `zanssnurnzdqwaxuadge` (free org Fantasy) | live | PAUSED via Management API (restorable one-click ~1 year; **do NOT delete the project** — Storage bucket `player-photos`, auth config and JWT secret are NOT in the SQL dumps) |
| n8n (n8n.ontext.info) | 10 active workflows | all 10 deactivated (left in place); JSON exports in `backups/n8n-freeze-2026-09-01/` (gitignored) |
| Telegram bot @goatsoccergame_bot | webhook → `/api/telegram-webhook` | webhook deleted; Mini App link still opens and shows Coming Soon |
| GitHub Actions | test.yml (push/PR), db-backup.yml (daily 02:30 UTC) | `test.yml` → `.disabled`; db-backup schedule commented out (workflow_dispatch kept) |

## n8n workflow ids (all deactivated, reactivate on unfreeze)
Live BPS `wfcIOOfE6bVkW1gc` · Finalize `jdI9MfAZ5K90PuMF` · Prize Finalize `XfmxUmo1g6qB5Cpg` · Bot Picks `so4OiXG3rd3LqShU` · Deadline Reminder `AxEqrPyvwHm825W1` · Lineup Alert `VBmk050efsVLEPHs` · Photo Sync `vZoUiKRKW4mzw1rX` · Watchdog `37WV3CYOKtQfCqLQ` · Bootstrap `6yVCHIC2atyH8pVe` · Supabase Keepalive (GOAT) `7STU71U2suaPImFq`.
"Workflow weekly backup" is instance-wide and was left active.

## Star prize economy — closed
- No open payout requests at freeze time.
- Anthonyusa's 20⭐ balance was settled off-platform by the owner directly; a `correction` row (−20) zeroes it in `prize_ledger`.
- Remaining balances (owner's own accounts 40+80⭐, bots 60⭐) are internal, not debt.

## Where the data lives
1. Local full dump WITH privileges: `_freeze-backup/goat_final_20260901.sql.gz` (gitignored; public+auth schemas, 40 tables, GRANTs included) — canonical for restore.
2. CloudRV daily dumps `automation/dbbackup_goat_*.sql.gz` — made with `--no-owner --no-privileges`, NOT sufficient to restore grants.
3. The paused Supabase project itself (photos in Storage, auth config).
4. Player photos backup (PNG originals): `~/Backups/goat-player-photos-2026-08-22`.

Secrets stay where they were: variable names only — `GOAT_NOTIFY_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `SPLIT_API_TOKEN` in Vercel env; `~/.config/goat_supabase.env`, `~/.config/goat_split.env`, `~/.config/supabase_backup_dburls.env` locally; GH secrets `SUPABASE_DB_URL`, `CLOUDREVE_EMAIL/PASSWORD`.

## How to unfreeze
1. Restore Supabase project in the dashboard (one click while pause is restorable; otherwise create a project and restore the local dump + re-upload Storage photos + reconfigure auth).
2. Re-set the bot webhook: `curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://goatapp.club/api/telegram-webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>"` (values in Vercel env).
3. Flip `FROZEN` to `false` in `app.js`, bump the `?v=` cache-buster in `index.html`, restore `test.yml`, uncomment db-backup schedule; push.
4. Reactivate the n8n workflows (keepalive first).
5. Season rollover if a new season started: see project memory `project_goat` (archive+seed procedure, `populate-prior.js`).

## Backlog carried over
See `project_goat` memory hub: player admin panel, squad-update admin, bot badges decision, per-column grants for `profiles` (security note), migration of 6 workflows from `?secret=` to `x-goat-secret` header.
