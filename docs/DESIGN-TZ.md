# ТЗ — адаптація GOAT до DESIGN.md v1

> Мета: звести наявний код (style.css + app.js + index.html) до канону `docs/DESIGN.md`.
> Pool B: дизайн НЕ переробляємо — прибираємо дрейф. Більшість змін **візуально непомітні** (перейменування/злиття значень).
> Дисципліна: атомарні коміти (~100 рядків), тести після кожного, premortem inline.

## Принцип реалізації

1. Завести CSS-змінні (`:root`) з YAML-ядра DESIGN.md → semantic-шар.
2. Поетапно замінювати сирі hex у `style.css`/`app.js` на `var(--*)`.
3. Кожен коміт = одне рішення з аудиту, окремо тестується (`npm run test:e2e` + візуальна звірка).
4. Stamp у шапку `style.css`: `/* design-md: goat v1 / follows tokens 2026-06-26 */`.

---

## Коміт 1 — `:root` токени + focus-visible  [Рішення 1, CRITICAL]

**Файл:** `style.css` (шапка) + глобальне правило.

- Додати `:root{}` з усіма primitive+semantic змінними (з DESIGN.md YAML).
- Додати глобальне:
  ```css
  :where(button,a,.tab,.pos-tab,.phex-card,.lb-name,.nav-menu-btn,input,select):focus-visible{
    outline:2px solid var(--accent); outline-offset:2px;
  }
  ```
- Прибрати `user-select:none` з інтерактивних, де воно блокує (перевірити).

**Тест:** e2e smoke + ручний Tab по табах/кнопках/картках → видиме золоте кільце. **Premortem:** `:focus-visible` не чіпає мишу — регресій кліку нема.

---

## Коміт 2 — success/danger уніфікація  [Рішення 2]

**Файл:** `style.css:618-621`.

- `.mt2-save{background:#2e7d32}` → `var(--success)` (#4CAF50); hover → світліший green.
- `.mt2-cancel{background:#c62828}` → `var(--danger)` (#ff4444); hover.
- Видалити `#388e3c`, `#d32f2f`.
- Текст на кнопках — темний для контрасту (#06210a / #2a0606).

**Тест:** My Team → Change pick → кнопки Save/Cancel у бренд-кольорах. e2e auth-picks.

---

## Коміт 3 — топ-3: медаль до імені, прибрати #ffd700  [Рішення 3]

**Файли:** `style.css:443`, `app.js` (рендер standings-рядка).

- Видалити `.lb-rank.top3{color:#ffd700}` (рядок 443). Ранг лишається `var(--accent)`.
- У `app.js`, де будується рядок лідерборду: для `rank<=3` префіксувати ім'я менеджера медаллю:
  `const medal = rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':''; name = medal+' '+name;`
  Медаль іде **на початку імені** (`.lb-name`/`.link-name`), НЕ в колонці номера.

**Тест:** Standings → топ-3 з медалями біля імен, номери звичайним золотом, жодного #ffd700. e2e standings.

---

## Коміт 4 — один рендер лінка `.link-name`  [Рішення 4]

**Файли:** `style.css:446-447, 555-556`, `app.js` (місця рендеру імен).

- Звести `.lb-name-btn` + `.lb-name-link` в один `.link-name`:
  ```css
  .link-name{color:var(--txt);cursor:pointer;text-decoration:none}
  .link-name:hover{color:var(--accent);text-decoration:underline}
  ```
- У `app.js` замінити обидва класи на `.link-name` скрізь, де клікабельне ім'я менеджера.
- Прибрати alpha-underline `#BFB29466`.

**Тест:** Standings GW-view і Season-view → імена однаково підсвічуються. Manager profile відкривається.

---

## Коміт 5 — gold ramp у змінні  [Рішення 5, 0 візуальних змін]

**Файл:** `style.css` (усі warm-gold входження).

- Замінити сирі `#d4c9a8 #d4c5a0 #a89570 #8a7050 #7a6040 #6a5030 #4a3820 #3a2810 #2a2216 #2a2510 #1a1800 #8a8060` → відповідні `var(--gold-*)`.
- `#d4c5a0` → `var(--gold-100)` (злиття з #d4c9a8).
- `#BFB294` (95×) → `var(--accent)` / `var(--gold-200)`.

**Тест:** піксель-звірка Live (MOTM-картка) + My Team до/після — **має бути ідентично**. Скріншот-діф.

---

## Коміт 6 — позиційні кольори в землю  [Рішення 6]

**Файл:** `app.js:11`.

- `POS_COLORS = {GKP:'#c9a227', DEF:'#4a8fa0', MID:'#7a9a4a', FWD:'#c25c3d'}`.
- Перевірити контраст тексту бейджа: для def/mid/fwd текст білий, gkp — темний.
  (єдине застосування: `buildProfileHeader` app.js:1713, `.mb-pos-badge`).

**Тест:** відкрити модалку профілю гравця кожної позиції → бейдж приглушений, читабельний.

---

## Коміт 7 — `.btn-primary` єдиний  [Рішення 7]

**Файли:** `style.css` (auth-btn, strip-submit, profile-save, admin-add-btn), `app.js:1255,1257` (inline).

- Створити базовий `.btn-primary{padding:10px 20px;font-size:12px;...;background:var(--accent);color:var(--ink)}` + hover/focus.
- Перевести 4 CSS-кнопки на `.btn-primary` (лишити лише позиційні overrides, де треба width:100%).
- Inline-кнопки в `app.js` (empty-states) → `class="btn-primary"`, прибрати inline `style`.

**Тест:** auth-модалка, submit-strip, profile-save, admin → однакова геометрія. e2e auth.

---

## Коміт 8 — сірі/radius/spacing  [Рішення 8]

**Файл:** `style.css` (повсюдно).

- Сірі → 6 surface-змінних: `#111/#151515/#161616 → var(--ink-1)`; `#222/#252525 → var(--ink-3)`; `#2e2e2e → var(--border)`; решта по мапі DESIGN.md.
- Текст-сірі → 7 text-змінних.
- `border-radius:2px` і `:4px` → прибрати (стане 0); лишити `50%` (кружки/аватари).
- Spacing-аутлаєри `7/9/11/13px` → найближча сходинка (8/10/12/12 або 14).

**Тест:** повний e2e + візуальна звірка всіх 4 табів — приглушені зсуви сірого допустимі, layout не їде.

---

## Версія й тестування (фінал)

1. **Гілка:** `design-md-v1` (worktree off main).
2. Після кожного коміту: `npm test` (unit) + `npm run test:e2e` (Playwright) — зелено перед наступним.
3. **Візуальний регрес:** Playwright-скріншоти 4 табів (Pick/My Team/Live/Standings) + модалок до/після. Комити 5,8 — обов'язковий скрін-діф (мають бути майже ідентичні).
4. Оновити `index.html` мета якщо треба; додати stamp у `style.css`.
5. Прев'ю готової версії локально (`vercel dev` / live-server) → Віктору на огляд.
6. Після ОК Віктора: merge у main → Vercel auto-deploy → `curl` прод (4 таби + standings) per `feedback_verify_vercel_deploy_after_push`.

**Premortem (ключові ризики):**
- 🟡 Коміт 5/8: var-заміна може зачепити `clip-path`-геометрію або specificity → скрін-діф ловить. Мітигація: міняти лише `background/color/border-color`, не layout.
- 🟡 app.js inline-кнопки в template-literal: уникати escape-помилок (є тест `client-sanity` на escaped template literals).
- 🟢 focus-visible: безпечно, без regресій кліку.

**Оцінка:** 8 атомарних комітів, ~1 робочий прохід. Комити 1–4, 6, 7 — видимі дрібні поліпшення; 5, 8 — невидиме прибирання боргу.
