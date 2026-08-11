# GOAT Changelog

## 2026-05-04 — n8n pipeline rescue + player_history rebackfill

Виявлено три каскадні баги в n8n-пайплайнах GOAT, які накопичились після квітневого апдейту n8n і змін у FPL API. Симптоми, які бачив користувач: `results` не оновлювалась з 2026-04-27 (Live BPS / Telegram писали "No BPS data yet"), сортування Form/GOAT на Pick Team візуально не реагувало, профайл гравця обривався на GW34 і показував прочерки за більшість турів.

### Bug 1 — Live BPS + Finalize крашили на IF-ноді
- **Workflow:** `GOAT Live BPS` (`wfcIOOfE6bVkW1gc`), `GOAT Finalize` (`jdI9MfAZ5K90PuMF`)
- **Корінь:** IF-нода `Has Active GW?` мала `typeValidation: "strict"` + порожній `rightValue` для оператора `exists`. Після апдейту n8n строге типізування почало вимагати число у rightValue, нода падала на кожному cron-запуску (`Wrong type: '' is a string but was expecting a number`).
- **Фікс:** PUT через REST API — змінив `typeValidation` на `"loose"` в обох воркфлоу.
- **Перевірено:** наступний tick Live BPS o 22:40 UTC = `success`, у `results` з'явилися рядки за fixture 347 (LEE-BUR GW35).

### Bug 2 — `player_history.minutes` завжди = 0 з GW29
- **Workflow:** `GOAT Bootstrap` (`6yVCHIC2atyH8pVe`), node `Sync Fixtures & GW Config & History`
- **Корінь:** код тягнув дані з `https://fantasy.premierleague.com/api/fixtures/`, але цей ендпойнт **не містить** stat-ідентифікатора `minutes` (там `goals_scored`, `assists`, `bps`, `cards`, `saves`, `bonus`, `defensive_contribution`). Тому всі рядки `player_history` за GW29-34 (~1660 шт) мали `minutes=0`, хоча `bps` і `bps_rank` валідні.
- **Каскад:** фронтенд `app.js:543` рахує форму `if (r.minutes > 0)` → форма для всіх гравців за останні 6 турів = 0 → стабільне сортування → клік на Form/GOAT нічого не пересортовував.
- **Фікс:** додав у Bootstrap fetch `/api/event/{gw}/live/` всередині циклу finishedGWs; minutes тепер `liveMinutes[eid] || (statMap.minutes || {})[eid] || 0`.
- **Бекфіл:** оновлено 1663 рядки (GW29-34) через PATCH з даних live ендпойнту.

### Bug 3 — `player_history` не писалась поки **всі** фікстури GW не завершились
- **Workflow:** `GOAT Bootstrap`, та сама нода
- **Корінь:** секція 5 гейтила запис умовою `gwFix.every(f.finished)` — поки хоча б один матч scheduled, ніщо за GW не писалось. У GW35 (на момент розбору) було 8/10 FT, але CHE-NFO і EVE-MCI ще не зіграні → 0 рядків `player_history` за GW35 → у профайлі гравця `statsMaxRound=34`, GW35 не видно.
- **Фікс:** переписав на per-fixture: `recentGWs` беруться через `gwFix.some(f.finished)`, skip-перевірка тепер по `fixture_id` (через `Set` існуючих), не по round.
- **Бекфіл:** 240 рядків GW35.

### Доп. фікс — оригінальний Bootstrap клав неправильні `was_home` / `opponent_team`
- **Корінь:** `isHome` чек був `(statMap.minutes && ...)` — оскільки `statMap.minutes` завжди `undefined` (див. Bug 2), `isHome` завжди `false` → `opponent_team` завжди = `f.team_h` навіть для домашніх гравців.
- **Каскад:** деякі гравці взагалі губились бо FPL `bps` stat array не включає рядки з 0 BPS — субам з minutes>0 і bps=0 не діставався запис.
- **Фікс (бекфіл):** окремий скрипт перебекфілив GW29-35 повністю — cross-check `bootstrap-static.elements[].team` для визначення `was_home`, плюс додав суб-фолбек через live `minutes>0` для players, відсутніх у `bps` stats. Upsert через `?on_conflict=element_id,fixture_id`.
- **TODO в Bootstrap workflow:** ця ж логіка ще не перенесена в робочий код node — поточна правка лишила оригінальний `isHome` чек живим (фоновий фікс через live працює тільки для minutes, не для was_home/opponent). Якщо при наступних турах знову з'являться неправильні opponent — переписати node повністю.

### Відомий side-effect (не виправлено)
DGW-тури (як GW33): `minutes` для гравця-DGW дорівнює **сумі обох матчів**, бо FPL `live` endpoint агрегує по гравцю, а не по матчу. Точні розбивки потребують `/api/element-summary/{eid}/` per player (як у `populate-history.js`). Не критично для UX наразі.

### Файли в репо НЕ змінювались
Всі правки — в n8n workflows на `n8n.ontext.info` через REST API + прямі upserts у Supabase. Бекфіл-скрипти лишились у `/tmp/` (одноразові).
