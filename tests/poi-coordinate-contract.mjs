#!/usr/bin/env node
/**
 * P07 — контракт записываемой POI: исполняемая трасса по фактическому
 * production-пути (10f-P, подготовка к независимому аудиту).
 *
 *   node tests/poi-coordinate-contract.mjs
 *
 * Семь свойств, каждое — именованными утверждениями на production-композиции
 * (тот же ingestPoi / intakePoi / writeRun, фикстурный реестр — ФАЙЛОМ по
 * каноническому пути в песочнице-копии дерева, никаких подстановок в коде):
 *
 *   1. решение Coordinate Policy берётся только из канонического
 *      owner-reviewed источника — файла реестра под git;
 *   2. решение привязано к конкретному POI (город + имя), а не к позиции строки;
 *   3. машинный путь не может сам назначить human-решение;
 *   4. координаты и политика записываются согласованно ОДНИМ допустимым эффектом;
 *   5. отсутствие, конфликт или несоответствие решения останавливают запись;
 *   6. Telegram- и портальный пути этот контракт не обходят;
 *   7. все writer'ы и документы ссылаются на один источник правил.
 *
 * Сеть, Airtable, Google и модель не трогаются: хранилище — в памяти,
 * резолвер и исследователь подменены, реестр — фикстура. Ничего не пишется.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  COORDINATE_DECISIONS_LEDGER_PATH, COORDINATE_DECISIONS_LEDGER_VERSION,
  coordinateDecisionIntegrityDigest, loadCoordinateDecisions,
} from '../src/lib/poi-coordinate-decision.ts'
import { classifyCoordinatePolicy, COORDINATE_POLICIES, SUBJECT_DECISION_POLICIES } from '../src/lib/poi-coordinate-policy.ts'
import { buildSourceKey } from '../src/lib/poi-ingest.ts'
import { intakePoi } from '../src/lib/poi-intake.ts'
import { createMemoryPoiStore } from '../src/lib/poi-memory-store.ts'
import { createProductionSandbox } from './support/production-sandbox.mjs'

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
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8')

/* Фикстуры реестра: решения владельца о двух объектах Осаки под ключами портала. */
const AT = '2026-09-03T00:00:00.000Z'
const PARK = { lat: 34.6937378, lon: 135.5021651 }
const stamped = (over = {}) => {
  const base = {
    sourceKey: 'bodik-osaka-tourism:park-7',
    subject: { siteCity: 'osaka', nameEn: 'Osakajo Park', nameRu: 'Парк Осакадзё' },
    decision: 'representativePoint', point: PARK,
    decisionRef: 'owner/2026-09-03#park', approver: 'Эдуард', decidedAt: AT,
    note: 'Парк без единого входа: точка — у главных ворот.',
    ...over,
  }
  return { ...base, integrityDigest: coordinateDecisionIntegrityDigest(base) }
}
const ledger = (...decisions) => ({ version: COORDINATE_DECISIONS_LEDGER_VERSION, decisions })

/* Один production-вызов ingestPoi в песочнице; результат — JSON из процесса. */
const INGEST = (poiOver, sourceOver = {}) => `
import { ingestPoi } from './src/lib/poi-ingest.ts'
import { createMemoryPoiStore } from './src/lib/poi-memory-store.ts'
const events = []
const store = createMemoryPoiStore([], { observe: (e) => events.push(e.kind + ':' + (e.method ?? '')) })
const r = await ingestPoi({ source: { kind: 'portal-collector', id: 'bodik-osaka-tourism', externalKey: 'park-7', ...${JSON.stringify(sourceOver)} },
  poi: { nameRu: 'Парк Осакадзё', nameEn: 'Osakajo Park', siteCity: 'osaka', ...${JSON.stringify(poiOver)} } }, store)
const rows = await store.listExisting()
console.log(JSON.stringify({ outcome: r.outcome, refusal: r.coordinatePolicy?.refusal ?? null, policy: r.coordinatePolicy?.policy ?? null,
  derivedFrom: r.coordinatePolicy?.derivedFrom ?? null, decisionRef: r.coordinateDecision?.decisionRef ?? null, explanation: r.explanation ?? null,
  effects: events.filter((e) => e.startsWith('create')).length, created: rows.length,
  canonWarn: (r.canonIssues ?? []).filter((i) => i.level === 'warn').map((i) => i.message),
  fields: r.fields ? { policy: r.fields['Coordinate Policy'], lat: r.fields.Latitude, lon: r.fields.Longitude, placeId: r.fields['Google Place ID'] ?? null } : null }))
`

/** Прогон в песочнице: падение production-кода — именованный провал, а не крах набора. */
const probe = (sb, label, script) => {
  const r = sb.tryRun(script)
  if (r.ok) return r.value ?? {}
  t(`${label}: production-код завершился без исключения`, r.error.slice(0, 160), 'ok')
  return {}
}

/* ── 1. Один источник правил — структурно, по фактическому production-коду ── */
{
  // Обход ВСЕГО production-кода (`src/` и `scripts/` целиком, без тестов), а не
  // избранных каталогов: писатель координат может оказаться в любом из них —
  // ежедневный крон живёт в `src/app/api`, ручной refresh — прямо в `scripts/`.
  const walk = (dir, out = []) => {
    for (const name of readdirSync(path.join(REPO, dir))) {
      const rel = path.join(dir, name)
      const abs = path.join(REPO, rel)
      if (statSync(abs).isDirectory()) { if (!/^(node_modules|\.next|tests?|__tests__)$/.test(name)) walk(rel, out) } else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.(test|spec)\./.test(name)) out.push(rel)
    }
    return out
  }
  const production = [...walk('src'), ...walk('scripts')]
  const sources = Object.fromEntries(production.map((rel) => [rel, read(rel)]))
  t('обход покрывает src/app, src/lib, src/components и scripts/', ['src/app', 'src/lib', 'src/components', 'scripts'].every((d) => production.some((f) => f.startsWith(`${d}/`))), true)
  // (а) единственная точка эффекта записи POI — store.create в ingestPoi.
  const createSites = production.filter((rel) => /\bstore\.create\(/.test(sources[rel]))
  /* ДВА МЕСТА, И ВТОРОЕ — НЕ ВТОРОЙ ПУТЬ ЗАПИСИ (10f-R). Точка эффекта
     по-прежнему одна: `ingestPoi`. Второе вхождение — проверяющая обёртка
     `withVerifiedWrites`, которая ПЕРЕДАЁТ вызов дальше и добавляет к нему
     только доказательство: журнал намерения, независимое перечитывание и
     исход. Полей она не строит и содержимого записи не касается — это
     проверяется ниже отдельно, иначе «обёртка» стала бы удобным именем для
     третьего писателя. */
  t('store.create в production ровно в двух модулях: приём и его граница',
    createSites.join(','), 'src/lib/poi-ingest.ts,scripts/poi-portals/lib/verified-write.mjs')
  const boundary = sources['scripts/poi-portals/lib/verified-write.mjs']
  /* Второй аргумент — наблюдатель эффектов (10f-R R2), а не поля: он лишь
     получает от хранилища нагрузку, которая уйдёт в базу. */
  t('граница передаёт поля дальше без изменений', /await store\.create\(fields, \{ onEffect \}\)/.test(boundary), true)
  /* Ключ поля в объектном литерале (`'POI ID': …`) — построение записи;
     чтение поля из прочитанной строки (`fields['POI ID']`) — сверка, и оно
     границе как раз положено. */
  t('граница не строит полей записи', /'(POI Name[^']*|POI ID|Last Seeded At|POI Category[^']*)':/.test(boundary), false)
  t('  но читает POI ID из базы для сверки номера', /fields\?\.\['POI ID'\]/.test(boundary), true)
  t('в ingestPoi — ровно один вызов store.create', (sources['src/lib/poi-ingest.ts'].match(/\bstore\.create\(/g) ?? []).length, 1)
  // (б) единственное вычисление политики и единственный production-вызов.
  const definers = production.filter((rel) => /export function classifyCoordinatePolicy/.test(sources[rel]))
  t('classifyCoordinatePolicy определена ровно в одном модуле', definers.join(','), 'src/lib/poi-coordinate-policy.ts')
  const callers = production.filter((rel) => rel !== 'src/lib/poi-coordinate-policy.ts' && /\bclassifyCoordinatePolicy\(/.test(sources[rel]))
  t('classifyCoordinatePolicy зовётся в production ровно из ingestPoi', callers.join(','), 'src/lib/poi-ingest.ts')
  // (в) поле Coordinate Policy пишется только через константу и только в ingestPoi.
  const fieldWriters = production.filter((rel) => /\[COORDINATE_POLICY_FIELD\]:/.test(sources[rel]))
  t('поле Coordinate Policy пишет только ingestPoi', fieldWriters.join(','), 'src/lib/poi-ingest.ts')
  const literalWriters = production.filter((rel) => /['"]Coordinate Policy['"]\s*:/.test(sources[rel]))
  t('литерал «Coordinate Policy: …» в production не пишет никто', literalWriters.join(','), '')
  // (г) аргумент decision у classifyCoordinatePolicy — только из решения реестра.
  const decisionArgs = sources['src/lib/poi-ingest.ts'].match(/decision:\s*([^,\n]+)/g) ?? []
  t('decision в classifyCoordinatePolicy — только coordinateDecision?.decision', decisionArgs.join(' | '), 'decision: coordinateDecision?.decision ?? null')
  // (д) реестр — один канонический источник: константа пути = статический импорт.
  const decisionSrc = sources['src/lib/poi-coordinate-decision.ts']
  t('канонический путь реестра', COORDINATE_DECISIONS_LEDGER_PATH, 'config/poi-coordinate-decisions.v1.json')
  has('реестр читается статическим импортом по тому же пути', decisionSrc, "from '../../config/poi-coordinate-decisions.v1.json'")
  // Читатель файла — тот, кто его импортирует или открывает, а не тот, кто называет путь в комментарии.
  const loaders = production.filter((rel) => /(?:from\s*['"][^'"]*|readFileSync\([^)]*|readFile\([^)]*|import\([^)]*)poi-coordinate-decisions\.v1\.json/.test(sources[rel]))
  t('файл реестра импортирует (открывает) только модуль решений', loaders.join(','), 'src/lib/poi-coordinate-decision.ts')
  t('loader не принимает аргументов', loadCoordinateDecisions.length, 0)
  // (е) Каждое production-решение названо владельцем и закреплено предметом,
  // политикой и точкой. Первый такой долг закрыт для «Музея Фудзита».
  const productionDecisions = loadCoordinateDecisions()
  const fujita = productionDecisions.get('bodik-osaka-tourism:OSAKA0000061')
  t('production-реестр содержит ровно одно принятое решение', productionDecisions.size, 1)
  t('решение Фудзита принадлежит нужному предмету',
    [fujita?.subject.siteCity, fujita?.subject.nameJa, fujita?.subject.nameRu].join(' | '),
    'osaka | 藤田美術館 | Музей Фудзита')
  t('для Фудзита принята точка Google как representativePoint',
    [fujita?.decision, fujita?.point?.lat, fujita?.point?.lon].join(' | '),
    'representativePoint | 34.695007 | 135.525015')
  t('решение Фудзита связано с решением владельца',
    [fujita?.approver, fujita?.decisionRef].join(' | '),
    'Jumbo | owner/2026-09-05#fujita-google-point')
  // (ж) остальные writer'ы к политике не прикасаются: только читают реестр и сверяют предмет.
  const intake = sources['src/lib/poi-intake.ts']
  t('Telegram-путь (poi-intake) не вычисляет политику', /classifyCoordinatePolicy|COORDINATE_POLICY_FIELD|loadCoordinateDecisions/.test(intake), false)
  const collector = sources['scripts/poi-portals/collect-pois.mjs']
  t('коллектор не вычисляет политику и не пишет поле', /classifyCoordinatePolicy\(|COORDINATE_POLICY_FIELD/.test(collector), false)
  t('коллектор пишет только через ingestPoiBatch', /\bingestPoiBatch\(/.test(collector) && !/\bstore\.create\(/.test(collector), true)
  // (з) production-хранилище Airtable: единственный POST — создание; единственный PATCH — переименование POI ID при коллизии, не координаты и не политика.
  const store = read('scripts/poi-portals/lib/airtable-store.mjs')
  t('Airtable-store: методов удаления нет', /DELETE/.test(store), false)
  const patches = store.match(/method: 'PATCH'[\s\S]{0,200}?body: JSON\.stringify\(([^)]*)\)/g) ?? []
  t('Airtable-store: ровно один PATCH', patches.length, 1)
  /* Тело PATCH — та же нагрузка, что объявлена наблюдателю эффектов
     (10f-R R2): одна константа, один ключ, и она нигде не переопределяется. */
  has('Airtable-store: PATCH шлёт объявленную нагрузку', patches[0] ?? '', 'fields: renamePayload')
  t('Airtable-store: нагрузка переименования — только POI ID, определена один раз', (store.match(/const renamePayload = \{ 'POI ID': fresh \}/g) ?? []).length, 1)
  t('Airtable-store: нагрузка переименования не переопределяется', /renamePayload\s*=(?!=)/.test(store.replace(/const renamePayload = \{ 'POI ID': fresh \}/, '')), false)
  has('Airtable-store: наблюдатель получает ту же нагрузку до PATCH', store, "onEffect({ step: 'rename', recordId, from: poiId, payload: { ...renamePayload } })")
  t('Airtable-store: PATCH не несёт координат и политики', /PATCH[\s\S]{0,400}(Latitude|Longitude|Coordinate Policy)/.test(store), false)
}

/* ── 2. Машина не назначает human-решение ──────────────────────────────── */
{
  const machineOnly = []
  const lats = [undefined, null, 34.7]
  const lons = [undefined, null, 135.5]
  const resolveds = [undefined, null, {}, { placeId: 'PID' }, { placeId: 'PID', lat: 34.7, lon: 135.5 }, { placeId: 'PID', lat: 34.71, lon: 135.5 }]
  for (const lat of lats) for (const lon of lons) for (const resolved of resolveds) {
    const v = classifyCoordinatePolicy({ lat, lon, resolved })
    if (v.ok) machineOnly.push(v.policy)
  }
  t('машинный вывод без решения даёт ТОЛЬКО exactObjectPoint', [...new Set(machineOnly)].join(','), 'exactObjectPoint')
  t('машинный вывод без решения никогда не даёт representativePoint/notApplicable', machineOnly.some((p) => SUBJECT_DECISION_POLICIES.includes(p)), false)
  t('exactObjectPoint — только при подтверждённой точке резолвера', machineOnly.length, 1)
  t('политики закрыты: три значения', COORDINATE_POLICIES.join(','), 'exactObjectPoint,representativePoint,notApplicable')
  const policySrc = read('src/lib/poi-coordinate-policy.ts')
  t('у resolved нет канала решения — только placeId/lat/lon', /resolved\?:\s*\{\s*placeId\?: string; lat\?: number; lon\?: number\s*\}/.test(policySrc), true)
  // Запрос вызывающего и объявленный «человеческий» источник — не решение.
  const sb = createProductionSandbox({ ledger: ledger() })
  try {
    // Вызывающий не может объявить себя новым видом источника: множество закрыто.
    const unknownKind = sb.tryRun(INGEST({}, { kind: 'human', id: 'owner-bot' }))
    t('source.kind — закрытое множество: «human» отвергается', unknownKind.ok, false)
    has('неизвестный source.kind назван', unknownKind.error, 'неизвестный source.kind «human»')
    // Даже «admin» и «manual-import» не несут решения: поле решения в запросе не читается.
    const smuggled = probe(sb, 'smuggled', INGEST({ coordinatePolicy: 'notApplicable', decision: 'notApplicable' }, { kind: 'admin', id: 'owner-bot' }))
    t('поле решения в запросе + source.kind=admin: остановка', smuggled.outcome, 'needs_review')
    t('причина — noCoordinates, а не notApplicable', smuggled.refusal, 'noCoordinates')
    t('эффектов нет', smuggled.effects, 0)
    const asOwner = probe(sb, 'asOwner', INGEST({ lat: 34.7, lon: 135.5, coordinatePolicy: 'representativePoint' }, { kind: 'manual-import' }))
    t('representativePoint из запроса при пустом реестре — остановка', asOwner.outcome, 'needs_review')
    t('причина — unknownProvenance (точка без резолвера и без решения)', asOwner.refusal, 'unknownProvenance')
  } finally { sb.dispose() }
}

/* ── 3. Привязка к POI, не к позиции строки ─────────────────────────────── */
{
  // Два решения под нестабильными ключами row-1/row-2. Меняем объекты местами — оба отвергаются по предмету.
  const rowLedger = ledger(
    stamped({ sourceKey: 'bodik-osaka-tourism:row-1', subject: { siteCity: 'osaka', nameEn: 'Osakajo Park', nameRu: 'Парк Осакадзё' }, decisionRef: 'owner/2026-09-03#row1' }),
    stamped({ sourceKey: 'bodik-osaka-tourism:row-2', subject: { siteCity: 'osaka', nameEn: 'Osaka Castle', nameRu: 'Замок Осака' }, decision: 'notApplicable', point: null, decisionRef: 'owner/2026-09-03#row2', note: 'Замок — комплекс без одной точки в этом источнике.' }),
  )
  const sb = createProductionSandbox({ ledger: rowLedger })
  try {
    const inPlace = probe(sb, 'inPlace', INGEST({ lat: PARK.lat, lon: PARK.lon }, { externalKey: 'row-1' }))
    t('row-1 = парк: решение применено', inPlace.outcome, 'created')
    t('row-1: решение о парке', inPlace.decisionRef, 'owner/2026-09-03#row1')
    const swapped = probe(sb, 'swapped', INGEST({ nameRu: 'Замок Осака', nameEn: 'Osaka Castle', lat: PARK.lat, lon: PARK.lon }, { externalKey: 'row-1' }))
    t('row-1 стал замком: решение НЕ перенесено', swapped.outcome, 'needs_review')
    t('row-1 стал замком: отказ по предмету', swapped.refusal, 'decisionSubjectMismatch')
    has('row-1 стал замком: поля предмета названы', swapped.explanation, 'не совпало: nameEn, nameRu')
    t('row-1 стал замком: эффектов нет', swapped.effects, 0)
    const swapped2 = probe(sb, 'swapped2', INGEST({}, { externalKey: 'row-2' }))
    t('row-2 стал парком: решение notApplicable НЕ перенесено', swapped2.refusal, 'decisionSubjectMismatch')
    const otherCity = probe(sb, 'otherCity', INGEST({ siteCity: 'kyoto', lat: PARK.lat, lon: PARK.lon }, { externalKey: 'row-1' }))
    t('тот же ключ, другой город — отказ по предмету', otherCity.refusal, 'decisionSubjectMismatch')
    has('другой город назван', otherCity.explanation, 'siteCity')
  } finally { sb.dispose() }
}

/* ── 4. Согласованная запись ОДНИМ допустимым эффектом ──────────────────── */
{
  const sb = createProductionSandbox({ ledger: ledger(
    stamped(),
    stamped({ sourceKey: 'bodik-osaka-tourism:castle-1', subject: { siteCity: 'osaka', nameEn: 'Osaka Castle', nameRu: 'Замок Осака' }, decision: 'notApplicable', point: null, decisionRef: 'owner/2026-09-03#castle', note: 'Комплекс без одной точки.' }),
  ) })
  try {
    const rp = probe(sb, 'rp', INGEST({ lat: PARK.lat, lon: PARK.lon }))
    t('representativePoint: ровно один эффект create', rp.effects, 1)
    t('representativePoint: создана одна запись', rp.created, 1)
    t('representativePoint: политика в том же объекте полей', rp.fields?.policy, 'representativePoint')
    t('representativePoint: широта решения в том же объекте', rp.fields?.lat, PARK.lat)
    t('representativePoint: долгота решения в том же объекте', rp.fields?.lon, PARK.lon)
    t('representativePoint: Place ID не выдуман', rp.fields?.placeId, null)
    const na = probe(sb, 'na', INGEST({ nameRu: 'Замок Осака', nameEn: 'Osaka Castle' }, { externalKey: 'castle-1' }))
    t('notApplicable: ровно один эффект create', na.effects, 1)
    t('notApplicable: политика notApplicable', na.fields?.policy, 'notApplicable')
    t('notApplicable: широта пуста в том же объекте', na.fields?.lat, null)
    t('notApplicable: долгота пуста в том же объекте', na.fields?.lon, null)
    const ex = probe(sb, 'ex', INGEST({ lat: 34.7, lon: 135.5, resolved: { placeId: 'PID-1', lat: 34.7, lon: 135.5 } }, { externalKey: 'no-decision-9' }))
    t('exactObjectPoint: ровно один эффект create', ex.effects, 1)
    t('exactObjectPoint: политика машинная', ex.fields?.policy, 'exactObjectPoint')
    t('exactObjectPoint: точка резолвера в том же объекте', ex.fields?.lat, 34.7)
    t('exactObjectPoint: derivedFrom — резолвер', ex.derivedFrom, 'resolvedGooglePlace')
  } finally { sb.dispose() }
}

/* ── 5. Отсутствие, конфликт, несоответствие — остановка без эффекта ────── */
{
  const sb = createProductionSandbox({ ledger: ledger(stamped()) })
  try {
    const none = probe(sb, 'none', INGEST({}, { externalKey: 'unknown-1' }))
    t('нет решения и нет координат — needs_review', none.outcome, 'needs_review')
    t('причина — noCoordinates', none.refusal, 'noCoordinates')
    t('решения к записи нет', none.decisionRef, null)
    t('эффектов нет', none.effects, 0)
    // Половина пары на production-пути не доходит до политики: канон отбрасывает обе координаты
    // с предупреждением, и политика видит «нет координат». Отказ `halfPair` в classifyCoordinatePolicy —
    // защитная ветка для прямого вызова; запись в обоих случаях остановлена.
    const half = probe(sb, 'half', INGEST({ lat: 34.7 }, { externalKey: 'unknown-2' }))
    t('половина пары — needs_review', half.outcome, 'needs_review')
    t('половина пары — канон отбросил обе координаты', (half.canonWarn ?? []).some((m) => /одна координата из двух/.test(m)), true)
    t('половина пары — политика видит noCoordinates', half.refusal, 'noCoordinates')
    t('половина пары — эффектов нет', half.effects, 0)
    const unprov = probe(sb, 'unprov', INGEST({ lat: 34.7, lon: 135.5 }, { externalKey: 'unknown-3' }))
    t('пара без резолвера — unknownProvenance', unprov.refusal, 'unknownProvenance')
    const wrongPoint = probe(sb, 'wrongPoint', INGEST({ lat: 34.8, lon: 135.6 }))
    t('решение representativePoint, но другая пара — decisionContradictsCoordinates', wrongPoint.refusal, 'decisionContradictsCoordinates')
    t('конфликт: эффектов нет', wrongPoint.effects, 0)
    const noPair = probe(sb, 'noPair', INGEST({}))
    t('решение representativePoint без пары — decisionContradictsCoordinates', noPair.refusal, 'decisionContradictsCoordinates')
  } finally { sb.dispose() }
  const sbNa = createProductionSandbox({ ledger: ledger(stamped({ decision: 'notApplicable', point: null, note: 'Точка неприменима.' })) })
  try {
    const naWithCoords = sbNa.run(INGEST({ lat: PARK.lat, lon: PARK.lon }))
    t('решение notApplicable, но координаты записаны — decisionContradictsCoordinates', naWithCoords.refusal, 'decisionContradictsCoordinates')
    t('конфликт notApplicable: эффектов нет', naWithCoords.effects, 0)
  } finally { sbNa.dispose() }
  // Негодный реестр — writer не пишет вовсе: отказ до хранилища, а не «решения нет».
  const bad1 = createProductionSandbox({ ledger: ledger({ ...stamped(), decision: 'humanSaidSo' }) })
  try {
    const r = bad1.tryRun(INGEST({ lat: PARK.lat, lon: PARK.lon }))
    t('реестр с неизвестным решением: writer отказал до хранилища', r.ok, false)
    has('реестр с неизвестным решением: причина названа', r.error, 'decision может быть только')
  } finally { bad1.dispose() }
  const bad2 = createProductionSandbox({ ledger: ledger({ ...stamped(), note: 'подправлено без пересчёта' }) })
  try {
    const r = bad2.tryRun(INGEST({ lat: PARK.lat, lon: PARK.lon }))
    t('реестр с несовпадающей контрольной суммой: writer отказал', r.ok, false)
    has('контрольная сумма названа', r.error, 'integrityDigest не совпадает')
  } finally { bad2.dispose() }
}

/* ── 6а. Telegram-путь не обходит контракт ─────────────────────────────── */
{
  const research = {
    nameRu: 'Парк Осакадзё', nameEn: 'Osakajo Park', siteCity: 'osaka',
    prefectureRu: 'Осака', prefectureEn: 'Osaka', categoriesRu: ['Парк'],
    workingHours: '', ticketsNote: '', website: '', descriptionRu: 'Описание.', descriptionEn: 'Description.',
    parentNameRu: '', parentNameEn: '', otherLocations: [], sources: [], openQuestions: [], operatingStatus: '',
  }
  const observed = []
  const created = []
  const store = createMemoryPoiStore([], { observe: (e) => { observed.push(e.kind); if (e.kind === 'create') created.push(e.fields) } })
  // Ключ источника у Telegram-запроса отсутствует по построению: реестр решений там недостижим.
  t('Telegram: source без externalKey → sourceKey null', buildSourceKey({ kind: 'telegram-agent', id: 'poi-intake-bot' }), null)
  // (а) резолвер молчит → needs_review, без эффекта, без решения.
  const silent = await intakePoi({ note: 'тест' }, { store, research, runId: 'run-tg-0', placeResolver: async () => ({ place: null, reason: 'выключен' }), japaneseNameResolver: async () => null })
  t('Telegram без точки: главный POI не создан', silent.created, false)
  t('Telegram без точки: эффектов нет', observed.filter((k) => k === 'create').length, 0)
  has('Telegram без точки: остановлен политикой координат', silent.explanation ?? '', 'Политика координат не выводится')
  // (б) резолвер подтвердил точку → exactObjectPoint, координаты и политика ОДНИМ create.
  observed.length = 0
  const place = { placeId: 'PID-PARK', lat: PARK.lat, lon: PARK.lon, businessStatus: 'OPERATIONAL', prefecture: { ru: 'Осака', en: 'Osaka' } }
  const report = await intakePoi({ note: 'тест' }, { store, research, runId: 'run-tg-1', placeResolver: async () => ({ place, reason: 'опознано' }), japaneseNameResolver: async () => null })
  t('Telegram с точкой: создан', report.created, true)
  t('Telegram с точкой: ровно один эффект create', observed.filter((k) => k === 'create').length, 1)
  const rows = await store.listExisting()
  t('Telegram с точкой: одна запись в хранилище', rows.length, 1)
  t('Telegram с точкой: политика exactObjectPoint в том же create', created[0]?.['Coordinate Policy'], 'exactObjectPoint')
  t('Telegram с точкой: широта резолвера в том же create', created[0]?.Latitude, PARK.lat)
  t('Telegram с точкой: долгота резолвера в том же create', created[0]?.Longitude, PARK.lon)
  t('Telegram с точкой: place_id резолвера', created[0]?.['Google Place ID'], 'PID-PARK')
  // (в) исследователь/резолвер не могут подсунуть human-решение: лишние поля не читаются.
  const store2 = createMemoryPoiStore([], {})
  const smuggled = await intakePoi({ note: 'тест' }, {
    store: store2, research: { ...research, decision: 'notApplicable', coordinatePolicy: 'notApplicable' }, runId: 'run-tg-2',
    placeResolver: async () => ({ place: null, reason: 'выключен', decision: 'notApplicable' }), japaneseNameResolver: async () => null,
  })
  t('Telegram: «решение» из исследователя/резолвера игнорируется — не создан', smuggled.created, false)
  t('Telegram: записей нет', (await store2.listExisting()).length, 0)
  // (г) даже решение в реестре, подписанное под именем бота и совпадающее по предмету, на Telegram-пути недостижимо: ключа нет.
  const sb = createProductionSandbox({ ledger: ledger(stamped({ sourceKey: 'poi-intake-bot:park', decision: 'notApplicable', point: null, note: 'Гипотетически.' })) })
  try {
    const r = probe(sb, 'telegram+реестр', `
import { intakePoi } from './src/lib/poi-intake.ts'
import { createMemoryPoiStore } from './src/lib/poi-memory-store.ts'
let creates = 0
const store = createMemoryPoiStore([], { observe: (e) => { if (e.kind === 'create') creates += 1 } })
const research = ${JSON.stringify(research)}
const report = await intakePoi({ note: 'тест' }, { store, research, runId: 'run-tg-3', placeResolver: async () => ({ place: null, reason: 'выключен' }), japaneseNameResolver: async () => null })
console.log(JSON.stringify({ created: report.created, creates, explanation: report.explanation ?? null }))
`)
    t('Telegram + решение в реестре по предмету: НЕ применено (ключа нет)', r.created, false)
    t('Telegram + решение в реестре: эффектов нет', r.creates, 0)
    has('Telegram + решение в реестре: остановлен политикой', r.explanation ?? '', 'Политика координат не выводится')
  } finally { sb.dispose() }
}

/* ── 6б. Портальный путь: структурно — только через ingestPoiBatch; поведение — tests/poi-portal-place.mjs §12 ── */
{
  const collector = read('scripts/poi-portals/collect-pois.mjs')
  t('коллектор консультирует реестр только loader\'ом без аргументов', /loadCoordinateDecisions\(\)/.test(collector), true)
  t('коллектор не строит lookup из объекта', /createCoordinateDecisionLookup|buildLookup/.test(collector), false)
  t('коллектор сверяет предмет тем же coordinateDecisionSubjectVerdict', /coordinateDecisionSubjectVerdict\(/.test(collector), true)
  has('коллектор: отказ по предмету назван так же, как в ingestPoi', collector, "refusal: 'decisionSubjectMismatch'")
  const portalPlace = read('tests/poi-portal-place.mjs')
  has('поведение портального пути закреплено в poi-portal-place §12', portalPlace, 'РЕШЕНИЕ ВЛАДЕЛЬЦА О КООРДИНАТАХ — ДО РЕЗОЛВЕРА')
  has('§12: перестановка строк отвергается по предмету', portalPlace, "'перестановка: решение отвергнуто по предмету'")
  has('§12: deps.coordinateDecisions не читается', portalPlace, 'deps.coordinateDecisions не читается')
}

/* ── 7. Документы ссылаются на один источник правил ─────────────────────── */
{
  // Каждый документ называет один и тот же источник решений — реестр под git по каноническому пути —
  // своими словами; проверяется именно та формулировка, которой документ на него ссылается.
  const docs = {
    'docs/poi-intake/README.md': COORDINATE_DECISIONS_LEDGER_PATH,
    'docs/poi-intake/runbook.md': COORDINATE_DECISIONS_LEDGER_PATH,
    'docs/poi-intake/change-policy.md': 'файлом реестра по каноническому пути',
    'docs/poi-writers-registry.md': 'по реестру решений владельца',
  }
  for (const [rel, needle] of Object.entries(docs)) {
    has(`${rel}: называет реестр решений как единственный источник`, read(rel), needle)
  }
  has('runbook: реестр по каноническому пути', read('docs/poi-intake/runbook.md'), COORDINATE_DECISIONS_LEDGER_PATH)
  has('README: единственный канал — реестр под git', read('docs/poi-intake/README.md'), COORDINATE_DECISIONS_LEDGER_PATH)
  has('change-policy §24: полномочие — файл под git, не вызов', read('docs/poi-intake/change-policy.md'), 'Полномочие владельца — файл под git, а не вызов')
  has('writers-registry: ingestPoi — политика машинно либо по реестру', read('docs/poi-writers-registry.md'), 'по реестру решений владельца')
  const sources = ['src/lib/poi-coordinate-decision.ts', 'scripts/poi-coordinate-decision.mjs', 'docs/poi-intake/change-policy.md', 'docs/poi-intake/runbook.md', 'docs/poi-intake/README.md']
  for (const rel of sources) {
    const text = read(rel)
    t(`${rel}: честно — импорт и checksum не доказывают авторство`, /не доказыва(ют|ет) авторств/i.test(text), true)
    t(`${rel}: полномочие — процесс owner review`, /owner review/.test(text), true)
  }
}

if (bad.length) {
  console.error(`✗ контракт записываемой POI (P07): провалено ${bad.length} из ${ok + bad.length}`)
  for (const line of bad) console.error(`  ${line}`)
  process.exit(1)
}
console.log(`✓ контракт записываемой POI (P07): ${ok} проверок пройдено`)
