# CLAUDE.md

_Last reviewed: 2026-08-09 (гигиена репозитория: fail-open в Telegram-вебхуке закрыт, 36 advisory → 0, мёртвый Vercel Workflow удалён, сборка без Airtable починена, линтер и тесты зелёные, появились `AGENTS.md`, `.env.example`, `npm run verify` и CI)._

_**Читать первым — `AGENTS.md`**, он общий для всех агентов; этот файл дополняет его спецификой Claude Code. Дальше: свежий `docs/handoff-*.md` (берите по дате в имени, а не по этой ссылке — она устареет), затем `docs/audit-2026-07-11.md` (полный аудит: код, документация, безопасность) и более ранние handoff'ы как история решений._

**КРИТИЧЕСКИЙ УРОК 2026-07-14 — авторизация живёт в `src/proxy.ts`, НЕ в middleware.ts.** Next 16 переименовал middleware в proxy и МОЛЧА игнорирует старый файл (и корневой `proxy.ts` при src-структуре тоже). Из-за этого админка простояла публично открытой с апгрейда на Next 16. Не создавать `middleware.ts`; `runtime` в config proxy не задавать (бросает ошибку); после любого деплоя, трогающего авторизацию, проверять анонимным curl: `/admin` → 307, `/api/admin/...` → 401.

This file is the primary operating guide for **Claude Code** when working in `jumboinjapan/jumboinjapan`.

Claude's role in this repository is **implementation-heavy engineering**: inspect the codebase, fix bugs, refactor safely, implement scoped features, run verification, and report clearly what changed. Architecture review may happen, but the default expectation is that Claude can work directly with code.

## 1. Project identity

JumboInJapan is a Russian-language private guide and Japan travel-planning website.

The product should feel like:

- a personal guide service,
- calm and competent,
- route/logistics aware,
- grounded in local Japan context,
- useful for real travelers, not just SEO traffic.

Do not turn the site into a generic travel blog, city directory, or anonymous travel portal.

## 2. Current architecture baseline

Treat this as the current working model unless the code proves otherwise.

- Framework: Next.js App Router.
- UI: React, Tailwind CSS 4, componentized layout under `src/components`.
- Content: mostly Russian public-facing copy in `src/app`, `src/data`, and page-level modules.
- SEO: Next metadata, canonical URLs, OpenGraph, schema.org JSON-LD.
- Analytics: Vercel Analytics.
- Config: `next.config.ts` includes redirects and `withWorkflow(nextConfig)`.
- Data pipeline: Japan Travel event ingestion through `scripts/import-japantravel-events.mjs` and `src/lib/japantravel-*` modules.
- External storage: Airtable is the canonical storage layer for imported resources/events.
- Images: files live ONLY in `public/`; the authoritative image path lives in exactly ONE place per surface (stop photos & multi-day heroes → Airtable; static-page heroes, cards, OG → code). Canon, naming rules, and the change process: `docs/photo-storage.md`. Validate with `npm run check:images` before any photo-touching commit.
- Типографика: русский текст типографируется НА РЕНДЕРЕ — `typoDeep(props)` из `src/lib/typography.ts` в отображающих компонентах. Неразрывные пробелы, многоточия и дефис-тире в исходниках руками не расставляются. Подробности и границы — ниже, раздел «Типографика».

Important package scripts:

```bash
npm run dev
npm run build
npm run lint
npm run check:images          # целостность ссылок на фото (код+Airtable+public/)
npm run check:typography      # грубые ошибки русской типографики в исходниках
npm run check:copy            # длина текстов по ролям (код + Airtable)
npm run test:typography       # инварианты типографера
npm run sync:photo-fallback   # регенерация src/data/route-stop-photos.generated.json
npm run import:japantravel-events
npm run maintain:japantravel-events
npm run report:japantravel-recurring
```

Note: `npm run lint` runs `eslint .` directly (Next.js 16 removed the `next lint` subcommand — if you see `Invalid project directory provided`, that's the old command resurfacing; `eslint.config.mjs` ignores `.next/**`, `next-env.d.ts`, `node_modules/**`, `public/**`).

## 3. Claude's primary responsibilities

Claude should be able to:

1. Fix TypeScript, React, Next.js, build, routing, metadata, and styling errors.
2. Implement scoped UI/page/component changes.
3. Refactor duplicated or fragile code without changing product behavior accidentally.
4. Improve importer/data-pipeline code only with explicit attention to dry-run/write safety.
5. Add tests or verification scripts when useful and proportional.
6. Update documentation when architecture, commands, or operational behavior changes.
7. Produce small, reviewable PRs or patches.

Claude should not behave only as a commentator. If the task is implementation-oriented, inspect the code, make the change, and verify it.

## 4. First steps for any task

Before editing:

1. Read the user request carefully.
2. Identify the affected area:
   - public page/content,
   - component/design system,
   - route/metadata/SEO,
   - import/data pipeline,
   - build/dependencies,
   - docs/workflow.
3. Inspect the relevant files before proposing a fix.
4. Check nearby patterns and reuse them.
5. Keep the change as small as possible.

Do not start by rewriting large files or introducing new abstractions unless the task clearly requires it.

## 5. Protected areas and extra caution

These areas can break production behavior or search visibility. Treat them as high-risk.

### Routing and deployment

- `next.config.ts`
- redirects
- canonical URLs
- sitemap-related files
- domain redirects between `www.jumboinjapan.com` and `jumboinjapan.com`

Rules:

- Do not remove redirects without a replacement or explicit approval.
- Do not change canonical strategy casually.
- If route paths change, add redirects and document affected URLs.

### Global app shell and SEO

- `src/app/layout.tsx`
- global metadata
- schema.org JSON-LD
- `AppShell`, header, footer, navigation

Rules:

- Schema must match visible page content.
- Metadata must support Russian-language search intent.
- Do not duplicate conflicting schema across pages.

### Homepage and core offer pages

- `src/app/page.tsx`
- `src/app/city-tour/**`
- `src/app/intercity/**`
- `src/app/multi-day/**`
- `src/app/contact/**`

Rules:

- Preserve personal private-guide positioning.
- Keep CTAs clear but not aggressive.
- Do not replace human copy with generic SEO filler.

### Japan Travel / Airtable pipeline

- `scripts/import-japantravel-events.mjs`
- `src/lib/japantravel-events.ts`
- `src/lib/japantravel-event-intake.ts`
- `src/lib/japantravel-event-maintenance.ts`
- Airtable field/state/resource mapping modules

Rules:

- Dry-run must remain the default.
- Writes must require explicit `--write` or equivalent intent.
- Do not introduce destructive delete unless explicitly requested and documented.
- Preserve deterministic IDs and duplicate handling.
- Lifecycle changes must be documented.
- If scoring changes, include examples and rationale.

## 6. Coding rules

### General

- Prefer TypeScript clarity over cleverness.
- Reuse existing utilities/components before adding new ones.
- Keep page-level content readable.
- Avoid unnecessary dependencies.
- Avoid broad formatting churn.
- Do not rename public states, fields, or routes unless required.
- Do not commit secrets, tokens, `.env.local`, logs with credentials, or private API output.

### React / Next.js

- Prefer server components unless client behavior is required.
- Add `'use client'` only when necessary.
- Keep metadata close to the page when page-specific.
- Use `next/image` for local/public images where appropriate.
- Keep alt text meaningful for real users and SEO.
- Do not use `dangerouslySetInnerHTML` except for controlled JSON-LD or already-established patterns.

### Styling

- Use existing Tailwind/CSS variable patterns.
- Preserve visual rhythm between nearby pages.
- Check mobile behavior for any layout change.
- Avoid decorative effects that reduce readability.
- Do not introduce a new design system inside one task.

### Вёрстка согласуется со скиллом `impeccable` (решение владельца, 2026-07-31)

Любая правка, меняющая вид публичной страницы — сетка, выравнивание, отступы, кегли, порядок блоков, новая секция, — проходит через скилл `impeccable`, а не делается на глаз.

**Почему.** Хук скилла уже подключён (`PostToolUse` + `Stop` в `.claude/settings.local.json`) и ловит детерминированное: кегли мимо шкалы, хардкод цветов, произвольные значения. Но «заголовки крепятся криво» он поймать не может — это суждение, а не правило. Именно такие вещи владелец и замечает на проде.

**Порядок работы:**

1. **Вызвать скилл явно.** Он живёт в `~/.claude/skills/impeccable` и сам по себе НЕ срабатывает — только инструментом Skill или `/impeccable <команда>`. Подкоманды: `layout` (сетка, ритм, выравнивание), `typeset` (иерархия и типографика), `critique` (разбор с оценками), `polish` (вычитка перед отгрузкой), `adapt` (узкие и широкие экраны).
2. **Диагноз замером, а не взглядом.** Прежде чем двигать блоки, снять фактические координаты в браузере (`playwright-core` + `channel: "chrome"`, дев-сервер `site`): левые и правые края колонок, верх и низ соседних блоков. Расхождение рельс в 37 px и несшитый низ в 56 px — это числа, а не впечатление; на глаз они читаются просто как «криво».
3. **Перед коммитом прогнать детектор:** `node ~/.claude/skills/impeccable/scripts/detect.mjs --json <файлы>` — пустой массив значит чисто.
4. **Показать владельцу картинку, а не код** (см. правило визуалов ниже по тексту раздела).

**Канон проекта старше скилла.** При конфликте побеждают правила этого файла: шкала кеглей из `globals.css`, лимиты длины из `src/lib/copy-limits.ts`, антиква только на дисплейных ролях, канон формулировок транспорта. Скилл предлагает — канон решает.

### Превью-деплой обязателен для рискованных изменений (2026-07-11, после инцидента с админкой)

Песочница Cowork не собирает приложение (только `tsc`/`eslint`), поэтому изменения, ломающие рантайм, доезжают до прода. Инцидент: guard авторизации, добавленный во все 24 admin-роута, в проде отклонял ВСЕ запросы (админка ослепла), хотя tsc был чист.

Правило: всё, что трогает **авторизацию, middleware, env-контракт или общий слой всех роутов**, идёт через ветку + preview-деплой Vercel, и только после проверки владельцем — в main. Preview-окружение настроено (2026-07-11): переменные `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`, `ADMIN_AUTH_SECRET`, `ADMIN_ALLOWED_EMAILS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` включены для Preview; после правки env-переменных превью надо пересобрать (Redeploy без build cache).

**Конкретный технический урок:** в admin API сессию читать ТОЛЬКО из `request.cookies` (`requireAdminSession(request)`, `src/lib/admin-guard.ts`) — так же, как это делает рабочий middleware. Версия на `cookies()` из `next/headers` в проде не видела валидную сессию и отклоняла всё. Не переписывать обратно.

### Adversarial pass — обязательный прогон перед коммитом (2026-07-10)

Песочница не собирает приложение (tsc/eslint only), поведенческие баги доезжают до прода. Серия факапов 10 июля имела один корень: фича отгружалась по счастливому пути. Перед коммитом любой фичи ответить на 5 вопросов:

1. **Существующие данные:** как фича поведёт себя на записях, созданных до неё? (rename прилёта работал только для generated-items — старые manual молчали)
2. **Конкурирующие источники состояния:** у любого нового хранилища (localStorage, кэш, вторая вкладка) должна быть политика конфликтов с timestamp «кто новее» (черновик-кэш без неё показал пустой тур поверх сохранённого; «Сохранить» затёрло бы базу)
3. **Время и пояс:** владелец в Японии (UTC+9); даты — чистый UTC насквозь, пример прогнать под TZ=Asia/Tokyo (18 окт рендерилось как «17 окт»)
4. **Идемпотентность генераторов:** ввод может уже содержать то, что генератор добавляет (slug `classic-japan-7-days-7-days`)
5. **Разрушающие записи:** каким состоянием «Сохранить» может перезаписать базу? Guard от «пустое поверх полного»

Если сценарий проверяем только на проде — явно написать владельцу, что именно проверить.

### Data/import scripts

- Keep command-line behavior explicit and predictable.
- Validate arguments.
- Log enough information for operators to understand decisions.
- Make failures actionable.
- Prefer idempotent writes.
- Keep reports human-readable.

## 7. Verification expectations

Run the strongest relevant verification available for the change.

For most code changes:

```bash
npm run lint
npm run build
```

При изменении русского текста (страницы, копирайт, данные) добавить:

```bash
npm run check:typography
npm run check:copy
npm run test:typography
```

There is no dedicated `npm run typecheck` script. Use `npx tsc --noEmit` directly — it works fine against the existing `tsconfig.json` and should be run whenever `.ts`/`.tsx` files change.

For UI/page changes:

- Run build.
- Manually inspect affected routes if a browser/dev server is available.
- Check mobile and desktop layout when practical.
- Confirm metadata/canonical/schema changes if touched.

For importer/pipeline changes:

Run at least a dry run, for example:

```bash
npm run check:images          # целостность ссылок на фото (код+Airtable+public/)
npm run sync:photo-fallback   # регенерация src/data/route-stop-photos.generated.json
npm run import:japantravel-events -- --pages 1 --limit 5 --dry-run
```

If changing maintenance behavior:

```bash
npm run check:images          # целостность ссылок на фото (код+Airtable+public/)
npm run sync:photo-fallback   # регенерация src/data/route-stop-photos.generated.json
npm run import:japantravel-events -- cleanup-ended --ended-before-days 14 --dry-run
npm run check:images          # целостность ссылок на фото (код+Airtable+public/)
npm run sync:photo-fallback   # регенерация src/data/route-stop-photos.generated.json
npm run import:japantravel-events -- report-recurring --status all
```

Never perform production writes unless the human explicitly requested it and the required environment is intentionally loaded.

## 8. How to report work

Every implementation response should include:

```md
Summary:
- ...

Changed files:
- ...

Verification:
- Ran: ...
- Not run: ...

Risks / notes:
- ...

Suggested next step:
- ...
```

Be honest. If a command failed, include the failure and what it likely means. Do not claim a check passed if it was not run.

## 9. PR / branch discipline

- Prefer one branch per task.
- Prefer one conceptual change per PR.
- Do not mix dependency upgrades, redesign, copy rewrite, routing, and importer changes unless the task explicitly requires it.
- If a task grows, stop and split into follow-up tasks.
- Keep commits meaningful and scoped.

Good commit examples:

```bash
fix: correct contact page metadata
fix: preserve dry-run behavior in event cleanup
refactor: extract route card component
style: improve mobile spacing on city tour page
docs: document Japan Travel importer workflow
```

Avoid vague commits like:

```bash
update stuff
fix bugs
changes
wip
```

## 10. Architecture escalation rules

Stop and ask for architecture/product confirmation before:

- changing URL strategy,
- changing Airtable schema or field names,
- changing event lifecycle state semantics,
- adding authentication/admin behavior,
- adding a new external service,
- replacing the design system,
- changing the site's core positioning,
- adding paid booking/payment flows,
- making irreversible data operations.

If the task is urgent and no confirmation is available, implement the safest reversible version and document the unresolved decision.

## 11. Collaboration model — three roles

**Папка `/Users/jumbo/Claude/Projects/Jumboinjapan.com` на машине владельца — архив, не проект.** Это переписка, брифы и черновики: не git-репозиторий, свой `CLAUDE.md` там на 236 строк короче репозиторного и устарел, а часть файлов (например `faq-drafts-batch-1.md`) уже разошлась содержимым с одноимёнными в `docs/`. Читать оттуда фактуру можно, считать её текущим состоянием проекта — нельзя. Источник правды — этот репозиторий.

This project uses three distinct AI roles that work together:

### GPT-5.5 — architecture review

GPT-5.5 (running as OpenClaw agents: Verter, Johny, Mason, Porter, and others) reviews architecture decisions, design system choices, and systemic risks.

When handing off to GPT-5.5 for architecture review, Claude should provide:

- branch or PR link,
- changed files,
- implementation summary,
- commands run and their output,
- known uncertainties,
- specific areas where architecture review is requested.

GPT-5.5 architecture review focuses on:

- product fit and positioning,
- architecture boundaries and systemic risk,
- data safety and pipeline integrity,
- SEO/schema/canonical risks,
- UX and design system consistency,
- verification quality.

Claude should fix concrete findings one by one and report the delta.

### Claude — implementation and deep audit

Claude (this agent) handles:

- heavy code implementation: bug fixes, refactors, feature shipping,
- deep audits of specific subsystems (importer pipeline, data integrity, schema),
- TypeScript/build errors, routing, metadata, pipeline logic,
- writing tests and verification scripts,
- producing reviewable PRs with clear changelogs.

### LLoyd (claude-sonnet-5, OpenClaw main agent) — orchestration

LLoyd manages task routing, backlog, agent coordination, and system-level context. LLoyd knows the full operational state of the project: active tasks, open bugs, deployment status, calendar, and team.

When Claude needs project context (what's in backlog, what's blocked, what's already in progress), it can request a summary from LLoyd via the OpenClaw inter-agent system.

LLoyd runs natively on Eduard's machine with a real local working copy and git push credentials. Claude in a Cowork session does not — see below.

### Claude in Cowork mode — environment constraints (learned 2026-07-01)

A Cowork/Claude Desktop session is an isolated sandbox with **no access to this repo by default**. Before it can do anything here, one of two things has to happen:

- Eduard connects the local folder (`/Users/jumbo/Projects/jumboinjapan`) to the session, giving Read/Write/Edit/Grep/Glob access plus a bash mount — this is the same working copy Lloyd uses, so both agents can end up editing it in the same window.
- Or the GitHub connector is authorized for that session, giving API-based repo access instead of a filesystem mount.

Even with the folder connected, **Cowork has no git push credentials** (`git push` fails with `could not read Username for 'https://github.com'`). Cowork can commit locally, but Eduard or Lloyd has to run the actual `git push` from the native machine.

Other quirks specific to the connected-folder mount:

- Stale `.git/index.lock` or `.git/objects/maintenance.lock` files can block git commands with permission errors that look like a concurrency problem but are usually just leftover locks the mount won't let a normal `rm` delete. If a git command fails with `Operation not permitted` on a `.lock` file, request delete permission for that specific file and remove it before retrying.
- Interactive `git rebase` can fail on this mount (missing `.git/rebase-merge/message` mid-rebase, a write-related quirk of the mount, not a real conflict). Prefer `git merge origin/main --no-edit` over rebase when reconciling a diverged branch here — it's a single atomic operation and doesn't depend on writing per-commit state files.
- Before starting work, always check `git status --short --branch` for ahead/behind counts — Lloyd may be actively committing to the same working copy concurrently.

## 12. Product copy rules

Public Russian copy should be:

- natural,
- personal,
- calm,
- specific,
- useful for travel decisions.

Avoid:

- generic AI tone,
- overuse of “уникальный”, “незабываемый”, “премиальный” without proof,
- empty luxury language,
- direct imperative pressure,
- keyword stuffing.

Good direction:

- explain why a route makes sense,
- mention logistics and seasonality,
- give context,
- preserve the feeling of a private guide who knows Japan from the inside.

### Правки владельца записываются в канон (2026-08-01)

`docs/copy-canon-for-agents.md` — единый блок для вставки в промпты копирайтеров (скиллы Cowork, генераторы в коде, подрядчики). Его раздел 5 «Уроки правок владельца» пополняется **после каждой правки текста рукой владельца**: правило одной строкой плюс пример «было → стало».

**Почему это обязанность, а не пожелание.** Правка владельца содержит правило, которого нет ни в одном файле: почему «сервис» хуже «услуг», почему заголовок-вопрос спорит с анкетой под ним, какие топонимы не склоняются. Без записи оно исчезает вместе с сессией, и следующий агент повторяет ту же ошибку — владелец правит её второй раз.

**Выжимка под конкретного агента:** `npm run copy-canon -- --role faq` (или `заголовки`, `кнопки`; список — `--roles`) печатает сквозные правила плюс правила роли. Метка `[все]` в начале урока означает сквозное правило. Разносить уроки по отдельным файлам под каждого агента НЕЛЬЗЯ: сквозных правил больше половины, копии разойдутся.

**Как собрать материал:** `npm run collect:copy-edits` вытаскивает из истории git пары «было → стало» по русским строкам в `src/app`, `src/data`, `src/components/sections` (за 30 дней; `-- --since 2026-07-01 --md` — таблицей). Скрипт даёт сырьё, правило формулирует агент или владелец.

**Куда это уходит дальше.** Скиллы-копирайтеры Cowork (`revidovich-copywriter`, `jj-title-copywriter`, `jumboinjapan-faq-writer`, `russian-naturalness-editor`, `geo-seo-revidovich-jumbo`) живут вне репозитория, и Claude Code их не видит. Поэтому источник правды — файл в репозитории, а в скиллы канон переносится копированием блока целиком, без пересказа.

### КАНОН длины текста: у каждой роли есть предел (2026-07-30)

**Обязательно для всех, кто пишет или компилирует тексты сайта — включая агентов-копирайтеров.** Машиночитаемый источник правды: `src/lib/copy-limits.ts`. Проверка: `npm run check:copy`.

Числа не назначены на глаз: замерена фактическая ёмкость строки на мобильном (390 px — узкое место, десктоп заведомо шире) в настоящем контейнере каждой роли. «Комфортно» — столько знаков, сколько ложится в комфортное число строк; «предел» — на строку больше, дальше блок ломается.

| Роль | Комфортно | Предел | Что ломается за пределом |
|---|---|---|---|
| Заголовок героя | 36 | 54 | Герой уходит на четыре строки и съедает первый экран |
| Заголовок страницы (h1) | 40 | 60 | Содержание уезжает за сгиб |
| Шапка раздела (h2) | 44 | 66 | Перестаёт читаться как заголовок, становится абзацем, набранным крупно |
| Заголовок карточки (h3) | 26 | 46 | Карточка растёт в высоту и рвёт ряд сетки |
| Метка над заголовком | 32 | 38 | Прописная разрядка в две строки превращается в шум |
| Лид-абзац | 120 | 160 | Это уже не подводка, а первый абзац |
| Описание карточки | 140 | 200 | Ряд выравнивается по самой высокой карточке |
| Вводный текст маршрута | 420 | 700 | Вступление конкурирует с программой |
| Вопрос FAQ | 56 | 84 | Не читается в свёрнутом виде |
| Ответ FAQ | 400 | 700 | Признак того, что вопросов на самом деле два |
| Надпись на кнопке | 20 | 28 | Кнопка растягивается на всю колонку |
| SEO-заголовок / описание | 55 / 150 | 60 / 160 | Выдача обрезает хвост |

**Главное правило: длинный заголовок не лечится уменьшением кегля.** Кегль — часть иерархии; подгонять его под текст значит разрушать иерархию ради одного заголовка. Лечится текст: длинное уходит в лид под заголовком.

Где это работает само:
- **Админка** — `CopyLengthHint` / `CopyLengthNotice` под полями в Route Texts и Конструкторе: счётчик становится жёлтым за комфортом и красным за пределом, с объяснением, что именно сломается.
- **Вёрстка** — заголовки карточек ограничены `line-clamp-2`: перелёт деградирует многоточием, а не рвёт сетку. Это страховка, а не разрешение писать длинно.
- **Проверка** — `npm run check:copy` проходит по коду (роль определяется тегом: h1/h2/h3) и по публичным полям Airtable. Падает только на перелётах; «длинновато» не блокирует.

Не проверяются намеренно: строки программы тура (Day Items, Route Days) — они переносятся свободно и сетку не держат. Лимиты существуют для блоков фиксированной формы, а не для любого текста.

### Шкала кеглей: только токены (2026-07-30)

Девять именованных шагов в `globals.css`: `--text-label` 11 → `--text-hero` 68. Заголовки набираются **только** ими. Дефолтная шкала Tailwind (`text-3xl`, `md:text-5xl`) и произвольные значения (`md:text-[62px]`) на дисплейных ролях запрещены: именно через них шкала расползлась в прошлый раз — шапки разделов оказались на 48 px, а заголовки карточек на 42, и разница между уровнями упала до 12%, которую глаз не читает как подчинение.

Текущий ряд на десктопе: герой 68 → раздел 40 → карточка 28 → шаг/FAQ 20/18 → проза 17. Шаги ×1,7 → ×1,43 → ×1,4 → ×1,18.

### Типографика: типографер на рендере (2026-07-30, аудит `docs/typography-audit-2026-07-29.md`)

Аудит нашёл ровно ноль неразрывных пробелов на 1,8 млн символов русского текста при ~19 900 местах, где они нужны. Расставлять их руками бессмысленно: каждый новый абзац снова придёт без них. Поэтому текст типографируется на выводе.

**Как это устроено.** `src/lib/typography.ts` — `typo(string)` и `typoDeep(object)`: неразрывные пробелы (однобуквенные предлоги, длинное тире, число + единица, сокращения, №), многоточие, схлопывание сдвоенных пробелов, дефис в роли тире. Подключено в 24 отображающих компонентах через `typoDeep(props)`, в копирайт-константах страниц и `src/data`, а также там, где компонент забирает данные сам (журнал, события, SEO-поля маршрутов).

**Правила, которые нельзя нарушать:**

1. **Типографер стоит на границе показа, а не на границе чтения данных.** Логика обязана видеть сырой текст: `tour-pricing` ищет подстроку «частный транспорт», `working-hours` парсит часы, фильтры сравнивают строки. Не переносить `typoDeep` в слой Airtable. Единственное исключение — `getMultiDayRouteSeoFields` (там всё поля-витрины), оно подписано в коде.
2. **В клиентских компонентах — только через `useMemo(() => typoDeep(props), [props])`.** `typoDeep` создаёт новые объекты; без мемоизации они уходят в зависимости хуков, и эффект с `setState` на `[stops]` в `IntercityRouteTimeline` даёт бесконечный цикл.
3. **Не расширять типографер правилами, требующими понимания смысла.** Числовой диапазон неотличим от японского адреса `Асакуса, 1-32-11`, десятичная точка — от даты `18.07`, границы цитаты регуляркой не вычисляются. Это правится в данных (`scripts/fix-airtable-typography.mjs`, dry-run по умолчанию) и ловится через `npm run check:typography`.
4. **PDF не типографируем.** Причина одна: pdfkit ломает строку по `\s`, куда U+00A0 попадает, — то есть перенос всё равно случится, а смысл неразрывного пробела теряется. Глифов это не касается: проверено, U+00A0, тире и многоточие в PT Sans и PT Serif есть; отсутствует именно U+2009, из-за которого в прошлый раз печатались квадраты. `/p/<token>` и печатное превью идут через `PrintProgramDocument` и типографируются, PDF — нет.
5. **`metadata` не трогаем** — в однострочном обрезаемом `<title>` неразрывные пробелы не видны, а SEO-строки без выгоды лучше не менять.

**Антиква только на h1/h2** (решение владельца 2026-07-30). h3 — гротеск Geist Medium: это заголовки карточек, шагов и FAQ, то есть подчинённый уровень, и антиква на подписи в 18–20 px читается как блог, а не как редакционная уверенность.

**Микротипографика в базовом слое:** висячая пунктуация (`hanging-punctuation`, пока только Safari), `text-wrap: pretty` на абзацах против висячих слов, табличные цифры в метках и подписях, подчёркивание ссылок ниже базовой линии. Всё это прогрессивные улучшения — там, где браузер не поддерживает, просто ничего не происходит.

**Границы в `SKIP_KEYS`** (`type`, `mode`, `status`, `slug`, `href`, …) — ключи логики. `name`, `alt`, `value` намеренно НЕ в списке: это видимый текст. Латинские значения типографер и так возвращает как есть.

### КАНОН транслитерации географических названий (владелец, 2026-07-14)

По умолчанию — система Поливанова (Дзуйходэн, Этиго-Цумари, Мацусима). НО устоявшиеся поисковые написания имеют приоритет — решение владельца в пользу SEO-практики. Текущие исключения: **«Хаконе»** (НЕ «Хаконэ») — везде: код, Airtable, метаданные, включая производные (Хаконе Дзиндзя, Мотохаконе, Хаконемати). Унификация проведена 2026-07-14 (код + все таблицы Airtable). Новые исключения добавлять **только** в `POLIVANOV_EXCEPTIONS` (`src/lib/polivanov.ts`) — оттуда правило расходится само.

**Как решается спор о написании (владелец, 10.08.2026).** Счёт по русской Википедии: `insource:"форма"` для ОБЕИХ форм, с одним и тем же фильтром на японский контекст. Симметрия обязательна — асимметричный замер дал «Кобе» ×5,3 вместо настоящих ×3,7. Регулярным выражением не мерить: оно ловит подстроку и приписывает «Кобе» ещё и Кобеляки (3540 вместо 113).

Замер решает только там, где корпус толстый: Токио ×430, Иокогама ×14,5, Кобе ×3,7, Хакодате ×2,2. Где корпус тонкий — Хаконе 27:23, Сендай 110:109 — решает владелец, и это записывается как решение, а не выдаётся за измерение. Подмена здесь реальна: Википедия мерит корпус энциклопедии, а канон сайта обоснован ПОИСКОМ, и у «Хаконе» счёт даёт ничью при однозначном решении владельца от 14.07.2026.

Google для замера не годится: русские имена есть лишь у 21% нашей базы, и среди них озеро Акан подписано по-сербски, а Сирахигэ — через «ши», вопреки канону.

**Правило теперь исполняется, а не пересказывается (10.08.2026).** Три года оно жило прозой здесь, в промпте исследователя и таблицей исключений в коде — и не стерегло ни один путь записи: агенты через транслитератор не ходят, они пишут имя сами. Замер показал 58 вхождений «Хаконэ» в POI и ещё 144 в маршрутах, включая утверждённые описания и SEO-заголовки, то есть текст, уехавший на сайт. Теперь `canonicalText()` чинит написание на входе в канон, а список запрещённых форм не ведётся руками, а **выводится**: для каждого исключения считается, что дал бы чистый Поливанов, и расхождение с каноном и есть запрещённая форма. Добавили строку в `POLIVANOV_EXCEPTIONS` — запрет появился сам. Замена идёт подстрокой, поэтому производные (Мотохаконе, Хаконемати) чинятся вместе с корнем.

### КАНОН: японские топонимы не склоняются (владелец, 2026-08-01)

«Я не люблю склонять японские топонимы за редкими исключениями» — решение владельца. По умолчанию названия остаются в исходной форме во всех падежах: «от Гинза до Сибуя», «в Сибуя», «с Гинза», «у статуи Хатико в Сибуя», «переехала на Тоёсу».

Исключения — устоявшиеся написания, которые уже склоняются в русском повсеместно и режут глаз в неизменяемом виде: Токио (не склоняется само по себе), Киото, Осака («в Осаке» допустимо, если так уже написано на сайте). Новые исключения добавлять сюда по решению владельца.

Правило распространяется на публичные тексты, FAQ и тексты в Airtable. Оно НЕ переопределяет канон транслитерации (Поливанов + устоявшиеся поисковые написания, см. выше) — это отдельный вопрос: как писать, а не как склонять.

### КАНОН формулировок видов транспорта (владелец, 2026-07-11)

В любом публичном тексте и в UI конструктора используются ТОЛЬКО эти термины: **Самостоятельно / Общественный транспорт / Частный транспорт / Заказной транспорт / ЖД / Авиа**. Другие формулировки не вводить. ЗАПРЕЩЕНЫ (юридические соображения): «автомобиль с гидом», «машина с гидом», «гид с машиной», «гид-водитель» — этот формат публично называется «частный транспорт», без расшифровки, кто за рулём. «С гидом» как отдельная переменная сопровождения (чекбокс) — допустимо; «без гида» = «самостоятельно». Термин «синкансэн» в лейблах транспорта заменён на «ЖД».

### Транспортная доктрина (фундаментальное бизнес-правило владельца, 2026-07-06)

Любой публичный текст (страницы, FAQ, метаданные) обязан подавать передвижение так:

- **Внутри города** (Токио, Киото): общественный транспорт уместен, может быть частью опыта.
- **Большие переезды между регионами**: синкансэны и суперэкспрессы — да, комплиментарно, обязательная часть тура и логистики.
- **Вне мегаполисов / в глубинке**: автомобиль с гидом — основной формат (двери-в-двери от отеля, свой темп, вещи в багажнике, остановки по пути).
- **VIP**: лимузин-сервис — упоминать как опцию, когда уместно.
- **Локальные электрички/автобусы между городами**: только справочно, с маркером «для самостоятельных поездок». Никогда — как формат тура с гидом для индивидуалов (так ездят разве что сборные группы).

Нарушение = переписывание. Эталон правильной подачи — FAQ Хаконэ (Airtable Routes.FAQ, живой на /intercity/hakone). Расширенная версия с примерами «было → стало» живёт в Cowork-скилле `jumboinjapan-faq-writer`; суть продублирована здесь, потому что Claude Code скиллы Cowork не видит.

### КАНОН: продолжительность тура не выносится в тексты и документы (владелец, 2026-07-18)

Число дней программы — переменный и опциональный параметр под конкретного клиента, а не свойство тура. Поэтому:

- НЕ выводить продолжительность («N дней», «N-дневный») в распечатки (PDF-обложка, печатное превью, публичная страница `/p/<token>`), в генерируемые описания (fallback meta description, подписи карточек) и в новые публичные тексты о турах конструктора.
- НЕ зашивать число дней в автогенерируемый slug (`-19-days` в URL врал бы после изменения программы; легаси-хвосты `-N-days` у существующих slug'ов не трогать — это постоянная идентичность записи).
- Допустимо: нумерация дней внутри программы («ДЕНЬ 1», даты), machine-readable `duration` в schema.org JSON-LD, внутренние админ-поверхности (карточка клиента, расчёт стоимости, шапка билдера) и осознанные диапазоны в кураторском копирайте статических модельных туров («7–8 дней», «От 4 дней»).

Реализация первой волны: коммиты `a047011` (документы и описания) и далее (slug). При написании нового кода/копирайта — соблюдать по умолчанию.

### Канон транспорта и тона (2026-07-18, решения владельца)

Классификация: **Общественный транспорт** = метро/ЖД/автобусы + такси + Uber Black Van; **Заказной транспорт** = лимузин-сервисы (MK Taxi, Hinomaru Limousine и аналоги); **Частный транспорт** = транспорт по договорённости с гидом (без указания гида как водителя). Публичные ярлыки карточек — только канонические термины; такси/лимузин/бренды — только внутри описаний.

Подача: три опции сквозные; карточки одинаковые для всех туров одного ТИПА, не отдельного тура. Типы: Токио (day-one, day-two, hidden-spots) / Выездные экскурсии (все intercity + Такао и Митакэ) / Многодневные. Карточка передаёт уровень комфорта в контексте типа тура, без логистических деталей (ветки, линии метро, пересадки — запрещены). Выездные: частный — наиболее выгодно, общественный — деликатно пессимизирован, заказной — оптимизирован без люкс-акцента (без ощущения расслоения).

Тон: повелительное наклонение к клиентам строго запрещено («идите», «попробуйте», «возьмите» — просторечие). Регистр — люксовый консьерж: деликатно передавать ощущение, по-деловому, без приторности. Кнопки-инфинитивы («Обсудить маршрут») допустимы. Slug заказного формата: `/city-tour/charter` (бывш. `/limousine`, 301 в next.config.ts).

### КАНОН: закрытый POI в программу не ставится (владелец, 2026-08-10)

Поле **Operating Status** у POI: `Работает` | `Сезонный` | `Закрыт временно` | `Закрыт навсегда` | `Не проверено`. Решение принимает `checkProgrammeUsable()` в `src/lib/poi-canon.ts` — это ЕДИНСТВЕННОЕ место, где правило записано; в агентах и промптах его дублировать нельзя, иначе разойдётся.

- Ставить точку в день тура при статусе `Закрыт временно` / `Закрыт навсегда` — запрещено.
- `Сезонный` — НЕ разновидность закрытого. Google не различает межсезонье и закрытие и отдаёт сад слив в Судзуке (POI-000005) как `CLOSED_TEMPORARILY` одиннадцать месяцев в году. Автопрогон `operatingStatusFromGoogle()` сезонность не затирает; ставить сезонную точку можно, сверив даты тура с окном в Working Hours.
- `Не проверено` не блокирует, но обязывает сверить состояние перед выдачей гостю.
- **«Работает» не ставится исследованием.** Бот приёма (`RESEARCH_SYSTEM_PROMPT`) заполняет статус только при подтверждённой находке о закрытии или сезонности; «Работает» приходит из `businessStatus` Google, потому что это единственный статус, действующий без замечаний, и он обязан быть проверяемым. `parseResearchJson` подрезает «Работает» из ответа модели, даже если та его написала.
- Завести закрытую точку в базу МОЖНО и нужно: `applyCanon` даёт по ней `warn`, а не `error`. Запрет на запись означал бы, что база не помнит о закрытии, и коллектор заведёт объект заново как незнакомый.

## 13. Known audit points in this repo

Resolved 2026-07-01:

- ~~Next dependency and `eslint-config-next` version alignment~~ — выровнено 2026-08-09: `eslint-config-next` поднят до 16.3.0 вслед за `next`. Прослойка `FlatCompat` при этом перестала работать («Converting circular structure to JSON»), `eslint.config.mjs` переведён на flat-конфиги напрямую.
- ~~Whether `npm run lint` is compatible with the installed Next version~~ — fixed, see above.
- ~~Orphaned files~~ — removed: duplicate `mockup-intercity-hero.html`, unused `src/data/batch-2..5-input.json`, dead `storage/admin-seo-llm-drafts.json`, 11 unreferenced images in `public/`, one-off migration scripts (`scripts/enrich-restaurants.js`, `fix-prices.js`, `find-trip-hotel-ids.js`, `scrape-restaurants.js`, `src/data/update-batch2..5.js`, `update-descriptions.js`). `public/preview/*.html` design mockups relocated to `docs/design-previews/`.

Still open, pay attention when touching related areas:

- Structured data consistency between global layout and page-level schema.
- Redirect coverage for legacy `/from-tokyo/...` paths.
- Importer decision names and README/docs consistency.
- Airtable lifecycle semantics: active vs archived vs ended.
- Whether public event/resource pages hide archived or ended records correctly.
- ~~`docs/multi-day-route-builder-spec.md` staleness~~ — reconciled 2026-07-01 (independent day type, `/admin/multi-day` shipped status).
- ~~Remaining lint debt (exhaustive-deps × 5, unused eslint-disable)~~ — resolved 2026-07-03. **Запись протухла**: к 2026-08-09 линтер давал 35 ошибок и 60 предупреждений, из них 33 ошибки — в `docs/design-previews/admin-redesign-test.mjs`. Приведено в порядок 2026-08-09, `npm run lint` снова зелёный и снова ворота. Урок общий: строки в этом списке — датированный журнал, а не описание текущего состояния; проверяйте запуском, а не чтением.
- **Долг компилятора React (зафиксирован 2026-08-09).** `eslint-config-next` 16 включил правила компилятора: 24 `set-state-in-effect`, 3 `purity`, 1 `static-components` — все в админских экранах. Понижены до warn в `eslint.config.mjs` с пояснением, чтобы линтер оставался воротами для новых ошибок. Поднимать обратно по одному правилу по мере разделения этих модулей.
- **TODO: split `src/lib/japantravel-events.ts` (1467 lines) into smaller modules** (types/text-geo-dedupe utilities/HTML-JSON-LD parsing/Airtable I/O/orchestrator — see natural seams via `grep -n "^export \(async \)\?function\|^function "`). Network is no longer blocked from Cowork (verified 2026-07-03: `en.japantravel.com` → 200, `api.airtable.com` reachable), but see the next bullet — the dry-run baseline currently returns 0 candidates, so "identical before/after decisions" is not a meaningful refactor check until the index parser is fixed.
- **BROKEN: importer index parsing finds 0 events (found 2026-07-03).** Dry-run (`--pages 1 --limit 5 --dry-run`) runs cleanly — Airtable read OK (366 known IDs), fetch OK, dry-run safety intact — but stops at page 1 with `source-exhausted`. Cause: `en.japantravel.com/events` no longer embeds per-event `Event` JSON-LD in the index page (only a `BreadcrumbList` block); event data now lives in an HTML-escaped hydration payload, and `parseIndexCandidates()` relies solely on `extractEventJsonLd()`. Detail pages still contain `Event` JSON-LD, so `parseDetailPage()` is likely fine. Fix: parse the hydration payload (or the visible event-card markup) on the index page. Not a sandbox artifact — same result with a browser User-Agent.
- ~~Route Builder → live `/multi-day/*` publishing gap~~ — wired up 2026-07-03: fixed a real bug where the publish-status gate checked for a `'Live'` value that never existed in Airtable (the real select option is `'Published'`, so status silently reset to Draft on every read/write); added a Status control to `/admin/multi-day`; added `src/app/multi-day/[slug]/page.tsx` which renders a Route Builder route only when `status === 'Published'`; linked from the `/multi-day` hub. **Verified against live data 2026-07-03** (network to `api.airtable.com` is now open from Cowork): flipped `multi-day/golden-route-7-days` («Золотой Маршрут») to Published in Airtable, dev server rendered `/multi-day/golden-route-7-days` correctly (200, Russian title/canonical/TouristTrip JSON-LD, per-day sections), Draft status correctly 404s both before and after revert; route restored to Draft. Also note: the current live `/multi-day/classic` and `/multi-day/mountain` pages are untouched static content — none of the routes drafted in the builder so far match those slugs, so this doesn't replace them, only adds a way to publish *new* builder-authored routes.

Добавлено 2026-07-14 (расчёт стоимости тура):

- **Блок «Расчёт тура» в Конструкторе** (`TourPricingPanel`, `src/lib/tour-pricing.ts`). Матрица базовых ставок — таблица Airtable **Pricing** (`tblPZ1EdCuhq6Fhr8`), ключ `Rate Key` (не переименовывать): `guide_day` $500/день, `guide_day_private_transport` $1000/день, `chartered_transport_day` $1000/день (диапазон $1000–1500 — в ремарке; расход ПОВЕРХ работы гида $500, решение владельца 2026-07-14), `guide_night_outside_tokyo` $150/ночь. Поле **Notes** каждой ставки — ремарка владельца («транспортные расходы не включены…», «включает минивэн, парковки, топливо…») — выводится под строкой разбивки в админке и в PDF. Правится в подблоке «Базовые ставки» (API `/api/admin/pricing`, GET/PATCH) или прямо в Airtable; недоступность таблицы страхуется `FALLBACK_PRICING_MATRIX`.
- Пер-туровые вводные (гости, override ставок, формат дня, ночёвки гида, ручные строки, флажок PDF) живут в `route.pricing` → Routes.**'Pricing Data'** (`fldhcOemy8VCyAz1p`, JSON, санитайзер `parseRoutePricingData` на чтении И записи). Старые туры без поля = null = дефолты; старые клиенты не затирают поле (route гоняется целиком).
- Формат дня выводится автоматически: `independent` → без гида; переезд на авто / «частный|заказной транспорт|лимузин» в программе → гид+частный транспорт ($1000); иначе гид ($500). Ночёвка гида: вне Токио (подстрока «токио/tokyo»), не departure-день, гид работает в этот или следующий день. Всё переопределяется вручную в таблице расчёта.
- **PDF**: страница «Стоимость программы» (`drawPricingPage`) считается ВСЕГДА (решение владельца 2026-07-15) — даже если блок «Расчёт тура» не заполнялся (дефолты: авто-формат дней, базовые ставки; без цены на человека, пока не задано число гостей). Состав: таблица по дням (день / формат работы / работа гида / ночёвка гида) + свод с ремарками ставок + итого + на человека. Выключается только флажком в блоке «Расчёт тура». Примечания владельца в текстах программы («Требует предварительной организации», «по желанию гостей», «Уточнить: …» — маркеры в `isOwnerActionNote`, print-program.ts) печатаются акцентом и жирнее в PDF и превью. На каждой странице PDF — водяной знак jumboinjapan.com (`drawWatermark`).
- Вёрстка PDF компактная (решение владельца 2026-07-15): день НЕ всегда с новой страницы — продолжает текущую, если остаётся ≥240 pt (шапка + вводка + одна точка), иначе новая. На 14-дневном туре: 18 → ~13 страниц, «свободные» дни группируются.
- Исправлены три рантайм-бага первой версии PDF-генератора (найдены смоук-тестом `pdftoppm`): (1) колонтитулы ниже нижнего поля заставляли pdfkit добавлять ПУСТУЮ страницу после каждой содержательной — обёртка `textBelowBottomMargin` обнуляет margins.bottom на время печати; (2) разрядка `tracked()` вставляла U+2009, которого нет в PT Sans — во всех капс-строках печатались квадраты; заменена на `characterSpacing` (константа `TRACKING`); (3) длинная дата в шапке дня наезжала на «ДЕНЬ N» — при нехватке ширины разрядка отключается. Смоук-тест PDF: отрендерить фиктивную программу через `renderTourProgramPdf` (tsx) и посмотреть страницы `pdftoppm -png`.

Добавлено 2026-07-10 (после инцидента с перезаписью тура пустым состоянием):

- **Серверные предохранители сохранения Конструктора** (`saveMultiDayBuilderRoute`, `src/lib/multi-day-builder-storage.ts`). Урок инцидента: клиентские guard'ы не защищают базу — прод может крутить старый клиент. Теперь сервер сам отклоняет разрушающие записи (HTTP 409 + код):
  - `SHRINK_BLOCKED` — входящая программа ≤2 блоков или меньше половины существующей (при существующих ≥5): похоже на случайную перезапись пустым состоянием. Override: повторное «Сохранить» в течение 15 с (клиент шлёт `saveOptions.allowShrink`).
  - `DEMOTE_BLOCKED` — попытка увести Published-маршрут в другой статус побочным эффектом сохранения. Override аналогично (`allowDemote`).
  - `SYNC_CONFLICT` — optimistic concurrency по `Last Builder Sync`: клиент шлёт штамп, который загрузил; расхождение = базу менял кто-то ещё; override НЕТ, только перезагрузка маршрута. Сервер возвращает новый штамп (`builderSync`) в ответе сохранения, клиент обновляет его в состоянии.
  - `SLUG_TAKEN` — сохранение с изменённым slug (переименование) в slug, занятый другой программой; override НЕТ.
  - **Идентичность и переименование**: slug — ключ upsert'а. У сохранённого маршрута slug НЕ регенерируется из названия/числа дней (это плодило программы-дубли); slug редактируется явным полем в Параметрах, клиент шлёт `saveOptions.previousSlug`, сервер патчит ту же запись Routes (rename, не создание) и подчищает детей под старым slug после успешной записи новых. Смена slug опубликованного тура меняет публичный URL без редиректа — предупреждение в UI.
  - **Автобэкап**: перед каждой перезаписью существующего маршрута полный снапшот программы уходит в Routes.'Program Backup' (`fld1Bvnjvbe1CDtCV`, JSON `{backedUpAt, route}`). Один уровень глубины — два подтверждённых ошибочных сохранения подряд затирают и бэкап. Ошибка бэкапа сохранение не блокирует (логируется).
  - Никогда не ослаблять эти предохранители «чтобы не мешали» — сначала разбираться, почему они сработали.

Добавлено 2026-07-06 (сессия GEO/FAQ; детали и указатели — `docs/handoff-2026-07-06.md`):

- **Контентный слой FAQ (главный GEO-рычаг) — каркас готов, контент в работе.** Поле `FAQ` в Routes (`fld5LKJrzDXDUB4C6`, JSON `[{"q":"…","a":"…"}]`) → `RouteFaq` server component (видимый аккордеон + FAQPage JSON-LD из одного массива) на всех 17 маршрутных страницах + шаблоне пакетов. Редактор — `/admin/route-text`, блок «FAQ маршрута». Черновики и статусы — `docs/faq-drafts-batch-1.md`.
- **Кэш-дисциплина при прямых правках Airtable:** записи мимо admin API не сбрасывают кэш сайта (ISR ждёт до часа). Решение: `POST /api/admin/revalidate` (кнопка «Обновить кэш сайта» в Route Texts) или «Сохранить» там же — она активна всегда и тоже сбрасывает кэш.
- Schema: организация теперь `TravelAgency` (было LocalBusiness), `sameAs` начат (`SAME_AS_PROFILES` в `src/lib/schema.ts`) — Instagram есть, слот под Google Business Profile ждёт ссылку владельца.
- robots.ts: явные allow для OAI-SearchBot (поиск ChatGPT) и Bingbot (Copilot); llms.txt синхронизирован с фактами сайта.
- Sitemap не знает о динамических пакетах Б-1 (`intercity/[slug]`, `city-tour/[slug]`, `multi-day/[slug]` со статусом Published) — при следующей работе с sitemap включить.

Добавлено 2026-07-16 (реквизиты документа + живая ссылка на программу):

- **Единый источник реквизитов документа — `src/lib/brand.ts`.** Имя гида, email (`hello@jumboinjapan.com`), домен (из `BASE_URL` в schema.ts), метка бренда, эйлайн обложки, метаданные PDF и `DAY_TYPE_LABELS`. И PDF-генератор (`tour-program-pdf.ts`), и печатное превью читают отсюда — прежние дубли (в т.ч. `DAY_TYPE_LABELS`, живший в двух файлах) устранены. Бренд-реквизиты правятся ЗДЕСЬ, в одном месте, не в конструкторе (они одинаковы для всех туров).
- **Оговорки документа — таблица Airtable `Document Settings`** (`tbl3XrbaUSYuc1UKp`; поля Key/Title/Text/Enabled/Order/Kind). Глобальные, редактируются в админке (меню «Документ» → `/admin/document-settings`, API `/api/admin/document-settings`, storage `document-settings-storage.ts`). Включённые печатаются в конце и PDF, и превью (`drawClosing` / `PrintProgramDocument`). Недоступность таблицы не роняет печать (оговорки просто не выводятся).
- **Живая публичная ссылка на программу — `jumboinjapan.com/p/<token>`.** Гостю отдаётся ссылка вместо PDF: страница `src/app/p/[token]/page.tsx` (server, `noindex`, `Disallow /p/` в robots, вне сайт-хрома через AppShell), всегда актуальная версия из Airtable, кнопка «Скачать PDF» → `/api/p/[token]/pdf` (attachment, кодовое имя вместо клиента). Тело документа вынесено в общий `src/components/print/PrintProgramDocument.tsx` (внутреннее превью + публичная страница из одного источника; `publicView` скрывает внутренние пометки и показывает смету только по флажку printInPdf).
- **Приватность ссылки — `src/lib/program-share.ts`.** Доступ по неугадываемому токену (Routes.`Public Token`, `fldcHDm5O1lAfOpl0`); на странице НЕТ ПД — кодовое имя (Routes.`Public Label`, `fld7ifhW0guVCPFJd` → Group Name связанного клиента из Prospects.Linked Routes → заглушка «Программа путешествия»). Срок: ссылка жива до конца дня отъезда (Start Date + Day Count дней, 00:00 JST — учтён японский пояс), потом жёсткий гейт `resolveSharedProgram` → 404, а `expireEndedShareTokens()` физически стирает токен. Отмена поездки = ручное «Отключить». Управление — конструктор → меню «⋯» → «Ссылка для гостя» (`/admin/program-share/[...slug]`, `ProgramShareControl`, API `/api/admin/print/share`: enable/rotate/disable/label + POST `{action:'cleanup'}`).
- **TODO (follow-up):** ночная физическая очистка токенов не автоматизирована — `expireEndedShareTokens()` доступна как `POST /api/admin/print/share {action:'cleanup'}`, но не привязана к крону. Жёсткий гейт по дате уже делает истёкшие ссылки нерабочими; для физического удаления повесить Vercel Cron / scheduled task на этот вызов. Фича — новая публичная поверхность с доступом к персональным данным по токену: катить через preview-деплой.

## 14. Definition of done

A task is done when:

- the requested behavior is implemented,
- the change is scoped and understandable,
- relevant verification was run or honestly explained,
- public copy/product positioning is preserved,
- data writes remain safe,
- docs are updated when behavior changes,
- remaining risks are explicitly listed.
