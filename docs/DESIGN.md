---
# GOAT — DESIGN.md  (машинне ядро = єдине джерело токенів)
meta:
  project: goat
  domain: goatapp.club
  follows: design-md/v1
  version: 2026-06-26
  stamp: "<!-- design-md: goat v1 / follows tokens 2026-06-26 -->"

colors:
  # ── Шар 1: PRIMITIVE (сирі сходинки; компоненти НЕ торкаються) ──
  primitive:
    # Surfaces (темна основа) — 6 канонічних сходинок
    ink-deep:   "#0d0d0d"   # nav, footer, team-strip, page-header
    ink-1:      "#141414"   # панелі/модалки  (зливає 111, 151515, 161616)
    ink-base:   "#1a1a1a"   # body, основний фон
    ink-2:      "#1e1e1e"   # картки, рядкові дільники
    ink-3:      "#242424"   # bps-бар, інпут-tint  (зливає 222, 252525)
    border:     "#2a2a2a"   # основні бордери  (зливає 2e2e2e)
    border-in:  "#333333"   # бордер інпутів
    # Text (сірий ramp) — 7 сходинок
    text-strong:"#ffffff"
    text-bright:"#f0f0f0"
    text-body:  "#cccccc"   # зливає dddddd
    text-sub:   "#aaaaaa"
    text-mute:  "#888888"   # зливає 999, 777
    text-dim:   "#666666"
    text-faint: "#444444"
    # Champagne-gold ramp (бренд) — 9 сходинок
    gold-100:   "#d4c9a8"   # hover-light (зливає d4c5a0)
    gold-200:   "#BFB294"   # ★ BASE — фірмовий акцент (95 використань)
    gold-300:   "#a89570"   # зливає 8a8060 (stat-text)
    gold-400:   "#8a7050"   # MOTM-border
    gold-500:   "#7a6040"   # MOTM-hex
    gold-600:   "#6a5030"   # MOTM-hex hover
    gold-700:   "#4a3820"   # текст на золоті / MOTM-pos
    gold-800:   "#3a2810"   # MOTM-status
    gold-900:   "#2a2216"   # найтемніший tint, selected-inner
    gold-bg:    "#1a1a12"   # золото-тонований фон рядка (зливає 2a2510, 1a1800, 222215)
    # Status
    green:      "#4CAF50"   # success (єдиний — Material 2e7d32/c62828 ВИДАЛЕНО)
    red:        "#ff4444"   # danger + live (єдиний)
    warn-hi:    "#ffc107"   # availability: starter-questionable
    warn-lo:    "#f08c00"   # availability: questionable
    avail-in:   "#4a8c3f"   # availability: starter
    avail-out:  "#e25c3d"   # availability: out / suspended
    # Position (приглушена «землиста» гама — НЕ неон)
    pos-gkp:    "#c9a227"   # було f5c518
    pos-def:    "#4a8fa0"   # було 00d5e0
    pos-mid:    "#7a9a4a"   # було a0e000
    pos-fwd:    "#c25c3d"   # було ff6b35
    # Brand-locked (НЕ чіпати — зовнішні бренди)
    tg-blue:    "#2AABEE"   # tg-hover 229ED9
    # google-brand: лишається в SVG-логотипі (4285F4/34A853/FBBC05/EA4335)

  # ── Шар 2: SEMANTIC (компоненти споживають ТІЛЬКИ це) ──
  semantic:
    accent:        gold-200   # CTA, active-tab, focus-ring, highlight, hex-fill
    accent-hover:  gold-100
    bg-page:       ink-base
    bg-chrome:     ink-deep
    bg-card:       ink-2
    bg-panel:      ink-1
    line:          border
    txt:           text-body
    txt-strong:    text-strong
    txt-mute:      text-mute
    success:       green
    danger:        red
    live:          red

typography:
  family: "'Arial', -apple-system, sans-serif"
  weights: { regular: 400, semi: 600, bold: 700, black: 900 }   # 700/900 домінують
  scale:   [8,9,10,11,12,13,14,15,16,18,20,24,26,32]            # px
  tracking: { tight: 0, label: "0.5px", wide: "1px", hero: "2px", logo: "3px" }
  transform: "uppercase для лейблів/кнопок/табів/титулів"

radius:  { none: 0, full: "9999px" }   # КАНОН: 0 (кутаста хекс-ДНК) + full (кружки/аватари). 2px/4px ВИДАЛЕНО.

spacing: { base: 4, scale: [4,6,8,10,12,14,16,18,20,24,28,32,40,60] }   # px; проміжне (7,9,11,13) = баг

motion:  { fast: "150ms", base: "200ms", easing: "ease", pulse: "1.5s" }

shape:
  hex: "clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)"   # ★ ПІДПИС бренду
---

## 0. Atmosphere / Visual Theme

GOAT — **темна, кутаста, «трофейна» фентезі-арена**. Настрій: преміальний спорт-мінімал, не геймерський неон. Три носії характеру:
1. **Темний монохром** (`ink-*`) як сцена — нічний стадіон, контент світиться зверху.
2. **Champagne-gold `#BFB294`** як єдиний герой-акцент — нагорода, статус, «обране». Приглушене золото, не блискуче.
3. **Гексагон** (`shape.hex`) — підпис форми: аватари гравців, номери матчів, бейджі рангу, слоти команди. Кутастість навмисна → `radius:0`.

Емоційний пік — **GOAT/MOTM-картка**: суцільне золото + корона 👑. Це єдине місце, де золото домінує площею.

## 1. Color Palette & Roles  (value → intent → boundary)

- **`accent` #BFB294 (gold-200)** → CTA, активний таб/поз-таб, focus-ring, highlight, hex-fill, виділення «моє». **Boundary:** ніколи не фон цілої сторінки; як текст — лише короткі лейбли/числа (контраст на темному ОК, на світлому — ні).
- **`accent-hover` #d4c9a8 (gold-100)** → hover усіх золотих кнопок/елементів. **Boundary:** тільки hover, не статичний стан.
- **gold-300…900** → глибинні тони MOTM-карток (border/hex/status). **Boundary:** лише в контексті «золотої» картки; не вводити новий warm-відтінок «на око» — брати наявну сходинку.
- **`success` #4CAF50 / `danger` #ff4444** → єдині зелений і червоний на весь застосунок (toast, auth-msg, save/cancel, live-dot, lock). **Boundary:** жодних інших зелених/червоних (Material-пара видалена).
- **availability** (warn-hi/lo, avail-in/out) → лише крапки доступності гравця. **Boundary:** не використовувати як загальний статус.
- **position** (pos-gkp/def/mid/fwd, землисті) → лише бейдж позиції в модалці профілю гравця. **Boundary:** приглушені, в гамі бренду; не неон.
- **brand-locked** (tg-blue, google SVG) → лише відповідні кнопки інтеграцій. **Boundary:** не переозначати.

> ВИДАЛЕНО з канону: `#ffd700` (трофейне золото топ-3) — друге золото, не реалізуємо. Топ-3 у Standings = медаль-емодзі 🥇🥈🥉 **на початку імені менеджера**; номер рангу лишається `accent` #BFB294 (див. §3).

## 2. Typography Rules

- Родина — `Arial` (системна, без веб-шрифтів → 0 CLS).
- **900 (black)** — титули, логотип, числа-герої (рахунок, ранг, BPS), CTA. **700 (bold)** — лейбли, імена, таби. **600** — другорядні кнопки. **400** — тіло тексту правил.
- Лейбли/кнопки/таби/секц-титули — `text-transform:uppercase` + tracking 0.5–3px (що менший кегль, то ширший tracking).
- Кегль із `typography.scale`. h-ролі: page-title 16px/900, gw-title 15px/900, section-title 10–12px/900 uppercase, body 13px/400 lh 1.7.

## 3. Component Stylings  (+ обов'язкові стани)

**Button / primary** (`.btn-primary` — ЄДИНИЙ; зливає auth-btn, strip-submit, profile-save, admin-add-btn, 2 inline в app.js):
```
default        : bg accent, text ink, padding 10px 20px, weight 900, uppercase, tracking 1px, radius 0
hover          : bg accent-hover (#d4c9a8)
:focus-visible : outline 2px accent, offset 2px        ← ОБОВ'ЯЗКОВО (див. §7)
:active        : translateY(1px)
disabled       : opacity .5, cursor not-allowed
loading        : текст→спінер, ширина зафіксована
```
**Button / outline** (`.btn-ghost` — page-back, mt2-change): border 1px accent, text accent, bg none → hover bg accent/text ink. focus-visible однаковий.

**Link** (`.link-name` — ЄДИНИЙ клікабельний рендер; зливає lb-name-btn + lb-name-link):
```
default : color text-body, no underline
hover   : color accent, underline
:focus-visible: outline 2px accent offset 2px
```

**Hex avatar** (`shape.hex`): outer = accent (selected) або ink-3 (default); inner = ink-2; MOTM → gold-500 outer. Це форма-підпис, не змінювати геометрію.

**Standings row / top-3:** номер рангу = `accent` (без #ffd700). Медаль 🥇🥈🥉 префіксом до `.link-name` менеджера для ranks 1–3. Рядок «я» = bg gold-bg.

**Status cards (empty / loading / error)** — обов'язковий набір:
```
empty   : .empty-state — емодзі 48px, h3 text-mute, p text-dim, центр, padding 60px
loading : .loading-spinner — text accent, padding 60px
error   : текст danger + інструкція retry (mb-api-note патерн)
```

## 4. Layout Principles

- Мобільний-first, односмугова стрічка; ширина контенту обмежена (page-body max 640px).
- Sticky-шари: nav (top:0, z200) → tabs (top:56, z190) → team-strip (bottom, z300).
- Горизонтальні скрол-стрічки карток (player-row, live-strip, mt2-strip) зі схованим скролбаром.
- Ритм відступів — лише зі `spacing.scale`.

## 5. Depth & Elevation

Дизайн **плаский**: розділення бордером (`line`), не тінню. Єдина дозволена тінь — золоте glow на активному редагуванні: `box-shadow:0 0 12px rgba(191,178,148,.3)` (`.changing`, driver-highlight). Жодних м'яких drop-shadow.

## 6. Responsive Behavior

- Брейк `@media(max-width:480px)`: nav 56→50px, картки -8–12px, кеглі -1–2px.
- Touch-таргети ≥ 28px (хекс-картки, таби).
- `@media(hover:hover)` гейтить hover-ефекти (translateY, info-btn) — миша так, тач ні.

## 7. Do's & Don'ts

- ✅ Кожен інтерактивний елемент має `:focus-visible{outline:2px solid accent;offset:2px}`. Відсутність = critical.
- ✅ Усі відступи зі `spacing.scale`. 7/9/11/13px = баг.
- ✅ Клікабельне ім'я має РІВНО один рендер (`.link-name`).
- ✅ Золота кнопка — лише `.btn-primary`; новий padding = борг.
- ❌ Жодного сирого hex у компонентах — лише semantic-токени.
- ❌ Жодного нового warm-gold/сірого «на око» — спершу сходинка в primitive.
- ❌ `radius:2px/4px` — заборонено (канон 0 + full).
- ❌ Друге золото (#ffd700), Material green/red — видалено, не повертати.
- ❌ Неонові позиційні кольори — лише приглушена земля.

## 8. Agent Prompt Guide

Перед будь-якою UI-правкою GOAT: читай цей файл, НЕ виводь стиль із коду (легасі-дрейф). Бери значення з YAML-ядра. Кожна згенерована/змінена сторінка несе stamp із `meta.stamp`. Verify-loop: після правки — `npm test` + `npm run test:e2e` + візуальна звірка проти цього спека (хекс-форма, єдине золото, focus-ring, 0-radius). Розходження коду й токенів = «штамп бреше» → diff і фікс.
