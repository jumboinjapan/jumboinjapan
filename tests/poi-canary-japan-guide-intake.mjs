#!/usr/bin/env node
/**
 * OFFLINE-ПРИЁМКА JA-6в: JAPAN GUIDE → НАСТОЯЩИЙ `ingestPoi` → ХРАНИЛИЩЕ В ПАМЯТИ.
 *
 *   node tests/poi-canary-japan-guide-intake.mjs
 *
 * Сухой прогон JA-6 доводит строку до вердикта «годна к созданию». Что запись
 * ДЕЙСТВИТЕЛЬНО завелась бы — и завелась бы ЧЕРНОВИКОМ, без описания и без
 * опубликованного текста, — из вердикта не следует. Здесь путь доводится до
 * конца: подготовленные запросы идут в производственный `ingestPoiBatch` →
 * `ingestPoi`, а хранилищем служит снимок в памяти.
 *
 * ЖИВЫХ ЗАПИСЕЙ НЕТ ПО УСТРОЙСТВУ, А НЕ ПО ОБЕЩАНИЮ. Хранилище — то самое, у
 * которого нет кода записи в Airtable, и writer узнаёт его ПО ТОЖДЕСТВУ
 * фабрики (`isMemoryPoiStore`), а не по объявленному полю. Это проверяется
 * первой же строкой прогона. Сети, Google и модели здесь нет вовсе.
 *
 * ПРИЁМУ ПРЕДЛАГАЕТСЯ ТОЛЬКО ПОДГОТОВЛЕННЫЙ ЗАПРОС. Между сухим прогоном и
 * приёмом стоит `assertIntakeAdmissible`: запрос, не проходящий обязательных
 * проверок Intake, до `ingestPoi` не доезжает вовсе. Строку без обязательных
 * данных останавливает граница подготовки ИМЕНОВАННЫМ отказом — она не
 * становится `writable`, запроса для неё не собирается, и приём её не видит.
 */
import { runDryRun } from '../scripts/poi-portals/lib/japan-guide-dry-run.mjs'
import { assertIntakeAdmissible, JG_RECORD_SPEC } from '../scripts/poi-portals/lib/japan-guide-record.mjs'
import { createSnapshotStore } from '../scripts/poi-portals/lib/base-snapshot.mjs'
import { evaluatePortalCandidates } from '../scripts/poi-portals/collect-pois.mjs'
import { getPortal } from '../scripts/poi-portals/registry.mjs'
import { ensureTaxonomySchemaForWrite, ingestPoiBatch, POI_INTAKE_CONTRACT_VERSION } from '../src/lib/poi-ingest.ts'
import { TAXONOMY_FIELDS } from '../src/lib/poi-taxonomy-airtable.ts'
import { taxonomyVersion } from '../src/lib/poi-taxonomy.ts'
import { legacyAirtableCategory } from '../scripts/poi-portals/lib/legacy-airtable-category-bridge.mjs'
import { isMemoryPoiStore } from '../src/lib/poi-memory-store.ts'
import {
  enrichedRow, enrichmentOf, exportBytesOf, GOOD_NAMED, identificationOf, identifiedRow,
  NAMES_RU, ownerNames, queueRow, queuesOf, TODAY,
} from './fixtures/japan-guide-pipeline.mjs'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const has = (label, text, needle) => {
  if (typeof text === 'string' && text.includes(needle)) ok++
  else bad.push(`${label}: в «${String(text).slice(0, 200)}» нет «${needle}»`)
}
const boom = async (fn) => { try { await fn(); return '(без ошибки)' } catch (e) { return e instanceof Error ? e.message : String(e) } }

const PORTAL = getPortal('japan-guide')

/* СЕТЕВАЯ ЛОВУШКА, а не обещание. Любой выход в сеть на этом пути — дефект, и
   узнать о нём надо здесь, а не по счёту от Google. */
let networkCalls = 0
globalThis.fetch = (...args) => {
  networkCalls += 1
  throw new Error(`приёмка Japan Guide → Intake: сеть на этом пути запрещена, вызван fetch ${String(args[0])}`)
}

/* ── ВХОДЫ ────────────────────────────────────────────────────────────────
   Четыре строки: три владелец назвал, четвёртую — нет. Опознание есть у трёх
   названных; у безымянной его нет намеренно — она обязана остановиться раньше
   и по своей причине. */
const KEYS = ['c1', 'c2', 'c3', 'c4'].map((k) => `japan-guide:${k}`)
const queues = queuesOf(KEYS.map((key, i) => queueRow(key, `Canary ${i}`)))
const enrichment = enrichmentOf(KEYS.map((key, i) => enrichedRow(key, `Canary ${i}`, GOOD_NAMED(i))),
  { inputs: { queues: { digest: queues.reportDigest } } })
const identification = identificationOf(
  KEYS.slice(0, 3).map((key, i) => identifiedRow(key, {
    placeId: `ChIJ-canary-${i}`, lat: 34.99 + i / 5, lon: 135.78 + i / 5,
  })),
  { inputs: { enrichment: { digest: enrichment.reportDigest } } },
)
/* Проверенные русские имена и направление — из файла владельца, настоящим
   загрузчиком. Правила города общие: `kyoto` есть в справочнике направлений,
   и за ним стоит 京都府 — та самая префектура, в которой опознаны места. */
const names = await ownerNames(Object.fromEntries(KEYS.slice(0, 3).map((key, i) => [
  key, { nameRu: NAMES_RU[i], siteCity: 'kyoto' },
])))

/* ОДНА ПОСТОРОННЯЯ ЗАПИСЬ — И В ВЫГРУЗКЕ, И В СНИМКЕ ХРАНИЛИЩА. Пустой снимок
   контракт не принимает намеренно: пустая база и снимок не той выгрузки
   различаются только этим файлом. Запись посторонняя — ни именем, ни точкой
   она с канарейкой не пересекается. */
const OUTSIDER = {
  poiId: 'POI-000042', recordId: 'rec00000000000042', nameRu: 'Посторонняя запись',
  nameEn: 'Unrelated', siteCity: 'osaka', lat: 34.5, lon: 135.3, placeId: null,
  sourceKey: 'bodik-osaka-tourism:OSAKA0000001',
}
const exportBytes = exportBytesOf([{
  recordId: OUTSIDER.recordId, poiId: OUTSIDER.poiId, nameEn: OUTSIDER.nameEn,
  nameRu: OUTSIDER.nameRu, sourceKey: OUTSIDER.sourceKey,
}])

const result = runDryRun({
  queues, enrichment, identification, exportBytes,
  portal: PORTAL, evaluate: evaluatePortalCandidates, namesLoaded: names, today: TODAY,
})
const byKey = Object.fromEntries(result.rows.map((row) => [row.sourceKey, row]))

t('три названные строки годны к созданию', result.rows.filter((row) => row.outcome === 'writable').length, 3)
t('безымянная — именованный отказ, а не writable', byKey[KEYS[3]].outcome, 'intakeIncomplete')
t('  и отказ назван каноном приёма', byKey[KEYS[3]].intake.refusal, 'canonBlocking')
t('  запроса для неё не собрано', result.requests.some((request) => request.source.externalKey === 'c4'), false)
t('подготовленных запросов ровно столько, сколько годных строк', result.requests.length, 3)
/* Классификация, разрешившая создание, доехала до запроса: 清水寺 → буддийский
   храм, 大原美術館 → художественная площадка, 伏見稲荷大社 → синтоистское
   святилище. Тип берётся из ТОГО ЖЕ вердикта, который дал допуск. */
t('тип каждой строки назван оценкой и доехал до запроса',
  result.requests.map((request) => request.poi.taxonomy?.poiPrimaryType ?? 'таксономии нет').join(','),
  'buddhist_temple,art_venue,shinto_shrine')
t('  и версия реестра — нынешняя',
  [...new Set(result.requests.map((request) => request.poi.taxonomy?.taxonomyVersion ?? 'таксономии нет'))].join(','), taxonomyVersion)

/* ── ВОРОТА: ПРИЁМУ — ТОЛЬКО ПОДГОТОВЛЕННЫЙ ЗАПРОС ────────────────────────
   Постусловие проверяется ТОЙ ЖЕ функцией канона, что и внутри приёма. Ворота
   не декоративны: собранный руками запрос без обязательных данных через них не
   проходит, и приём его не видит. */
const offered = []
for (const request of result.requests) {
  t(`ворота: запрос ${request.source.externalKey} проходит обязательные проверки приёма`,
    assertIntakeAdmissible(request, JG_RECORD_SPEC), 'exactObjectPoint')
  offered.push(request)
}
has('ворота не пропускают запрос без русского имени',
  await boom(() => assertIntakeAdmissible({ poi: { ...offered[0].poi, nameRu: '' } })),
  'не проходит канон приёма')
has('и запрос без направления тоже',
  await boom(() => assertIntakeAdmissible({ poi: { ...offered[0].poi, siteCity: '' } })),
  'не проходит канон приёма')
t('приёму предложено ровно то, что прошло ворота', offered.length, result.requests.length)

/* ── ПРИЁМ ────────────────────────────────────────────────────────────────── */
const created = []
const events = []
const store = createSnapshotStore([OUTSIDER], {
  observe: (event) => { events.push(event.kind); if (event.kind === 'create') created.push(event.fields) },
})
t('хранилище — снимок в памяти ПО ТОЖДЕСТВУ фабрики', isMemoryPoiStore(store), true)
/* Обязательная проверка схемы под таксономию — существующая, и на офлайн-
   хранилище она открывает ветку «схемы нет по построению», а не пропускает
   проверку: право на неё даёт ТОЖДЕСТВО фабрики. */
const schemaGate = await ensureTaxonomySchemaForWrite(store, true)
t('  и проверка схемы таксономии признаёт его хранилищем в памяти', schemaGate.memory, true)
has('  и говорит, почему живой схемы нет', schemaGate.reason, 'в Airtable не пишет')
has('  эффектное хранилище без живой схемы поля таксономии не принимает',
  await boom(() => ensureTaxonomySchemaForWrite({ ...store }, true)), 'не умеет отдать живую схему')
t('  копия того же объекта тождества не наследует', isMemoryPoiStore({ ...store }), false)

const results = await ingestPoiBatch(offered, store, {})

t('приём завёл все три записи', results.filter((r) => r.outcome === 'created').length, 3)
t('  и хранилище вызвано ровно три раза', created.length, 3)
t('  других исходов нет', [...new Set(results.map((r) => r.outcome))].join(','), 'created')
t('  идентификаторы выданы', results.every((r) => /^POI-\d{6}$/.test(r.poiId ?? '')), true)

/* ── ЧЕРНОВИК БЕЗ ОПИСАНИЯ И БЕЗ ОПУБЛИКОВАННОГО ТЕКСТА ───────────────────
   Сайт рендерит `Description Approved (RU)` первым и без оглядки на
   `Copy Status`: запись в опубликованные поля означала бы мгновенную
   публикацию. Поэтому проверяется не «поле пусто», а «поля нет среди
   записываемых вовсе» — пустое значение всё равно было бы записью в поле. */
const PUBLISHED = ['Description (RU)', 'Description (EN)', 'Description Approved (RU)', 'Description Approved (EN)', 'Approved']
for (const fields of created) {
  const name = String(fields['POI Name (RU)'])
  t(`«${name}»: заведена черновиком`, fields['Copy Status'], 'Draft')
  t(`  факт-чек не пройден и это сказано`, fields['Fact Check Status'], 'Todo')
  t(`  черновик русского описания пуст`, fields['Description Draft (RU)'], null)
  t(`  черновик английского — тоже`, fields['Description Draft (EN)'], null)
  t(`  опубликованных полей нет среди записываемых`,
    PUBLISHED.filter((field) => field in fields).join(',') || 'ни одного', 'ни одного')
  t(`  политика координат выведена машинно`, fields['Coordinate Policy'], 'exactObjectPoint')
  t(`  место опознано и идентификатор записан`, typeof fields['Google Place ID'], 'string')
  t(`  направление владельца сохранено`, fields['Site City'], 'kyoto')
  t(`  префектура выведена правилом направления`, fields['Prefecture (EN)'], 'Kyoto')
  t(`  происхождение записи названо`, fields['Intake Contract Version'], POI_INTAKE_CONTRACT_VERSION)
  t(`  ключ источника на месте`, String(fields['Source Key']).startsWith('japan-guide:c'), true)
  /* КАНОНИЧЕСКИЕ ПОЛЯ ТАКСОНОМИИ — в самой записи, а не только в запросе. */
  t(`  тип объекта сохранён`, TAXONOMY_FIELDS.type in fields, true)
  t(`  источник классификации — правило`, fields[TAXONOMY_FIELDS.source], 'rule')
  t(`  версия реестра сохранена`, fields[TAXONOMY_FIELDS.version], taxonomyVersion)
  /* Пустой список фасетов — ПУСТОЕ поле, а не []: Airtable трактует пустой
     массив как «очистить», а у новой записи чистить нечего. */
  t(`  фасетов нет — и поле пусто, а не пустой список`, fields[TAXONOMY_FIELDS.facets], undefined)
  t(`  старое поле категории переведено существующим мостом`,
    JSON.stringify(fields['POI Category (RU)'] ?? null),
    JSON.stringify([legacyAirtableCategory(fields[TAXONOMY_FIELDS.type]).value]))
  t(`  имя пришло из файла владельца`, NAMES_RU.slice(0, 3).includes(name), true)
}

/* Записываемая точка — ТА ЖЕ, что назвал резолвер: политика этого требует, и
   здесь это видно по числам, а не по названию политики. */
const first = created.find((fields) => String(fields['Source Key']) === 'japan-guide:c1')
t('тип 清水寺 сохранён как буддийский храм', first[TAXONOMY_FIELDS.type], 'buddhist_temple')
t('широта — точка опознания', first.Latitude, 34.99)
t('долгота — точка опознания', first.Longitude, 135.78)
t('день снятия координат объявлен', first['Coords Checked At'], TODAY)

/* ── ПОВТОР ТОГО ЖЕ ПАКЕТА НИЧЕГО НЕ ЗАВОДИТ ─────────────────────────────── */
const again = await ingestPoiBatch(offered, store, {})
t('повтор даёт already_ingested', again.filter((r) => r.outcome === 'already_ingested').length, 3)
t('  и записей больше не появилось', created.length, 3)

/* ── ЭФФЕКТОВ НЕТ ────────────────────────────────────────────────────────── */
t('к хранилищу были только чтения и три создания',
  events.filter((kind) => kind === 'create').length, 3)
t('сеть не вызывалась ни разу', networkCalls, 0)

console.log(bad.length
  ? `✗ приёмка Japan Guide → Intake: провалено ${bad.length} из ${ok + bad.length}:\n  ` + bad.join('\n  ')
  : `✓ приёмка Japan Guide → Intake: ${ok} проверок пройдено `
    + `(${created.length} черновика в памяти, живых записей 0)`)
process.exitCode = bad.length ? 1 : 0
