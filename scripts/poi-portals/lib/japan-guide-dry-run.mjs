/**
 * JA-6: СКВОЗНОЙ СУХОЙ ПРОГОН JAPAN GUIDE → INTAKE — `poi-japan-guide-dry-run/v1`.
 *
 * Настоящий путь целиком, на ПОДПИСАННЫХ входах и без единого эффекта:
 * очереди JG-1 → наблюдения JA-3 → опознание JA-4 → кандидат приёма → общая
 * оценка, дедуп внутри партии и сверка с базой → манифест прогона и pre-write
 * gate. Airtable 0, Google 0, модель 0, сеть 0.
 *
 * ПОЧЕМУ ЭТО НЕ «ЕЩЁ ОДИН ПАЙПЛАЙН». Ни оценка, ни дедуп, ни сверка, ни
 * манифест здесь не переписаны: вызываются те самые функции, которыми
 * пользуется живой коллектор. Сухой прогон, идущий своим путём, доказывал бы
 * исправность своего пути, а не production'ного, — и разошёлся бы с ним ровно
 * там, где это дороже всего.
 *
 * ЧТО ЗДЕСЬ ЕСТЬ СВОЕГО. Только сборка кандидата из УЖЕ ДОБЫТЫХ наблюдений:
 * какое поле берётся из какого отчёта и с каким провенансом. Это и есть
 * предмет JA-6 — показать, что путь сходится, и назвать, где он упирается.
 *
 * ПРОВЕНАНС ОБЯЗАТЕЛЕН. Ни одно поле кандидата не появляется без источника:
 * английское имя — из снимка обхода, японское имя и адрес — из фактов
 * официального сайта (JA-3), координаты и `place_id` — из опознания (JA-4).
 * Поле без названного источника здесь не собирается вовсе: `provenance`
 * покрывает каждое непустое значение, и это проверяется.
 */
import { canonicalJsonBytes } from '../../lib/canonical-contract.mjs'
import { sha256Bytes } from '../../lib/byte-digest.mjs'
import { assertReportDigest } from './enrichment.mjs'
import { dedupeWithinBatch, matchAgainstExisting, MATCHER_POLICY_VERSION, matcherPolicyDigest } from './dedupe.mjs'
import { existingFromExport, JAPAN_GUIDE_QUEUES_SPEC } from './japan-guide-queues.mjs'
import { TERMINAL } from './classification-contract.mjs'
import { parseVerifiedAirtableExport } from './discovery-airtable-match.mjs'
import { ENRICHMENT_SPEC } from './enrichment.mjs'
import { PLACE_IDENTIFICATION_SPEC } from './place-identification.mjs'
import { prepareIntakeRequest } from './japan-guide-record.mjs'

export const DRY_RUN_SPEC = 'poi-japan-guide-dry-run/v1'

/**
 * Терминальные исходы строки. Закрыты; сумма по ним равна числу строк очереди
 * `candidate` отчёта JG-1 — это и есть закон сохранения сухого прогона.
 */
export const DRY_RUN_OUTCOMES = Object.freeze([
  'writable',        // подготовленный запрос: приём завёл бы черновик
  'qualityRejected', // общая оценка отвергла (нет имени, координат и т. п.)
  'intakeIncomplete',// обязательных данных записи нет — запрос не собирается
  'duplicateInBatch',// дубль другой строки той же партии
  'matchesExisting', // сверка с базой указывает на существующую запись
  'needsOwner',      // ждёт решения человека (JA-5)
  'notEnriched',     // бесплатное обогащение до строки не дошло либо ничего не дало
])
/** Источники полей кандидата. Закрыты: поле без источника не собирается. */
export const FIELD_SOURCES = Object.freeze(['discovery', 'officialSite', 'placeLookup', 'ownerNames'])

const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0

/**
 * КАНДИДАТ ПРИЁМА ИЗ НАБЛЮДЕНИЙ.
 *
 * Собирается только из фактов ОДНОГО места (JG2-03) и только из полей
 * закрытого списка. Каждое непустое значение получает запись в `provenance`:
 * какое поле, откуда, каким наблюдением.
 */
export function candidateFromObservations({ row, enriched, identified, portal, namesLoaded = null }) {
  const provenance = []
  const take = (field, value, source, detail) => {
    if (!nonEmpty(value)) return null
    if (!FIELD_SOURCES.includes(source)) throw new Error(`${DRY_RUN_SPEC}: источник «${source}» вне закрытого списка`)
    provenance.push({ field, source, detail })
    return value.trim()
  }
  const places = [...new Set((enriched?.facts ?? []).map((fact) => fact.place ?? 0))]
  const only = places.length === 1 ? places[0] : null
  const factOf = (field) => (only === null
    ? null
    : (enriched.facts.find((fact) => fact.field === field && (fact.place ?? 0) === only)?.value ?? null))
  const factUrl = enriched?.hint ?? null

  const nameJa = take('nameJa', factOf('nameJa'), 'officialSite', factUrl)
  const nameKana = take('nameKana', factOf('nameKana'), 'officialSite', factUrl)
  const address = take('address', factOf('address'), 'officialSite', factUrl)
  /* ── ИМЯ И НАПРАВЛЕНИЕ — ИЗ ПРОВЕРЕННОГО ФАЙЛА ВЛАДЕЛЬЦА ────────────────
     Тот же файл, что у портального пути (`names-file.mjs`), и тот же порядок
     старшинства: выбранное человеком имя главнее всего. Машинной
     транслитерации здесь нет вовсе — Japan Guide не даёт ни каны, ни
     японского имени в выгрузке, а переводить «Golden Pavilion» в «Голден
     Павильон» значит записать не то имя. Нет имени в файле — строка ждёт
     владельца, и это её именованный исход, а не пустое поле в записи. */
  const owner = namesLoaded?.names?.[row.sourceKey] ?? {}
  const ownerDetail = namesLoaded?.identity?.digest ?? null
  const nameRu = take('nameRu', owner.nameRu, 'ownerNames', ownerDetail)
  const siteCity = take('siteCity', owner.siteCity, 'ownerNames', ownerDetail)
  const nameEn = nonEmpty(owner.nameEn)
    ? take('nameEn', owner.nameEn, 'ownerNames', ownerDetail)
    : take('nameEn', row.nameEn, 'discovery', row.url)

  /* КООРДИНАТЫ — ТОЛЬКО ПАРОЙ И ТОЛЬКО ИЗ ОДНОГО ИСТОЧНИКА. Смешать широту
     опознания с долготой сайта значило бы снова собрать точку, которой нигде
     нет. Опознание старше: у него есть `place_id`, которым точку можно
     перепроверить. */
  let lat = null
  let lon = null
  if (identified?.place?.placeId) {
    /* Идентификатор места — отдельное поле и отдельный источник: он остаётся,
       даже если координаты пришлось бы взять иначе. */
    provenance.push({ field: 'placeId', source: 'placeLookup', detail: identified.place.placeId })
  }
  if (identified?.place?.coordinates) {
    lat = identified.place.coordinates.lat
    lon = identified.place.coordinates.lon
    provenance.push({ field: 'coordinates', source: 'placeLookup', detail: identified.place.placeId })
  } else {
    const latText = factOf('lat')
    const lonText = factOf('lon')
    const latNum = typeof latText === 'string' ? Number(latText) : Number.NaN
    const lonNum = typeof lonText === 'string' ? Number(lonText) : Number.NaN
    if (Number.isFinite(latNum) && Number.isFinite(lonNum)) {
      lat = latNum
      lon = lonNum
      provenance.push({ field: 'coordinates', source: 'officialSite', detail: factUrl })
    }
  }

  return {
    candidate: {
      sourceKey: row.sourceKey,
      sourceUrl: row.url,
      seedSource: portal.id,
      licence: portal.licence ?? null,
      nameJa: nameJa ?? '',
      nameKana: nameKana ?? '',
      nameEn: nameEn ?? '',
      nameRu: nameRu ?? '',
      address: address ?? null,
      prefectureJa: null,
      cityJa: null,
      siteCity: siteCity ?? null,
      lat,
      lon,
      descriptionJa: '',
      descriptionEn: '',
      placeId: identified?.place?.placeId ?? null,
    },
    provenance,
    placeNodes: places.length,
  }
}

/**
 * СВЕДЕНИЕ ВХОДОВ. Каждый отчёт проверяется отпечатком, и связь отчётов друг с
 * другом — тоже: обогащение обязано быть собрано по этим очередям, опознание —
 * по этому обогащению. Иначе сухой прогон свёл бы вместе куски разных прогонов
 * и предъявил бы результат, которого не было ни в одном.
 */
export function assertDryRunInputs({ queues, enrichment, identification }) {
  assertReportDigest(queues, JAPAN_GUIDE_QUEUES_SPEC, 'queues')
  assertReportDigest(enrichment, ENRICHMENT_SPEC, 'enrichment')
  if (enrichment.inputs?.queues?.digest && enrichment.inputs.queues.digest !== queues.reportDigest) {
    throw new Error(`${DRY_RUN_SPEC}: обогащение собрано по очередям ${enrichment.inputs.queues.digest}, подан отчёт ${queues.reportDigest}`)
  }
  const candidates = new Set((queues.queues?.candidate ?? []).map((row) => row.sourceKey))
  if (!candidates.size) throw new Error(`${DRY_RUN_SPEC}: в отчёте JG-1 нет очереди candidate — вести к приёму нечего`)
  const foreign = enrichment.rows.filter((row) => !candidates.has(row.sourceKey)).map((row) => row.sourceKey)
  if (foreign.length) {
    throw new Error(`${DRY_RUN_SPEC}: ${foreign.length} строк обогащения не принадлежат очереди candidate (первая: ${foreign[0]})`)
  }
  if (identification !== null) {
    assertReportDigest(identification, PLACE_IDENTIFICATION_SPEC, 'identification')
    if (identification.inputs?.enrichment?.digest && identification.inputs.enrichment.digest !== enrichment.reportDigest) {
      throw new Error(`${DRY_RUN_SPEC}: опознание собрано по обогащению ${identification.inputs.enrichment.digest}, подан отчёт ${enrichment.reportDigest}`)
    }
    const enrichedKeys = new Set(enrichment.rows.map((row) => row.sourceKey))
    const strayIdentified = identification.rows.filter((row) => !enrichedKeys.has(row.sourceKey)).map((row) => row.sourceKey)
    if (strayIdentified.length) {
      throw new Error(`${DRY_RUN_SPEC}: ${strayIdentified.length} строк опознания не принадлежат обогащению (первая: ${strayIdentified[0]})`)
    }
  }
  return { candidates }
}

/**
 * СУХОЙ ПРОГОН.
 *
 * `evaluate` — общая оценка коллектора (`evaluatePortalCandidates`), передаётся
 * параметром: модуль не тянет коллектор с его сетью и адаптерами, но и своей
 * оценки не заводит. Порядок исходов — от того, что решается без базы, к тому,
 * что решается по базе: сначала качество, потом дубль внутри партии, потом
 * сверка с существующими записями.
 */
export function runDryRun({
  queues, enrichment, identification = null, exportBytes, portal, evaluate,
  assemble = candidateFromObservations, copyPlan = 'draftLater', namesLoaded = null, today,
}) {
  assertDryRunInputs({ queues, enrichment, identification })
  if (typeof evaluate !== 'function') throw new TypeError(`${DRY_RUN_SPEC}: нужна общая оценка кандидатов`)
  const { airtable, exportDigest } = parseVerifiedAirtableExport(exportBytes)
  const existing = existingFromExport(airtable)

  const enrichedByKey = new Map(enrichment.rows.map((row) => [row.sourceKey, row]))
  const identifiedByKey = new Map((identification?.rows ?? []).map((row) => [row.sourceKey, row]))
  const queue = queues.queues.candidate

  /* Кандидаты собираются для ВСЕХ строк очереди: строка, которую не удалось
     обогатить, не исчезает — она получает свой исход и остаётся в сумме. */
  const built = queue.map((row) => {
    const enriched = enrichedByKey.get(row.sourceKey) ?? null
    const identified = identifiedByKey.get(row.sourceKey) ?? null
    const assembled = assemble({ row, enriched, identified, portal, namesLoaded })
    return { row, enriched, identified, ...assembled }
  })
  /*
   * ПРОВЕНАНС ПРОВЕРЯЕТСЯ ЗДЕСЬ, А НЕ ПОДРАЗУМЕВАЕТСЯ В СБОРЩИКЕ. Сборщик
   * инъектируем — и именно поэтому граница не полагается на его дисциплину.
   *
   * ПРИСУТСТВИЕ ПОЛЯ СЧИТАЕТСЯ ПО ТИПУ, А НЕ ПО «НЕПУСТОЙ СТРОКЕ». Аудит JG-3
   * (находка 04) предъявил обход: проверка признавала заполненным только
   * непустую строку, и числовые координаты — 35 и 139 — проезжали мимо неё
   * вместе с отсутствующей отметкой источника. Координаты теперь проверяются
   * ОТДЕЛЬНО и независимо от значения: ноль, отрицательная широта и любая
   * другая законная координата обязаны иметь источник ровно так же.
   */
  const filled = (value) => (typeof value === 'number' ? Number.isFinite(value) : nonEmpty(value))
  const marked = (item, field) => item.provenance.some((mark) => mark.field === field)
  for (const item of built) {
    for (const [field, value] of Object.entries(item.candidate)) {
      if (['sourceKey', 'sourceUrl', 'seedSource', 'licence', 'lat', 'lon'].includes(field)) continue
      if (!filled(value)) continue
      if (!marked(item, field)) {
        throw new Error(`${DRY_RUN_SPEC}: ${item.row.sourceKey}: поле ${field} без названного источника`)
      }
    }
    /* Координаты — своя проверка: присутствие любой из половин требует
       отметки, а половина без пары не принимается вовсе. */
    const hasLat = filled(item.candidate.lat)
    const hasLon = filled(item.candidate.lon)
    if (hasLat !== hasLon) {
      throw new Error(`${DRY_RUN_SPEC}: ${item.row.sourceKey}: половина координатной пары — точкой это не является`)
    }
    if (hasLat && !marked(item, 'coordinates')) {
      throw new Error(`${DRY_RUN_SPEC}: ${item.row.sourceKey}: координаты без названного источника`)
    }
  }

  /*
   * ОПИСАНИЕ ПИШЕТСЯ ОТДЕЛЬНО — И ЭТО ОБЪЯВЛЕНО, А НЕ ПОДРАЗУМЕВАЕТСЯ.
   *
   * Решение владельца § V (08.09.2026): новые POI заводятся ЧЕРНОВИКАМИ, а
   * описания готовятся отдельно по фактам. Поэтому портальный кандидат
   * оценивается планом `draftLater`: описание не даёт ни балла, порог сдвинут
   * ровно на его вес, все прочие вето — имя, координаты, регион, таксономия —
   * остаются нетронутыми, а карточка несёт `copyPending`.
   */
  const verdicts = new Map(evaluate(portal, built.map((item) => item.candidate), { copyPlan })
    .map((entry) => [entry.candidate.sourceKey, entry.verdict]))

  /*
   * ОБЯЗАТЕЛЬНЫЕ ДАННЫЕ ЗАПИСИ — ОТДЕЛЬНАЯ ГРАНИЦА, И ОНА ПРОХОДИТСЯ ДО ЛЮБЫХ
   * УТВЕРЖДЕНИЙ О БАЗЕ.
   *
   * Оценка коллектора судит о КАРТОЧКЕ — японское имя, координаты, регион,
   * тип; об обязательных данных ЗАПИСИ — русском имени и направлении — она не
   * знает ничего и знать не должна. Пока этой границы не было, строка без
   * проверенного русского имени объявлялась `writable`, и обещание «запись
   * была бы создана» держалось ровно на том, что до записи дело не доходило.
   *
   * Граница не повторяет правила приёма у себя — она зовёт его функции
   * (`applyCanon`, `classifyCoordinatePolicy`, общее правило направления):
   * см. `japan-guide-record.mjs`. Разойтись с приёмом ей нечем.
   */
  const prepared = new Map()
  for (const item of built) {
    const verdict = verdicts.get(item.row.sourceKey) ?? null
    if (!verdict || verdict.terminal !== TERMINAL.POI_ELIGIBLE) continue
    prepared.set(item.row.sourceKey, prepareIntakeRequest({
      candidate: item.candidate, row: item.row, portal, identified: item.identified, today,
      /* Классификация — ИЗ ТОГО ЖЕ ВЕРДИКТА, который разрешил создание. */
      classification: verdict.classification ?? null,
    }))
  }

  /* Дедуп внутри партии — общий (`dedupeWithinBatch`): он возвращает
     оставленных и столкновения, и второй его редакции здесь нет. Видит он
     ТОЛЬКО тех, кто может стать записью: пока в него шли все строки подряд,
     отвергнутая по качеству или неподготовленная строка могла «занять место» и
     пометить годную дублем — записью не стал бы ни один. */
  const duplicates = new Map()
  const contenders = built.filter((item) => prepared.get(item.row.sourceKey)?.ok)
  for (const collision of dedupeWithinBatch(contenders.map((item) => item.candidate)).collisions) {
    duplicates.set(collision.candidate.sourceKey, collision.against.sourceKey ?? null)
  }

  const rows = built.map((item) => {
    const key = item.row.sourceKey
    const verdict = verdicts.get(key) ?? null
    const base = {
      sourceKey: key,
      nameEn: item.row.nameEn,
      sourceUrl: item.row.url,
      enrichment: item.enriched?.outcome ?? 'absent',
      identification: item.identified?.outcome ?? 'absent',
      provenance: item.provenance,
      verdict: verdict
        ? {
          terminal: verdict.terminal,
          reason: verdict.terminalReason,
          score: verdict.score,
          blocking: verdict.blockingReasons,
          copyPending: verdict.copyPending ?? false,
          importThreshold: verdict.importThreshold ?? null,
        }
        : null,
      match: null,
    }
    /* СНАЧАЛА ТО, ЧТО РЕШАЕТСЯ БЕЗ БАЗЫ. Строка, отвергнутая по качеству, до
       сверки с базой не доходит: сверять нечего, а «дубль» у неё был бы
       утверждением о записи, которой она всё равно не станет. */
    if (!verdict || verdict.terminal !== TERMINAL.POI_ELIGIBLE) {
      const notEnriched = (item.enriched?.outcome ?? 'absent') !== 'enriched'
      return { ...base, outcome: notEnriched ? 'notEnriched' : 'qualityRejected' }
    }
    /* Обязательных данных нет — ИМЕНОВАННЫЙ ОТКАЗ, а не `writable`. */
    const intake = prepared.get(key)
    if (!intake) throw new Error(`${DRY_RUN_SPEC}: ${key}: годная строка не прошла подготовку запроса`)
    if (!intake.ok) {
      return {
        ...base,
        outcome: 'intakeIncomplete',
        intake: { refusal: intake.refusal, missing: [...intake.missing], message: intake.message },
      }
    }
    if (duplicates.has(key)) {
      return { ...base, outcome: 'duplicateInBatch', duplicateOf: duplicates.get(key) }
    }
    const matched = matchAgainstExisting(item.candidate, existing)
    const top = matched.matches[0] ?? null
    const summary = matched ? { verdict: matched.verdict, top: top ? { poiId: top.record.poiId, confidence: top.confidence, reasons: top.reasons } : null } : null
    if (matched.verdict !== 'new') return { ...base, match: summary, outcome: 'matchesExisting' }
    if (item.identified?.outcome === 'ambiguous') return { ...base, match: summary, outcome: 'needsOwner' }
    return { ...base, match: summary, outcome: 'writable', intake: { policy: intake.policy } }
  })

  /* ЗАКОН СОХРАНЕНИЯ. */
  if (rows.length !== queue.length) {
    throw new Error(`${DRY_RUN_SPEC}: закон сохранения нарушен — в очереди ${queue.length}, исходов ${rows.length}`)
  }
  const seen = new Set()
  for (const row of rows) {
    if (!DRY_RUN_OUTCOMES.includes(row.outcome)) throw new Error(`${DRY_RUN_SPEC}: ${row.sourceKey}: исход вне закрытого списка`)
    if (seen.has(row.sourceKey)) throw new Error(`${DRY_RUN_SPEC}: ${row.sourceKey} дважды`)
    seen.add(row.sourceKey)
  }
  /* ПОДГОТОВЛЕННЫЕ ЗАПРОСЫ — ТОЛЬКО У `writable`, И ТОЛЬКО ОНИ.
     Возвращаются рядом с отчётом, а не внутри него: отчёт подписывается и
     хранится, а запрос — предмет одной партии и одного разрешения. Приёму
     передаётся ровно этот список, ничего сверх него. */
  const requests = rows
    .filter((row) => row.outcome === 'writable')
    .map((row) => prepared.get(row.sourceKey).request)

  return {
    rows,
    requests,
    names: namesLoaded?.identity ?? null,
    today,
    existing: existing.length,
    exportDigest,
    copyPlan,
    /* Канонический вход прогона — набор кандидатов, а не файл: манифест
       подписывает то, по чему принимались решения. */
    candidates: built.map((item) => item.candidate),
    airtableRecords: airtable.records.length,
    airtableWithSourceKey: airtable.records.filter((row) => typeof row.sourceKey === 'string' && row.sourceKey).length,
  }
}

/**
 * ОТЧЁТ СУХОГО ПРОГОНА.
 *
 * `manifest` и `gate` приходят готовыми — их собирает CLI теми же функциями,
 * что и живой коллектор. Отпечаток отчёта не зависит от момента: повтор на тех
 * же байтах обязан дать тот же отпечаток, и это и есть проверяемое условие
 * воспроизводимости из плана JA-6.
 */
export function buildDryRunReport({ result, queues, enrichment, identification, manifest, gate, createdAt, portal }) {
  const counts = Object.fromEntries(DRY_RUN_OUTCOMES.map((outcome) => [outcome, result.rows.filter((row) => row.outcome === outcome).length]))
  const total = DRY_RUN_OUTCOMES.reduce((sum, outcome) => sum + counts[outcome], 0)
  if (total !== result.rows.length) throw new Error(`${DRY_RUN_SPEC}: суммы исходов не сходятся`)
  const report = {
    spec: DRY_RUN_SPEC,
    createdAt,
    portal: portal.id,
    mode: 'dry-run',
    inputs: {
      queues: { digest: queues.reportDigest, candidates: queues.queues.candidate.length },
      enrichment: { digest: enrichment.reportDigest, rows: enrichment.rows.length },
      identification: identification ? { digest: identification.reportDigest, rows: identification.rows.length } : null,
      airtable: { exportDigest: result.exportDigest, records: result.existing },
      matcherPolicy: { version: MATCHER_POLICY_VERSION, digest: matcherPolicyDigest() },
      /* Проверенные имена владельца — такой же вход, как отчёты этапов: без
         его отпечатка нельзя сказать, ПО КАКИМ именам собраны записи. */
      names: result.names ? { digest: result.names.digest, file: result.names.file } : null,
    },
    manifest,
    gate,
    copyPlan: result.copyPlan ?? 'draftLater',
    counts: { queue: result.rows.length, ...counts },
    rows: result.rows,
    effects: { network: 0, google: 0, model: 0, post: 0, patch: 0, delete: 0 },
  }
  return { ...report, reportDigest: sha256Bytes(canonicalJsonBytes({ ...report, createdAt: null, manifest: null, gate: null }, DRY_RUN_SPEC)) }
}

/**
 * ОТЧЁТ JA-6, ПРИШЕДШИЙ ФАЙЛОМ, ПРОВЕРЯЕТСЯ ПО СВОЕМУ КОНТРАКТУ.
 *
 * Аудит JG-3 (находка 01) предъявил: у отчёта своя формула отпечатка — она
 * исключает `createdAt`, `manifest` и `gate`, — и общий `assertReportDigest`
 * к нему неприменим. Пока никто не пересчитывал отпечаток ЭТОЙ формулой,
 * достаточно было поменять исход одной строки с `notEnriched` на `writable`,
 * оставив прежние `counts` и `reportDigest`: партия собиралась по подделке и
 * предлагала создать запись, которой в прогоне не было.
 *
 * Здесь проверяется всё, чем отчёт себя объявляет: версия, отпечаток по
 * собственной формуле, закрытый список исходов, уникальность ключей и
 * сходимость `counts` со строками. Расхождение — отказ до отбора партии.
 */
export function assertDryRunReport(doc, where = DRY_RUN_SPEC) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new TypeError(`${where}: ожидается отчёт-объект`)
  if (doc.spec !== DRY_RUN_SPEC) {
    throw new TypeError(`${where}.spec: ожидается «${DRY_RUN_SPEC}», получено ${JSON.stringify(doc.spec ?? null)}`)
  }
  if (typeof doc.reportDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(doc.reportDigest)) {
    throw new TypeError(`${where}.reportDigest: отпечатка нужной формы нет — принимать нечего`)
  }
  if (!Array.isArray(doc.rows)) throw new TypeError(`${where}.rows: ожидается массив строк`)
  const { reportDigest, ...body } = doc
  const recomputed = sha256Bytes(canonicalJsonBytes({ ...body, createdAt: null, manifest: null, gate: null }, DRY_RUN_SPEC))
  if (recomputed !== reportDigest) {
    throw new Error(`${where}: отчёт изменён после подписи — объявлен ${reportDigest}, содержимое даёт ${recomputed}`)
  }
  const seen = new Set()
  for (const row of doc.rows) {
    if (!DRY_RUN_OUTCOMES.includes(row?.outcome)) {
      throw new TypeError(`${where}: ${row?.sourceKey ?? '(без ключа)'}: исход вне закрытого списка`)
    }
    if (seen.has(row.sourceKey)) throw new TypeError(`${where}: ${row.sourceKey} встречается дважды`)
    seen.add(row.sourceKey)
  }
  /* Счётчики — не украшение: партия отбирается по ним, и разойтись со строками
     они не имеют права. */
  if (!doc.counts || typeof doc.counts !== 'object') throw new TypeError(`${where}.counts: ожидается объект счётчиков`)
  if (doc.counts.queue !== doc.rows.length) {
    throw new TypeError(`${where}.counts.queue: объявлено ${doc.counts.queue} при ${doc.rows.length} строках`)
  }
  for (const outcome of DRY_RUN_OUTCOMES) {
    const actual = doc.rows.filter((row) => row.outcome === outcome).length
    if (doc.counts[outcome] !== actual) {
      throw new TypeError(`${where}.counts.${outcome}: объявлено ${doc.counts[outcome]} при ${actual} строках`)
    }
  }
  return doc
}

export function summarizeDryRun(report) {
  const c = report.counts
  return [
    `СУХОЙ ПРОГОН JAPAN GUIDE → INTAKE — строк ${c.queue}: годны к созданию ${c.writable}, отвергнуто качеством ${c.qualityRejected}, `
    + `не обогащено ${c.notEnriched}, нет обязательных данных ${c.intakeIncomplete}, дублей в партии ${c.duplicateInBatch}, `
    + `совпало с базой ${c.matchesExisting}, к человеку ${c.needsOwner}`,
    `входы: очереди ${report.inputs.queues.digest}; обогащение ${report.inputs.enrichment.digest}; `
    + `опознание ${report.inputs.identification?.digest ?? 'не выполнялось'}; база ${report.inputs.airtable.exportDigest} (${report.inputs.airtable.records} записей)`,
    `pre-write gate: ${report.gate?.state ?? 'не собран'}${report.gate?.reason ? ` (${report.gate.reason})` : ''}`,
    'эффектов 0: Airtable POST/PATCH/DELETE 0, Google 0, модель 0, сеть 0',
  ].join('\n')
}
