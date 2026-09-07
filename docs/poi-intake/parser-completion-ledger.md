```
Status: current acceptance snapshot
Scope ID: poi-parser-v1
Scope frozen: 2026-09-01
Owner: Eduard Revidovich
Canonical current status: docs/poi-intake/README.md
Acceptance checks: 30
Checks met: 30
Milestones accepted: 10 of 10
Accepted: 2026-09-05
```

# Airtable Intake Core: итоговый реестр приёмки

Этот файл хранит **итог**, а не дневник разработки. Подробности текущей архитектуры и
безопасных изменений находятся в `README.md` и `agent-maintenance-guide.md`; открытые
работы после завершения — в `poi-completion-dag.md`. Промежуточные аудиты и handoff удалены
из рабочего дерева; путь, SHA‑256 и коммит каждого — в `retired-index.md`, текст читается из
Git-истории без восстановления в дерево.

## 1. Граница принятого результата

Принят общий parser-owned поток, начинающийся с канонического кандидата:

`PoiCandidate от candidate-producing Portal Intake Adapter → классификация → matching →`
`manifest/gate → owner approval →`
`resolvePlace/owner decision → ingestPoi → проверяемая запись → независимое чтение → отчёт`

Приёмка 30/30 не доказывает наличие Portal Intake Adapter у каждого источника. В
частности, discovery Japan Guide не входит в эту границу, пока не реализована проекция
`discovery record → PoiCandidate`.

Не входят в результат 30/30: массовый импорт, автоматический cron, редакторские update-path,
автоматическое удаление, миграция legacy-данных и отдельные системы для других видов данных.
Каждое такое изменение получает собственную область и не наследует полномочия POI.

## 2. Десять принятых вех

В каждой строке ровно три критерия. Источником точных enum, полей и поведения остаётся код;
этот реестр называет границу и исполняемое доказательство.

| ID | Принятая граница | Три критерия | Владеющий код и доказательство |
|---|---|---|---|
| P01 | Получение источников | ✓ обход корпуса; ✓ стабильный `Source Key` и учёт каждой строки; ✓ полный read-only прогон заканчивается отчётом | `scripts/poi-portals/registry.mjs`, `lib/opendata-csv.mjs`; `tests/opendata-csv.mjs`, `poi-model-plan.mjs` |
| P02 | Fail-closed процесс | ✓ неверный вход отвергается до эффектов; ✓ провал процесса даёт ненулевой код; ✓ корректный снимок участвует в matching | `collect-pois.mjs`, `lib/existing-file.mjs`; `tests/existing-file.mjs`, `poi-verified-write.mjs` |
| P03 | Модельное извлечение | ✓ план, профиль, разрешение и preflight связаны; ✓ исполнитель и журнал проверены офлайн; ✓ production-entrypoint не обходит ворота | `lib/model-*.mjs`, `lib/execution-*.mjs`; `tests/poi-model-entrypoint.mjs`, `poi-model-reachability.mjs` |
| P04 | Taxonomy | ✓ реестр v2 и loader каноничны; ✓ классификатор использует реестр; ✓ результат представим в схеме Airtable | `config/poi-taxonomy.v2.json`, `src/lib/poi-taxonomy*.ts`, `scripts/poi-schema/`; `tests/poi-taxonomy*.mjs`, `poi-schema-chain.mjs` |
| P05 | География | ✓ единый `resolvePlace`; ✓ подтверждённая точка канонизируется; ✓ портал передаёт `resolved` и Place ID через эту границу | `src/lib/place-resolve.ts`, `poi-portal-place.ts`; `tests/place-resolve.mjs`, `poi-portal-place.mjs`, `poi-canary-osaka-offline.mjs` |
| P06 | Matching и дедупликация | ✓ снимок базы строгий; ✓ снимок участвует в решении; ✓ policy v4, словари и различающая eval-фикстура имеют отпечатки; **P06.3 `ACCEPTED` повторно 08.09.2026** аудитом Codex (10h-A, R2), после переоткрытия по I‑5.1 из-за двух ложных дублей в разметке владельца | `src/lib/poi-matching.ts`, `lib/dedupe.mjs`; `tests/poi-matching.mjs`, `poi-matching-eval.mjs`, `fixtures/poi-matching-eval/v1.json` |
| P07 | Контракт записываемой POI | ✓ неизвестное не пишется; ✓ `exactObjectPoint` связан с координатами; ✓ owner-решения `representativePoint`/`notApplicable` проходят один production-канал | `src/lib/poi-coordinate-*.ts`, `poi-ingest.ts`; `tests/poi-coordinate-*.mjs` |
| P08 | Manifest и допуск | ✓ `run-manifest/v2`; ✓ подписаны вход, база, правила, реестры и код; ✓ pre-write gate стоит до store, resolver и первого эффекта | `lib/run-manifest.mjs`, `lib/code-graph.mjs`; `tests/poi-run-manifest.mjs`, `poi-code-graph.mjs`, `poi-prewrite-gate.mjs` |
| P09 | Проверяемая запись | ✓ parser-owned create-path существует; ✓ намерение долговечно журналируется и неизвестный исход восстанавливается чтением; ✓ каждая запись подтверждается независимыми чтениями | `lib/airtable-store.mjs`, `verified-write.mjs`, `write-journal.mjs`, `reconcile-writes.mjs`; `tests/poi-write-journal.mjs`, `poi-verified-write.mjs` |
| P10 | Ограниченная live-приёмка | ✓ реальный источник проходит полный поток; ✓ owner approval ограничивает строки и эффекты; ✓ результат и запрет лишних эффектов подтверждены отчётом и журналом | `lib/write-approval.mjs`, `collect-pois.mjs`; `tests/poi-write-approval.mjs`; принятый canary 05.09.2026 |

Итог: **30/30 критериев, 10 из 10 вех приняты** (приёмка 05.09.2026). Новый дефект может
переоткрыть конкретную границу только production-контрпримером; новая функция сама по себе
не меняет этот замороженный знаменатель. **Текущее состояние: 30/30** — P06.3 повторно
принят аудитом Codex 08.09.2026 (10h-A, R2) после переоткрытия 07.09.2026
production‑контрпримером (два ложных дубля в разметке владельца:
`zuiganji-treasure-museum`, `taishakuten-shibamata` в `fixtures/poi-matching-eval/v1.json`),
исправление — `poi-matcher-policy/v4` (часть–целое различается и по английскому имени);
ручные метки и исходные объекты eval-фикстуры сохранены.

## 3. Подтверждённые живые переходы

| Дата (JST; артефакты в `tmp/` датированы UTC) | Полномочие | Проверенный результат | Эффекты |
|---|---|---|---|
| 05.09.2026 | `canary-osaka-v2-2026-09-05` | созданы и независимо перечитаны `POI-000577` и `POI-000578`; третья разрешённая строка остановлена неоднозначностью места до записи | 3 Google Places, 2 POST, 0 PATCH, 0 DELETE |
| 06.09.2026 | `owner/2026-09-05#fujita-google-point` и новое одноразовое write approval | создан и независимо перечитан `POI-000579` «Музей Фудзита», политика `representativePoint` | 0 Google Places, 1 POST, 0 PATCH, 0 DELETE |

Used-marker, write-journal и schema-execution journal — operational evidence. Их нельзя
удалять как временный мусор: они предотвращают повтор уже исполненного разрешения и нужны
для поздней сверки. Точный текущий размер живой базы этим документом не заявляется.

## 4. Как поддерживать реестр

- Не добавлять сюда поминутную историю аудита, логи мутаций и временные пути.
- При production-контрпримере назвать P01–P10, сохранить различающее доказательство в тесте
  и временно отметить переоткрытие в `README.md`; после исправления обновить эту строку.
- Новую post-completion работу вести в DAG, не увеличивая 30/30 задним числом.
- Любое живое чтение, запись, commit и push отражать в итоговой передаче отдельно.
