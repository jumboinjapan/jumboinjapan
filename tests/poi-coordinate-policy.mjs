/**
 * Политика координат: чистая классификация и путь записи.
 *
 * Круг 10f-L R4. Прежде путь записи о поле `Coordinate Policy` не знал вовсе:
 * `ingestPoi` писал `Latitude` и `Longitude` и оставлял политику пустой, а
 * проверка целостности такую пару молча пропускала как «переходный случай».
 * Так и накопились 444 координатированные записи без политики. Здесь
 * закреплено обратное правило: запись без выводимой политики не создаётся.
 *
 * Каждая проверка ИСПОЛНЯЕТ ветку, а не ищет текст в исходнике. Исключение
 * одно и названо вслух — структурная проверка «второго списка значений не
 * существует»: она и обязана смотреть на исходники, потому что утверждает
 * именно о них.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  classifyCoordinatePolicy,
  COORDINATE_POLICIES,
  COORDINATE_POLICY_FIELD,
  coordinatePolicyAgreesWithCoords,
  isCoordinatePolicy,
  SUBJECT_DECISION_POLICIES,
} from '../src/lib/poi-coordinate-policy.ts'
import { ingestPoi, ingestPoiBatch } from '../src/lib/poi-ingest.ts'
import { canonicalCoords } from '../src/lib/poi-canon.ts'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok += 1
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ── 1. Состав значений ────────────────────────────────────────────────────
t('значений ровно три', COORDINATE_POLICIES.length, 3)
t('и это те самые три', [...COORDINATE_POLICIES].sort().join(','),
  'exactObjectPoint,notApplicable,representativePoint')
t('имя поля одно на весь проект', COORDINATE_POLICY_FIELD, 'Coordinate Policy')
t('решением человека объявляются только два', [...SUBJECT_DECISION_POLICIES].sort().join(','),
  'notApplicable,representativePoint')
t('exactObjectPoint решением не объявляется',
  SUBJECT_DECISION_POLICIES.includes('exactObjectPoint'), false)
t('распознаватель принимает своё', isCoordinatePolicy('representativePoint'), true)
t('и отвергает чужое', isCoordinatePolicy('centroid'), false)

// ── 2. Чистая классификация ───────────────────────────────────────────────
function P(lat, lon) { return { placeId: 'PID-X', lat, lon } }

{
  // Google point: полная пара, пришедшая от резолвера, и записывается она же.
  const v = classifyCoordinatePolicy({ lat: 35.01, lon: 135.76, resolved: P(35.01, 135.76) })
  t('точка резолвера → exactObjectPoint', v.ok && v.policy, 'exactObjectPoint')
  t('и происхождение названо', v.ok && v.derivedFrom, 'resolvedGooglePlace')
}
{
  // No resolver: координаты есть, подтвердить их нечем.
  const v = classifyCoordinatePolicy({ lat: 35.01, lon: 135.76, resolved: null })
  t('без резолвера политика не выводится', v.ok, false)
  t('и причина — происхождение', v.refusal, 'unknownProvenance')
}
{
  // Missing key: резолвер отвечал, но опознанного места нет — placeId пуст.
  const v = classifyCoordinatePolicy({ lat: 35.01, lon: 135.76, resolved: { placeId: '', lat: 35.01, lon: 135.76 } })
  t('пустой placeId не подтверждает происхождение', v.refusal, 'unknownProvenance')
  const w = classifyCoordinatePolicy({ lat: 35.01, lon: 135.76, resolved: { placeId: 'PID-X' } })
  t('placeId без собственных координат тоже не подтверждает', w.refusal, 'unknownProvenance')
}
{
  // Unknown provenance: place_id настоящий, но точка записывается другая.
  const v = classifyCoordinatePolicy({ lat: 35.01, lon: 135.76, resolved: P(35.99, 135.76) })
  t('чужая точка рядом с настоящим place_id не проходит', v.refusal, 'unknownProvenance')
  // Долгота сторожится ОТДЕЛЬНЫМ утверждением: пара, различающаяся только по
  // ней, при общем утверждении «точки разные» осталась бы непроверенной.
  const w = classifyCoordinatePolicy({ lat: 35.01, lon: 135.76, resolved: P(35.01, 136.99) })
  t('точка, отличающаяся только долготой, тоже не проходит', w.refusal, 'unknownProvenance')
}
{
  // Empty stub: ни координат, ни решения.
  const v = classifyCoordinatePolicy({ resolved: null })
  t('пустая заглушка политики не получает', v.ok, false)
  t('и это не notApplicable, а незакрытая работа', v.refusal, 'noCoordinates')
}
{
  // Half pair — с обеих сторон.
  t('половина пары: только широта', classifyCoordinatePolicy({ lat: 35.01 }).refusal, 'halfPair')
  t('половина пары: только долгота', classifyCoordinatePolicy({ lon: 135.76 }).refusal, 'halfPair')
  t('NaN координатой не считается', classifyCoordinatePolicy({ lat: Number.NaN, lon: 135.76 }).refusal, 'halfPair')
  t('бесконечность координатой не считается',
    classifyCoordinatePolicy({ lat: Number.POSITIVE_INFINITY, lon: 135.76 }).refusal, 'halfPair')
}
{
  // Явные предметные решения.
  const na = classifyCoordinatePolicy({ decision: 'notApplicable' })
  t('явное notApplicable при пустой паре принимается', na.ok && na.policy, 'notApplicable')
  t('и помечено как решение человека', na.ok && na.derivedFrom, 'subjectDecision')

  const rp = classifyCoordinatePolicy({ lat: 35.01, lon: 135.76, decision: 'representativePoint' })
  t('явное representativePoint при полной паре принимается', rp.ok && rp.policy, 'representativePoint')
  t('и резолвер для него не нужен', rp.ok && rp.derivedFrom, 'subjectDecision')

  t('representativePoint без координат отвергается',
    classifyCoordinatePolicy({ decision: 'representativePoint' }).refusal, 'decisionContradictsCoordinates')
  t('representativePoint на половине пары отвергается',
    classifyCoordinatePolicy({ lat: 35.01, decision: 'representativePoint' }).refusal, 'decisionContradictsCoordinates')
  t('notApplicable с координатами отвергается',
    classifyCoordinatePolicy({ lat: 35.01, lon: 135.76, decision: 'notApplicable' }).refusal, 'decisionContradictsCoordinates')
  t('notApplicable на половине пары отвергается',
    classifyCoordinatePolicy({ lat: 35.01, decision: 'notApplicable' }).refusal, 'decisionContradictsCoordinates')
  t('exactObjectPoint решением человека не принимается',
    classifyCoordinatePolicy({ lat: 35.01, lon: 135.76, resolved: P(35.01, 135.76), decision: 'exactObjectPoint' }).refusal,
    'unknownDecision')
  t('выдуманное значение решением не принимается',
    classifyCoordinatePolicy({ decision: 'centroid' }).refusal, 'unknownDecision')
  t('пробелы решением не считаются',
    classifyCoordinatePolicy({ decision: '   ' }).refusal, 'noCoordinates')
}

// ── 3. Путь записи ────────────────────────────────────────────────────────
const makeStore = () => {
  const state = { created: [], calls: 0 }
  return {
    state,
    store: {
      async listExisting() { return [] },
      async findBySourceKey() { return null },
      async create(fields) {
        state.calls += 1
        state.created.push(fields)
        const poiId = `POI-00${700 + state.created.length}`
        return { poiId, recordId: `rec${poiId}` }
      },
    },
  }
}
const base = (extra = {}) => ({
  source: { kind: 'portal-collector', id: 'policy', externalKey: `K${Math.random().toString(36).slice(2, 8)}` },
  poi: {
    nameRu: `Объект ${Math.random().toString(36).slice(2, 8)}`,
    siteCity: 'kyoto',
    descriptionRu: 'Описание объекта.',
    descriptionEn: 'Object description.',
    categoriesRu: ['Буддийский храм'],
    ...extra,
  },
})

{
  const { state, store } = makeStore()
  const r = await ingestPoi(base({ lat: 35.01, lon: 135.76, resolved: P(35.01, 135.76) }), store)
  t('Google point: запись создана', r.outcome, 'created')
  t('Google point: политика записана', state.created[0]?.[COORDINATE_POLICY_FIELD], 'exactObjectPoint')
  // Атомарность записи: политика и пара координат приезжают ОДНИМ объектом
  // полей, а не вторым PATCH-ом. Разорванной пары не существует ни на миг.
  const f = state.created[0] ?? {}
  t('Google point: политика приехала тем же объектом, что широта', typeof f.Latitude, 'number')
  t('Google point: и что долгота', typeof f.Longitude, 'number')
  t('Google point: store.create вызван ровно один раз', state.calls, 1)
}
{
  const { state, store } = makeStore()
  const r = await ingestPoi(base({ lat: 35.01, lon: 135.76 }), store)
  t('no resolver: остановка', r.outcome, 'needs_review')
  t('no resolver: причина структурна', r.coordinatePolicy.refusal, 'unknownProvenance')
  t('no resolver: полей нет', r.fields, null)
  t('no resolver: записей нет', state.calls, 0)
}
{
  const { state, store } = makeStore()
  const r = await ingestPoi(base({ lat: 35.01, lon: 135.76, resolved: { placeId: '' } }), store)
  t('missing key: остановка', r.outcome, 'needs_review')
  t('missing key: записей нет', state.calls, 0)
}
{
  // Empty stub — ровно та форма, в которой заводятся заглушки родителя
  // и мест из программы: имя, город и открытый вопрос, без координат.
  const { state, store } = makeStore()
  const r = await ingestPoi({
    source: { kind: 'telegram-agent', id: 'poi-intake-bot' },
    poi: { nameRu: 'Заглушка родителя', siteCity: 'kyoto', openQuestions: ['Заглушка: родительский объект.'] },
  }, store)
  t('empty stub: остановка', r.outcome, 'needs_review')
  t('empty stub: причина — нет координат', r.coordinatePolicy.refusal, 'noCoordinates')
  t('empty stub: записей нет', state.calls, 0)
}
{
  const { state, store } = makeStore()
  const r = await ingestPoi(base({ lat: 35.01, resolved: P(35.01, 135.76) }), store)
  t('half pair: остановка', r.outcome, 'needs_review')
  t('half pair: записей нет', state.calls, 0)
}
{
  // force подтверждает не-дубль, а не происхождение координаты.
  const { state, store } = makeStore()
  const r = await ingestPoi(base({ lat: 35.01, lon: 135.76 }), store, { force: true })
  t('force не обходит инвариант', r.outcome, 'needs_review')
  t('force не создаёт записей', state.calls, 0)
}
{
  // ОТРИЦАТЕЛЬНЫЙ СЦЕНАРИЙ круга R5, находка P0-A. Прежде это поле приходило
  // тем же объектом запроса, что и всё остальное, и портальный коллектор
  // объявлял себя человеком: обе «требующие решения» политики проставлялись
  // машиной. Теперь поле на машинной границе не существует, и попытка его
  // передать не меняет ничего.
  for (const attempt of ['notApplicable', 'representativePoint']) {
    const { state, store } = makeStore()
    const r = await ingestPoi(base({ coordinatePolicyDecision: attempt }), store)
    t(`portal-collector объявляет «${attempt}» без координат: остановка`, r.outcome, 'needs_review')
    t(`portal-collector объявляет «${attempt}» без координат: записей нет`, state.calls, 0)

    const s2 = makeStore()
    const r2 = await ingestPoi(base({ lat: 34.6873, lon: 135.5259, coordinatePolicyDecision: attempt }), s2.store)
    t(`portal-collector объявляет «${attempt}» с неподтверждённой точкой: остановка`, r2.outcome, 'needs_review')
    t(`portal-collector объявляет «${attempt}» с неподтверждённой точкой: причина о происхождении`,
      r2.coordinatePolicy.refusal, 'unknownProvenance')
    t(`portal-collector объявляет «${attempt}» с неподтверждённой точкой: записей нет`, s2.state.calls, 0)
  }
}
{
  // Пакетный путь: инвариант держится по каждой записи отдельно, а не по пакету.
  const { state, store } = makeStore()
  const results = await ingestPoiBatch([
    base({ lat: 34.1, lon: 135.1, resolved: P(34.1, 135.1) }),
    base({ lat: 34.9, lon: 135.9 }),
    base({ coordinatePolicyDecision: 'notApplicable' }),
  ], store)
  t('пакет: опознанная создана', results[0].outcome, 'created')
  t('пакет: неопознанная остановлена', results[1].outcome, 'needs_review')
  t('пакет: объявленное решение не создаёт запись', results[2].outcome, 'needs_review')
  t('пакет: записей ровно одна', state.calls, 1)
  t('пакет: у единственной точка резолвера', state.created[0]?.[COORDINATE_POLICY_FIELD], 'exactObjectPoint')
}
{
  // Портальный путь: коллектор resolved не наполняет, поэтому его запросы
  // выглядят так. Все они обязаны остановиться.
  const { state, store } = makeStore()
  const results = await ingestPoiBatch([
    base({ lat: 34.6, lon: 135.5 }),
    base({ lat: 34.7, lon: 135.6 }),
  ], store)
  t('портальный путь: первая остановлена', results[0].outcome, 'needs_review')
  t('портальный путь: вторая остановлена', results[1].outcome, 'needs_review')
  t('портальный путь: ни одной записи', state.calls, 0)
}

{
  // РЕГРЕССИЯ круга R5, находка P0-B. Записываемая пара проходила канон приёма
  // (семь знаков), пара резолвера — нет, и одна и та же точка Google
  // объявлялась чужой. Обе стороны канонизируются одним правилом.
  const LAT = 35.76001173325338
  const LON = 139.88016401596929
  const canon = canonicalCoords(LAT, LON)
  t('канон приёма действительно округляет', canon.lat, 35.7600117)
  const v = classifyCoordinatePolicy({ lat: canon.lat, lon: canon.lon, resolved: { placeId: 'PID-G', lat: LAT, lon: LON } })
  t('одна точка Google после канона обеих сторон даёт exactObjectPoint', v.ok && v.policy, 'exactObjectPoint')

  const { state, store } = makeStore()
  const r = await ingestPoi(base({ lat: LAT, lon: LON, resolved: { placeId: 'PID-G', lat: LAT, lon: LON } }), store)
  t('и через ingestPoi запись создаётся', r.outcome, 'created')
  t('с политикой точки объекта', state.created[0]?.[COORDINATE_POLICY_FIELD], 'exactObjectPoint')
  t('и записана канонизированная широта', state.created[0]?.Latitude, 35.7600117)

  // Действительно другая точка по-прежнему не проходит: допуска не появилось.
  const other = classifyCoordinatePolicy({ lat: canon.lat, lon: canon.lon, resolved: { placeId: 'PID-G', lat: 35.7600217, lon: LON } })
  t('точка, отличающаяся ПОСЛЕ канона, остаётся чужой', other.refusal, 'unknownProvenance')
  const far = classifyCoordinatePolicy({ lat: canon.lat, lon: canon.lon, resolved: { placeId: 'PID-G', lat: 35.99, lon: LON } })
  t('и далёкая точка тоже', far.refusal, 'unknownProvenance')
}
{
  // Согласие политики с координатами: fail-closed на неизвестном непустом.
  t('неизвестное непустое значение согласия не даёт',
    coordinatePolicyAgreesWithCoords('centroid', 35.0, 139.0), false)
  t('и при пустой паре тоже не даёт',
    coordinatePolicyAgreesWithCoords('centroid', null, null), false)
  t('пустая legacy-политика допустима отдельно',
    coordinatePolicyAgreesWithCoords('', 35.0, 139.0), true)
  t('и null тоже считается пустой', coordinatePolicyAgreesWithCoords(null, 35.0, 139.0), true)
  t('notApplicable требует пустой пары', coordinatePolicyAgreesWithCoords('notApplicable', 35.0, 139.0), false)
  t('точечная политика требует полной пары', coordinatePolicyAgreesWithCoords('exactObjectPoint', 35.0, null), false)
  t('и согласуется при полной паре', coordinatePolicyAgreesWithCoords('exactObjectPoint', 35.0, 139.0), true)
}
{
  // Поля решения на машинной границе не существует ни в одном production-файле.
  const offenders = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next' || entry === '.git' || entry === '_to_delete') continue
      const full = path.join(dir, entry)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!/\.(ts|tsx|mjs|js)$/.test(entry)) continue
      if (readFileSync(full, 'utf8').includes('coordinatePolicyDecision')) offenders.push(path.relative(ROOT, full))
    }
  }
  for (const dir of ['src', 'scripts']) walk(path.join(ROOT, dir))
  t('поля решения нет ни в одном production-файле', offenders.join(','), '')
}

// ── 4. Второго списка значений не существует ──────────────────────────────
// Единственная проверка, которая смотрит на исходники, — потому что именно
// о них и утверждает. Параллельный список расходится молча, и поймать это
// исполнением ветки нельзя: обе ветки будут зелёными, пока списки совпадают.
{
  const ALLOWED = new Set([path.join(ROOT, 'src/lib/poi-coordinate-policy.ts')])
  const offenders = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next' || entry === '.git' || entry === '_to_delete') continue
      const full = path.join(dir, entry)
      const st = statSync(full)
      if (st.isDirectory()) { walk(full); continue }
      if (!/\.(ts|tsx|mjs|js)$/.test(entry)) continue
      if (full.startsWith(path.join(ROOT, 'tests'))) continue
      if (ALLOWED.has(full)) continue
      const src = readFileSync(full, 'utf8')
      // Второй список — это перечисление, а не одиночное упоминание: ищем
      // файлы, где рядом стоят все три значения.
      if (COORDINATE_POLICIES.every((v) => src.includes(`'${v}'`) || src.includes(`"${v}"`))) {
        offenders.push(path.relative(ROOT, full))
      }
    }
  }
  // Обходится только production-код. `tmp/` не обходится намеренно: там лежат
  // замороженные улики кругов 10f-H…10f-K3, которые обязаны остаться
  // побайтово прежними, и фикстуры, где эти значения — данные, а не список.
  for (const dir of ['src', 'scripts']) walk(path.join(ROOT, dir))
  t('параллельного перечисления значений политики нигде нет', offenders.join(','), '')
}

if (bad.length) {
  console.error(`✗ политика координат: ${bad.length} из ${ok + bad.length}`)
  for (const b of bad) console.error(`  ${b}`)
  process.exit(1)
}
console.log(`✓ политика координат: ${ok} проверок пройдено`)
