#!/usr/bin/env node
/**
 * Решения владельца о политике координат (10f-P R1, P07.3): контракт записи,
 * реестр под git как ЕДИНСТВЕННЫЙ источник полномочия, привязка к предмету
 * и production-композиция через песочницу-копию дерева.
 *
 *   node tests/poi-coordinate-decision.mjs
 *
 * Что доказывается.
 *   • Полномочие representativePoint/notApplicable нельзя собрать вызовом:
 *     фабрики с аргументом-реестром нет, `options`/`deps`/поля запроса не
 *     читаются, объект той же формы брендом не обладает. Единственный вход —
 *     файл по каноническому пути; тест композиции меняет ФАЙЛ в копии дерева.
 *   • `integrityDigest` — контрольная сумма целостности; правка без пересчёта
 *     отвергается; авторства она не удостоверяет и подписью не называется.
 *   • Решение привязано к предмету (город + имена): решение, найденное по
 *     нестабильному ключу row-N о другом объекте, не применяется и
 *     останавливает строку именованным отказом.
 *   • Политика и координаты не расходятся: точка решения подтверждает только
 *     названную точку, notApplicable — только пустую пару; отсутствие
 *     координат без решения — остановка, не notApplicable.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import * as DECISION_MODULE from '../src/lib/poi-coordinate-decision.ts'
import {
  COORDINATE_DECISION_SPEC,
  COORDINATE_DECISIONS_LEDGER_VERSION,
  COORDINATE_DECISIONS_LEDGER_PATH,
  coordinateDecisionIntegrityDigest,
  coordinateDecisionIssues,
  coordinateDecisionSubjectVerdict,
  isCoordinateDecisionLookup,
  loadCoordinateDecisions,
  validateCoordinateDecisionLedger,
} from '../src/lib/poi-coordinate-decision.ts'
import { SUBJECT_DECISION_POLICIES } from '../src/lib/poi-coordinate-policy.ts'
import { ingestPoi, ingestPoiBatch, buildSourceKey } from '../src/lib/poi-ingest.ts'
import { assertCanonicalInstant } from '../scripts/lib/canonical-contract.mjs'
import { stampDraft } from '../scripts/poi-coordinate-decision.mjs'
import { createProductionSandbox } from './support/production-sandbox.mjs'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const has = (label, text, needle) => {
  if (typeof text === 'string' && text.includes(needle)) ok++
  else bad.push(`${label}: в «${String(text).slice(0, 300)}» нет «${needle}»`)
}
const boom = async (fn) => { try { await fn(); return '(без ошибки)' } catch (e) { return e.message } }

const AT = '2026-09-03T00:00:00.000Z'
const KEY = 'bodik-osaka-tourism:park-7'
const POINT = { lat: 34.6937378, lon: 135.5021651 }
const SUBJECT = { siteCity: 'osaka', nameRu: 'Парк Осакадзё', nameEn: 'Osakajo Park' }
const draft = (over = {}) => ({
  sourceKey: KEY,
  subject: { ...SUBJECT },
  decision: 'representativePoint',
  point: { ...POINT },
  decisionRef: 'owner/2026-09-03#1',
  approver: 'Эдуард',
  decidedAt: AT,
  note: 'Парк без единого входа: точка — центр главной аллеи.',
  ...over,
})
const stamped = (over = {}) => {
  const entry = draft(over)
  return { ...entry, integrityDigest: coordinateDecisionIntegrityDigest(entry) }
}
const ledger = (...decisions) => ({ version: COORDINATE_DECISIONS_LEDGER_VERSION, decisions })

/* ── 1. Контракт и контрольная сумма ─────────────────────────────────── */
t('спецификация записи именована', COORDINATE_DECISION_SPEC, 'poi-coordinate-decision/v1')
t('версия реестра именована', COORDINATE_DECISIONS_LEDGER_VERSION, 'poi-coordinate-decisions/v1')
{
  const a = coordinateDecisionIntegrityDigest(draft())
  t('контрольная сумма — sha256', /^sha256:[0-9a-f]{64}$/.test(a), true)
  t('контрольная сумма детерминирована', coordinateDecisionIntegrityDigest(draft()), a)
  for (const [label, over] of [
    ['заметки', { note: 'другая' }],
    ['решения', { decision: 'notApplicable', point: null }],
    ['ключа', { sourceKey: 'x:y' }],
    ['утверждающего', { approver: 'кто-то' }],
    ['момента', { decidedAt: '2026-09-04T00:00:00.000Z' }],
    ['точки', { point: { lat: 34.7, lon: 135.5 } }],
    ['города предмета', { subject: { ...SUBJECT, siteCity: 'kyoto' } }],
    ['имени предмета', { subject: { ...SUBJECT, nameEn: 'Other Park' } }],
    ['состава имён предмета', { subject: { siteCity: 'osaka', nameJa: '大阪城公園' } }],
  ]) t(`контрольная сумма меняется от ${label}`, coordinateDecisionIntegrityDigest(draft(over)) !== a, true)
  t('точка сравнивается после канонического округления',
    coordinateDecisionIntegrityDigest(draft({ point: { lat: 34.69373781234, lon: 135.50216512345 } })), a)
}

/* ── 2. Нарушения формы — каждое названо ─────────────────────────────── */
{
  const say = (over, needle, label, drop = null) => {
    const entry = stamped(over)
    if (drop) delete entry[drop]
    has(label, coordinateDecisionIssues(entry, 'x').join(' | '), needle)
  }
  t('годная запись без нарушений', coordinateDecisionIssues(stamped()).length, 0)
  t('не объект — нарушение', coordinateDecisionIssues('строка').length, 1)
  say({ extra: 1 }, 'набор полей должен быть ровно', 'лишнее поле')
  say({}, 'набор полей должен быть ровно', 'нет заметки', 'note')
  say({}, 'набор полей должен быть ровно', 'нет предмета', 'subject')
  say({ sourceKey: 'без-двоеточия' }, 'sourceKey должен иметь вид', 'ключ без источника')
  say({ subject: 'osaka' }, 'subject должен быть объектом', 'предмет строкой')
  say({ subject: { siteCity: 'osaka', nameEn: 'X', extra: 1 } }, 'subject должен быть объектом с полями', 'лишнее поле предмета')
  say({ subject: { siteCity: 'Осака', nameEn: 'Osakajo Park' } }, 'каноническим слагом города', 'город не слагом')
  say({ subject: { siteCity: '', nameEn: 'Osakajo Park' } }, 'каноническим слагом города', 'пустой город')
  say({ subject: { siteCity: 'osaka' } }, 'хотя бы одно имя объекта', 'предмет без имён')
  say({ subject: { siteCity: 'osaka', nameEn: ' Osakajo Park' } }, 'subject.nameEn должен быть непустой строкой', 'имя с пробелом по краю')
  say({ decision: 'exactObjectPoint' }, 'decision может быть только representativePoint или notApplicable', 'машинную политику решением назвать нельзя')
  say({ decision: 'notApplicable' }, 'notApplicable требует point: null', 'notApplicable с точкой')
  say({ point: null }, 'representativePoint требует point', 'representativePoint без точки')
  say({ point: { lat: 34.7 } }, 'representativePoint требует point', 'половина пары')
  say({ point: { lat: 34.7, lon: Number.NaN } }, 'representativePoint требует point', 'NaN в точке')
  say({ decisionRef: '' }, 'decisionRef обязателен', 'пустая ссылка')
  say({ approver: '  ' }, 'approver обязателен', 'пустой утверждающий')
  say({ note: '' }, 'note обязательна', 'пустая заметка')
  say({ decidedAt: '2026-09-03T00:00:00Z' }, 'каноническим моментом', 'момент без миллисекунд')
  say({ decidedAt: '2026-02-30T00:00:00.000Z' }, 'каноническим моментом', 'несуществующая дата')
  has('правка без пересчёта контрольной суммы', coordinateDecisionIssues({ ...stamped(), note: 'подправлено' }).join(' | '), 'integrityDigest не совпадает')
  has('чужая контрольная сумма', coordinateDecisionIssues({ ...stamped(), integrityDigest: 'sha256:' + 'a'.repeat(64) }).join(' | '), 'integrityDigest не совпадает')
  has('текст отказа зовёт её контрольной суммой, а не подписью', coordinateDecisionIssues({ ...stamped(), note: 'x' }).join(' | '), 'контрольной суммы')
  t('значения решения — те же, что у политики', SUBJECT_DECISION_POLICIES.join(','), 'representativePoint,notApplicable')
}

/* Та же грамматика момента, что у канонического контракта планов. */
{
  for (const [value, valid] of [
    ['2026-09-03T00:00:00.000Z', true], ['2026-09-03T12:34:56.789Z', true],
    ['2026-09-03T00:00:00Z', false], ['2026-09-03T00:00:00.000+00:00', false],
    ['2026-02-30T00:00:00.000Z', false], ['2026-09-03', false],
  ]) {
    let scripts = true
    try { assertCanonicalInstant(value, 'x') } catch { scripts = false }
    const here = coordinateDecisionIssues(stamped({ decidedAt: value })).every((i) => !i.includes('каноническим моментом'))
    t(`канонический момент ${value}: реестр и контракт планов сходятся`, here, scripts)
    t(`канонический момент ${value}: ожидаемый вердикт`, here, valid)
  }
}

/* ── 3. Форма реестра — вердикт без полномочий ───────────────────────── */
{
  const good = validateCoordinateDecisionLedger(ledger(stamped()))
  t('годный реестр принят', good.ok, true)
  t('годный реестр: размер', good.size, 1)
  t('годный реестр: ключи', good.keys.join(','), KEY)
  t('пустой реестр принят', validateCoordinateDecisionLedger(ledger()).ok, true)
  has('реестр: не объект', validateCoordinateDecisionLedger([]).issues.join(' | '), 'ожидается объект')
  has('реестр: лишнее поле', validateCoordinateDecisionLedger({ ...ledger(), extra: 1 }).issues.join(' | '), 'набор полей должен быть ровно')
  has('реестр: чужая версия', validateCoordinateDecisionLedger({ version: 'poi-coordinate-decisions/v2', decisions: [] }).issues.join(' | '), 'версия')
  has('реестр: decisions не массив', validateCoordinateDecisionLedger({ version: COORDINATE_DECISIONS_LEDGER_VERSION, decisions: {} }).issues.join(' | '), 'должен быть массивом')
  has('реестр: негодная запись названа индексом',
    validateCoordinateDecisionLedger(ledger(stamped(), { ...stamped({ sourceKey: 'a:b' }), note: 'правка' })).issues.join(' | '), 'decisions[1]: integrityDigest не совпадает')
  has('реестр: повтор ключа', validateCoordinateDecisionLedger(ledger(stamped(), stamped({ note: 'вторая запись о том же' }))).issues.join(' | '), 'встречается дважды')
  t('вердикт формы — не lookup и не полномочие', isCoordinateDecisionLookup(good), false)
}

/* ── 4. Привязка к предмету ──────────────────────────────────────────── */
{
  const v = (subject, observed) => coordinateDecisionSubjectVerdict(subject, observed)
  t('совпадение по городу и имени', v(SUBJECT, { siteCity: 'osaka', nameRu: 'Парк Осакадзё', nameEn: 'Osakajo Park' }).ok, true)
  t('имя сравнивается после нормализации матчера', v({ siteCity: 'osaka', nameEn: 'Osakajo Park' }, { siteCity: 'osaka', nameEn: 'OSAKAJO  PARK' }).ok, true)
  t('город: слаг сравнивается канонически', v({ siteCity: 'fuji', nameEn: 'X' }, { siteCity: 'mt-fuji', nameEn: 'X' }).ok, true)
  t('другой город — несовпадение', v(SUBJECT, { siteCity: 'kyoto', nameRu: 'Парк Осакадзё', nameEn: 'Osakajo Park' }).mismatched.join(','), 'siteCity')
  t('другое имя — несовпадение', v(SUBJECT, { siteCity: 'osaka', nameRu: 'Парк Осакадзё', nameEn: 'Himeji Castle' }).mismatched.join(','), 'nameEn')
  t('имя названо в решении, но у записи пусто — несовпадение', v(SUBJECT, { siteCity: 'osaka', nameRu: 'Парк Осакадзё' }).mismatched.join(','), 'nameEn')
  t('имя, не названное в решении, не проверяется', v({ siteCity: 'osaka', nameEn: 'Osakajo Park' }, { siteCity: 'osaka', nameEn: 'Osakajo Park', nameRu: 'что угодно' }).ok, true)
  t('все расхождения перечислены (порядок полей предмета)', v(SUBJECT, { siteCity: 'kyoto', nameRu: 'X', nameEn: 'Y' }).mismatched.join(','), 'siteCity,nameEn,nameRu')
}

/* ── 5. Полномочие: только файл реестра, никакой фабрики ─────────────── */
{
  const live = loadCoordinateDecisions()
  t('production-реестр брендирован', isCoordinateDecisionLookup(live), true)
  t('production-реестр кэшируется одним экземпляром', loadCoordinateDecisions() === live, true)
  const raw = JSON.parse(readFileSync(fileURLToPath(new URL(`../${COORDINATE_DECISIONS_LEDGER_PATH}`, import.meta.url)), 'utf8'))
  t('файл реестра несёт свою версию', raw.version, COORDINATE_DECISIONS_LEDGER_VERSION)
  t('файл реестра — ровно version и decisions', Object.keys(raw).sort().join(','), 'decisions,version')
  t('loader видит все записи файла', live.size, raw.decisions.length)
  t('каждая запись файла проходит контракт', validateCoordinateDecisionLedger(raw).ok, true)
  t('фабрика с аргументом-реестром НЕ экспортирована', 'createCoordinateDecisionLookup' in DECISION_MODULE, false)
  t('loader не принимает аргументов', loadCoordinateDecisions.length, 0)
  const lookalike = { size: 1, get: () => stamped(), keys: () => [KEY] }
  t('объект той же формы брендом не обладает', isCoordinateDecisionLookup(lookalike), false)
  t('null — не lookup', isCoordinateDecisionLookup(null), false)
  // Ни одна экспортированная функция, кроме loader'а, не возвращает бренд — даже на годном реестре.
  const others = Object.entries(DECISION_MODULE).filter(([name, value]) => typeof value === 'function' && name !== 'loadCoordinateDecisions')
  for (const [name, fn] of others) {
    let value = null
    try { value = fn(ledger(stamped())) } catch { value = null }
    t(`экспорт ${name} не выдаёт брендированный lookup`, isCoordinateDecisionLookup(value), false)
  }
  const source = readFileSync(fileURLToPath(new URL('../src/lib/poi-coordinate-decision.ts', import.meta.url)), 'utf8')
  t('реестр читается статическим импортом по каноническому пути', source.includes("from '../../config/poi-coordinate-decisions.v1.json' with { type: 'json' }"), true)
  t('модуль не читает файлы по пути из аргумента', /readFile|readFileSync|import\(/.test(source), false)
  t('модуль не зовёт контрольную сумму подписью', /подпис/i.test(source.replace(/не подпис\S*/gi, '')), false)
}

/* ── 6. Каналы подмены в writer'е мертвы ─────────────────────────────── */
const memStore = () => {
  const created = []
  const seen = { reads: 0 }
  return {
    created,
    seen,
    store: {
      async listExisting() { seen.reads += 1; return [] },
      async findBySourceKey() { seen.reads += 1; return null },
      async create(f) { created.push(f); return { poiId: 'POI-000901', recordId: 'rec1' } },
    },
  }
}
const request = (poiOver = {}, sourceOver = {}) => ({
  source: { kind: 'portal-collector', id: 'bodik-osaka-tourism', externalKey: 'park-7', ...sourceOver },
  poi: { nameRu: 'Парк Осакадзё', nameEn: 'Osakajo Park', siteCity: 'osaka', ...poiOver },
})
t('ключ запроса совпадает с ключом решения', buildSourceKey(request().source), KEY)
{
  const m = memStore()
  const r = await ingestPoi(request(), m.store)
  t('без координат и без решения — остановка', r.outcome, 'needs_review')
  t('причина — noCoordinates', r.coordinatePolicy?.refusal, 'noCoordinates')
  t('решения к записи не было', r.coordinateDecision, null)
  t('записи нет', m.created.length, 0)
}
{
  // Подделка через options: даже объект «как lookup» не читается — канала нет.
  const m = memStore()
  const forged = { size: 1, get: () => stamped({ decision: 'notApplicable', point: null }), keys: () => [KEY] }
  const r = await ingestPoi(request(), m.store, { coordinateDecisions: forged })
  t('options.coordinateDecisions не читается', r.outcome, 'needs_review')
  t('и причина всё та же — noCoordinates', r.coordinatePolicy?.refusal, 'noCoordinates')
  const rb = await ingestPoiBatch([request()], memStore().store, { coordinateDecisions: forged })
  t('ingestPoiBatch: канала тоже нет', rb[0]?.coordinatePolicy?.refusal, 'noCoordinates')
}
{
  // Подделка через запрос: поля решения в запросе не существует и не читается.
  const m = memStore()
  const r = await ingestPoi(request({ coordinatePolicy: 'notApplicable', decision: 'notApplicable', coordinateDecision: stamped({ decision: 'notApplicable', point: null }) }), m.store)
  t('поле решения в запросе игнорируется', r.outcome, 'needs_review')
  t('и причина всё та же', r.coordinatePolicy?.refusal, 'noCoordinates')
  t('записи нет', m.created.length, 0)
}

/* ── 7. Production-композиция: реестр — ФАЙЛ по каноническому пути ───────
   Песочница-копия дерева с фикстурным реестром; внутри — тот же ingestPoi,
   без единой подстановки в коде. Результат приходит JSON'ом из процесса. */
const INGEST_SCRIPT = (poiOver, sourceOver = {}) => `
import { ingestPoi } from './src/lib/poi-ingest.ts'
const created = []
const store = { async listExisting() { return [] }, async findBySourceKey() { return null },
  async create(f) { created.push(f); return { poiId: 'POI-000901', recordId: 'rec1' } } }
const r = await ingestPoi({ source: { kind: 'portal-collector', id: 'bodik-osaka-tourism', externalKey: 'park-7', ...${JSON.stringify(sourceOver)} },
  poi: { nameRu: 'Парк Осакадзё', nameEn: 'Osakajo Park', siteCity: 'osaka', ...${JSON.stringify(poiOver)} } }, store)
console.log(JSON.stringify({ outcome: r.outcome, refusal: r.coordinatePolicy?.refusal ?? null, policy: r.coordinatePolicy?.policy ?? null,
  derivedFrom: r.coordinatePolicy?.derivedFrom ?? null, decisionRef: r.coordinateDecision?.decisionRef ?? null, explanation: r.explanation,
  fields: created[0] ? { policy: created[0]['Coordinate Policy'], lat: created[0].Latitude, lon: created[0].Longitude, placeId: created[0]['Google Place ID'] ?? null, notes: created[0].Notes } : null }))
`
{
  const sb = createProductionSandbox({ ledger: ledger(stamped()) })
  try {
    const matched = sb.run(INGEST_SCRIPT({ lat: POINT.lat, lon: POINT.lon }))
    t('representativePoint: запись создана', matched.outcome, 'created')
    t('representativePoint: политика из решения', matched.policy, 'representativePoint')
    t('representativePoint: derivedFrom — решение', matched.derivedFrom, 'subjectDecision')
    t('representativePoint: решение возвращено', matched.decisionRef, 'owner/2026-09-03#1')
    t('в полях — representativePoint', matched.fields?.policy, 'representativePoint')
    t('в полях — широта решения', matched.fields?.lat, POINT.lat)
    t('в полях — долгота решения', matched.fields?.lon, POINT.lon)
    t('Google Place ID не выдуман', matched.fields?.placeId, null)
    has('след в Notes: политика', matched.fields?.notes, 'ПОЛИТИКА КООРДИНАТ ПО РЕШЕНИЮ ВЛАДЕЛЬЦА: representativePoint')
    has('след в Notes: ссылка и утверждающий', matched.fields?.notes, 'owner/2026-09-03#1; Эдуард; ' + AT)
    has('след в Notes: контрольная сумма', matched.fields?.notes, stamped().integrityDigest)
    has('след в Notes: заметка', matched.fields?.notes, 'Парк без единого входа')

    const rounded = sb.run(INGEST_SCRIPT({ lat: 34.69373781234, lon: 135.50216512345 }))
    t('та же точка после округления — принята', rounded.outcome, 'created')
    t('та же точка после округления — записана каноническая пара', rounded.fields?.lat, POINT.lat)

    const wrongPoint = sb.run(INGEST_SCRIPT({ lat: 34.7, lon: 135.5 }))
    t('точка не та — остановка', wrongPoint.outcome, 'needs_review')
    t('точка не та — причина названа', wrongPoint.refusal, 'decisionContradictsCoordinates')
    has('точка не та — объяснение называет решение', wrongPoint.explanation, 'owner/2026-09-03#1')
    t('точка не та — записи нет', wrongPoint.fields, null)

    const noPair = sb.run(INGEST_SCRIPT({}))
    t('representativePoint без координат — остановка', noPair.outcome, 'needs_review')
    t('representativePoint без координат — причина', noPair.refusal, 'decisionContradictsCoordinates')

    // ПРЕДМЕТ: тот же ключ, другой объект — решение не переносится.
    const otherObject = sb.run(INGEST_SCRIPT({ nameRu: 'Замок Осака', nameEn: 'Osaka Castle', lat: POINT.lat, lon: POINT.lon }))
    t('другой объект под тем же ключом — остановка', otherObject.outcome, 'needs_review')
    t('другой объект — отказ назван', otherObject.refusal, 'decisionSubjectMismatch')
    has('другой объект — объяснение перечисляет поля', otherObject.explanation, 'не совпало: nameEn, nameRu')
    t('другой объект — записи нет', otherObject.fields, null)
    t('другой объект — решение показано в результате', otherObject.decisionRef, 'owner/2026-09-03#1')
    const otherCity = sb.run(INGEST_SCRIPT({ siteCity: 'kyoto', lat: POINT.lat, lon: POINT.lon }))
    t('другой город под тем же ключом — отказ по предмету', otherCity.refusal, 'decisionSubjectMismatch')
    const spelled = sb.run(INGEST_SCRIPT({ nameEn: 'OSAKAJO  PARK', lat: POINT.lat, lon: POINT.lon }))
    t('имя в другой записи регистра — тот же предмет', spelled.outcome, 'created')

    const otherKey = sb.run(INGEST_SCRIPT({ lat: POINT.lat, lon: POINT.lon }, { externalKey: 'park-8' }))
    t('чужой ключ — решение не применено', otherKey.refusal, 'unknownProvenance')
    t('чужой ключ — решения в результате нет', otherKey.decisionRef, null)
    const noKey = sb.run(INGEST_SCRIPT({}, { externalKey: null }))
    t('без Source Key — решение не ищется', noKey.refusal, 'noCoordinates')
  } finally { sb.dispose() }
}
{
  const sb = createProductionSandbox({ ledger: ledger(stamped({ decision: 'notApplicable', point: null, note: 'Маршрут по нескольким кварталам: одной точки нет.' })) })
  try {
    const na = sb.run(INGEST_SCRIPT({}))
    t('notApplicable: запись создана', na.outcome, 'created')
    t('notApplicable: политика из решения', na.policy, 'notApplicable')
    t('notApplicable: в полях — политика', na.fields?.policy, 'notApplicable')
    t('notApplicable: широта пуста', na.fields?.lat, null)
    t('notApplicable: долгота пуста', na.fields?.lon, null)
    has('notApplicable: след в Notes', na.fields?.notes, 'ПОЛИТИКА КООРДИНАТ ПО РЕШЕНИЮ ВЛАДЕЛЬЦА: notApplicable')
    const withCoords = sb.run(INGEST_SCRIPT({ lat: POINT.lat, lon: POINT.lon }))
    t('notApplicable с координатами — остановка', withCoords.outcome, 'needs_review')
    t('notApplicable с координатами — причина', withCoords.refusal, 'decisionContradictsCoordinates')
    const machine = sb.run(INGEST_SCRIPT({ lat: POINT.lat, lon: POINT.lon, resolved: { placeId: 'PID-1', lat: POINT.lat, lon: POINT.lon } }, { externalKey: 'other' }))
    t('машинный вывод для другого ключа сохранён', machine.policy, 'exactObjectPoint')
    t('машинный вывод — из резолвера', machine.derivedFrom, 'resolvedGooglePlace')
  } finally { sb.dispose() }
}
{
  // Негодный реестр по каноническому пути: writer не пишет вовсе — до хранилища.
  const sb = createProductionSandbox({ ledger: ledger({ ...stamped(), note: 'правка без пересчёта' }) })
  try {
    const r = sb.tryRun(INGEST_SCRIPT({ lat: POINT.lat, lon: POINT.lon }))
    t('негодный реестр — writer бросает', r.ok, false)
    has('негодный реестр — причина из реестра', r.error, 'integrityDigest не совпадает')
  } finally { sb.dispose() }
}

/* ── 8. Скрипт владельца: контрольная сумма и проверка — без записи ──── */
{
  const s = stampDraft(draft())
  t('--stamp: контрольная сумма совпадает с библиотечной', s.integrityDigest, coordinateDecisionIntegrityDigest(draft()))
  t('--stamp: проставленная запись проходит контракт', coordinateDecisionIssues(s).length, 0)
  t('--stamp: чужая контрольная сумма в черновике перезаписывается', stampDraft({ ...draft(), integrityDigest: 'sha256:' + 'f'.repeat(64) }).integrityDigest, s.integrityDigest)
  has('--stamp: негодный черновик отвергнут с причиной', await boom(() => stampDraft(draft({ note: '' }))), 'note обязательна')
  has('--stamp: не объект — отказ', await boom(() => stampDraft([])), 'ожидается объект')
  const out = execFileSync('node', ['scripts/poi-coordinate-decision.mjs', '--check'], { encoding: 'utf8', cwd: process.cwd() })
  has('--check читает реестр под git', out, COORDINATE_DECISIONS_LEDGER_PATH)
  has('--check называет число решений', out, `${loadCoordinateDecisions().size} решений`)
  const source = readFileSync(fileURLToPath(new URL('../scripts/poi-coordinate-decision.mjs', import.meta.url)), 'utf8')
  t('скрипт не пишет файлы', /writeFile|appendFile|createWriteStream/.test(source), false)
  t('скрипт не ходит в сеть', /fetch\(|node:http/.test(source), false)
  t('скрипт не зовёт контрольную сумму подписью', /--sign\b|подпис(ать|ь\b)/.test(source.replace(/не подпись/g, '')), false)
  // Честность текста о полномочии (10f-P R2): импорт и checksum не доказывают авторство; полномочие — процесс owner review.
  const honest = [
    ['src/lib/poi-coordinate-decision.ts', /не доказывают авторство/i, /owner review/],
    ['scripts/poi-coordinate-decision.mjs', /не доказывают авторство/i, /owner review/],
    ['docs/poi-intake/change-policy.md', /не доказывают авторство/i, /owner review/],
    ['docs/poi-intake/runbook.md', /не доказывают авторство/i, /owner review/],
    ['docs/poi-intake/README.md', /не доказывают авторство/i, /owner review/],
  ]
  for (const [rel, claim, process_] of honest) {
    const text = readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8')
    t(`${rel}: говорит, что импорт и checksum не доказывают авторство`, claim.test(text), true)
    t(`${rel}: полномочие задаётся процессом owner review`, process_.test(text), true)
    t(`${rel}: не обещает, что коммит/импорт/сумма удостоверяют авторство`, /(коммит|импорт|сумма)[^.\n]{0,40}удостоверяет авторство/.test(text), false)
  }
}

if (bad.length) {
  console.error(`✗ решения о координатах: провалено ${bad.length} из ${ok + bad.length}`)
  for (const line of bad) console.error(`  ${line}`)
  process.exit(1)
}
console.log(`✓ решения о координатах: ${ok} проверок пройдено`)
