```
Audit ID: fable-5.1-poi-system-audit-2026-09-02
Revision: R2 (после возражений штатного аудитора; R1 сохранён как улика:
  tmp/fable-5.1-poi-system-audit-2026-09-02.md, sha256 a2811f55…)
Status: report-complete, read-only
Auditor: Claude (Fable 5.1), независимый проход
Repository: /Users/jumbo/Projects/jumboinjapan (физический корень подтверждён: git rev-parse --show-toplevel)
Branch: main
HEAD = origin/main = d61bce235c4054c08cbe87c18ac3ee037fb8b870 (2026-08-26 02:16 +0900) — не изменился между R1 и R2
Working tree: 51 записей status (32 M + 19 untracked) — не тронуты, не индексированы
stash@{0}, .git/index.lock (от 26.08), _to_delete/, tmp/ — не тронуты
Live Airtable: НЕ читалась (разрешения не было) → база получает вердикт UNVERIFIED_LIVE_STATE
Сеть: не использовалась ни для Airtable, ни для Google, ни для порталов, ни для модели
Ledger: статусы не менялись мной. Заявлено 18/30; по итогам аудита ФАКТИЧЕСКИ ≤16/30
  (P01.2 и P02.2 опровергнуты исполняемыми контрпримерами и подтверждены вторым
  аудитором) — рекомендуется REOPENED для P01 и P02, см. § 1 и § 10.
  P05: 2/3; scope delta 0; task identity: preserved
```

# Независимый аудит POI-системы: скрапер, Intake, модель данных — R2

## 0. Что изменилось относительно R1 и ответы на возражения

Байты, к которым относится R2. Между R1 и R2 в рабочем дереве изменились ровно два
файла (`find -newermt` от начала R1): `src/lib/poi-portal-place.ts` (`17837573…` →
**`a11b696e…`**, пакет 10f-N R2) и `tests/poi-portal-place.mjs` (`1aefc7e0…`). Остальные
двенадцать ключевых файлов побайтно те же (`collect-pois.mjs` `9b2cbe0a…`,
`poi-intake.ts` `1b276ecc…`, `poi-ingest.ts` `46536aed…`, `place-resolve.ts` `e18e4d72…`,
`poi-coordinate-policy.ts` `8aeb8f3e…`, `poi-matching.ts` `1fd515dd…`,
`airtable-schema.ts` `509bd0b8…`, `airtable-store.mjs` `d3ef8d8d…`,
`existing-file.mjs` `6b88e4d4…`, `base-snapshot.mjs` `450f6aa5…`,
`check-poi-integrity.mjs` `8374267f…`, `parser-completion-ledger.md` `d94b90f3…`,
`package.json` `7d3f5a27…`, `opendata-csv.mjs` `0285bca1…`). R2-файлы доставлены в
контейнер, хеши совпали; на них исполнено: `tests/poi-portal-place.mjs` — **155/155**,
`tsc --noEmit` — 0 ошибок, `eslint` — 0. Diff R1→R2 ограничен `describeThrown`
(тотальная функция без `instanceof`, собственные data-дескрипторы, ограниченный проход
`clampToLimit`) — ни одну находку R1 он не закрывает и не открывает.

| Возражение | Ответ | Что изменено в R2 |
|---|---|---|
| 1. Аудит устарел: проверялся R1 `poi-portal-place.ts`, текущий — R2 `a11b696e…`, 155/155 | Принято. R2 перепроверен на новых байтах; вывод по 10f-N (граница реализована корректно, но F-01/F-04/F-05/F-16 остаются) не изменился | шапка, § 0, § 10 |
| 2. F-01 сформулирован неточно: резолвер перебирает кандидатов после отклонения; дефект — принятие первого прошедшего без обнаружения неоднозначности | Принято. `place-resolve.ts:134-165` действительно продолжает цикл после `continue`; дефект в том, что (а) `namesAgree` не отвергает чужой объект с общим корнем и (б) первый прошедший принимается без проверки, прошёл ли второй | F-01 переписан |
| 3. F-10, F-15, F-16 нельзя оставлять follow-up: уникальность `Source Key` — основа идемпотентности; пул пакета теряет `placeId`; отсутствующая префектура Google подменяется ожидаемой | Принято. Все три — `IN_SCOPE_DEFECT`, закрываются до первого автоматического импорта: F-16 → 10f-N (P05.3), F-10 и F-15 → 10f-Q (тождество входа/базы) | § 3, § 10, таблица |
| 4. F-09 (`check:hotel-links` в `verify`) — припаркованный трек, не расширяет и не останавливает парсер | Принято: не в знаменателе, не блокер парсера. Остаётся механический факт: «полный `verify` зелёный» нельзя записать в доказательство P10.3, пока флаг не вынесен или не добавлен в CI — это правит гостиничный трек одной строкой | F-09 → вне области парсера |
| 5. S-1–S-8 — не новый обязательный фронт; до 30/30 нужен только S-4 в части, совпадающей с 10f-R | Принято. S-4 ∩ 10f-R остаётся; S-1–S-3, S-5–S-8 перенесены в раздел «после 30/30» | § 8 переименован |
| 6. Денежные оценки ориентировочные, тарифы сетью не проверялись | Верно и было заявлено в § 12; в R2 каждая сумма помечена «ориентировочно» | § 9 |
| Коррекция реестра: P01.2 (row-N) и P02.2 (exit 0) опровергнуты → ≤16/30, два критерия переоткрыть | Принято и посчитано: P01 `ACCEPTED 3/3` → `REOPENED 2/3`, P02 `ACCEPTED 3/3` → `REOPENED 2/3`; **принятых вех становится 0 из 10** (обе принятые вехи и были P01 и P02). Число критериев 30 не меняется | § 1, § 10 |
| Маршрут 10f-N…10f-S с распределением находок | Принят как основа § 10 с привязкой каждого пакета к критериям, чтобы арифметика реестра сходилась | § 10 |

Независимо подтверждено вторым аудитором (по его сообщению): F-01 (пары `namesAgree`),
F-03 (`exitCode=0` при бросающем адаптере), F-04 (132 writable, `nameEn=0`,
`nameKana=0`), F-06 (PATCH 429 → «переименовано»), F-07 (`row-${i+1}`), F-02
(untracked-файлы, HEAD = origin/main = d61bce2). Эти шесть находок далее помечены ✔✔.

Дополнение из чекпойнта 10f-N R2 (§ 7 там же), которое я подтверждаю по коду и включаю
как F-24: канонический `resolvePlace` читает `data.places` **вне** `try`
(`place-resolve.ts:128`), а Telegram-путь зовёт `placeResolver` без `try/catch`
(`poi-intake.ts:760-766`) — тело ответа Google, разобравшееся в `null`, роняет весь приём
из Telegram вместо `needs_review`. Портальный путь после R1 это содержит (`resolverThrew`).

Проверка шла от production-кода к утверждениям. Код читался в копии рабочего дерева
(без `.env*`, `node_modules`, `.git`, `tmp/`), доставленной в контейнер; тождество
байтов доказано SHA-256 на обеих сторонах. Артефакты `tmp/` и `backup/` читались на
устройстве владельца, без переноса.

---

## 1. Вердикт и границы доказанного

**Скрапер и конвейер.** Production-достижимый путь записи существует ровно один —
`collect-pois.mjs --write` → `writeRun` → `ingestPoiBatch` → `airtable-store.mjs`, и он
исполним только для двух CSV-порталов (`bodik-osaka-tourism`, `bodik-kyoto-tourism`).
Discovery Japan Guide — read-only, baseline в Git подтверждён независимым прогоном
(`verify-discovery-baseline.mjs` → rc 0, 1140 записей, 1293 обмена). Модельное
извлечение недостижимо ни одним production-путём: это подтверждено чтением импортов и
117 проверками `poi-model-reachability`. Пакет 10f-N реализован корректно как граница,
но **на единственном реальном корпусе (Осака) он даёт ноль опознанных мест**, потому
что резолвер ищет только по английскому имени, а у всех 132 writable-строк Осаки
`nameEn` и `nameKana` пусты (доказано по сохранённому dry-run).

**Живая модель данных.** Вердикт `UNVERIFIED_LIVE_STATE`. По сохранённым артефактам
(выгрузка 25.08, baseline 01.09 с SHA `ff1125b2…`, инвентарь схемы 28.08) доказаны:
уникальность и формат `POI ID`, уникальность 51 `Source Key` на 25.08, отсутствие
Intake-маркеров у всех 466 записей до 10e-E2, 200 записей без `Google Place ID`,
7 записей с городами вне справочника, 444 координатированных записи без политики.
Всё остальное (опции select, текущие дубли place_id, расхождение схемы с писателями)
требует живого GET.

**Главный системный факт.** Не менее шести из восемнадцати «закрытых» критериев
реестра (P02.1–P02.3, P05.2, P06.2 в части `--existing`, P07.2) доказаны кодом,
которого **нет ни в HEAD, ни в origin/main, ни на Vercel**: `poi-coordinate-policy.ts`,
`poi-portal-place.ts`, `existing-file.mjs`, их тесты и сам реестр лежат untracked, а
гейт политики координат в `poi-ingest.ts` — незакоммиченная правка (P05.1 и P07.1 —
`resolvePlace` и `needs_review` — в HEAD есть). Production-бот Telegram (main = d61bce2)
по-прежнему создаёт записи без `Coordinate Policy`. Это не отменяет доказательств, но
делает их непроверяемыми в CI и в свежем клоне и противоречит правилу реестра § 8
(«доказательство в репозитории»).

**Коррекция реестра (рекомендация, статусы не менял).** Два принятых критерия
опровергнуты исполняемыми контрпримерами и подтверждены вторым аудитором: P01.2
(«стабильные `sourceKey`») — `opendata-csv.mjs:143` подставляет номер строки; P02.2
(«перехваченная ошибка даёт ненулевой код») — `collect-pois.mjs:1456-1470, 1501-1526`
перехватывают ошибку портала и записи и завершают процесс нулём. Честная арифметика:
**≤16 из 30**, P01 → `REOPENED 2/3`, P02 → `REOPENED 2/3`, принятых вех — **0 из 10**
(обе принятые вехи и были P01, P02). Знаменатель прежний; новых критериев нет.

**Наиболее опасное.** (1) Опознание места принимает **первого** кандидата Google,
прошедшего рамку, префектуру и `namesAgree`, и не замечает, что прошёл и второй; сам
`namesAgree` не отвергает объект с общим корнем имени («Osaka Castle» ≡ «Osaka Station»,
«Ueno Park» ≡ «Ueno Zoo»), а точка источника с точкой резолвера не сравнивается — место
с чужим `place_id` получает `exactObjectPoint`. (2) Перехваченная ошибка портала или
записи оставляет код возврата 0. (3) Неудачный PATCH при коллизии `POI ID` отчитывается
как успех и оставляет дубль номера. (4) Ни один сетевой вызов конвейера не имеет
таймаута. (5) `Source Key` — основа идемпотентности — не имеет ни одного сторожа
уникальности, а поиск по нему берёт первое совпадение.

**Что оправдывает свою сложность.** Fail-closed `needs_review` в `ingestPoi`, политика
координат как чистая функция, контракт снимка базы, инварианты суммы исходов, baseline
discovery в Git с тремя отпечатками, reachability-тест платного пути. **Что не
оправдывает.** 10 425 строк модельного стека плюс 10 975 строк тестов ради пути, который
policy всех источников запрещает, а суммарная денежная экспозиция по корпусу Осаки —
порядка 0,03–0,5 $ за прогон; 12 одноразовых L3-исполнителей на 8 261 строку в `tmp/`;
`--existing` рядом с `--base-snapshot`; два хранилища Airtable, две карты категорий,
семь литералов base ID, две точности координат, два справочника городов.

---

## 2. Фактическая архитектура (production-достижимые связи)

```
Порталы (registry.mjs: 11 активных)
  ├─ opendata-csv (Осака, Киото)  ── единственный адаптер кандидатов
  │     collectFromOpenDataCsv → candidates{sourceKey = portal:ID|NO|row-N, nameJa, lat/lon…}
  ├─ japan-guide-html (discovery) ── read-only, записи poi-discovery-record/v2, отдельная таблица адаптеров
  └─ sitemap-html ×7 ─────────────── адаптера нет → portal.skipped
        ↓ collect-pois.mjs runPortal
evaluatePoiCandidate (scoring) → classifyByRules (taxonomy v2 loader) → terminalOutcome (9 исходов)
        ↓ dedupeWithinBatch (dedupe.mjs, свои пороги) → resolveSiteCity (jp-address) → writable
        ↓ [--existing]: matchAgainstExisting → только счётчик matchedExistingBase (решений не меняет)
writeRun (только при --write/--dry-write/--base-snapshot)
   preflight маршрута → loadNames → legacy-мост (9/20 кодов) → assertNameCoverage
   → resolvePortalPlace(subject{nameEn,siteCity,prefectureJa}) → resolvePlace (Google Text Search, платно)
   → ingestPoiBatch(requests, store)
        store = deps.store | createSnapshotStore (--base-snapshot) | createAirtablePoiStore (live)
        ingestPoi: канон → findBySourceKey → listExisting → screenNewPoi → place_id-гейт
                   → needs_review → classifyCoordinatePolicy → fields → store.create
   → report.write (ошибка перехватывается: report.write.error, exit 0)
--monitor: diffAgainstSnapshot ПОСЛЕ записи (посмертный отчёт, не гейт)
--out: writeJsonReport; манифеста прогона нет (кроме report.modelPlan в --model-plan)

Второй путь создания: Telegram → intakePoi (poi-intake.ts) → researchPoi (OpenAI) → resolvePlace
   → resolveJapaneseName (Wikidata) → ingestPoi → createAirtableStore (poi-intake.ts, второе хранилище)

Пути обновления мимо Intake: cron refresh-coords, admin (title/seo/approved), refresh-google-coords.mjs,
   fix-poi-typos.mjs, fix-airtable-typography.mjs, интерфейс Airtable. Удаление: deleteAirtablePoi.

Модельный стек (14 модулей, 10 425 строк): нет ни одного production-вызова executeModelPlan.
```

Узлы, которых **нет** в production-композиции: run-manifest, версия matcher policy,
pre-write drift gate, экспортёр снимка базы, eval-фикстуры, журнал попыток записи в
Airtable, независимое перечитывание полей после create.

---

## 3. Findings по серьёзности

Формат: файл:строка · минимальный контрпример · влияние · требуемое исправление · класс.

### P0

Не найдено. Ни один путь не пишет в живую базу без явного флага/сессии; `needs_review`
действительно заканчивается нулём записей (`poi-ingest.ts:519-529, 557-568` — возврат до
`store.create`).

### P1

**F-01 ✔✔. Опознание места принимает первого прошедшего кандидата и не обнаруживает
неоднозначность; гейт `namesAgree` не отвергает чужой объект с общим корнем имени.**
Формулировка R2 (уточнена по возражению 2). `resolvePlace` (`place-resolve.ts:134-165`)
перебирает до пяти кандидатов Google: отклонённые по рамке, имени или префектуре
пропускаются `continue`, **первый прошедший возвращается немедленно** — остальные не
проверяются, и состояние «прошли двое» неотличимо от «прошёл один». Второй слой дефекта —
сам гейт: `core()` (`:66-72`) вычёркивает `castle|station|park|museum|garden|…`, затем
сравнивает `includes`. Контрпример исполнен офлайн:
`namesAgree('Osaka Castle','Osaka Station') === true`, `('Ueno Park','Ueno Zoo') === true`,
`('Osaka Museum of History','Osaka Castle Park') === true`, `('Nara Park','Nara') === true`.
Третий слой — точка источника (у портала она есть, `candidate.lat/lon`) с точкой резолвера
не сравнивается вовсе (отмечено и в чекпойнте 10f-N R2 § 7). Влияние: запись получает
чужой `Google Place ID`, чужую точку и `exactObjectPoint`
(`poi-coordinate-policy.ts:143-152` подтверждает только совпадение с точкой резолвера,
а не тождество объекта). Действует на production-пути Telegram с 10.08 и на портальном
пути 10f-N; `identityConflict` в `poi-portal-place.ts:429-435` (R2) недостижим — он зовёт
ту же функцию. Исправление (10f-N): (а) тождество по токенам — все различающие токены
обязаны совпасть, родовые слова не вычёркиваются, а сравниваются как токены; (б) собирать
**всех** прошедших кандидатов, при двух и более → именованный отказ `ambiguous`;
(в) для портального пути — расстояние точки резолвера до точки источника как
дополнительный дискриминатор (порог — решение владельца, ADR-0002 § 12.3); (г) canary
на 20 строках Осаки с японскими именами (см. F-04) и eval-фикстура пар
«имя ↔ displayName». Класс: `IN_SCOPE_DEFECT` (P05.3; смысл `exactObjectPoint` в P07).
Шесть существующих политик проставлены L3-картами 10f-K по отдельным уликам, не этим
гейтом, — они не затронуты.

**F-02 ✔✔. Доказательства реестра лежат вне репозитория; production отстаёт от рабочего
дерева на пакеты 10f-L…10f-N.** `git show HEAD:src/lib/poi-ingest.ts | grep -c
"Coordinate Policy"` → 0; `HEAD:collect-pois.mjs` без `resolvePortalPlace`; untracked:
`src/lib/poi-coordinate-policy.ts`, `src/lib/poi-portal-place.ts`,
`scripts/poi-portals/lib/existing-file.mjs`, `tests/{existing-file,poi-coordinate-policy,
poi-portal-place}.mjs`, `docs/poi-intake/{parser-completion-ledger,poi-completion-dag}.md`.
Контрпример: `git clone origin/main && npm test` не содержит ни одной из этих проверок;
Vercel исполняет Telegram-бота без гейта политики → каждая новая запись увеличивает
долг A. Влияние: CI не стережёт как минимум 6 закрытых критериев; README/канонизация § 7.1
описывают рабочее дерево, а не production. Исправление: коммит пакетов поимённо
(без `git add -A`), обновление README тем же коммитом, отметка в реестре § 8 «доказано в
коммите X». Класс: `IN_SCOPE_DEFECT` (правило реестра § 8 «ссылка только на tmp/
недостаточна» распространяется и на untracked-файлы).

**F-03 ✔✔. Перехваченная ошибка портала или записи не меняет код возврата.**
`collect-pois.mjs:1456-1470` (per-portal `catch` → `report.portals[].error`),
`:1501-1526` (`catch` → `report.write = {error}`), `:1602-1606` (`exitCode = 1` только
для исключений, покинувших `main`). Контрпример исполнен: `main()` с бросающим
адаптером и `main(['--write','--names','/nonexistent'])` завершаются с
`process.exitCode = 0`. Влияние: частично записанный пакет выглядит успешным для
cron/CI/оператора; P02.2 «перехваченная ошибка даёт ненулевой код» принят на узком
чтении (`tests/existing-file.mjs` проверяет только ошибки, выброшенные из `main`, и
`monitorFailure`). README § 9 сам называет это открытым риском. Исправление:
`portals[].error` и `write.error` → `monitorFailure`-подобный отложенный throw после
записи отчёта; тест на настоящем процессе. Класс: `IN_SCOPE_DEFECT`; **P02.2 опровергнут** —
рекомендация P02 → `REOPENED 2/3`; закрывается в 10f-R (вместе с журналом и перечитыванием).

**F-04 ✔✔. Портальный `resolvePlace` ключуется полем, которого у корпуса нет.**
`place-resolve.ts:103-104`: `if (!name) return … 'Нет английского имени — искать нечем'`;
`PlaceQuery` (`:49-54`) не принимает `nameJa` и координаты. Артефакт
`tmp/dry-osaka-pre-taxonomy-e4bc27d.json`: writable 132, из них с `nameEn` — **0**, с
`nameKana` — **0**. Контрпример: без файла `--names` все 132 строки уходят в `unnamed`;
с файлом, дающим только `nameRu`, — все 132 в `placeUnresolved: notResolved`. Влияние:
P05.3 закрывается тестами на фикстуре с английскими именами (`tests/poi-portal-place.mjs:
200-266`), но на реальном корпусе даёт ноль `place_id`, пока владелец не введёт вручную
~130 английских названий; при этом самый сильный ключ поиска (японское название +
`locationBias` по координатам портала) не используется. Исправление: решение владельца —
(а) резолвер принимает `nameJa` и `locationBias`, сравнивает `displayName` с `nameJa`
при `languageCode: 'ja'`; (б) либо приёмка P05.3 на подмножестве с рукописными
`nameEn`. Класс: `IN_SCOPE_DEFECT` для доказательства P05.3 на production-корпусе, пакет
10f-N. Изменение ключа резолвера затрагивает и путь Telegram; по определению реестра § 5
это не `SCOPE_CHANGE` (ни один критерий не меняется), но это matcher-policy — нужна строка
владельца (ADR-0002 § 12.3); замечание штатного аудитора «реальный canary на японских
именах» я читаю как согласие с вариантом (а).

### P2

**F-05. Платные обращения к Google идут до проверки идемпотентности и в каждом dry-run.**
`collect-pois.mjs:1041-1068` (цикл резолвера) стоит до `ingestPoiBatch` (`:1117`), где
`findBySourceKey` (`poi-ingest.ts:438-453`) отсеял бы `already_ingested`;
`:1505-1508` собирает резолвер из `GOOGLE_PLACES_API_KEY`, автоматически подхваченного
`loadEnvConfig` (`:81`), при любом `args.write` — включая `--base-snapshot`, который
runbook § 2–3 описывает как «без токена». Кэша, потолка числа обращений и бюджета нет.
Контрпример: два подряд `--base-snapshot` по Осаке с файлом имён = 2 × 132 платных
Text Search Pro (поле-маска с `location`, `businessStatus`, `addressComponents`), включая
строки, уже заведённые. Исправление: `findBySourceKey` до резолвера; лимит
`--max-place-lookups`; локальный кэш `sourceKey → place` со сроком по `coordsCheckedAt`
(30 дней по условиям Maps); runbook обновить тем же коммитом (change-policy § 13).
Класс: `IN_SCOPE_DEFECT` для 10f-N (документация) + `FOLLOW_UP_DEBT` (кэш/лимит).

**F-06 ✔✔. Неудачный PATCH при коллизии `POI ID` объявляется успехом.**
`scripts/poi-portals/lib/airtable-store.mjs:153-160` (`await fetch(PATCH)` без проверки
`res.ok`), то же `src/lib/poi-intake.ts:669-677` (`fetchAirtableWithRetry` возвращает
ответ 429 после попыток, `ok` не проверяется). Контрпример исполнен: заглушка с
`PATCH → 429` — `create()` вернул `{poiId:'POI-000012'}` и напечатал «переименована», а
запись в базе осталась `POI-000011` (дубль номера). Обратное чтение только по `POI ID`
до PATCH, после — нет. Исправление: проверять `ok`, перечитывать запись после PATCH,
при неизвестном исходе — исключение с `recordId` в тексте. Класс: `IN_SCOPE_DEFECT`
(P09.2–P09.3).

**F-07 ✔✔. `sourceKey` для CSV может выводиться из номера строки.**
`scripts/poi-portals/lib/opendata-csv.mjs:143`: `get('sourceId') || 'row-' + (i+1)`;
алиасы `['ID','NO']` (`:51`). Контрпример: пустая ячейка `ID` или колонка `NO` с
порядковым номером → после перестановки строк в выгрузке новый объект получает старый
ключ → `already_ingested` (тихая потеря), а старый заводится повторно. Никакого
предупреждения, счётчика или остановки. Исправление: fail-closed — строки без
источникового ID в очередь `sourceKeyUnstable`, запись по ним запрещена; счётчик в
отчёте. Класс: `IN_SCOPE_DEFECT`; **P01.2 опровергнут** — рекомендация P01 → `REOPENED 2/3`;
закрывается в 10f-Q (тождество входа).

**F-08. Ни один сетевой вызов конвейера не ограничен по времени.**
`place-resolve.ts:112` (Google), `:190,196` (Wikidata), `airtable-store.mjs:73,132,153`,
`poi-intake.ts:237,346,465,669` (`airtable-retry.ts:44-64` только 429-backoff),
`opendata-csv.mjs` (CKAN и CSV), `html-fetch.mjs` (нет `AbortSignal`), cron
`refresh-coords/route.ts:218`. Change-policy § 21 требует срок на операцию целиком.
Контрпример: повисший ответ Google на 57-й строке держит `writeRun` бесконечно; на
Vercel cron упирается в `maxDuration = 60` посреди PATCH-пачки с неизвестным исходом.
Исправление: `AbortSignal.timeout` на каждом вызове; истёкший срок = «исход неизвестен»
→ остановка серии. Класс: `IN_SCOPE_DEFECT` (P09.2).

**F-09. `npm run verify` в рабочем дереве красный на `check:docs` — вне области парсера.**
`package.json:74` содержит `check:hotel-links`, `.github/workflows/verify.yml` — нет;
исполнено: `npm run check:docs` → «расхождений: 1». Причина — припаркованный гостиничный
трек (SC-001). По возражению 4: не расширяет и не останавливает завершение парсера,
в знаменатель не входит. Механический факт, который остаётся: пока флаг не вынесен из
`verify` или не добавлен в CI, «полный `verify` зелёный» нельзя записать доказательством
P10.3 — правится одной строкой внутри гостиничного трека. Класс: вне области парсера
(долг гостиничного трека).

**F-10. Уникальность `Source Key` — основы идемпотентности — ничем не стережётся.**
`check-poi-integrity.mjs:657-666` не читает ни `Source Key`, ни `Google Place ID`;
`findBySourceKey` берёт **первое** совпадение (`airtable-store.mjs:110`,
`poi-intake.ts:643`). Снимок из файла дубль ключа отвергает (`base-snapshot.mjs:132-139`),
живое хранилище — нет: `check:canon` стережёт place_id, ключ источника в живой базе —
никто. Контрпример: вторая запись с тем же `Source Key` (ручной ввод, ошибка L3-карты,
повторный импорт мимо Intake) → `already_ingested` указывает на произвольную из двух,
отчёт молчит; дубль остаётся навсегда. Исправление: `FAIL source_key_duplicate` в
`check:poi` (поле уже читается 10e-c); в живых хранилищах `findBySourceKey` → ошибка при
более чем одном совпадении (та же строгость, что у контракта снимка).
Класс: `IN_SCOPE_DEFECT` (по возражению 3): закрыть до первого автоматического импорта,
пакет 10f-Q (тождество базы/снимка).

**F-11. `Name (JA)` из Wikidata берётся по первому попаданию поиска без сверки.**
`place-resolve.ts:186-206`: `srsearch` → `search[0].title` → `labels.ja`; ни сравнения
метки с `nameEn`, ни проверки типа сущности. Документы называют `Name (JA)` «сильнейшим
ключом сверки дублей». Контрпример (не исполнен, сети нет): «Nara Park» → первая
статья с P17=Q17, содержащая «Nara» → чужая японская метка попадает в ключ тождества.
Класс: `FOLLOW_UP_DEBT` (путь Telegram).

**F-12. Два хранилища Airtable, две карты категорий, семь литералов base ID, два
справочника городов, две точности координат, три рамки Японии.**
– `createAirtablePoiStore` (`airtable-store.mjs`) и `createAirtableStore`
  (`poi-intake.ts:626-687`) — один и тот же алгоритм (кэш, nextPoiId, коллизия);
  довод «алиас `@/` не резолвится» устарел — `poi-intake.ts` уже импортирует относительно.
– `CATEGORY_RU_TO_EN`: `poi-intake.ts:53-72` (18 значений) ≠ `airtable-store.mjs:29-47`
  (17, нет «Знаковый вид») — уже разошлись.
– base ID `'apppwhjFN82N9zNqm'`: `airtable-schema.ts:50`, `collect-pois.mjs:1114`,
  `check-poi-integrity.mjs:56`, `check-canon.mjs:25`, `check-polivanov.mjs:43`,
  `poi-score.mjs:21`, `refresh-google-coords.mjs:29`; таблица по имени `'POI'` в
  `airtable-store.mjs:15`, `poi-intake.ts:42` при импортированном, но не используемом для
  запросов `POI_TABLE_ID`.
– `KNOWN_CITIES` (63, `poi-canon.ts:47`) против `DESTINATIONS`+tokyo (39,
  `jp-address.ts:48,134`): 24 слага (`fuji, naoshima, biei, okinawa, chiba, mitake, takao…`)
  канон принимает, а `resolvePortalPlace` отвергает `siteCityUnverifiable`
  (`poi-portal-place.ts:285-293`); в выгрузке 25.08 — 7 живых записей с городами вне
  обоих (`inujima`, `megijima`, `teshima`).
– Точность: `roundCoordinate` 7 знаков (`poi-canon.ts:378-383`) против
  `Math.round(x*1e6)/1e6` в cron (`route.ts:209`) и `refresh-google-coords.mjs:171`.
– Рамки: `poi-canon.ts:358` (lat 20–46.5), `place-resolve.ts:30` (24–46), `REGION_BBOX`
  (`collect-pois.mjs:84`).
Класс: `FOLLOW_UP_DEBT`, см. § 8.

**F-13. Крон и ручной скрипт координат расходятся.** `refresh-google-coords.mjs:31-37`
не пишет `Coords Checked At` (крон пишет, `route.ts:186, 202, 211`) → после `--apply` крон
заново платит за те же записи; ни один из них не трогает `Coordinate Policy`; крон
не перечитывает результат PATCH (`:218-224`). Класс: `FOLLOW_UP_DEBT` (cron — отдельный
трек по handoff § 2).

**F-14. Модельная классификация в production-отчёте оценивается по другой модели и
цене, чем канонический профиль.** `enrich.mjs:40-45` (`gemini-2.5-flash-lite`,
`gpt-5.6-luna` 0.1/0.6 $/1M) достижим из `collect-pois.mjs:657`; канонический
`model-pricing.mjs:334-346` (микродоллары, digest) — недостижим. Два источника цены одной
модели. Класс: `FOLLOW_UP_DEBT`.

### P3

**F-15 (переклассифицирован в P2, `IN_SCOPE_DEFECT`).** Пул пакета не несёт `placeId`
(`poi-ingest.ts:693-704`: в `pool.push` есть имена, город, координаты, `recordId`, но не
`Google Place ID`): гейт «один place_id — один POI» (`:478-492`) внутри одного пакета не
работает. Контрпример: две строки Осаки с разными именами, опознанные в одно место
Google, — первая создаётся, вторая не блокируется гейтом place_id; страхует только
геометрия (точки резолвера совпадут → `needs_review` при непохожих именах в пределах
60 м), то есть исход зависит от побочного правила, а не от объявленного тождества.
Исправление: `placeId: result.fields['Google Place ID']` в пуле; регрессия «две строки,
один place_id, один пакет → `blocked_duplicate`». Закрыть в 10f-Q (по возражению 3),
до первого автоматического импорта.

**F-16 (переклассифицирован в P2, `IN_SCOPE_DEFECT`).** `prefecture: prefecture ??
wantPrefecture` (`place-resolve.ts:160`): при отсутствии `administrative_area_level_1` в
ответе Google ожидаемая префектура возвращается в поле, которое `resolvePortalPlace`
читает как «сказанную резолвером» (`poi-portal-place.ts:390-420`), — подмена
происхождения, при которой `cityConflict` не может сработать, а в `Prefecture (RU/EN)`
записи попадает наша догадка под видом внешнего факта. Контрпример (по коду; сети нет):
ответ без `addressComponents` для места в другой префектуре при `askPrefecture` =
ожидаемой → `ok: true`, `prefecture` = ожидаемая. Исправление: `prefecture: prefecture`
(без `??`), а отсутствие — именованный отказ `siteCityUnverifiable` на границе (ветка
уже есть: `poi-portal-place.ts:390-396`). Закрыть в 10f-N (по возражению 3).

**F-17.** Портальный путь получает `businessStatus` от резолвера и не использует его
(`collect-pois.mjs:1058-1067`), записывая `Operating Status: Не проверено`; Telegram
тот же факт пишет (`poi-intake.ts:806`). Оплаченный факт выбрасывается. `FOLLOW_UP_DEBT`.

**F-18.** `tests/poi-model-reconciliation.mjs:851-864` полагается на `chmod 0o500`:
под root (типичный CI-контейнер) 3 проверки падают и `npm test` красный; под
непривилегированным пользователем — 215/215. `FOLLOW_UP_DEBT`.

**F-19.** README § 6 п. 4 обещает «литералы модулей пересекаются со значениями реестра»,
тест (`tests/poi-taxonomy-loader.mjs:304-335`) сканирует только `poi-taxonomy.ts`;
легаси-подписи (`'Буддийский храм'`, `'Музей'`) живут в трёх модулях. Документация
обещает больше сторожа, чем есть. `FOLLOW_UP_DEBT` (docs).

**F-20.** Реестр писателей устарел: строки 1–2 указывают на `poi-intake.ts → ingestPoi`,
поля собирает `poi-ingest.ts`; нет строки на PATCH `POI ID` в Next-хранилище
(`poi-intake.ts:669`); не упомянут `scripts/browser/poi-screen-smoke.js:257`; аудит строки
11 пишет дамп в CWD, а не в `tmp/`. `FOLLOW_UP_DEBT` (docs).

**F-21.** Без `--portal` коллектор берёт `bodik-osaka-tourism` по умолчанию
(`collect-pois.mjs:1409`) — `--write` без явного портала пишет Осаку. `FOLLOW_UP_DEBT`.

**F-22.** Опции select `Seed Source = portal-collector | telegram-agent`,
`Fact Check Status = Todo`, поля `Wikidata QID`, `Season Window` — существование в живой
схеме не доказано артефактами (доказан только `manual-import`, 10e-E2). Первый `--write`
может упасть 422 на каждой строке уже после оплаты Google. Требует живого чтения.

**F-23.** Модель Telegram-бота `gpt-4.1-mini` (`poi-intake.ts:448`) по комментарию в
`enrich.mjs:36-38` снята с прайс-листа OpenAI — не проверено сетью; риск production-пути
вне парсера.


**F-24 (P2, `IN_SCOPE_DEFECT`, из чекпойнта 10f-N R2 § 7, подтверждено по коду).**
`resolvePlace` читает `data.places` вне своего `try` (`place-resolve.ts:128`), хотя
заголовок модуля обещает «ничего не бросает»; Telegram-путь зовёт `placeResolver` без
`try/catch` (`poi-intake.ts:760-766`). Тело ответа Google, разобравшееся в JSON `null`,
роняет весь приём из Telegram вместо `needs_review`; портальный путь после R1 это
содержит именованным `resolverThrew`. Исправление: `(data?.places ?? [])` внутри `try`
в `resolvePlace` (одна строка, закрывает обе границы) + регрессия на теле `null`.
Закрыть в 10f-N: правка общего резолвера входит в тот же пакет, что F-01/F-04/F-16.
---

## 4. Аудит скрапера и конвейера (§ 5)

Таблица переходов. Колонки: entrypoint · контракт вход→выход · источник правил ·
внешняя стоимость · терминальные исходы · частичный отказ · доказательства ·
production-достижимость.

| Переход | Entrypoint | Вход → выход | Правила | Стоимость | Исходы | Частичный отказ | Доказательства | Достижим |
|---|---|---|---|---|---|---|---|---|
| discovery (Japan Guide) | `collect-pois --portal japan-guide` | robots → каталог → BFS → snapshot v3 | `discovery-contract.mjs` (VERSION_POLICY) | сеть портала, ≥1293 обменов, бесплатно | complete / incompleteReasons / 4 канала отказов | неполный снимок — диагностика, не baseline | baseline в Git, 3 отпечатка, 572+707+145 проверок, мой прогон `verify-discovery-baseline` rc 0 | да (read-only) |
| извлечение CSV | `collectFromOpenDataCsv` | CKAN → CSV (utf-8/cp932) → candidates | `COLUMN_ALIASES` | сеть портала | все строки в candidates | исключение адаптера → `portals[].error`, exit 0 (F-03) | `tests/existing-file.mjs` через stub; контракт колонок не версионирован | да |
| качество/классификация | `evaluatePoiCandidate`, `classifyByRules` | candidate → verdict{terminal, classification} | taxonomy v2 через единственный loader; правила в `scoring.mjs` | нет | 9 исходов, инварианты суммы (`collect-pois.mjs:506-575`) | throw останавливает портал | 202 проверки контракта; eval-фикстуры нет (DAG 2.6) | да |
| модель | нет | — | policy 12 источников: deny | 0 (недостижимо) | — | — | reachability 117 | **нет** |
| дедуп партии | `dedupeWithinBatch` | kept/collisions | `dedupe.mjs:40-43` (свои пороги) | нет | collision → `poiDeduped` | — | покрыт косвенно | да |
| география | `resolveSiteCity` | prefecture/city/address → siteCity | `DESTINATIONS` | нет | outsideRegion / cityUnresolved | — | 89 проверок jp-address | да |
| `--existing` | `loadExistingBase` | файл → records | контракт по полям матчера | нет | fail-closed на негодный файл | — | 105 проверок; **влияет только на счётчик** | да |
| имена/легаси-мост | `writeRun` | writable → pending / unnamed / legacyBlocked | `--names`, `legacy-airtable-category-bridge` (9/20) | нет | throw при непереводимом коде — весь пакет | — | 29 + классификационные | да |
| место (10f-N) | `resolvePortalPlace` | subject → resolved/refusal (9 причин) | `resolvePlace`, `DESTINATIONS`, `prefectures.ts` | **Google, платно, на каждый pending, без кэша** | requests / placeUnresolved, инвариант суммы | исключение резолвера → `resolverThrew` (R1) | 155 проверок (R2) на фикстуре с `nameEn`; на корпусе Осаки — 0 опознаний (F-04) | код да, корпус нет |
| приём | `ingestPoiBatch` → `ingestPoi` | request → 5 исходов | канон, матчер, place_id, политика | Airtable GET снимка | created / already_ingested / needs_review / rejected_canon / blocked_duplicate | цикл, исключение → остаток не пишется, префикс в базе | 167 + 240 + 84 проверок | да |
| writer | `airtable-store.create` | fields → {poiId, recordId} | — | POST + GET(filter) + при коллизии PATCH+GET | — | PATCH без проверки (F-06), таймаута нет (F-08) | 18 проверок (happy path коллизии) | да |
| reconciliation | нет | — | — | — | — | — | только независимое ручное чтение в L3-картах | **нет** |
| отчёт | `writeJsonReport` | report → `--out` | — | — | — | списки обрезаны 100/200 | — | да |
| манифест / drift gate | нет (P08) | — | — | — | — | — | — | **нет** |

### 5.1 Источники и discovery

Реестр — `registry.mjs`, 11 активных, адаптеры у двух CSV и одного discovery.
Учёт входных строк: полный (`fetched = Σ finalTally`, инвариант). Устойчивость
`sourceKey`: **не гарантирована** для CSV без ID (F-07); для Japan Guide — из адреса,
контрактно. Discovery-свидетельство и факт разведены жёстко: отдельная таблица
адаптеров (`collect-pois.mjs:111-113`), `assertDiscoveryBoundary` отвергает любой режим
записи, `assertPortalPlaceSubject` отвергает `poi-discovery-record/v2` поимённо
(`poi-portal-place.ts:209-231`). Полнота обхода и завершение — baseline в Git, три
отпечатка, мой прогон сошёлся. Декодирование cp932 — по U+FFFD в первых 4 КБ
(эвристика, шумных данных не встречено). Редиректы и канонизация — по тестам
discovery-контракта (не переаудировал 1614 строк парсера построчно — см. § 12).
Conservation: доказана инвариантами в `runPortal` и `writeRun`, оба падают при
расхождении.

### 5.2 Модельное извлечение

Достижимость: нулевая (импорты, флаги, cron, CI — проверено). План, approval, профиль,
лимиты, срок — реализованы и связаны отпечатками; approval в репозитории нет, каталог
`tmp/poi-model-approvals/` не существует. Fail-closed без ключа: транспорт не читает
окружение, провод и резолвер учётных данных инъецируются. Сериализация/таймаут/неизвестный
исход: `model-transport.mjs` (220 проверок), журнал (499), reconciliation (215 при
non-root). Случайный платный вызов из теста/импорта/dry-run: **невозможен для модели**;
**возможен для Google Places** из `--base-snapshot`/`--dry-write` (F-05). Повторное
использование результатов: `maxRetries === 0` у обоих контрактов — законно и
безопасно, но кэша ответов нет. Стоимость держит не механизм, а policy: для Осаки
`needsLlmCategory = 443`, оценка `aiCost.totalUsd ≈ 0.03`.

### 5.3 Нормализация, taxonomy, география

Loader единственный (`poi-taxonomy.ts` импортирует один JSON — тест `:124`); локальные
копии легаси-подписей — три (F-12, F-19). Соответствие v2 ↔ Airtable: мост 9/20, поля
v2 в таблице отсутствуют (DAG 3.1) — P04.3 открыт, подтверждаю. Канонизация координат
одним правилом на обеих сторонах — да в Intake (`roundCoordinate`), нет в путях
обновления (F-12). Общий `resolvePlace`: да, оба пути зовут одну функцию (10f-N в
рабочем дереве). Place ID / префектура / Site City / `Coords Checked At`: наполняются;
`coordsCheckedAt` из инъецируемых часов (детерминизм фикстур). Три политики: машина
выводит только `exactObjectPoint`; `decision` в `classifyCoordinatePolicy` существует
как параметр чистой функции, `ingestPoi` его не передаёт — машинное решение выдать за
владельца нельзя. Конфликты города/префектуры: `cityConflict` через `DESTINATIONS` —
работает только для 39 слагов (F-12). Составные POI: `screenNewPoi` разводит
коллекцию/объект/уточнение (240 проверок), подтверждаю по коду `poi-ingest.ts:317-371`.
Неизвестный/повреждённый/брошенный ответ резолвера: закрыто в R1 (`resolverThrew`,
`unknownResolverShape`, `halfCoordinates`). Потеря проверенных значений между
резолвером и Intake: `businessStatus` теряется (F-17); `prefecture` может быть эхом
входа (F-16).

### 5.4 Matching и дедупликация

`--existing` **не участвует в решениях** — только `matchedExistingBase`
(`collect-pois.mjs:403-406, 643`), что честно сказано в ADR-0002 § 10.2, но P02.3/P06.2
формулируются как «участвует в сопоставлении». Настоящая база для гейта — `--base-snapshot`
или живое хранилище. Приоритеты: `Source Key` (идемпотентность) → `place_id` → матчер
(имена+город+координаты) → родитель; порядок в `ingestPoi` подтверждён. Неоднозначности:
`needs_review` / `parentAmbiguous` — есть. Нормализация на границе сравнения: имена —
`normalizeName` в матчере; ключ — `===` без нормализации, контракт файла проверяет ту же
форму (10f-M R1). Версии matcher policy — нет; две таблицы порогов (`poi-matching.ts:
932-978`, `dedupe.mjs:40-43`) без версии. Eval-корпус — нет (ни classification, ни
matching в `tests/fixtures/`). Тождество ≠ близость: `geoRefutedDuplicate` и
`geoNeighbours` разведены — да. Идемпотентность повторного запуска: по `Source Key` —
да, но платит Google до неё (F-05).

### 5.5 Запись и вердикт

Писатели: 12 программных сайтов в 9 файлах (инвентарь по коду; расхождения с реестром —
F-20). Обходы Intake: cron, три админ-хелпера, delete, три ручных скрипта, интерфейс.
Create/update/delete: create — через `ingestPoi` (оба store), update — 8 путей без
журнала, delete — одна кнопка без проверки входящих ссылок (`airtable.ts:379`).
Предзаписьная проверка пакета: маршрут → имена → мост → **резолвер (сеть)** →
`ingestPoiBatch` (контракт источников всех строк до снимка) — порядок верный, кроме
того, что сеть Google стоит до `findBySourceKey`. Свежая проверка строки перед
записью: `findBySourceKey` по кэшу, снятому в начале пакета — на живой базе окно гонки
с ботом закрывается только post-hoc проверкой `POI ID`. Журнал попыток до эффекта:
**нет** для Airtable (есть только у модельного стека). После таймаута/обрыва: таймаута
нет (F-08); исключение останавливает остаток (верно), rollback/retry не придумываются
(верно). Независимое перечитывание: только `POI ID` при коллизии; поля не
перечитываются (P09.3 открыт, подтверждаю). Манифест, code identity, snapshot identity,
schema fingerprint, drift gate: нет (P08 0/3, подтверждаю; `report` несёт только
`startedAt`, `dryRun`, `portals`). Согласие отчёта, кода возврата и Airtable: **нет**
(F-03). Запись при `needs_review`: нет — возврат до `store.create`, покрыто тестами.

---

## 5. Аудит базы POI (§ 6)

### 5.1 Что доказано по сохранённым артефактам

Источники: `tmp/airtable-poi-export-2026-08-25-postwrite.json` (466 записей, проекция
10 полей, контракт `poi-airtable-export/v1`), `tmp/10f-l-baseline-2026-09-01.json`
(SHA-256 `ff1125b2…` совпал с документом; per-record множества),
`tmp/10f-h-six-poi-readonly-inventory-2026-08-28.md` (33 поля с ID и типами),
`backup/poi-full-backup-2026-08-06.json` (431 запись по field ID, без имён полей),
`tmp/dry-osaka-*.json`.

| Утверждение | Доказано | Чем |
|---|---|---|
| `POI ID` — формат `POI-\d{6}`, уникальны | да (466/466 на 25.08; `duplicatePoiIds: []` на 01.09) | выгрузка + baseline |
| `Source Key` уникальны | да на 25.08 (51/51); на 01.09 — 67 с ключом, уникальность не проверялась сборщиком | выгрузка |
| Пространства `Source Key` | `japan-guide` 23, `benesse-artsite` 23, `iconic-view` 5, `owner-curation` 5 (после 26.08); `iconic-view` и `benesse-artsite` не являются writer-путями реестра — происхождение этих ключей документами не объяснено | выгрузка |
| Intake-маркеры | 0 из 466 на 25.08; 5 на 01.09 (`withIntakeMarkers`) | обе |
| `Seed Source` | 28 `admin`, 438 пусто (25.08) | выгрузка |
| Системные | 11 `Is System` | обе |
| Координаты | 450 с парой, 10 `notApplicable`, 0 половинок, 0 вне Японии; 444 с парой без политики; 16 с политикой | baseline (множества, не только счётчики) |
| `Google Place ID` | **200 записей без него** (42 %) — крон их не обновляет, гейт place_id для них слеп | baseline `noGooglePlaceId` |
| Города вне справочников | `inujima` 2, `megijima` 1, `teshima` 4 (не в `KNOWN_CITIES`, не в `DESTINATIONS`); 11 без города (системные) | выгрузка |
| `Name (JA)` | 120 из 466 пусто | выгрузка |
| Пары близких точек | 7 пар ≤ 30 м — очередь проверки, не дубли (правильно классифицированы как `nearPairs`) | baseline |
| Редакция | 30 без RU, 13 Draft-ожидание, 15 Review, 376 Synced, 124/126 без legacy-категории | baseline |
| Схема (частично) | 33 поля с ID/типами; `Coordinate Policy` создана 10f-H (карта v3); поля-ссылки без потребителей в коде: `Place ID` → `tblzYm0CTUAeb8MOI`, `Tickets 1` → `tblKOLhiHMihpWsVl`, `Regions` → `tblbSajWkzI8X7M4U`, `City Location` (используется только L3-картами) | инвентарь 28.08 + grep |

Числа baseline 01.09 (471/460/11, 64, 0/0, 450, 16, 444, 2 drift) **воспроизводятся из
множеств артефакта**, а метод подсчёта (`tmp/10f-l-baseline-2026-09-01.mjs`, 29 КБ)
прочитан выборочно; независимо от `check:poi` они не пересчитывались мной — живого
чтения не было.

### 5.2 Что требует живого чтения (не выполнено)

- опции select: `Seed Source` (`portal-collector`, `telegram-agent`), `Fact Check Status`
  (`Todo`), `Operating Status`, `Copy Status`; существование `Wikidata QID`, `Season Window`,
  `Last Seeded At`, `Intake *` (последние три доказаны косвенно успешным `check:poi` 01.09);
- полный список 53 полей: поля без потребителей и поля, которые код пишет, а схема не
  объявляет; типы `Latitude/Longitude` (precision 7 подтверждена 28.08);
- дубли `Google Place ID` (стережёт `check:canon`, артефакта его прогона нет);
- уникальность `Source Key` на сегодня; связи `Parent POI` (циклы/висячие — `check:poi`);
- расхождение данных с UI/JSON-LD сайта;
- согласие `Coordinate Policy` с координатами у 16 записей (baseline говорит 0
  расхождений — принимаю как утверждение артефакта).

Если разрешение будет дано: только GET; база `apppwhjFN82N9zNqm`, таблицы
`tblVCmFcHRpXUT24y` (POI), `tblpa3Zof1ZGofAtS` (Route Stops), meta `/bases/{id}/tables`;
ожидаемо 1 meta-запрос + 5 страниц POI + 1 страница Route Stops = 7 GET; отчёт —
детерминированный JSON без секретов, сравнение с `npm run check:poi --json`.

---

## 6. Расхождения code ↔ docs ↔ tests ↔ ledger

| # | Где | Что заявлено | Что в коде/тестах |
|---|---|---|---|
| D-1 | ledger P02.2 | «перехваченная ошибка даёт ненулевой код» | верно только для ошибок, покинувших `main`, и `monitorFailure`; `portals[].error`, `write.error` → exit 0 (F-03) → критерий опровергнут, P02 → REOPENED |
| D-2 | ledger P02.3, P06.2 | «снимок участвует в сопоставлении/матчинге» | `--existing` даёт только счётчик; гейт использует `--base-snapshot`/store — разные входы, оба верны, формулировка вводит в заблуждение |
| D-3 | ledger § 2 «Доказательство» | файлы и тесты в репозитории | 8 критериев — untracked/незакоммиченный код (F-02) |
| D-4 | README § 4 «без выводимой политики запись не создаётся ни одним путём» | — | верно для рабочего дерева; production (main) — нет |
| D-5 | README § 4 «Целевое: единая граница resolvePlace» | не реализовано | в рабочем дереве реализовано (10f-N), README не обновлён тем же изменением (change-policy § 13) |
| D-6 | runbook § 2–3: `--base-snapshot` «без токена», «Airtable-токены: нет» | — | Google-ключ подхватывается автоматически, до 132 платных обращений; runbook о Google молчит (F-05) |
| D-7 | README § 6 п. 4 | «литералы модулей ∩ реестр = ∅, проверяется тестом» | тест сканирует только loader (F-19) |
| D-8 | `docs/poi-writers-registry.md` | 12 путей, `poi-intake.ts → ingestPoi` | поля собирает `poi-ingest.ts`; +PATCH `POI ID` в Next-store; +smoke-скрипт (F-20) |
| D-9 | `airtable-schema.ts` | «идентификаторы только отсюда» | 7 литералов base ID, таблица по имени в двух store (F-12) |
| D-10 | `place-resolve.ts:74-79` комментарий | «проверка обязательна и в геометрической ветке» | геометрической ветки в `resolvePlace` нет |
| D-11 | `AGENTS.md` § 4 | «verify проходит без единой переменной окружения» | `check:docs` красный из-за `check:hotel-links` (F-09); `npm test` красный под root (F-18) |
| D-12 | DAG 1.6 «`--existing` fail-closed — закрыт» | — | подтверждаю (105 проверок, процессные), но узел описывает диагностический вход |
| D-15 | ledger P01.2 «стабильные `sourceKey`» — ACCEPTED | — | `opendata-csv.mjs:143` подставляет номер строки (F-07) → критерий опровергнут, P01 → REOPENED |
| D-13 | ADR-0002 § 2 «Нет» | «версии таксономии в отчёте нет» | по-прежнему нет в обычном отчёте; есть только в `report.modelPlan` |
| D-14 | `poi-standard.md` | `Coords Checked At` не старше 30 дней | 200 записей без place_id никогда не обновляются кроном |

Ретроспектива авторских отчётов: чекпойнт 10f-N R1 (`tmp/10f-n-checkpoint-r1-2026-09-02.md`)
подтверждён по существу — `resolverThrew` и `readExactOwn` в коде, контрпримеры A1/B1
воспроизводимы по структуре кода; но отчёт не называет ограничение F-04 и стоимость F-05.
Утверждение 10f-M «P02 закрыт» подтверждено на узком чтении (D-1).

---

## 7. Карта дрейфа и сторожей

### 7.1 Дрейф источников
- HTML/charset/URL/pagination Japan Guide: ловится контрактом v3 + `--monitor` (семантика /
  наблюдение / перестановки / топология) — **есть**, доказано мониторингом v3→v3.
- CSV: смена заголовков — только число колонок в `meta.columns`; семантический fingerprint
  колонок (ADR § 8.1) — **нет**; исчезновение колонки `ID` → тихий `row-N` (F-07) — **нет**.
- Новый объект под старым `sourceKey`: **нет** сторожа (F-07); для Japan Guide частично —
  `vanishedForHumanReview`.
- Условия хранения: `Coords Checked At` + cron для записей с place_id; 200 без place_id
  выпадают из ретеншена (D-14).

### 7.2 Дрейф кода и контрактов
- docs > production: D-4, D-5, D-6, D-7; docs < production: D-12.
- schema/type/test слабее потребителя: `tests/poi-store.mjs` не подаёт неудачный PATCH (F-06).
- один контракт — несколько валидаторов: digest-shape ×3 (`model-pricing.mjs:194-207, 264-269`,
  `provider-profile.mjs:743-756`), координаты ×2, рамка Японии ×3, города ×2, категории ×2.
- мёртвые/декоративные поля: `Place ID`-ссылка, `Tickets 1`, `Regions`; `POI_TABLE_ID` импортирован
  и не используется для запросов; `screenBatchCandidate` экспортирован и не вызывается.
- ledger ≠ код: D-1, D-2, D-3.
- helper вместо production-композиции: P05.3 доказан на фикстуре с `nameEn` (F-04).

### 7.3 Дрейф схемы и данных
- опции Airtable ↔ taxonomy: 24 RU / 18 EN против 20 кодов (DAG 1.3) — подтверждено
  документами, живьём не проверено.
- writer пишет несуществующее поле/опцию: F-22 — не доказано ни в ту, ни в другую сторону.
- legacy ≠ новые: Intake-маркеры различают (порог 11.08), `check:poi` стережёт — **есть**.
- запись без происхождения/политики/идентификатора: закрыто кодом в рабочем дереве, **открыто
  в production** (F-02).
- счётчики сходятся, множества — нет: baseline 01.09 хранит множества по `POI ID` — **есть**;
  для discovery — множества ключей — **есть**.

### 7.4 Предлагаемые сторожа

| Сторож | Ловит | Где | Данные/сеть | Стоимость / ложные | Источник правды | Контрпример | Блокирует? |
|---|---|---|---|---|---|---|---|
| G-1 `source_key_duplicate` в `check:poi` | F-10, ручные дубли ключа | read-only monitor + verify | живой GET POI (уже читается) | ~0; ложных нет | Airtable | две записи с одним ключом | уведомляет (FAIL в verify) |
| G-2 схема-снимок `docs/poi-intake/schema/poi.v1.json` + fingerprint полей, которые пишут writers | F-22, переименование/удаление поля, смена типа | offline unit (writers ⊆ snapshot) + read-only monitor (snapshot = meta API) | meta GET 1 раз в прогон | низкая; ложный сигнал при легальном добавлении опции → обновить снимок | meta API | writer пишет `Seed Source: portal-collector`, снимок без опции | offline — блокирует коммит; live — уведомляет |
| G-3 `run-manifest/v1` минимальный: commit, dirty, taxonomy digest, порог-набор матчера (hash констант), digest снимка базы, digest `--names` | P08.1–P08.2, decision drift ≠ policy drift | integration (`--out`) | нет | ~0 | git + файлы | два отчёта с разными хешами порогов | нет (артефакт) |
| G-4 pre-write drift gate: `snapshotDigest(base) == manifest.baseSnapshot` + `taxonomyDigest == README` до `store.create` | P08.3, запись против устаревшего снимка | integration, тест со store-бомбой | нет | ~0 | манифест | снимок изменён после dry-run | **блокирует** |
| G-5 golden corpus: 200 размеченных пар matching + 100 классификаций (материал: README § 8, `nearPairs`, `collisionQueue`) | правка порогов «чтобы сошлось», F-01 | unit/release gate | нет | часы владельца на разметку | фикстура с версией | правка `DUPLICATE_BLOCK` меняет метрики | блокирует CI |
| G-6 set-level reconciliation после `--write`: множество `Intake Run ID` в базе == множество `created` отчёта, поля перечитаны | P09.3, частичная запись | integration после записи | 1–5 GET | ~0 | Airtable | отчёт created 5, база 4 | уведомляет + rc≠0 |
| G-7 canary: `--base-snapshot` на фиксированных 10 строках Осаки с рукописными `nameEn`, детерминированный отчёт под хешем | регресс гейта/резолвера | CI (с fake-fetch) | нет | ~0 | фикстура | смена `namesAgree` меняет исходы | блокирует |
| G-8 бюджет внешних вызовов: `--max-place-lookups N`, счётчик в отчёте, отказ при превышении | F-05 | runtime | нет | ~0 | флаг | 133-й lookup | **блокирует** |
| G-9 монитор очередей: `placeUnresolved`, `unnamed`, `awaiting` между прогонами по тому же корпусу — рост > x% → REVIEW | исчезнувший/выросший поток | `--monitor` | нет | пороги — решение владельца (ADR § 12.5) | предыдущий отчёт | 0 → 132 unresolved | уведомляет |
| G-10 ledger ↔ код: скрипт сверяет, что каждый файл из колонки «Доказательство» tracked и есть в `npm test`; статусы `ACCEPTED` требуют commit hash | F-02, D-3 | CI (`check:docs`) | нет | ~0 | git ls-files | untracked `existing-file.mjs` | блокирует |
| G-11 offline-режим: `JJ_OFFLINE=1` запрещает `loadEnvConfig` и любой `fetch` (глобальная заглушка бросает) во всех check-скриптах и коллекторе | случайный credentialed read/платный вызов | unit + `npm test` | нет | ~0 | env-флаг | `check:poi` при `.env.local` | **блокирует** сеть |
| G-12 `KNOWN_CITIES ⊆ DESTINATIONS ∪ {tokyo}` и `CATEGORY_RU_TO_EN` единственный | F-12 | unit | нет | ~0 | код | добавить город в один список | блокирует |
| G-13 тест на настоящем процессе: `portals[].error` / `write.error` → rc 1 | F-03 | unit (spawn) | нет | ~0 | код | бросающий адаптер | блокирует |

---

## 8. Упрощение — только после 30/30, кроме S-4 ∩ 10f-R

По возражению 5: список ниже **не является обязательным фронтом** и не входит в путь
до 30/30. Единственное исключение — S-4 в той части, где он совпадает с 10f-R
(общая граница записи: карточка с отпечатком, транспорт с таймаутом, append-only журнал,
независимое перечитывание, карточка восстановления — это и есть P09.2–P09.3). Остальное —
после приёмки парсера, отдельными коммитами, с сохранением перечисленных гарантий.

| # | Что исчезает | Какую гарантию даёт сейчас | Чем заменяется | Риск / откат | Экономия | Критерий успеха |
|---|---|---|---|---|---|---|
| S-1 | `--existing`, `existing-file.mjs` (263), часть `tests/existing-file.mjs`, счётчик `matchedExistingBase` | fail-closed чтение файла; счётчик совпадений | `--base-snapshot` (тот же контракт `assertSnapshotRows`) + отчёт `write.outcomes.already_ingested`/`blocked_duplicate`; процессные тесты кодов возврата переезжают на `--base-snapshot` | низкий; откат — git revert | −1 контракт, −1 CLI-флаг, −~300 строк, −1 строка DAG | P02/P06 доказываются одним входом; `check:docs` зелёный |
| S-2 | второе хранилище `createAirtableStore` в `poi-intake.ts:626-687`, `CATEGORY_RU_TO_EN` ×2, литерал `'POI'` ×2 | тот же алгоритм в двух копиях | один модуль `src/lib/airtable-poi-store.ts` (уже относительные импорты), `POI_TABLE_ID` из схемы, карта категорий — единственная (или из легаси-моста) | средний (Telegram production); откат — revert; проверка — `tests/poi-store.mjs` + `poi-intake.mjs` | −~180 строк, −1 расхождение карт | обе границы зовут один store; grep `'POI'` = 0 в writers |
| S-3 | 7 литералов base ID, 2 точности координат, 3 рамки Японии, 2 справочника городов | — | `AIRTABLE_BASE_ID`, `roundCoordinate`, `JAPAN_BOX`, `DESTINATIONS` как единственные экспорт-источники + G-12 | низкий | −6 дублей, −1 класс дрейфа | grep литералов = 1 |
| S-4 | 12 L3-исполнителей + 22 мутационных набора + 11 журналов в `tmp/` (15 232 строки) | карточка → preflight → old-reread → журнал → reconcile — по копии на серию | одна production-библиотека `src/lib/l3-series.ts` (карточка с отпечатком, транспорт с таймаутом, append-only журнал, независимое перечитывание, карточка восстановления) + один тест-набор; это и есть P09.2–P09.3 (10f-R) | средний; старые карточки остаются уликой, не переписываются | каждая следующая серия: часы вместо дней; −10k строк одноразового кода | 10f-R реализует библиотеку, следующая L3-серия не пишет исполнителя |
| S-5 | модельный стек как активная поверхность README (§ 4 — ~15 строк-абзацев) | reachability + fail-closed | **парковка**, не удаление: стек остаётся в репозитории, тесты остаются в `npm test` (21 с), README сводит описание к трём строкам + ссылка на `docs/poi-intake/model-execution.md`; `enrich.mjs` цену берёт из `model-pricing.mjs` (одна таблица) | низкий | −сопровождение документации; −1 источник цены | README § 4 ≤ 1 экрана; `aiCost` = каноническая таблица |
| S-6 | `diffAgainstSnapshot` после записи как «мониторинг» | посмертный диф | G-3 + G-4 (манифест и гейт до записи), post-run report остаётся | низкий | −путаница «monitor = гейт» | ADR § 5.1 выполнен |
| S-7 | `Notes` как проза происхождения (`buildNotes`) параллельно структурным полям | человекочитаемый след | оставить, но не дублировать `Source Key`/`Первоисточник` — они уже в полях | низкий | меньше расхождений | Notes не повторяет структурные поля |
| S-8 | `screenBatchCandidate`, неиспользуемые экспорты, `POI_TABLE_ID`-импорт без использования | — | удалить | ~0 | чистота | grep |

Не предлагается (и не должно быть предложено): автоматический повтор неизвестной записи,
отказ от перечитывания, нормализация идентификаторов, слияние owner/machine decision,
запись discovery-подсказок, ослабление fail-closed, хранение чужого содержимого.

---

## 9. Снижение стоимости (все суммы ориентировочные — тарифы сетью не проверялись)

| Источник расходов сейчас | Изменение | Ожидаемая экономия | Как измерить |
|---|---|---|---|
| Google Places Text Search (Pro-поле-маска) на каждый pending при любом `args.write`, повторно при каждом прогоне, до `findBySourceKey` (F-05) | `findBySourceKey` до резолвера; `--max-place-lookups`; кэш `sourceKey → {placeId, lat, lon, checkedAt}` в `tmp/` с TTL 30 дней (условия Maps: place_id бессрочно, координаты 30 дней) | повторные прогоны: −100 % оплаченных lookup для already_ingested и кэшированных; Осака: ~132 → ~0 при повторе | `placeLookups` в отчёте; счёт Google по дням |
| Резолвер по `nameEn`: на Осаке 0 попаданий, любой прогон — деньги без результата (F-04) | `nameJa` + `locationBias` (круг 500 м от портальной точки) → один запрос, высокая точность | доля `notResolved` с ~100 % до оценочно < 20 % (проверить на canary из 20 строк — ≈ 0,64 $) | `placeRefusals` по причинам |
| Airtable: полный снимок на каждый пакет (5 страниц) + GET-фильтр после каждого create + PATCH при коллизии; `verify` = 4 живых стадии по 5 таблицам | снимок по `fields[]` уже минимален; фильтр коллизии оставить (дёшево); в `verify` объединить `check:canon`/`check:poi` чтение в один GET-набор (обе читают POI целиком) | −5 GET на `verify`; ~0 $ (Airtable не тарифицирует), но −время и −rate-limit | число GET в логах |
| Модельный стек: 0 $ сегодня; сопровождение — 10,4k + 11k строк, README | S-5 парковка; при разрешении policy — двухступенчатая маршрутизация уже есть (правила → модель), стоимость ~0,03–0,05 $ на 2012 строк Осаки | сопровождение −; деньги без изменений | строки README, время `npm test` |
| L3-серии: каждая — новый исполнитель (8 261 строка на 12) + мутации (6 971) | S-4 библиотека | −80 % кода на серию; часы вместо дней | строки в `tmp/` на серию |
| Telegram: OpenAI `gpt-4.1-mini` + web_search на каждое сообщение, Wikidata 2 GET, Google 1 | без изменений (вне парсера); проверить доступность модели (F-23) | — | счёт OpenAI |
| CI: `npm test` 21 с; `verify` целиком с build | нормально; не трогать | — | — |

---

## 10. Минимальный путь до ≤16/30 → 30/30 — маршрут по пакетам с арифметикой реестра

Маршрут принят по возражениям штатного аудитора; ниже он привязан к критериям так,
чтобы после каждого пакета сумма закрытых критериев была проверяемой. Исходная точка
после коррекции: P01 `REOPENED 2/3`, P02 `REOPENED 2/3`, P03 2/3, P04 2/3, P05 2/3,
P06 2/3, P07 2/3, P08 0/3, P09 1/3, P10 1/3 = **16/30**, принятых вех 0.

| Пакет | Закрывает критерии | Находки, которые обязан закрыть | Внешние предпосылки | Итог после пакета |
|---|---|---|---|---|
| **10f-N** (в дереве, R2 `a11b696e…`) | P05.3 | F-01 (токенное тождество + `ambiguous` при ≥2 прошедших + расстояние до точки источника), F-04 (резолвер принимает `nameJa` и `locationBias`; canary на 20 строках Осаки с японскими именами — ориентировочно ≤1 $), F-05 (`findBySourceKey` до резолвера, лимит `--max-place-lookups`, runbook), F-16 (без `?? wantPrefecture`), F-24 (`data?.places` внутри `try`); README § 4 переносит «единая граница resolvePlace» из «целевого» в «реализовано» тем же коммитом; коммит пакета (F-02) | решение владельца о ключе резолвера (затрагивает Telegram) — по определению реестра § 5 это не `SCOPE_CHANGE` (критерий не меняется), но это matcher-policy, нужна строка владельца (ADR-0002 § 12.3) | 17/30; P05 3/3 → `ACCEPTED` после независимого аудита |
| **10f-O** | P03.3 | fail-closed production-entrypoint исполнителя (DAG 1.1); без платного вызова | подтверждение владельца, что P03.3 значит «отказывает без разрешения» (после пакета P03 = 3/3 при нулевой полезной функции) | 18/30; P03 3/3 |
| **10f-P** (лучше три подпакета) | P04.3, P06.3, P07.3 | P06.3: версия matcher policy (G-3) + eval-фикстура (G-5) — чистый код; P04.3: поля taxonomy v2 в Airtable (schema change, R3); P07.3: авторизованный контур `representativePoint`/`notApplicable` | решения владельца 4.5 (состав полей v2) и 4.9 (форма авторизации) — без них P04.3/P07.3 недостижимы кодом | 21/30; P04, P06, P07 по 3/3 |
| **10f-Q** | P01.2 (reopened), P08.1–P08.3 | F-07 (fail-closed на строки без источникового ID), F-10 (сторож уникальности `Source Key` + строгий `findBySourceKey`), F-15 (`placeId` в пуле пакета), `run-manifest/v1` (G-3), экспортёр снимка базы (DAG 2.3 — без него манифесту нечего связывать), pre-write drift gate до `store.create` (G-4) | retention-матрица 4.3 определяет, где живёт снимок с координатами (пока только `tmp/`) | 25/30; P01 3/3 → `ACCEPTED`, P08 3/3 |
| **10f-R** | P02.2 (reopened), P09.2–P09.3 | F-03 (`portals[].error`/`write.error` → ненулевой код; тест на настоящем процессе), F-06 (`res.ok` + перечитывание после PATCH), F-08 (`AbortSignal.timeout` на всех вызовах; истёкший срок = «исход неизвестен»), журнал попыток до первого эффекта, независимое перечитывание полей каждой созданной записи, set-level reconciliation по `Intake Run ID` (G-6); реализация — общая библиотека серии (S-4 ∩ 10f-R) | — | 28/30; P02 3/3 → `ACCEPTED`, P09 3/3 |
| **10f-S** | P10.2–P10.3 | живой schema preflight (F-22: опции `Seed Source`, `Fact Check Status`, поля `Wikidata QID`, `Season Window`), ограниченный импорт явно названного подмножества, независимая финальная сверка | разрешение владельца на live write; подмножество только с представимыми типами (мост 9/20 останавливает весь пакет при одной непредставимой строке — `collect-pois.mjs:1008-1019`); долг A (4.7 — правило канонизации § 2 не отменено); зелёный `verify` — либо гостиничный трек выносит `check:hotel-links` (F-09), либо в доказательстве P10.3 названо исключение | 30/30; P10 3/3 |

Порядок пакетов содержательный: N раньше Q (гейт drift сравнивает снимок с тем, что
реально пишет резолвер), Q раньше R (журнал и перечитывание привязываются к манифесту),
R раньше S. Ни один пакет не добавляет вех и критериев; знаменатель 30 неизменен.
Открытые кандидаты `SCOPE_CHANGE` — только семантика P03.3 (если владелец решит, что
«подключение модели» означает нечто большее, чем fail-closed entrypoint).

---

## 11. Follow-up debt (не блокирует парсер) и вне области парсера

**Вне области парсера (припаркованные треки):** F-09 (`check:hotel-links` в `verify` —
гостиничный трек), F-13 (крон/скрипт координат — трек cron), F-23 (модель Telegram-бота —
трек Telegram).

**Follow-up debt после 30/30:** F-11 (Wikidata первое попадание), F-12 (дубли источников
правды: два store, две карты категорий, семь литералов base ID, две точности, три рамки,
два справочника городов), F-14 (две таблицы цен), F-17 (`businessStatus` портального
пути), F-18 (chmod в тесте под root), F-19–F-21 (docs: сторож литералов, реестр писателей,
портал по умолчанию); S-1–S-3, S-5–S-8; G-1, G-2, G-9, G-11, G-12; `tmp/` — 458 файлов,
53 МБ, 51k строк `.mjs` (парковка/архив по решению владельца); `Place ID`/`Tickets 1`/
`Regions` — поля-ссылки без потребителей (удалить или задокументировать); 200 записей
без `Google Place ID`; 7 записей с городами вне справочников; `iconic-view:*` и
`benesse-artsite:*` — пространства `Source Key` без описанного писателя.

Переклассифицированы **из** follow-up в область парсера по возражению 3: F-10, F-15, F-16
(см. § 3 и § 10).

---

## 12. Не проверено — точный список и причина

Проверено дополнительно в R2: байты `poi-portal-place.ts` `a11b696e…` и `tests/poi-portal-place.mjs` `1aefc7e0…` исполнены в контейнере — 155/155, `tsc` 0, `eslint` 0; остальные ключевые файлы побайтно те же, что в R1.

1. Живая Airtable (схема, опции, дубли place_id/Source Key, связи, соответствие
   UI/JSON-LD) — разрешения на credentialed GET не было. Вердикт базы:
   `UNVERIFIED_LIVE_STATE`.
2. `npm run verify` целиком — четыре живые стадии (`check:copy`, `check:canon`,
   `check:poi`, `check:images`) и `next build` не запускались: нет разрешения на живое
   чтение; сборка на мунте невозможна (SWC), в контейнере не запускалась намеренно
   (отчёт ограничен офлайн-проверками). Запущено: `npm test` (все 39 наборов: 38 зелёных
   под root, `poi-model-reconciliation` зелёный под non-root — 215/215),
   `tsc --noEmit` (0 ошибок), `eslint` на 13 изменённых файлах (0), `check:docs`
   (**1 расхождение**), `verify-discovery-baseline` (rc 0),
   `check:poi --fixture tests/fixtures/poi-integrity` (rc 1 ожидаемо на фикстуре с
   намеренными FAIL).
3. Порталы, Google, Wikidata, OpenAI — сеть не использовалась; F-04 доказан по сохранённому
   dry-run 11.08, а не свежей выгрузкой; F-11, F-23 — не исполнены.
4. `japan-guide-html.mjs` (1614 строк), `html-fetch.mjs` (795), `discovery-contract.mjs`
   (2965) — не переаудированы построчно; принято по тестам (707 + 572 + 145) и
   независимой сверке baseline.
5. Метод подсчёта `tmp/10f-l-baseline-2026-09-01.mjs` — не сверен с `check:poi` построчно;
   совпадение хеша артефакта с документом подтверждено.
6. Мутационные матрицы авторов (10f-L R5 28/28, 10f-M 17/17, 10f-N) — не воспроизводились;
   отчёт опирается на собственные контрпримеры (§ 3).
7. Точные SKU/цены Google Places и текущий прайс OpenAI — не проверялись сетью; оценки в § 9
   помечены как оценочные.

---

## Таблица рекомендаций (R2)

| ID | Класс | Серьёзность | Блокирует P01–P10 | Пакет | Экономия | Риск | Следующий шаг |
|---|---|---|---|---|---|---|---|
| F-01 ✔✔ | IN_SCOPE_DEFECT | P1 | P05.3; смысл `exactObjectPoint` (P07) | 10f-N | качество данных | средний (меняет исходы Telegram) | токенное тождество; `ambiguous` при ≥2 прошедших; расстояние до точки источника; canary на японских именах |
| F-02 ✔✔ | IN_SCOPE_DEFECT | P1 | ≥6 «закрытых» критериев не в CI/production | коммит до 10f-O | — | низкий | коммит пакетов поимённо, README тем же коммитом, G-10 |
| F-03 ✔✔ | IN_SCOPE_DEFECT — **P02.2 опровергнут** | P1 | P02 → REOPENED 2/3 | 10f-R | — | низкий | отложенный throw после отчёта; G-13 |
| F-04 ✔✔ | IN_SCOPE_DEFECT (matcher-policy, строка владельца) | P1 | P05.3 на реальном корпусе | 10f-N | Google: −100 % пустых lookup | средний | `nameJa` + `locationBias`; canary 20 строк Осаки |
| F-05 | IN_SCOPE_DEFECT (docs + порядок) | P2 | 10f-N приёмка | 10f-N | Google: −повторы (ориентировочно) | низкий | `findBySourceKey` до резолвера; G-8; runbook |
| F-06 ✔✔ | IN_SCOPE_DEFECT | P2 | P09.2–P09.3 | 10f-R | — | низкий | `res.ok` + перечитывание после PATCH; тест с 429 |
| F-07 ✔✔ | IN_SCOPE_DEFECT — **P01.2 опровергнут** | P2 | P01 → REOPENED 2/3 | 10f-Q | — | низкий | fail-closed на строки без источникового ID |
| F-08 | IN_SCOPE_DEFECT | P2 | P09.2 | 10f-R | — | низкий | `AbortSignal.timeout` везде; «неизвестный исход» |
| F-09 | вне области парсера (гостиничный трек) | P2 | нет (механически: «verify зелёный» для P10.3) | трек гостиниц | — | ~0 | вынести/добавить флаг одной строкой |
| F-10 | IN_SCOPE_DEFECT (переклассифицирован) | P2 | идемпотентность (P06/P08) | 10f-Q | — | ~0 | G-1 + строгий `findBySourceKey` |
| F-11 | FOLLOW_UP_DEBT | P2 | нет | после 30/30 | — | низкий | сверка метки Wikidata с nameEn |
| F-12 | FOLLOW_UP_DEBT | P3 | нет | после 30/30 | сопровождение | низкий | S-2, S-3, G-12 |
| F-13 | вне области (cron-трек) | P2 | нет | трек cron | Google: −повторные refresh | низкий | checkedAt в скрипте; одна функция сдвига |
| F-14 | FOLLOW_UP_DEBT | P2 | нет | после 30/30 | — | ~0 | одна таблица цен |
| F-15 | IN_SCOPE_DEFECT (переклассифицирован) | P2 | «один place_id — один POI» в пакете (P06) | 10f-Q | — | низкий | `placeId` в пуле + регрессия |
| F-16 | IN_SCOPE_DEFECT (переклассифицирован) | P2 | происхождение префектуры (P05.3) | 10f-N | — | низкий | без `?? wantPrefecture`; именованный отказ |
| F-17 | FOLLOW_UP_DEBT | P3 | нет | после 30/30 | — | низкий | `businessStatus` в запрос |
| F-18 | FOLLOW_UP_DEBT | P3 | нет | после 30/30 | CI-стабильность | ~0 | пропуск под root с явным сообщением |
| F-19–F-21 | FOLLOW_UP_DEBT (docs) | P3 | нет | после 30/30 | — | ~0 | правка документов |
| F-22 | требует живого чтения | P3 | 10f-S (schema preflight) | 10f-S | — | — | meta GET с разрешением |
| F-23 | вне области (Telegram-трек) | P3 | нет | трек Telegram | — | средний для Telegram | проверить модель |
| F-24 | IN_SCOPE_DEFECT | P2 | P05 (вторая граница резолвера) | 10f-N | — | низкий | `data?.places` внутри `try`; регрессия на `null` |
| S-4 ∩ 10f-R | обязательная часть | — | P09.2–P09.3 | 10f-R | −80 % кода будущих серий | средний | общая библиотека серии записи |
| S-1–S-3, S-5–S-8 | упрощение | — | нет | после 30/30 | см. § 8 | низкий/средний | отдельными коммитами |
| G-3/G-4/G-6 | сторожа | — | = P08, P09.3 | 10f-Q/10f-R | — | низкий | манифест, drift gate, reconciliation |
| G-11 | сторож | — | нет | после 30/30 | случайные платные/credentialed вызовы | низкий | `JJ_OFFLINE=1` |

Сводка первой строкой по правилу реестра § 10 — заявлено `P05: 2/3; всего 18/30;
scope delta 0`; по итогам аудита фактически `≤16/30` с рекомендацией `REOPENED` для P01
и P02 (статусы в реестре я не менял — это решение владельца, оформляется строкой в § 8
реестра). `task identity: preserved` — аудит не добавил ни одной вехи и ни одного
критерия; единственный открытый кандидат `SCOPE_CHANGE` — семантика P03.3.

Денежные оценки во всём отчёте ориентировочные: тарифы Google Places и OpenAI сетью не
проверялись.

READY_FOR_OWNER_AND_CODEX_REVIEW
