# Триаж незакоммиченного — 9 августа 2026

30 untracked-записей плюс ignored-слой в рабочей копии. По каждой — предложение. **Ничего из вашего я не трогал**: жду вердикта по списку.

Семь строк шума уже закрыты в ветке `chore/repo-hygiene-2026-08-09` — `.claude/settings.local.json`, `.claude/launch.json`, `.codex/`, `.cursor/`, `.impeccable/`, `backup/`, `*.tgz` ушли в `.gitignore` (внутри абсолютные пути `/Users/jumbo/…`, на другой машине бессмысленны). После вливания ветки они пропадут из `git status` сами.

---

## A. Парсинг — вы вывели за скобки, ваша ветка

Не трогаю ни одного файла. Из-за них падают команды `package.json` (`check:poi`, `check:polivanov`, `check:polivanov-wd`, `poi:collect`, `poi:gaps`, `poi:sources`, `test:poi-store`, `test:poi-ingest`, `test:poi-matching`, `test:polivanov`) — это записано в `AGENTS.md` как известный долг, чтобы следующий агент не искал причину заново.

| Файл | Размер | Что это |
|---|---|---|
| `src/lib/poi-ingest.ts` | 20K | приём POI |
| `src/lib/poi-matching.ts` | 52K | сопоставление POI |
| `src/lib/polivanov.ts` | 52K | транслитерация |
| `tests/poi-ingest.mjs`, `poi-matching.mjs`, `poi-store.mjs`, `poi-description-bilingual.mjs`, `polivanov.mjs` | 72K | тесты к ним |
| `tests/fixtures/` | 44K, 1 файл | фикстуры |
| `scripts/check-poi-integrity.mjs`, `check-polivanov.mjs`, `check-polivanov-wikidata.mjs` | — | проверки (в ignored) |
| `scripts/poi-portals/` | 12 файлов | сбор POI из открытых порталов (в ignored) |
| `scripts/import-japantravel-events-batched.mjs` | — | пакетный импортёр (в ignored) |
| `docs/poi-fact-strategy.md`, `poi-intake-contract.md`, `poi-integrity-audit.md`, `poi-portal-collector.md`, `poi-sources-ranking.md`, `poi-roadmap.html` | 144K | документация к этому контуру |
| `docs/POI-очередь-разбора.xlsx` | — | рабочая таблица |

**Предложение:** одним коммитом в вашей ветке парсинга, вместе с кодом. Тогда десять команд оживут, а `npm run verify` можно будет дополнить POI-тестами.

Одна оговорка: `.gitignore` в моей ветке больше не прячет `scripts/` — файлы станут видимыми в `git status`. Это и было целью: они пропадали молча.

---

## B. Незаконченная фича «Счета» — ваше решение

Связный кусок, 6,2 МБ вместе со шрифтом. Работа явно в процессе: страница есть, API есть, воркспейс есть.

| Файл | Размер |
|---|---|
| `src/app/admin/invoices/` | 1 файл |
| `src/app/api/admin/invoices/` | 2 файла |
| `src/components/admin/InvoiceWorkspace.tsx` | 24K |
| `src/lib/invoice/` | 4 файла, 40K |
| `src/lib/pdf/invoice-pdf.ts` | 20K |
| `src/assets/invoice/` | 3 файла, 236K |
| `src/assets/fonts/ipaexg.ttf` | **5,9 МБ** |

**Предложение:** отдельная ветка `feat/invoices`, когда доведёте. Два замечания, если решите коммитить как есть:

- `ipaexg.ttf` на 5,9 МБ попадёт в каждый клон навсегда. Если он нужен только для PDF на сервере — стоит проверить, не тянется ли он уже как зависимость, и подписать в `next.config.ts` в `outputFileTracingIncludes` рядом с существующими шрифтами;
- маршруты под `/admin` закрыты авторизацией из `src/proxy.ts` — то есть при вливании они сразу окажутся за логином, это правильно.

---

## C. `src/data/multiDayCustom.ts` (12K) + правка `src/app/multi-day/custom/page.tsx`

Данные и страница идут парой, страница у вас в изменённых. Это публичная страница — попадает в выдачу сразу после деплоя.

**Предложение:** ваше решение. Если черновик — оставить; если готово — отдельный коммит вместе с правкой страницы, чтобы не разъехались.

---

## D. Мусор — предлагаю удалить

`device_bash` не умеет `rm`, поэтому сам не трогаю.

| Что | Размер | Почему |
|---|---|---|
| `.audit2.tgz` | 1,5 МБ | архив аудита в корне репозитория |
| `src/app/.well-known/workflow/` | 8 файлов | **важно**: артефакты удалённого Workflow SDK. Лежат под `src/app`, то есть локальный dev-сервер отдаёт их как живые маршруты. В git их не было, на Vercel они не уезжали. В ветке добавлено правило `.gitignore`, но файлы на диске надо снести руками |
| `docs/_to_delete/` | 3 файла | `.bak`, `.bak2`, `.b3` от `poi-portal-collector.md` |
| `_to_delete/` в корне | **576 МБ** | накопилось с 26 июля |

Одной строкой в терминале проекта:

```
rm -rf .audit2.tgz src/app/.well-known/workflow docs/_to_delete _to_delete
```

---

## Что останется в `git status` после всего

Если принять A, B, C и D — ничего. Если только D и правила из ветки — останутся ровно два блока: парсинг (A) и счета (B), оба осмысленные и оба ваши.
