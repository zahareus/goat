# GOAT

Pick the best player from each Premier League match. Highest BPS wins.

**Domain:** https://goatapp.club
**Repo:** https://github.com/zahareus/goat
**Backend:** Supabase (`zanssnurnzdqwaxuadge.supabase.co`)
**Hosting:** Vercel
**Season:** 2025-26

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
