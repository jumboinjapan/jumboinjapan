```
Status: current index of retired POI documents
Owner: Eduard Revidovich
Решение владельца: 06.09.2026, второй опросник, п. 1.1 (docs/poi-intake/pilot-owner-decisions-2026-09-06.md)
Canonical current status: docs/poi-intake/README.md
```

# Индекс удалённых документов POI

История доказательств живёт в Git, а не в рабочем дереве: отменённые handoff, промежуточные
аудиты, прежние roadmap и стандарт удалены консолидацией 06.09.2026, и их возвращение в
дерево останавливает `check:docs`. Этот индекс — единственная точка, через которую ссылка на
удалённый документ остаётся проверяемой: для каждого пути названы SHA‑256 байтов последней
редакции и последний коммит, изменивший файл (сам файл существует во всех коммитах до
удаления включительно, то есть до `8cbd73e`).

Чтение любой строки — одной командой, без восстановления в дерево:

```
git --no-optional-locks show <коммит>:<путь> | sha256sum   # обязан совпасть с колонкой SHA‑256
git --no-optional-locks show <коммит>:<путь>               # сам текст
```

| Путь | SHA‑256 байтов | Последний коммит, изменивший файл | Строк | Что это было |
|---|---|---|---|---|
| `docs/poi-intake/audits/fable-5.1-poi-system-audit-2026-09-02-r2.md` | `c3fbbd7de811a0c4ea6f211ccd69b6d328d0ab677875e62afe008326fe0fd8a6` | `fde6b4e` | 814 | аудит Fable R2, по которому 02.09.2026 переоткрыты P01.2 и P02.2 (F‑03, F‑07) |
| `docs/poi-intake/audits/fable-5.1-poi-system-audit-2026-09-02.md` | `a2811f553d429423bf1ff1064a26b8b55e77962b8affe698aa8789504312db08` | `fde6b4e` | 698 | аудит Fable, первая редакция |
| `docs/poi-intake/audits/fable-5.1-full-audit-handoff-2026-09-02.md` | `0263b411172ed246377802f0a7e0c04b819422a6175f5289643f9fd60e1d643b` | `fde6b4e` | 434 | handoff полного аудита Fable |
| `docs/poi-intake/audits/README.md` | `b30ccdaed569e793be4891ea3c4fda83e5a2721136678b167a0e9914cd63d6e1` | `fde6b4e` | 21 | индекс каталога аудитов |
| `docs/poi-intake/drift-roadmap.md` | `98af86d6ea86cb989c50ce2a0e7b5a872715312948cc7bfb7998a76b1109aaf2` | `8fbf4f7` | 283 | этапы внедрения контроля дрейфа; на него ссылается ADR‑0002 |
| `docs/poi-standard.md` | `f1568b8a6a7b1395911289c5c4f6cd315c11429a6844e854054cd317a7fd9183` | `8fbf4f7` | 128 | прежний стандарт записи POI; правила перенесены в код и `change-policy.md` |
| `docs/poi-sources-ranking.md` | `cefa3d5df846f55b407b2e489ae8841802316037f912e8facb5a670ee2f89ee2` | `25617ce` | 244 | ранжирование источников до реестра `registry.mjs` |
| `docs/poi-roadmap.html` | `eb4e342a93d670be3634a35e7823365435e8f8c4eb59237e6a4b189798ccab43` | `25617ce` | 324 | визуальная дорожная карта до DAG |
| `docs/poi-portal-collector.md` | `4fcd47607dbf839151a280495315aedf4eb902948196898328b43bed6ebe97be` | `4b29046` | 348 | описание коллектора до `scripts/poi-portals/README.md` |
| `docs/poi-intake-contract.md` | `1df4aa355ee8ff7f76b59d58ed81d28430cab3c658440458d91d41bde37c2608` | `4b29046` | 311 | прежний текстовый контракт приёма; действующий — `src/lib/poi-ingest.ts` |
| `docs/poi-intake-agent.md` | `c315e38ca6aa49090b328a53d5f531172001b42d772d3473b9d45eb5db48dbde` | `4b29046` | 87 | инструкция агенту приёма до `agent-maintenance-guide.md` |
| `docs/poi-fact-strategy.md` | `b0a60db184127f207abc3247fcde216403d7e11850803c27f0d85b31bff07909` | `58f1091` | 253 | стратегия фактов и описаний |
| `docs/handoff-poi-intake-v2-2026-08-11.md` | `fca9bf34f8f207ee88c66427172454de1593d002d0f5de4ac7e71b9205cd16eb` | `4b29046` | 1772 | handoff приёма v2 |
| `docs/handoff-poi-name-en-required.md` | `44212de08e9ab78564303154486895e432421bc3b26282b665924f8dc409340a` | `fcd70ec` | 80 | handoff об обязательном английском имени |
| `scripts/poi-score.mjs` | `953ab8915004eb30b82a76191312cd4c5e1e35a727c2038ca61f1fad2245d913` | `e7321bc` | 181 | скрипт оценки по старому стандарту; команда `poi:score` снята (решение владельца 06.09.2026, п. 7.1) |

Правила:

* новый удалённый документ POI входит в этот индекс тем же коммитом, что и удаление;
* перенос документа допустим только с сохранением байтов — тогда строка получает новый путь
  при том же SHA‑256;
* индекс не заменяет документ: он делает ссылку проверяемой, а не пересказывает содержание;
* состав таблицы и список `RETIRED_POI_PATHS` в `scripts/check-doc-contracts.mjs` обязаны совпадать —
  это проверяет `check:docs`.
