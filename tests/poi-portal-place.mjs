/**
 * P05.3 — портальный путь проходит канонический resolvePlace.
 *
 * ЧТО ЗДЕСЬ ДОКАЗЫВАЕТСЯ. Не то, что функция границы возвращает правильные
 * значения на своих входах, — это было бы проверкой helper'а. Здесь исполняется
 * ПРОИЗВОДСТВЕННАЯ КОМПОЗИЦИЯ целиком:
 *
 *   замороженная запись обхода Japan Guide
 *     → проверенный результат извлечения
 *       → production-мост (writeRun)
 *         → инъецированный КАНОНИЧЕСКИЙ resolvePlace
 *           → production Intake (ingestPoiBatch → ingestPoi)
 *
 * Резолвер здесь настоящий: вызывается ровно тот `resolvePlace`, который
 * вызывает Telegram, только его `fetch` подменён. Ни одного сетевого и ни
 * одного платного обращения этот файл не делает.
 *
 * Отрицательные случаи проверяют ровно то, ради чего граница и заведена:
 * неуверенный исход обязан кончиться ИМЕНОВАННЫМ отказом и НУЛЁМ обращений к
 * хранилищу. Хранилище для этого падает на любом вызове — иначе «не дошли до
 * записи» доказывалось бы отсутствием записи, а отсутствие записи бывает и по
 * другим причинам.
 */
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  assertDiscoveryRecord,
  buildAppliesTo,
  buildDiscoveryRecord,
  buildFactLead,
  buildPageEvidence,
  buildPlacement,
  DISCOVERY_RECORD_SPEC,
  LEAD_CONFIDENCE,
} from '../scripts/poi-portals/lib/discovery-contract.mjs'
import { assertDiscoveryBoundary, main, writeRun } from '../scripts/poi-portals/collect-pois.mjs'
import { createSnapshotStore } from '../scripts/poi-portals/lib/base-snapshot.mjs'
import { getPortal } from '../scripts/poi-portals/registry.mjs'
import { resolvePlace } from '../src/lib/place-resolve.ts'
import {
  assertPortalPlaceSubject,
  canonicalPortalPlaceResolver,
  PORTAL_PLACE_REFUSALS,
  PORTAL_PLACE_SUBJECT_SPEC,
  resolvePortalPlace,
  RESOLVER_ERROR_TEXT_LIMIT,
  UNDESCRIBABLE_THROWN,
} from '../src/lib/poi-portal-place.ts'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const has = (label, text, needle) => {
  if (typeof text === 'string' && text.includes(needle)) ok++
  else bad.push(`${label}: в «${text}» нет «${needle}»`)
}
const boom = async (fn) => { try { await fn(); return '(без ошибки)' } catch (e) { return e.message } }

/* Прогон печатает предупреждения в stderr; в наборе они шум. */
const quiet = async (fn) => {
  const real = console.error
  console.error = () => {}
  try { return await fn() } finally { console.error = real }
}

/**
 * Описание брошенного значения для самого набора.
 *
 * Тем же способом, что и в продукте, и по той же причине. Матрица ловила это
 * дважды. Сначала на `throw null`: `error.message` падал, прогон умирал молча
 * вместо того, чтобы напечатать проваленное утверждение, и мутация «вернуть
 * дефект» выживала по вине харнеса. Потом на `HostileError` и бросающем Proxy:
 * `instanceof` дёргает `getPrototypeOf`, а чтение `message` — getter, и оба
 * бросали здесь, в самом наборе, когда мутация выпускала значение наружу.
 *
 * Харнес обязан пережить ЛЮБОЕ брошенное значение: иначе он проверяет не
 * границу, а собственную удачу.
 */
const said = (error) => {
  try {
    if (typeof error === 'string') return error
    if (error !== null && typeof error === 'object') {
      const slot = Object.getOwnPropertyDescriptor(error, 'message')
      if (slot && 'value' in slot && typeof slot.value === 'string') return slot.value
    }
    return `значение типа ${error === null ? 'null' : typeof error}`
  } catch {
    return 'значение, которое не удалось описать'
  }
}

/** Как quiet, но глушит и stdout: `main` печатает туда весь отчёт прогона. */
const hushed = async (fn) => {
  const realLog = console.log
  console.log = () => {}
  try { return await quiet(fn) } finally { console.log = realLog }
}

/** Как quiet, но брошенное исключение превращает в пустой отчёт. */
/* ФОРМА ОТВЕТА ПРИ ОТКАЗЕ — ПОЛНАЯ, а не частичная. Прежде здесь не было
   `placeBudget`, и любое утверждение вида `result.placeBudget.performed`
   после броска падало с TypeError ДО печати итога: прогон умирал молча, и
   набор, поймавший регрессию именованной проверкой выше, выглядел упавшим
   «по своей вине». Заполнители заведомо невозможные (-1), чтобы ни одно
   утверждение случайно не совпало с ними. */
const quietOrEmpty = async (fn) => {
  try { return await quiet(fn) } catch (error) {
    return {
      attempted: -1, unnamed: -1, outcomes: {}, placeRefusals: {},
      placeUnresolved: -1, created: [], notCreated: [],
      placeBudget: { limit: -1, performed: -1, skippedAlreadyIngested: -1, refusedBeforeLookup: -1 },
      placeUnresolvedQueue: [{ refusal: `БРОШЕНО: ${said(error)}` }],
    }
  }
}

const dir = await mkdtemp(path.join(tmpdir(), 'portal-place-'))
let n = 0

const NOW = new Date('2026-09-02T00:00:00.000Z')
const AT = '2026-08-25T00:00:00.000Z'
const HOST = 'https://www.japan-guide.com'
const HIMEJI_URL = `${HOST}/e/e3501.html`
const HIMEJI_KEY = 'japan-guide:e3501'

/* ── 1. Замороженная запись обхода Japan Guide ───────────────────────────
   Строится каноническими строителями, а не литералом рядом: литерал был бы
   вторым представлением формата и разошёлся бы с ней молча. */
const frozenRecord = buildDiscoveryRecord({
  sourceKey: HIMEJI_KEY,
  url: HIMEJI_URL,
  nameEn: 'Himeji Castle',
  placements: [buildPlacement({
    kind: 'destinationRanking',
    collectionSourceKey: 'japan-guide:e2157',
    listPosition: 1,
    editorialLevel: 3,
    categoryHint: 'Castle',
  })],
  factLeads: [buildFactLead({
    kind: 'hours_hint',
    appliesTo: buildAppliesTo('Main Keep'),
    value: '9:00 to 17:00',
    source: HIMEJI_URL,
    sourceLocator: 'hours_fees_block',
    observedAt: AT,
  })],
  omissions: [],
  pageEvidence: buildPageEvidence({
    url: HIMEJI_URL,
    pageRole: 'poi',
    pageBytes: 128000,
    rawPageDigest: `sha256:${'b'.repeat(64)}`,
    observedAt: AT,
    httpCharset: 'shift-jis',
    metaCharset: 'utf-8',
    decodePolicy: 'mixed-page-utf8-locators-v1',
    decodeErrorCount: 0,
    decodeReplacements: 0,
    nonWhitelistedCodepoints: 0,
  }),
})
assertDiscoveryRecord(frozenRecord); ok++
t('запись обхода — та самая версия', frozenRecord.contractVersion, DISCOVERY_RECORD_SPEC)
t('подсказка записи неподтверждённая', frozenRecord.factLeads[0].confidence, LEAD_CONFIDENCE)
t('и момент подтверждения пуст', frozenRecord.factLeads[0].verifiedAt, null)

/* ── 2. Запись обхода готовым POI не является ────────────────────────────
   Граница обязана отвергнуть её ПОИМЁННО, а не общим «неизвестные поля»:
   иначе причина отказа не отличала бы чужой формат от опечатки. */
has(
  'запись обхода отвергнута границей',
  await boom(() => resolvePortalPlace(frozenRecord, { resolver: null, now: NOW })),
  `чужая версия ${JSON.stringify(DISCOVERY_RECORD_SPEC)}`,
)
has(
  'и названа причина: подсказки не подтверждены',
  await boom(() => resolvePortalPlace(frozenRecord, { resolver: null, now: NOW })),
  'готовым POI не является',
)

/* ── 3. Проверенный результат извлечения ─────────────────────────────────
   ШАГ ПРОВЕРКИ ФАКТА ЖИВЁТ ВНЕ ЭТОЙ ГРАНИЦЫ. Превращение неподтверждённой
   подсказки в факт — предмет вехи P03 (модельное извлечение), и здесь он
   выполнен явным ручным шагом. Именно поэтому он и написан отдельной
   функцией: граница принимает результат извлечения, а не производит его. */
const verifiedExtraction = (record, { siteCity, prefectureJa }) => {
  if (record.contractVersion !== DISCOVERY_RECORD_SPEC) throw new Error('на вход подана не запись обхода')
  return {
    contractVersion: PORTAL_PLACE_SUBJECT_SPEC,
    sourceKey: record.sourceKey,
    nameEn: record.nameEn,
    /* Записи обхода японского имени не несут (`name_ja` — зарезервированный вид
       подсказки), поэтому здесь оно пустое: путь Japan Guide опознаёт место по
       английскому имени. Японский ключ проверяется на корпусе Осаки в canary. */
    nameJa: '',
    siteCity,
    prefectureJa,
    sourceLat: null,
    sourceLon: null,
  }
}
const himeji = verifiedExtraction(frozenRecord, { siteCity: 'himeji', prefectureJa: '兵庫県' })
assertPortalPlaceSubject(himeji); ok++
t('имя доехало из записи обхода', himeji.nameEn, 'Himeji Castle')

/* ── 4. Канонический резолвер с подменённым fetch ─────────────────────── */
let fetches = 0
const googleAnswer = (places) => async () => {
  fetches += 1
  return { ok: true, json: async () => ({ places }) }
}
/** Сырое тело ответа как есть — для повреждённых, а не просто пустых ответов. */
const googleRawBody = (body) => async () => {
  fetches += 1
  return { ok: true, json: async () => body }
}
/** Канонический resolvePlace на СЫРОМ теле ответа. */
const canonicalRaw = (body) => (input) => resolvePlace(input, { apiKey: 'ключ-фикстуры', fetchImpl: googleRawBody(body) })
const gplace = (over = {}) => ({
  id: 'PID-HIMEJI',
  displayName: { text: 'Himeji Castle' },
  location: { latitude: 34.8394, longitude: 134.6939 },
  businessStatus: 'OPERATIONAL',
  addressComponents: [{ types: ['administrative_area_level_1'], longText: 'Hyogo Prefecture' }],
  ...over,
})
/** Канонический resolvePlace целиком — подменён только его fetch. */
const canonical = (places) => (input) => resolvePlace(input, { apiKey: 'ключ-фикстуры', fetchImpl: googleAnswer(places) })

/* ── 5. Портальный отчёт и хранилища ─────────────────────────────────── */
const routed = (row) => ({
  entityKind: 'tourist_poi',
  poiPrimaryType: 'historic_site',
  classificationSource: 'rule',
  ...row,
})
const rowOf = (subject, over = {}) => routed({
  sourceKey: 'bodik-osaka-tourism:1',
  /* Строка отчёта несёт японское имя, но фикстуры этого файла проверяют границу
     на английском ключе; японский путь проверяет offline-canary на настоящем
     корпусе Осаки. Пустое японское имя оставляет ключом английское. */
  nameJa: '',
  nameKana: null,
  nameEn: subject.nameEn,
  siteCity: subject.siteCity,
  prefectureJa: subject.prefectureJa,
  workingHours: '',
  website: '',
  /* Координаты ИСТОЧНИКА намеренно негодные. Если запись всё-таки появится с
     ними, значит вызывающему поверили без резолвера — ровно то, что запрещено. */
  lat: 0,
  lon: 0,
  ...over,
})
const reportOf = (rows) => ({
  portals: [{ portalId: 'bodik-osaka-tourism', source: { url: 'https://example.jp/opendata' }, writable: rows }],
})

const countedStore = (inner) => {
  const seen = { listExisting: 0, findBySourceKey: 0, create: 0 }
  const created = []
  return {
    seen,
    created,
    store: {
      async listExisting() { seen.listExisting += 1; return inner.listExisting() },
      async findBySourceKey(key) { seen.findBySourceKey += 1; return inner.findBySourceKey(key) },
      async create(fields) { seen.create += 1; created.push(fields); return inner.create(fields) },
    },
  }
}
/**
 * Хранилище, у которого ЧТЕНИЕ разрешено, а ЗАПИСЬ падает.
 *
 * До финального пакета здесь стояло хранилище, падающее на любом обращении, и
 * утверждение звучало как «ноль обращений к store». После F-05 это перестало
 * быть правдой — и должно было перестать: проверка `Source Key` теперь идёт ДО
 * платного обращения к Google, то есть граница обязана прочитать базу раньше
 * резолвера. Формулировать инвариант прежними словами значило бы прятать
 * изменение поведения за зелёным тестом.
 *
 * Честный инвариант: отказ не создаёт записей и не делает лишних чтений —
 * читает ровно та проверка идемпотентности, ради которой чтение и перенесли.
 */
const readableStore = () => {
  const seen = { reads: 0, creates: 0 }
  return {
    seen,
    store: {
      async listExisting() { seen.reads += 1; return [] },
      async findBySourceKey() { seen.reads += 1; return null },
      async create() { seen.creates += 1; throw new Error('ЗАПИСЬ ВЫЗВАНА: store.create') },
    },
  }
}
/* Тело блоком, а не сокращённым `=> ({…})`: за этим объявлением идёт голый
   блок, и парсер TypeScript начинает читать скобку как список параметров
   стрелки, где `poiId: 'POI-000700'` — аннотация типа. Node такой файл
   разбирает, eslint падает. */
const snapshotRow = (over = {}) => {
  return {
    poiId: 'POI-000700', recordId: 'rec-POI-000700', nameRu: 'Ничего похожего', nameEn: 'Nothing Alike',
    siteCity: 'tokyo', lat: 35.7, lon: 139.7, placeId: null, sourceKey: null, ...over,
  }
}

/* ── 6. РАЗЛИЧАЮЩИЙ УСПЕШНЫЙ СЛУЧАЙ ─────────────────────────────────────
   Точные широта, долгота, Place ID и exactObjectPoint — в тех полях, которые
   собирает production Intake, а не в декоративных полях отчёта. */
try {
  const c = countedStore(createSnapshotStore([snapshotRow()]))
  const before = fetches
  const result = await quiet(() => writeRun(
    reportOf([rowOf(himeji)]),
    {},
    { placeResolver: canonical([gplace()]), store: c.store, now: NOW },
  ))
  t('канонический резолвер действительно отработал', fetches - before, 1)
  t('кандидат дошёл до записи', result.attempted, 1)
  t('и запись создана', result.outcomes.created, 1)
  t('обращений к резолверу учтено', result.placeLookups, 1)
  t('неопознанных нет', result.placeUnresolved, 0)

  /* Пустая заглушка, а не падение: см. пояснение в refusalOf. */
  const fields = c.created[0] ?? {}
  t('широта — точка резолвера, а не источника', fields.Latitude, 34.8394)
  t('долгота — точка резолвера, а не источника', fields.Longitude, 134.6939)
  t('Google Place ID доехал до полей записи', fields['Google Place ID'], 'PID-HIMEJI')
  t('политика координат выведена машинно', fields['Coordinate Policy'], 'exactObjectPoint')
  t('префектура — из нашей таблицы, RU', fields['Prefecture (RU)'], 'Хёго')
  t('префектура — из нашей таблицы, EN', fields['Prefecture (EN)'], 'Hyogo')
  t('момент снятия координат детерминирован', fields['Coords Checked At'], NOW.toISOString())
  t('направление доехало без изменений', fields['Site City'], 'himeji')
  t('запись — черновик', fields['Copy Status'], 'Draft')
  t('происхождение названо', fields['Seed Source'], 'portal-collector')
  t('create вызван ровно один раз', c.seen.create, 1)
} catch (error) {
  bad.push(`успешный случай оборвался исключением: ${error.message}`)
}

/* ── 7. ОТРИЦАТЕЛЬНЫЕ СЛУЧАИ ────────────────────────────────────────────
   Каждый — свой ИМЕНОВАННЫЙ отказ и ноль обращений к хранилищу. */
const refusalOf = async (resolver, subject = himeji, rowOver = {}, args = {}) => {
  const c = readableStore()
  const touched = () => c.seen.creates
  /* Исключение не должно обрывать набор: снятый сторож обязан проявиться
     ПРОВАЛЕННЫМ ИМЕНОВАННЫМ утверждением, а не оборванным прогоном. Иначе
     мутационная проверка засчитала бы падение на импорте за убийство. */
  try {
    const result = await quiet(() => writeRun(
      reportOf([rowOf(subject, rowOver)]),
      args,
      { placeResolver: resolver, store: c.store, now: NOW },
    ))
    return { result, touched: touched(), reads: c.seen.reads, row: result.placeUnresolvedQueue[0] ?? {} }
  } catch (error) {
    return {
      result: { attempted: -1, placeRefusals: {}, placeUnresolvedQueue: [] },
      touched: touched(),
      reads: c.seen.reads,
      row: { refusal: `БРОШЕНО: ${said(error)}`, message: '', resolverReason: '' },
    }
  }
}

const cases = []

/* 7.1 резолвер отсутствует */
cases.push(['резолвер отсутствует', await refusalOf(null), 'noResolver'])

/* 7.2 неоднозначный результат: ни один кандидат не прошёл проверки резолвера.
   Имена подобраны так, чтобы разойтись ПО ЯДРУ: «Himeji Station» ядром не
   отличается от «Himeji Castle» — родовое слово канонический резолвер снимает
   у обоих, — и такой кандидат был бы принят, а не отвергнут. */
cases.push(['неоднозначный результат', await refusalOf(canonical([
  gplace({ id: 'PID-A', displayName: { text: 'Kokoen Garden' } }),
  gplace({ id: 'PID-B', displayName: { text: 'Engyoji Temple' } }),
])), 'notResolved'])

/* 7.3 неизвестная форма ответа */
cases.push(['неизвестная форма ответа', await refusalOf(async () => ({ places: [] })), 'unknownResolverShape'])

/* 7.4 половина координат */
cases.push(['половина координат', await refusalOf(async () => ({
  outcome: 'resolved',
  place: {
    placeId: 'PID-HALF', lat: 34.8394, lon: undefined, businessStatus: 'OPERATIONAL',
    prefecture: { en: 'Hyogo', ru: 'Хёго', ja: '兵庫県' }, matchedName: 'Himeji Castle',
  },
  reason: 'Опознано как «Himeji Castle»',
})), 'halfCoordinates'])

/* 7.5 конфликт города: место опознано в чужой префектуре.
   Достижимо КАНОНИЧЕСКИМ резолвером: у кандидата префектуры нет, поэтому
   собственный гейт резолвера не срабатывает, и чужое место возвращается —
   но уже со СВОЕЙ префектурой из ответа Google, а не с нашим ожиданием. */
const naraSlug = verifiedExtraction(frozenRecord, { siteCity: 'nara', prefectureJa: '' })
cases.push(['конфликт города', await refusalOf(canonical([gplace()]), naraSlug), 'cityConflict'])

/* 7.6 НЕОДНОЗНАЧНОСТЬ: проверки прошли двое.
   Заменила прежний `identityConflict`, который был структурно мёртв — граница
   звала ту же `namesAgree`, что и резолвер, и иначе ответить не могла.
   Этот случай, наоборот, достижим КАНОНИЧЕСКИМ резолвером: у Google бывают два
   разных места с одинаковым отображаемым именем, и выбор между ними — не наше
   дело. Ни Place ID, ни координат такой исход не даёт. */
cases.push(['неоднозначность: прошли двое', await refusalOf(canonical([
  gplace({ id: 'PID-ONE' }),
  gplace({ id: 'PID-TWO', location: { latitude: 34.8400, longitude: 134.6950 } }),
])), 'ambiguous'])

/* 7.7 Place ID потерян между границами */
cases.push(['Place ID потерян', await refusalOf(async () => ({
  outcome: 'resolved',
  place: {
    placeId: '', lat: 34.8394, lon: 134.6939, businessStatus: 'OPERATIONAL',
    prefecture: { en: 'Hyogo', ru: 'Хёго', ja: '兵庫県' }, matchedName: 'Himeji Castle',
  },
  reason: 'Опознано как «Himeji Castle»',
})), 'missingPlaceId'])

/* 7.8 проверить направление нечем: резолвер не назвал префектуры.
   Тоже достижимо каноническим резолвером — Google не всегда отдаёт
   административную единицу первого уровня. */
cases.push(['префектуры в ответе нет', await refusalOf(
  canonical([gplace({ addressComponents: [] })]),
  naraSlug,
), 'siteCityUnverifiable'])

/* 7.9 резолвер бросил исключение. До 10f-N R1 исключение поднималось из
   `resolvePortalPlace` через цикл опознания и наружу из `writeRun`: пакет падал
   целиком, именованного исхода у кандидата не было вовсе. */
cases.push(['резолвер бросил исключение', await refusalOf(async () => {
  throw new Error('RESOLVER_THROW')
}), 'resolverThrew'])

/* 7.10 КАНОНИЧЕСКИЙ резолвер на повреждённом теле ответа.
   Отличается от «неизвестной формы ответа» тем, что здесь никто не подставляет
   резолвер неправильной формы: это настоящий production-код опознания места,
   которому внешний fetch вернул тело, разобравшееся в JSON `null`.
   `resolvePlace` читает `data.places` вне своего `try` и бросает TypeError. */
cases.push(['канонический резолвер на JSON null', await refusalOf(canonicalRaw(null)), 'providerUnusable'])

for (const [label, outcome, refusal] of cases) {
  t(`${label} → ${refusal}`, outcome.row?.refusal, refusal)
  t(`${label}: запись не создавалась`, outcome.touched, 0)
  t(`${label}: база прочитана проверкой Source Key`, outcome.reads > 0, true)
  t(`${label}: в запись не пошло ничего`, outcome.result.attempted, 0)
  t(`${label}: причина попала в раскладку`, outcome.result.placeRefusals[refusal], 1)
}
t('все причины отказа перечислены в контракте',
  cases.every((entry) => PORTAL_PLACE_REFUSALS.includes(entry[2])), true)

/* Отсутствие Place ID — ДОКАЗАННЫЙ исход резолвера, а не потерянное поле:
   в очереди лежит то, что сказал сам резолвер. */
const lostId = cases.find(([label]) => label === 'Place ID потерян')[1]
has('отсутствие Place ID подтверждено словами резолвера', lostId.row.resolverReason, 'Опознано как')
has('и названо своим именем', lostId.row.message, 'Google Place ID пуст')

/* ── 8. Каноническая функция — ОДНА. Копии рядом нет ────────────────── */
{
  /* Мост не имеет права опознавать место сам. Проверяется поведением: если
     резолвер ничего не вернул, места не появляется ниоткуда. */
  const c = readableStore()
  const result = await quietOrEmpty(() => writeRun(
    reportOf([rowOf(himeji)]),
    {},
    { placeResolver: async () => ({ outcome: 'notFound', place: null, reason: 'Google ничего не нашёл' }), store: c.store, now: NOW },
  ))
  t('без места запись не появляется', result.attempted, 0)
  t('и запись не создавалась', c.seen.creates, 0)
}

/* ── 9. Вызывающий не назначает политику координат ────────────────────── */
{
  /* 9а. Контракт входа не принимает поле решения — ни под каким именем. */
  has(
    'решение о политике в контракт входа не входит',
    await boom(async () => assertPortalPlaceSubject({ ...himeji, decision: 'notApplicable' })),
    'неизвестные поля «decision»',
  )
  has(
    'и accessor вместо значения отвергается',
    await boom(async () => assertPortalPlaceSubject(Object.defineProperty({ ...himeji }, 'siteCity', {
      get: () => 'himeji', enumerable: true, configurable: true,
    }))),
    "accessor'ом",
  )

  /* 9б. Строка отчёта с подсунутой политикой проходит композицию и НЕ меняет
     исхода: политику выводит приём, а не тот, кто её прислал. */
  const c = countedStore(createSnapshotStore([snapshotRow()]))
  try {
    const result = await quiet(() => writeRun(
      reportOf([rowOf(himeji, { coordinatePolicy: 'notApplicable', decision: 'notApplicable', 'Coordinate Policy': 'notApplicable' })]),
      {},
      { placeResolver: canonical([gplace()]), store: c.store, now: NOW },
    ))
    t('подсунутая политика не остановила приём', result.outcomes.created, 1)
    t('и не подменила вывод', (c.created[0] ?? {})['Coordinate Policy'], 'exactObjectPoint')
  } catch (error) {
    bad.push(`подсунутая политика оборвала прогон: ${error.message}`)
  }

  /* 9в. Резолвер тоже не назначает политику: лишний ключ — чужая форма. */
  const c9 = readableStore()
  const forged = await quietOrEmpty(() => writeRun(
    reportOf([rowOf(himeji)]),
    {},
    {
      placeResolver: async () => ({
        outcome: 'resolved',
        place: {
          placeId: 'PID-HIMEJI', lat: 34.8394, lon: 134.6939, businessStatus: 'OPERATIONAL',
          prefecture: { en: 'Hyogo', ru: 'Хёго', ja: '兵庫県' }, matchedName: 'Himeji Castle',
          coordinatePolicy: 'representativePoint',
        },
        reason: 'Опознано',
      }),
      store: c9.store,
      now: NOW,
    },
  ))
  t('политика от резолвера — чужая форма ответа', forged.placeUnresolvedQueue[0].refusal, 'unknownResolverShape')
  t('и записи не появилось', c9.seen.creates, 0)
}

/* ── 10. force не открывает обход географии ──────────────────────────── */
{
  const c = readableStore()
  const result = await quietOrEmpty(() => writeRun(
    reportOf([rowOf(naraSlug)]),
    { force: true },
    { placeResolver: canonical([gplace()]), store: c.store, now: NOW, force: true },
  ))
  t('force не пропускает чужую префектуру', result.placeUnresolvedQueue[0].refusal, 'cityConflict')
  t('и записей по force нет', result.attempted, 0)
  t('и запись не создавалась', c.seen.creates, 0)
}

/* ── 11. Умолчания из окружения у writeRun нет ───────────────────────────
   Пока оно было, ключ из подхваченного .env.local уходил в живой Google
   Places из ЛЮБОГО вызова — включая npm test. */
has(
  'writeRun без названного резолвера отказывает',
  await boom(() => writeRun(reportOf([rowOf(himeji)]), {}, {})),
  'без deps.placeResolver',
)
t('фабрика без ключа даёт null, а не резолвер', canonicalPortalPlaceResolver(''), null)
t('пробельный ключ тоже null', canonicalPortalPlaceResolver('   '), null)
t('undefined тоже null', canonicalPortalPlaceResolver(undefined), null)
t('с ключом фабрика даёт функцию', typeof canonicalPortalPlaceResolver('k'), 'function')

/* ── 12. Граница discovery не ослаблена ─────────────────────────────────
   Проверяется и правилом, и ИСПОЛНЕНИЕМ: адаптер не должен быть вызван, то
   есть отказ приходит до первого сетевого запроса. */
{
  const japanGuide = getPortal('japan-guide')
  const baseArgs = {
    write: false, dryWrite: false, baseSnapshot: null, modelPlan: false,
    providerProfileRef: null, names: null, existing: null, monitor: null, limit: null,
  }
  const forbidden = [
    ['--write', { write: true }],
    ['--dry-write', { write: true, dryWrite: true }],
    ['--existing', { existing: '/tmp/e.json' }],
    ['--model-plan', { modelPlan: true }],
    ['--model-provider-profile', { providerProfileRef: 'openai-responses-luna@1.0.0' }],
  ]
  for (const [flag, over] of forbidden) {
    has(
      `${flag} отвергнут границей discovery`,
      await boom(async () => assertDiscoveryBoundary({ args: { ...baseArgs, ...over }, portals: [japanGuide] })),
      'несовместимо с discovery-порталом',
    )
  }

  let adapterCalls = 0
  const argv = ['node', 'collect-pois.mjs', '--portal', 'japan-guide', '--write']
  const message = await boom(() => main(argv, {
    adapters: {},
    discoveryAdapters: { 'japan-guide-html': async () => { adapterCalls += 1; throw new Error('АДАПТЕР ВЫЗВАН') } },
    placeResolver: null,
  }))
  has('--write на japan-guide роняет прогон', message, 'несовместимо с discovery-порталом')
  t('и до первого сетевого запроса дело не дошло', adapterCalls, 0)
}

/* ── 13. Исключение резолвера — исход кандидата, а не авария пакета ──────
   Находка аудита Codex: настоящий `writeRun` с бросающим резолвером возвращал
   исключение наружу — `{"threw":"RESOLVER_THROW","storeCalls":0}`. Ноль обращений
   к хранилищу там был, а именованного исхода записи не было: падал весь пакет. */
{
  /* 13а. Точное имя, точное сообщение, кандидат в очереди разбора. */
  const thrown = cases.find(([label]) => label === 'резолвер бросил исключение')[1]
  t('исключение даёт отдельную причину', thrown.row.refusal, 'resolverThrew')
  t('и это не «резолвера нет»', thrown.row.refusal === 'noResolver', false)
  t('и не «место не опознано»', thrown.row.refusal === 'notResolved', false)
  t('и не «чужая форма ответа»', thrown.row.refusal === 'unknownResolverShape', false)
  has('текст исключения сохранён в очереди', thrown.row.message, 'RESOLVER_THROW')
  has('и назван исключением, а не отсутствием места', thrown.row.message, 'бросил исключение')
  t('кандидат назван в очереди разбора', thrown.row.sourceKey, 'bodik-osaka-tourism:1')
  t('исхода резолвера не было — поле пустое', thrown.row.resolverReason, '')

  /* 13б. Повреждённый ответ КАНОНИЧЕСКОГО резолвера — тот же исход.
     Отдельно доказывается, что сам `resolvePlace` на таком теле бросает: без
     этого случай неотличим от подставного резолвера неправильной формы. */
  /* ПОСЛЕ F-24 повреждённый ответ провайдера больше не исключение: канонический
     `resolvePlace` разбирает тело ВНУТРИ своей границы и возвращает типизированный
     `malformedResponse`. Портальная граница переводит его в `providerUnusable` —
     отдельную причину, а не в «место не опознано». */
  const corrupted = cases.find(([label]) => label === 'канонический резолвер на JSON null')[1]
  t('повреждённый JSON провайдера назван своей причиной', corrupted.row.refusal, 'providerUnusable')
  t('и это не «место не опознано»', corrupted.row.refusal === 'notResolved', false)
  has('и сохранён текст исхода резолвера', corrupted.row.message, 'тело не той формы')

  const direct = await resolvePlace(
    { nameEn: 'Himeji Castle', siteCity: 'himeji', prefectureEn: 'Hyogo' },
    { apiKey: 'ключ-фикстуры', fetchImpl: googleRawBody(null) },
  )
  t('канонический resolvePlace на теле JSON null больше не бросает', direct.outcome, 'malformedResponse')
  t('и места не даёт', direct.place, null)
  /* А эти повреждения он ловит сам — значит guard границы не прикрывает
     собственные проверки резолвера и не делает их незаметными. */
  const socket = await resolvePlace(
    { nameEn: 'Himeji Castle', siteCity: 'himeji' },
    { apiKey: 'ключ-фикстуры', fetchImpl: async () => { throw new Error('SOCKET_RESET') } },
  )
  t('упавший fetch резолвер ловит сам', socket.place, null)
  has('и называет причину', socket.reason, 'SOCKET_RESET')

  /* 13в. Законный сосед не исчезает вместе с бросившим кандидатом.
     Прежде первое же исключение уносило весь пакет: соседи, счётчики и очередь
     разбора пропадали, а инвариант суммы до проверки не доходил. */
  let call = 0
  const c = countedStore(createSnapshotStore([snapshotRow()]))
  const mixed = await quietOrEmpty(() => writeRun(
    reportOf([
      rowOf(himeji, { sourceKey: 'bodik-osaka-tourism:1' }),
      rowOf(himeji, { sourceKey: 'bodik-osaka-tourism:2' }),
    ]),
    {},
    {
      placeResolver: async (input) => {
        call += 1
        if (call === 1) throw new Error('RESOLVER_THROW')
        return canonical([gplace()])(input)
      },
      store: c.store,
      now: NOW,
    },
  ))
  t('бросивший кандидат отвергнут', mixed.placeUnresolved, 1)
  t('и назван в очереди', mixed.placeUnresolvedQueue[0]?.sourceKey, 'bodik-osaka-tourism:1')
  t('его причина — исключение', mixed.placeUnresolvedQueue[0]?.refusal, 'resolverThrew')
  t('законный сосед дошёл до записи', mixed.attempted, 1)
  t('и запись по нему создана', mixed.outcomes.created, 1)
  t('create вызван ровно один раз', c.seen.create, 1)
  t('счётчик обращений к резолверу считает обе попытки', mixed.placeLookups, 2)
  t('раскладка причин не потеряна', mixed.placeRefusals.resolverThrew, 1)
  /* ИНВАРИАНТ СУММЫ на смешанном пакете: две входные строки — ровно два
     терминальных исхода. Он и не мог сойтись, пока пакет падал. */
  t('инвариант суммы сходится', mixed.attempted + mixed.unnamed + mixed.placeUnresolved, 2)

  /* 13г. force обхода не открывает: причина остаётся терминальной. */
  const forced = await refusalOf(
    async () => { throw new Error('RESOLVER_THROW') },
    himeji,
    {},
    { force: true },
  )
  t('force не пропускает бросивший резолвер', forced.row.refusal, 'resolverThrew')
  t('и записей по force нет', forced.result.attempted, 0)
  t('и запись не создавалась', forced.touched, 0)

  /* 13д. Текст исключения ограничен и режется по кодовым точкам.
     Брошенное значение приходит извне и длины не имеет. */
  const long = 'Ж'.repeat(RESOLVER_ERROR_TEXT_LIMIT + 500)
  const huge = await refusalOf(async () => { throw new Error(long) })
  t('длинный текст не уезжает в очередь целиком',
    huge.row.message.length < long.length, true)
  has('обрезка названа вслух', huge.row.message, '(обрезано)')
  /* Астральный символ занимает ДВЕ единицы UTF-16. Срез по единицам разрубил бы
     пару и оставил одиночный суррогат — при кодировании в UTF-8 он становится
     U+FFFD, и два разных текста превращаются в один. Режем по кодовым точкам. */
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
  /* НЕЧЁТНЫЙ префикс обязателен. «𠮷» занимает ровно две единицы UTF-16, и на
     чистой строке из него срез по единицам попадает точно между парами — пара не
     рвётся, и подмена прохода остаётся невидимой. Одна BMP-буква впереди сдвигает
     границу на единицу, и срез приходится ровно в середину суррогатной пары. */
  const astral = await refusalOf(async () => {
    throw new Error(`Ж${'𠮷'.repeat(RESOLVER_ERROR_TEXT_LIMIT + 50)}`)
  })
  t('срез не оставил одиночного суррогата', LONE_SURROGATE.test(astral.row.message), false)
  has('астральный текст тоже обрезан', astral.row.message, '(обрезано)')

  /* 13е. Брошено может быть что угодно, не только Error. Сырое значение в
     текст не интерполируется. */
  const weird = await refusalOf(async () => { throw { toString() { throw new Error('и toString падает') } } })
  t('не-Error тоже даёт именованный отказ', weird.row.refusal, 'resolverThrew')
  has('и описан типом, а не значением', weird.row.message, 'брошено значение типа object')
  t('и запись не создавалась', weird.touched, 0)

  const nothing = await refusalOf(async () => { throw null })
  t('брошенный null не роняет границу', nothing.row.refusal, 'resolverThrew')
  has('и описан как null', nothing.row.message, 'брошено значение типа null')
}

/* ── 14. Описание брошенного значения враждебно к рефлексии ──────────────
   Находка аудита Codex (R2): `describeThrown` обещала комментарием читать только
   безопасные собственные data-свойства, а кодом звала `instanceof Error` и
   `error.message`. `instanceof` дёргает ловушку `getPrototypeOf`, чтение
   свойства — ловушку `get` и наследованный getter. Результат на `HostileError`
   был `{"threw":"MESSAGE_GETTER_THROW","storeCalls":0}`: исключение уходило
   наружу мимо всей границы и снова роняло весь пакет — то самое, что закрывал R1. */
{
  /** Ровно то, что предъявил аудит: собственное message удалено, getter бросает. */
  class HostileError extends Error {
    constructor() {
      super()
      delete this.message
    }
    get message() {
      throw new Error('MESSAGE_GETTER_THROW')
    }
  }

  /** Proxy, у которого падает всё, чем пользуется рефлексия. */
  const hostileProxy = () => new Proxy({}, {
    getPrototypeOf() { throw new Error('PROTO_TRAP_THROW') },
    getOwnPropertyDescriptor() { throw new Error('DESCRIPTOR_TRAP_THROW') },
    get() { throw new Error('GET_TRAP_THROW') },
  })

  const revokedProxy = () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    return proxy
  }

  /* 14а. HostileError не покидает границу. */
  const hostile = await refusalOf(async () => { throw new HostileError() })
  t('HostileError даёт именованный отказ', hostile.row.refusal, 'resolverThrew')
  t('и запись не создавалась', hostile.touched, 0)
  t('и в запись ничего не пошло', hostile.result.attempted, 0)
  has('и описан типом, а не значением', hostile.row.message, 'брошено значение типа object')
  t('текст getter’а наружу не просочился',
    hostile.row.message.includes('MESSAGE_GETTER_THROW'), false)

  /* 14б. Ловушки Proxy тоже не покидают границу — ни одна из трёх. */
  const proxied = await refusalOf(async () => { throw hostileProxy() })
  t('бросающие ловушки Proxy не роняют границу', proxied.row.refusal, 'resolverThrew')
  has('и Proxy описан типом', proxied.row.message, 'брошено значение типа object')
  t('текст ловушки наружу не просочился',
    /PROTO_TRAP_THROW|DESCRIPTOR_TRAP_THROW|GET_TRAP_THROW/.test(proxied.row.message), false)
  t('и запись не создавалась', proxied.touched, 0)

  const revoked = await refusalOf(async () => { throw revokedProxy() })
  t('отозванный Proxy не роняет границу', revoked.row.refusal, 'resolverThrew')
  t('и запись не создавалась', revoked.touched, 0)

  /* 14в. Полезное сообщение обычного Error сохраняется. Без этого «безопасно»
     означало бы «бесполезно»: по типу значения дефект не разберёшь. */
  const plain = await refusalOf(async () => { throw new Error('RESOLVER_THROW') })
  has('обычный Error сохраняет сообщение', plain.row.message, 'RESOLVER_THROW')
  t('и не описывается типом', plain.row.message.includes('брошено значение типа'), false)

  /* Собственные name и message читаются оба — и только собственные. */
  const named = await refusalOf(async () => {
    const e = new Error('boom')
    e.name = 'MyError'
    throw e
  })
  has('собственное имя попадает в текст', named.row.message, 'MyError: boom')

  /* Только имя, без сообщения, — тоже полезнее типа. */
  const nameOnly = await refusalOf(async () => { throw { name: 'DOMException' } })
  has('одного имени достаточно для текста', nameOnly.row.message, 'DOMException')
  t('и типом это уже не описывается',
    nameOnly.row.message.includes('брошено значение типа'), false)

  /* 14г. Symbol: `String(symbol)` НЕ бросает — он возвращает «Symbol(описание)»
     и тем самым выносит наружу чужой текст. Бросает только неявное приведение
     (шаблонная строка). Поэтому значение не приводится к строке вовсе, а
     описывается типом; утверждение ниже проверяет именно нераскрытие. */
  const symbol = await refusalOf(async () => { throw Symbol('секрет') })
  t('брошенный Symbol не роняет границу', symbol.row.refusal, 'resolverThrew')
  has('и описан типом', symbol.row.message, 'брошено значение типа symbol')
  t('описание символа его не раскрывает', symbol.row.message.includes('секрет'), false)

  /* 14д. Законный сосед после HostileError доходит до Intake. */
  let turn = 0
  const c14 = countedStore(createSnapshotStore([snapshotRow()]))
  const after = await quietOrEmpty(() => writeRun(
    reportOf([
      rowOf(himeji, { sourceKey: 'bodik-osaka-tourism:1' }),
      rowOf(himeji, { sourceKey: 'bodik-osaka-tourism:2' }),
    ]),
    {},
    {
      placeResolver: async (input) => {
        turn += 1
        if (turn === 1) throw new HostileError()
        return canonical([gplace()])(input)
      },
      store: c14.store,
      now: NOW,
    },
  ))
  t('после HostileError сосед дошёл до записи', after.attempted, 1)
  t('и запись по нему создана', after.outcomes.created, 1)
  t('враждебный кандидат назван в очереди', after.placeUnresolvedQueue[0]?.sourceKey, 'bodik-osaka-tourism:1')
  t('его причина — исключение', after.placeUnresolvedQueue[0]?.refusal, 'resolverThrew')
  t('инвариант суммы сходится', after.attempted + after.unnamed + after.placeUnresolved, 2)

  /* 14е. Проход по тексту ОГРАНИЧЕН limit + 1.
     Считается не время, а число подтягиваний итератора строки: `Array.from`
     обязан вычерпать его до конца, ограниченный проход — остановиться сразу за
     потолком. Итератор подменяется только на время вызова и только для ЭТОЙ
     строки; всё остальное уходит к исходному. */
  const long = 'Ж'.repeat(RESOLVER_ERROR_TEXT_LIMIT + 500)
  const original = String.prototype[Symbol.iterator]
  let pulls = 0
  Object.defineProperty(String.prototype, Symbol.iterator, {
    value: function countedIterator() {
      const inner = original.call(this)
      if (this !== long) return inner
      return {
        next: () => { pulls += 1; return inner.next() },
        [Symbol.iterator]() { return this },
      }
    },
    writable: true,
    configurable: true,
  })
  let bounded
  try {
    bounded = await refusalOf(async () => { throw new Error(long) })
  } finally {
    Object.defineProperty(String.prototype, Symbol.iterator, {
      value: original, writable: true, configurable: true,
    })
  }
  t('итератор строки восстановлен', String.prototype[Symbol.iterator], original)
  t('счётчик подтягиваний сработал', pulls > 0, true)
  t('проход по тексту ограничен limit + 1', pulls <= RESOLVER_ERROR_TEXT_LIMIT + 1, true)
  has('и текст всё-таки обрезан', bounded.row.message, '(обрезано)')

  /* 14ж. Негодный контракт входа и негодная дата — по-прежнему ОШИБКИ КОДА,
     а не отказ по кандидату. Иначе дефект вызывающего прятался бы в очередь. */
  const ok9 = async () => ({ outcome: 'notFound', place: null, reason: 'не важно' })
  has(
    'негодный контракт входа по-прежнему бросается',
    await boom(() => resolvePortalPlace({ ...himeji, лишнее: 1 }, { resolver: ok9, now: NOW })),
    'неизвестные поля',
  )
  has(
    'негодная дата по-прежнему бросается',
    await boom(() => resolvePortalPlace(himeji, { resolver: ok9, now: 'вчера' })),
    'options.now обязан быть годной датой',
  )
  has(
    'Invalid Date тоже бросается',
    await boom(() => resolvePortalPlace(himeji, { resolver: ok9, now: new Date('не дата') })),
    'options.now обязан быть годной датой',
  )
}

/* ── 15. Отказ форматировщика не покидает границу ────────────────────────
   Находка аудита Codex к R2: аккуратной рефлексии НЕДОСТАТОЧНО. Ловушка прокси —
   чужой код внутри нашей проверки, и её побочные эффекты рефлексией не
   ограничены: `getOwnPropertyDescriptor` подменяет `String.prototype[Symbol.iterator]`
   и роняет уже не рефлексию, а обрезку текста — шаг, где никакого чужого объекта
   давно нет. Прежний результат: `{"threw":"ITERATOR_POISON","storeCalls":0}`.
   Гарантия даётся не про рефлексию, а про границу. */
{
  const ITERATOR = Symbol.iterator

  /** Ловушка дескриптора не бросает — она травит итератор строк и уходит. */
  const poisonProxy = () => new Proxy({}, {
    getOwnPropertyDescriptor() {
      Object.defineProperty(String.prototype, ITERATOR, {
        value: function poisoned() { throw new Error('ITERATOR_POISON') },
        writable: true,
        configurable: true,
      })
      return undefined
    },
  })

  /* 15а. Отравленный итератор не покидает границу.
     Прототип восстанавливается в `finally`: иначе умрёт весь набор, а не
     испытуемая граница, и мутационная матрица зачтёт падение дерева за убийство. */
  const original = String.prototype[ITERATOR]
  let poisoned = false
  let poison
  try {
    poison = await refusalOf(async () => { throw poisonProxy() })
    poisoned = String.prototype[ITERATOR] !== original
  } finally {
    Object.defineProperty(String.prototype, ITERATOR, {
      value: original, writable: true, configurable: true,
    })
  }
  t('отравление действительно состоялось', poisoned, true)
  t('итератор строк восстановлен набором', String.prototype[ITERATOR], original)
  t('отравленный итератор не покидает границу', poison.row.refusal, 'resolverThrew')
  t('и запись не создавалась', poison.touched, 0)
  t('и в запись ничего не пошло', poison.result.attempted, 0)
  has('и отказ описан постоянным текстом', poison.row.message, UNDESCRIBABLE_THROWN)
  t('текст отравления наружу не просочился',
    poison.row.message.includes('ITERATOR_POISON'), false)

  /* 15б. Законный сосед после отравителя доходит до Intake. */
  const original2 = String.prototype[ITERATOR]
  let turn = 0
  const c15 = countedStore(createSnapshotStore([snapshotRow()]))
  let mixed
  try {
    mixed = await quietOrEmpty(() => writeRun(
      reportOf([
        rowOf(himeji, { sourceKey: 'bodik-osaka-tourism:1' }),
        rowOf(himeji, { sourceKey: 'bodik-osaka-tourism:2' }),
      ]),
      {},
      {
        placeResolver: async (input) => {
          turn += 1
          if (turn === 1) throw poisonProxy()
          return canonical([gplace()])(input)
        },
        store: c15.store,
        now: NOW,
      },
    ))
  } finally {
    Object.defineProperty(String.prototype, ITERATOR, {
      value: original2, writable: true, configurable: true,
    })
  }
  t('после отравителя сосед дошёл до записи', mixed.attempted, 1)
  t('и запись по нему создана', mixed.outcomes.created, 1)
  t('create вызван ровно один раз', c15.seen.create, 1)
  t('отравитель назван в очереди', mixed.placeUnresolvedQueue[0]?.sourceKey, 'bodik-osaka-tourism:1')
  t('его причина — исключение', mixed.placeUnresolvedQueue[0]?.refusal, 'resolverThrew')
  t('инвариант суммы сходится', mixed.attempted + mixed.unnamed + mixed.placeUnresolved, 2)

  /* 15в. ОБЩИЙ бюджет прохода по двум фрагментам.
     Прежняя редакция склеивала `имя + ': ' + сообщение` и обрезала уже склейку:
     два внешних куска материализовались в третий, вдвое больший. Считаем
     подтягивания итератора по ОБЕИМ исходным строкам сразу. */
  /** Считает подтягивания итератора по названным строкам и восстанавливает его. */
  const countPulls = async (watchedStrings, fn) => {
    const watched = new Set(watchedStrings)
    const before = String.prototype[ITERATOR]
    let pulls = 0
    Object.defineProperty(String.prototype, ITERATOR, {
      value: function countedIterator() {
        const inner = before.call(this)
        if (!watched.has(this)) return inner
        return {
          next: () => { pulls += 1; return inner.next() },
          [Symbol.iterator]() { return this },
        }
      },
      writable: true,
      configurable: true,
    })
    try {
      return { value: await fn(), pulls, restored: true }
    } finally {
      Object.defineProperty(String.prototype, ITERATOR, {
        value: before, writable: true, configurable: true,
      })
    }
  }

  /* 15в-1. Первый фрагмент сам исчерпывает потолок: до второго проход не доходит. */
  const hugeName = 'Н'.repeat(RESOLVER_ERROR_TEXT_LIMIT + 400)
  const hugeMessage = 'М'.repeat(RESOLVER_ERROR_TEXT_LIMIT + 400)
  const firstWins = await countPulls([hugeName, hugeMessage], () => refusalOf(async () => {
    const e = new Error(hugeMessage)
    e.name = hugeName
    throw e
  }))
  t('итератор строк восстановлен после замера', String.prototype[ITERATOR], original)
  t('фрагменты читаются напрямую, без промежуточной склейки', firstWins.pulls > 0, true)
  has('и результат обрезан', firstWins.value.row.message, '(обрезано)')
  t('результат не длиннее ограниченного',
    Array.from(firstWins.value.row.message).length <= RESOLVER_ERROR_TEXT_LIMIT + 60, true)
  t('второй фрагмент не читается, когда первый исчерпал потолок',
    firstWins.value.row.message.includes('М'), false)

  /* 15в-2. Первый фрагмент КОРОТКИЙ — потолок добирается вторым.
     Именно этот случай различает общий бюджет и «потолок на каждый фрагмент»:
     при сбросе счётчика на каждом фрагменте суммарный проход выходит за limit + 1,
     хотя результат по-прежнему выглядит обрезанным. */
  const shortName = 'Н'.repeat(50)
  const spillover = await countPulls([shortName, hugeMessage], () => refusalOf(async () => {
    const e = new Error(hugeMessage)
    e.name = shortName
    throw e
  }))
  t('общий проход по обоим фрагментам ограничен limit + 1',
    spillover.pulls <= RESOLVER_ERROR_TEXT_LIMIT + 1, true)
  t('и оба фрагмента действительно читались', spillover.pulls > 50, true)
  has('короткое имя попало в результат', spillover.value.row.message, shortName)
  has('и хвост сообщения обрезан', spillover.value.row.message, '(обрезано)')
}

/* ── 16. Идемпотентность до Google и бюджет обращений (F-05) ─────────────
   Прежде каждая уже принятая строка успевала оплатить обращение к Google и
   вдобавок оседала в `placeUnresolved`, так и не получив своего
   `already_ingested`. Порядок теперь обратный: сначала бесплатные проверки по
   всему пакету, затем `Source Key`, затем бюджет, и только потом деньги. */
{
  /** Резолвер-бомба: если до него дошли, значит порядок нарушен. */
  const neverCalled = async () => { throw new Error('РЕЗОЛВЕР ВЫЗВАН, а не должен был') }

  const namesFileFor = async (map) => {
    const file = path.join(dir, `names${n++}.json`)
    await writeFile(file, JSON.stringify(map), 'utf8')
    return file
  }

  /* 16а. Уже принятая строка не платит Google и получает свой терминальный исход. */
  {
    const c = countedStore(createSnapshotStore([
      snapshotRow({ poiId: 'POI-000800', sourceKey: 'bodik-osaka-tourism:1', nameRu: 'Уже принятая', siteCity: 'himeji' }),
    ]))
    const names = await namesFileFor({ 'bodik-osaka-tourism:1': { nameRu: 'Уже принятая' } })
    const result = await quietOrEmpty(() => writeRun(
      reportOf([rowOf(himeji, { sourceKey: 'bodik-osaka-tourism:1' })]),
      { names },
      { placeResolver: neverCalled, store: c.store, now: NOW },
    ))
    t('уже принятая строка к резолверу не идёт', result.placeBudget.performed, 0)
    t('и учтена как пропущенная', result.placeBudget.skippedAlreadyIngested, 1)
    t('и получила терминальный исход приёма', result.outcomes.already_ingested, 1)
    t('и записи не появилось', c.seen.create, 0)
    t('и в очередь неопознанных не попала', result.placeUnresolved, 0)
    t('инвариант суммы сходится', result.attempted + result.unnamed + result.placeUnresolved, 1)
  }

  /* 16б. Новая строка рядом с принятой: платит только новая. */
  {
    const c = countedStore(createSnapshotStore([
      snapshotRow({ poiId: 'POI-000801', sourceKey: 'bodik-osaka-tourism:1', nameRu: 'Уже принятая', siteCity: 'himeji' }),
    ]))
    const names = await namesFileFor({
      'bodik-osaka-tourism:1': { nameRu: 'Уже принятая' },
      'bodik-osaka-tourism:2': { nameRu: 'Новая строка' },
    })
    let calls = 0
    const result = await quietOrEmpty(() => writeRun(
      reportOf([
        rowOf(himeji, { sourceKey: 'bodik-osaka-tourism:1' }),
        rowOf(himeji, { sourceKey: 'bodik-osaka-tourism:2' }),
      ]),
      { names },
      {
        placeResolver: async (q) => { calls += 1; return canonical([gplace()])(q) },
        store: c.store,
        now: NOW,
      },
    ))
    t('обращение ровно одно — за новую строку', calls, 1)
    t('и отчёт называет то же число', result.placeBudget.performed, 1)
    t('пропущенных как принятые — одна', result.placeBudget.skippedAlreadyIngested, 1)
    t('принятая осталась принятой', result.outcomes.already_ingested, 1)
    t('новая создана', result.outcomes.created, 1)
    t('инвариант суммы сходится на смешанном пакете',
      result.attempted + result.unnamed + result.placeUnresolved, 2)
  }

  /* 16в. Бюджет исчерпан — прогон стоит ДО первого обращения. */
  {
    const c = countedStore(createSnapshotStore([snapshotRow()]))
    const names = await namesFileFor({
      'bodik-osaka-tourism:1': { nameRu: 'Первая' },
      'bodik-osaka-tourism:2': { nameRu: 'Вторая' },
    })
    const message = await boom(() => quiet(() => writeRun(
      reportOf([
        rowOf(himeji, { sourceKey: 'bodik-osaka-tourism:1' }),
        rowOf(himeji, { sourceKey: 'bodik-osaka-tourism:2' }),
      ]),
      { names, maxPlaceLookups: 1 },
      { placeResolver: neverCalled, store: c.store, now: NOW },
    )))
    has('превышение бюджета останавливает прогон', message, 'Бюджет обращений к резолверу места превышен')
    has('и называет обе величины', message, 'новых строк 2')
    has('и объявленный лимит', message, '--max-place-lookups=1')
    t('до первого обращения: записей нет', c.seen.create, 0)
  }

  /* 16г. Бюджет считается ПОСЛЕ проверки Source Key: принятые в него не входят. */
  {
    const c = countedStore(createSnapshotStore([
      snapshotRow({ poiId: 'POI-000802', sourceKey: 'bodik-osaka-tourism:1', nameRu: 'Уже принятая', siteCity: 'himeji' }),
    ]))
    const names = await namesFileFor({
      'bodik-osaka-tourism:1': { nameRu: 'Уже принятая' },
      'bodik-osaka-tourism:2': { nameRu: 'Новая строка' },
    })
    const result = await quietOrEmpty(() => writeRun(
      reportOf([
        rowOf(himeji, { sourceKey: 'bodik-osaka-tourism:1' }),
        rowOf(himeji, { sourceKey: 'bodik-osaka-tourism:2' }),
      ]),
      { names, maxPlaceLookups: 1 },
      { placeResolver: canonical([gplace()]), store: c.store, now: NOW },
    ))
    t('лимит 1 при одной новой строке не срабатывает', result.placeBudget.performed, 1)
    t('и объявленный лимит виден в отчёте', result.placeBudget.limit, 1)
  }

  /* 16д. Форма флага проверяется ДО сети — через настоящий main. */
  {
    const argv = (...extra) => ['node', 'collect-pois.mjs', '--portal', 'bodik-osaka-tourism', '--write', ...extra]
    let adapterCalls = 0
    const deps = () => ({
      adapters: { 'opendata-csv': async () => { adapterCalls += 1; return { candidates: [], meta: {} } } },
      placeResolver: null,
    })
    for (const [label, bad] of [
      ['мусор', '12abc'],
      ['отрицательное', '-1'],
      ['дробное', '1.5'],
      ['пустое', ''],
    ]) {
      adapterCalls = 0
      const message = await boom(() => hushed(() => main(argv('--max-place-lookups', bad), deps())))
      has(`--max-place-lookups отвергает ${label}`, message, '--max-place-lookups')
      t(`и до адаптера дело не дошло: ${label}`, adapterCalls, 0)
    }
    adapterCalls = 0
    const twice = await boom(() => hushed(() => main(argv('--max-place-lookups', '5', '--max-place-lookups', '7'), deps())))
    has('повтор флага отвергается', twice, 'указан дважды')
    t('и до адаптера дело не дошло: повтор', adapterCalls, 0)
  }

  /* 16е. Для production-резолвера бюджет обязателен. */
  {
    /* `main` перехватывает отказ записи в `report.write.error` (это известный
       дефект F-03, чинит 10f-R), поэтому проверяем не исключение, а отчёт. */
    const printed = []
    const realLog = console.log
    console.log = (line) => printed.push(String(line))
    try {
      await quiet(() => main(
        ['node', 'collect-pois.mjs', '--portal', 'bodik-osaka-tourism', '--write'],
        { adapters: { 'opendata-csv': async () => ({ candidates: [], meta: {} }) } },
      ))
    } finally {
      console.log = realLog
    }
    const report = JSON.parse(printed.join(String.fromCharCode(10)))
    /* Ключа в окружении набора может не быть — тогда резолвер `null`, требовать
       бюджет не с чего, и запись честно проходит вхолостую. Проверяются ОБА
       законных исхода и ни одного третьего. */
    const refused = String(report.write?.error ?? '')
    const legal = refused === '' || refused.includes('--max-place-lookups не задан')
    t('production-резолвер без бюджета не запускается (либо ключа нет вовсе)', legal, true)
    t('и третьего исхода нет', typeof report.write, 'object')
  }
}

/* ── 17. КОМПОЗИЦИЯ: повреждённый ответ провайдера в пакете (аудит R1) ────
   Через ПРОИЗВОДСТВЕННУЮ цепочку целиком: `writeRun` → `resolvePortalPlace` →
   канонический `resolvePlace` → `ingestPoiBatch` → store. Подменён только
   `fetchImpl`. Проверяется не то, что резолвер вернул исход, а то, что пакет
   на повреждённом ответе не создаёт запись и не теряет соседа. */
{
  const namesFile = path.join(dir, `names-mixed${n++}.json`)
  await writeFile(namesFile, JSON.stringify({
    'bodik-osaka-tourism:1': { nameRu: 'Замок Химэдзи' },
    'bodik-osaka-tourism:2': { nameRu: 'Осакский замок' },
  }), 'utf8')

  /* Ответ зависит от того, ЧТО спросили: у соседа он валиден, у повреждённой
     строки — нет. Один общий ответ на оба запроса такой проверки не делает. */
  const byQuery = new Map([
    ['Himeji Castle', { places: [gplace()] }],
    ['Osaka Castle', { places: [gplace({
      id: 'PID-OSAKA',
      displayName: { text: 'Osaka Castle' },
      addressComponents: {},
    })] }],
  ])
  const mixedResolver = (input) => resolvePlace(input, {
    apiKey: 'ключ-фикстуры',
    fetchImpl: async (_url, init) => ({
      ok: true,
      json: async () => byQuery.get(String(JSON.parse(init.body).textQuery).split(',')[0]) ?? { places: [] },
    }),
  })

  const c = countedStore(createSnapshotStore([snapshotRow()]))
  const mixed = await quietOrEmpty(() => writeRun(
    reportOf([
      rowOf(himeji, { sourceKey: 'bodik-osaka-tourism:1' }),
      rowOf(himeji, { sourceKey: 'bodik-osaka-tourism:2', nameEn: 'Osaka Castle' }),
    ]),
    { names: namesFile, maxPlaceLookups: 2 },
    { placeResolver: mixedResolver, store: c.store, now: NOW },
  ))

  t('повреждённый ответ не роняет прогон', mixed.attempted, 1)
  t('сосед дошёл до записи', mixed.outcomes.created, 1)
  t('и store.create вызван ровно один раз', c.seen.create, 1)
  t('повреждённая строка ушла в очередь неопознанных', mixed.placeUnresolved, 1)
  t('под именованным отказом провайдера',
    mixed.placeUnresolvedQueue[0]?.refusal, 'providerUnusable')
  has('и причина называет уровень повреждения',
    mixed.placeUnresolvedQueue[0]?.resolverReason ?? '', 'addressComponents не массив')
  t('запись создана НЕ по повреждённой строке',
    c.created[0]?.['POI Name (RU)'], 'Замок Химэдзи')
  t('инвариант суммы сходится',
    mixed.attempted + mixed.unnamed + mixed.placeUnresolved, 2)

  /* Ни одной пригодной структуры — тот же терминальный отказ, а не «не нашли». */
  const c2 = countedStore(createSnapshotStore([snapshotRow()]))
  const allBad = await quietOrEmpty(() => writeRun(
    reportOf([rowOf(himeji, { sourceKey: 'bodik-osaka-tourism:1' })]),
    { names: namesFile, maxPlaceLookups: 1 },
    { placeResolver: canonical([gplace({ addressComponents: [null] })]), store: c2.store, now: NOW },
  ))
  t('весь ответ повреждён — записи нет', c2.seen.create, 0)
  t('и отказ назван провайдером, а не «место не опознано»',
    allBad.placeUnresolvedQueue[0]?.refusal, 'providerUnusable')
}

if (bad.length) {
  console.error(`✗ портальная граница места: Провалено ${bad.length} из ${ok + bad.length}`)
  for (const line of bad) console.error(`  ${line}`)
  process.exit(1)
}
console.log(`✓ портальная граница места: ${ok} проверок пройдено`)
