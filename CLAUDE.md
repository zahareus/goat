# GOAT

Pick the best player from each Premier League match. Highest BPS wins.

**Domain:** https://goatapp.club
**Repo:** https://github.com/zahareus/goat
**Backend:** Supabase (`zanssnurnzdqwaxuadge.supabase.co`)
**Hosting:** Vercel
**Season:** 2025-26

## Snapshot Archive (для тестування нових фіч)

Сусідній проєкт Flop11 веде архів `fpl_snapshots` (Supabase `usnowlefhmedofssodei`, **3962 рядки** за GW36-38 сезону 2025-26, 16 днів, 2026-05-09 → 2026-05-25). Включає `fixtures`, `live` (per-player events: minutes, goals, BPS, cards, bonus), `lineups` (RotoWire), `cards` (Smarkets), `team-xg` (ClubElo) — все upstream-джерела, спільні з GOAT.

Для тестування нових GOAT-фіч (нові метрики, рейтинги, scoring-правила) можна замокати FPL API з цих snapshots замість чекати наступного сезону. Доступ через сервісний ключ Flop11-Supabase, фільтр `gw IN (36,37,38)`. Деталі формату — у `~/Claude Code/flop11/docs/architecture.md` § Snapshot Capture System.

## Testing

### Unit Tests (Vitest)
- `tests/bot-strategies.test.js` — 13 bot strategies, topN, randomPick
- `tests/rankings.test.js` — tied ranks, player stats (Bayesian avg, form, streaks)
- `tests/client-sanity.test.js` — no leaked secrets, no escaped template literals, API handler exports

### E2E Tests (Playwright)
- `tests/e2e/smoke.spec.js` — homepage, tabs, matches, standings, auth, GW navigation, console errors, resources

### Shared Logic Modules
- `lib/bot-strategies.js` — pure strategy logic extracted from `api/bot-picks.js`
- `lib/rankings.js` — ranking and player stats logic extracted from `app.js`

### Commands
```bash
npm test              # Run unit tests
npm run test:watch    # Watch mode
npm run test:e2e      # Run E2E tests (requires Playwright browsers)
npm run check         # Syntax check API files
npm run predeploy     # Full pre-deploy check (syntax + unit tests)
```

### CI/CD
- GitHub Actions: `.github/workflows/test.yml` — runs unit + E2E on every push/PR to main
- Vercel auto-deploys from main after CI passes

### Test Protocol
When modifying code:
1. Run `npm test` after changes to bot strategies, rankings, or API files
2. Run `npm run test:e2e` after changes to frontend (app.js, index.html, style.css)
3. If tests fail — fix the issue before committing
4. Never push code that breaks existing tests without updating them

## Quick Reference

- `api/bot-picks.js` — bot pick generation (called by n8n every 30 min)
- `api/notify.js` — Telegram notifications
- `api/telegram-webhook.js` — Telegram bot commands
- `app.js` — monolithic frontend (2190 lines)
- Admin email: `zahareus@gmail.com`

## Cron endpoints & their secret

Every `api/*` cron endpoint is guarded by `GOAT_NOTIFY_SECRET` (Vercel env). Two ways to pass it:

- **Header `x-goat-secret`** — what "GOAT Photo Sync" uses. The value lives in the n8n credential **"GOAT notify secret (x-goat-secret)"** (`BWtklpJJY4Dt5qZQ`, type `httpHeaderAuth`), so it is encrypted at rest and absent from the exported workflow JSON. Supported by `api/sync-photos.js` today; extend the same way when moving another workflow.
- **`?secret=` query** — still how the other six GOAT workflows authenticate, with the key in plain text inside their node URL. Working as intended, just less private; migrate opportunistically, never mid-gameweek.

Same secret value for both. To call one by hand:
`curl -H "x-goat-secret: $GOAT_NOTIFY_SECRET" https://goatapp.club/api/sync-photos`

n8n workflows: Finalize `jdI9MfAZ5K90PuMF` · Live BPS `wfcIOOfE6bVkW1gc` · Prize Finalize `XfmxUmo1g6qB5Cpg` · Bot Picks `so4OiXG3rd3LqShU` · Deadline Reminder `AxEqrPyvwHm825W1` · Lineup Alert `VBmk050efsVLEPHs` · Photo Sync `vZoUiKRKW4mzw1rX`. Edit them over the REST API (`X-N8N-API-KEY` from `~/.config/n8n.env`), and back the workflow up to `backups/` before every PUT.

## Domain Vocabulary

- **TMA** — Telegram Mini App (t.me/goatsoccergame_bot/goat) — the ONLY way to play. Browser goatapp.club = landing page only; full web app exists solely behind `?webapp=1` for Playwright e2e (never remove).
- **GOAT pick** — user's chosen player for one fixture; `is_goat` = TRUE for ALL players sharing max BPS (ties allowed).
- **Prize ledger** — `prize_ledger` + `payouts` tables; Telegram Stars paid via split.tg (xRocket USDT invoices). Bots participate in prizes as economy stabilizers — never expose bot status in public UI.
- **Finalization** — automatic n8n cron ("GOAT Prize Finalize", hourly): gate = all fixtures FT + results final + FPL's own `events[gw].finished && data_checked` from bootstrap-static. Measured on GW1: FPL flipped +13.2h after the last kickoff, finalize ran at +14h. Before computing standings it re-reads `fixtures?event=<gw>` and upserts `results` — Live BPS stops at the whistle, hours before FPL finishes checking (see Iron Rule 6).

## 🔴 Iron Rules

1. **Payout truth = admin's explicit "Paid ✓" click.** split.tg `/user/invoices` keeps xrocket invoices `pending` even after real payment — there is NO machine source of payment truth. Confirm = CAS `requested→processing` BEFORE buying; reconcile only marks `expired`, never returns to `requested`.
2. **Auth is initData-only** (HMAC in `lib/telegram-initdata.js`); unknown TG user silently gets an auto-account. Never log initData or token_hash. Cached session accepted only if `user_metadata.telegram_id` matches initData.
3. **CSP `frame-ancestors` in vercel.json** replaces X-Frame-Options — don't restore DENY, don't add other CSP directives (site relies on inline onclick).
4. **`backups/` may contain n8n exports with live secrets** — stays gitignored, never `git add -A` around it.
5. **UI rules from Victor:** no label may wrap to 2 lines; dates everywhere DD/MM/YY.
6. **Never trust `results` at the whistle.** Live BPS syncs only the ACTIVE gameweek, and a gameweek goes inactive the moment the last match ends — FPL kept editing BPS for 13 more hours after that in GW1 (9 rows drifted permanently). Anything that pays out or declares a final standing must re-read FPL first, the way `api/prize-finalize.js` does: same `fixtures?event=` endpoint and same parsing as the Live BPS node, max over the RAW entries before filtering unknown players, one upsert on the `(fixture_id, element_id)` PK with `is_final: true`. Never patch only the changed rows — a crown moves by its neighbours' BPS.

## ⚠️ Known Traps

- Vercel env values (created ~02.2026) have a trailing newline — always read env through the trimming `env()` helper (`api/telegram-auth.js` pattern).
- GoTrue admin user update = **PUT** (PATCH → 405).
- `generate_link {type:'magiclink'}` for a nonexistent email **CREATES the user**; probe existence only with `{type:'recovery'}`.
- Supabase default privileges auto-grant `anon` on new tables — every CREATE TABLE needs an explicit REVOKE (verified incident: anon read on prize tables).
- First e2e auth-spec run sometimes flakes — rerun the spec solo before debugging.

## Security (Supabase)

- RLS is ENABLED on all public tables — anon cannot write. Telegram webhook verifies
  `TELEGRAM_WEBHOOK_SECRET`; admin API checks the `zahareus@gmail.com` auth token.
- 🔴 `anon` SELECT on `profiles` is **column-scoped to hide `telegram_chat_id` and the
  `telegram_verify_*` columns** (audit 2026-07-03). Do NOT re-grant whole-table SELECT
  to `anon`, and keep public/other-user profile reads to explicit safe columns
  (`id, team_name, avatar_url, is_bot`) — `select('*')` on profiles is `authenticated`-only
  (own row), else it 401s for anon. Full context: memory `project_flop11_goat_security_audit`.
