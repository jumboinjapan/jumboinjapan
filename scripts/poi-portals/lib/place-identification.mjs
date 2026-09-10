/**
 * JA-4: ОГРАНИЧЕННОЕ ОПОЗНАНИЕ МЕСТА — `poi-place-identification/v1`.
 *
 * Координаты и Place ID берутся ТОЛЬКО у кандидатов, переживших предыдущие
 * этапы, и только через ОБЩИЙ резолвер `resolvePlace` — портальной копии
 * поиска здесь нет и быть не должно: вторая редакция политики тождества имён
 * разошлась бы с первой ровно там, где обе написаны для спорного случая.
 *
 * ЧЕТЫРЕ ПРАВИЛА ЭТОГО МОДУЛЯ.
 *
 *   1. ПОТОЛОК ОБЪЯВЛЕН ДО ПЕРВОГО ВЫЗОВА и не превышает 20 (решение
 *      владельца 3.2 от 06.09.2026, подтверждено 08.09.2026). Превышение
 *      останавливает прогон до следующего разрешения — это законный конец, а
 *      не ошибка;
 *   2. КАЖДЫЙ ВЫЗОВ И КАЖДЫЙ ОТКАЗ УЧТЕНЫ. Счётчик увеличивается ДО
 *      обращения: вызов, который не вернулся, всё равно был сделан, и
 *      «посчитаем удавшиеся» означало бы считать не то, за что платят;
 *   3. НЕОДНОЗНАЧНЫЙ ОТВЕТ НЕ ВЫБИРАЕТСЯ АВТОМАТИЧЕСКИ. `ambiguous` общего
 *      резолвера уходит к человеку целиком, вместе с тем, что вернул источник;
 *   4. ТАРИФ И ВЕРХНЯЯ ГРАНИЦА СТОИМОСТИ ФИКСИРУЮТСЯ ДО ЗАПУСКА. Цену этот
 *      модуль не знает и не выдумывает: она приходит параметром, и без неё
 *      живой прогон не начинается. Тариф, взятый из памяти кода, устарел бы
 *      молча.
 *
 * ЗАПИСИ ЗДЕСЬ НЕТ. Ни Airtable, ни журналов: результат — отчёт и очередь
 * решений для человека (JA-5).
 */
import { calendarPlusDays, canonicalJsonBytes, isStrictCalendarDate } from '../../lib/canonical-contract.mjs'
import { sha256Bytes } from '../../lib/byte-digest.mjs'
import { PLACE_RESOLUTION_OUTCOMES } from '../../../src/lib/place-resolve.ts'
import { canonicalPrefecture } from '../../../src/lib/prefectures.ts'
import { prefectureJaForSiteCity } from '../../../src/lib/jp-address.ts'
import { ENRICHMENT_OUTCOMES } from './enrichment.mjs'

export const PLACE_IDENTIFICATION_SPEC = 'poi-place-identification/v1'
/** Потолок диагностического прогона — решение владельца 3.2. Больше нельзя. */
export const MAX_DIAGNOSTIC_CALLS = 20
/**
 * СРОК ГОДНОСТИ КООРДИНАТ GOOGLE — 30 СУТОК, правило проекта (runbook § 3а,
 * пункт 4): `place_id` хранится бессрочно, координаты — со сроком,
 * ОТОБРАЖАЕМЫЕ ИМЕНА НЕ ХРАНЯТСЯ ВОВСЕ. Правило существующее; здесь оно
 * применяется, а не заводится заново.
 */
export const COORDINATE_TTL_DAYS = 30

/**
 * ПРОЕКЦИЯ РАЗРЕШЁННОГО К ХРАНЕНИЮ.
 *
 * Аудит JG-2 (находка 05) предъявил отчёт, в котором лежали `matchedName` и
 * координаты без срока: правило хранения обходилось не злым умыслом, а тем,
 * что объект резолвера сохранялся целиком. Поэтому сохраняется не «то, что
 * пришло», а ЯВНО ПЕРЕЧИСЛЕННОЕ: идентификатор, точка со сроком, статус и
 * административная единица. Имени в этом списке нет.
 */
export function storablePlace(place, observedOn) {
  if (!place) return null
  if (!isStrictCalendarDate(observedOn)) {
    throw new TypeError(`${PLACE_IDENTIFICATION_SPEC}: дата наблюдения обязана быть календарной, получено ${JSON.stringify(observedOn)}`)
  }
  return {
    placeId: place.placeId,
    businessStatus: place.businessStatus ?? '',
    prefecture: place.prefecture ?? null,
    coordinates: {
      lat: place.lat,
      lon: place.lon,
      observedOn,
      /* Срок годности объявлен ЗДЕСЬ, а не подразумевается: координата без
         даты, до которой она верна, через месяц становится утверждением о
         прошлом, поданным как утверждение о настоящем. */
      validUntil: calendarPlusDays(observedOn, COORDINATE_TTL_DAYS),
      ttlDays: COORDINATE_TTL_DAYS,
    },
  }
}

/** Те же ограничения — для вариантов неоднозначного ответа. */
export function storableAlternatives(alternatives, observedOn) {
  return (alternatives ?? []).map((alternative) => storablePlace(alternative, observedOn))
}

/**
 * Исходы строки. Первые совпадают с исходами общего резолвера — переименовывать
 * их значило бы заводить второй словарь для того же события; к ним добавлены
 * два, относящиеся не к ответу, а к тому, дошли ли мы до вызова.
 */
export const IDENTIFICATION_OUTCOMES = Object.freeze([
  ...PLACE_RESOLUTION_OUTCOMES,
  'notAttempted',   // потолок вызовов исчерпан раньше этой строки
  'noQueryKeys',    // искать нечем: ни японского имени, ни английского
])
/** Исходы, уводящие строку к человеку (JA-5). */
export const REVIEW_OUTCOMES = Object.freeze(['ambiguous', 'notFound', 'providerError', 'malformedResponse', 'noQuery', 'noQueryKeys'])

/** Official-site availability does not gate independent Google lookup.
 * Conflicting facts and rows not yet selected for enrichment remain excluded.
 * Source breadcrumbs only guide search; verified editorial Site City wins.
 */
export function identificationQueueFrom(enrichmentReport, { namesLoaded = null, contexts = new Map() } = {}) {
  /* `factsConflict` в платный этап НЕ идёт: страница назвала несколько мест, и
     какое из них наше — вопрос к человеку, а не к поиску (аудит JG-2, 03). */
  for (const row of enrichmentReport.rows) if (!ENRICHMENT_OUTCOMES.includes(row.outcome)) throw new Error(`${PLACE_IDENTIFICATION_SPEC}: неизвестный исход обогащения`)
  const rows = enrichmentReport.rows.filter((row) => !['factsConflict', 'budgetNotSpent'].includes(row.outcome))
  return rows.map((row) => {
    if ((row.conflicts ?? []).length) {
      throw new Error(`${PLACE_IDENTIFICATION_SPEC}: ${row.sourceKey}: исход «${row.outcome}» при расхождении полей ${row.conflicts.join(', ')} — отчёт себе противоречит`)
    }
    /* ФАКТ БЕРЁТСЯ У ОДНОГО МЕСТА, А НЕ У СТРАНИЦЫ ЦЕЛИКОМ. Номер узла несёт
       сам факт; ключи поиска собираются из фактов ОДНОГО номера. */
    const places = [...new Set(row.facts.map((fact) => fact.place ?? 0))].sort((a, b) => a - b)
    const only = places.length <= 1 ? (places[0] ?? 0) : null
    const factOf = (field) => (only === null
      ? null
      : row.facts.find((fact) => fact.field === field && (fact.place ?? 0) === only)?.value ?? null)
    /* ОТСУТСТВУЮЩАЯ КООРДИНАТА — НЕ НОЛЬ. `Number(null)` даёт 0, и первая же
       редакция этого места отправляла бы поиск к точке (0, 0) в Гвинейском
       заливе, выдавая пропуск за наблюдение. Пара берётся только тогда, когда
       ОБА факта пришли строками и оба читаются числами. */
    const latRaw = factOf('lat')
    const lonRaw = factOf('lon')
    const lat = typeof latRaw === 'string' ? Number(latRaw) : Number.NaN
    const lon = typeof lonRaw === 'string' ? Number(lonRaw) : Number.NaN
    const bias = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null
    const owner = namesLoaded?.names?.[row.sourceKey] ?? {}
    const context = contexts.get(row.sourceKey) ?? null
    const ownerPrefecture = canonicalPrefecture(prefectureJaForSiteCity(owner.siteCity))
    return {
      sourceKey: row.sourceKey,
      sourceUrl: row.sourceUrl,
      nameJa: owner.nameJa || factOf('nameJa'),
      nameEn: owner.nameEn || row.nameEn,
      nameJaAlternative: factOf('nameJa'),
      nameEnAlternative: context?.titleEn ?? row.nameEn,
      siteCity: owner.siteCity ?? null,
      searchArea: ownerPrefecture ? owner.siteCity : (context?.area ?? owner.siteCity ?? null),
      prefectureEn: ownerPrefecture?.en ?? context?.prefectureEn ?? null,
      searchContext: context,
      address: factOf('address'),
      locationBias: bias ?? context?.mapCenter ?? null,
      enrichedFrom: row.outcome === 'enriched' ? row.hint ?? null : null,
    }
  })
}

/**
 * ПРОГОН ОПОЗНАНИЯ.
 *
 * `resolve(query)` — общий резолвер, уже связанный с ключом; модуль его не
 * создаёт и ключей не видит. Возвращает `{ rows, calls }`.
 */
export function identificationQueries(row) {
  const queries = []
  const seen = new Set()
  for (const [field, value] of [['nameJa', row.nameJa], ['nameJa', row.nameJaAlternative], ['nameEn', row.nameEn], ['nameEn', row.nameEnAlternative]]) {
    if (typeof value !== 'string' || !value.trim()) continue
    const name = value.trim()
    const key = `${field}:${name.normalize('NFKC').toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    queries.push(Object.fromEntries(Object.entries({ [field]: name, siteCity: row.siteCity ?? undefined, searchArea: row.searchArea ?? undefined,
      address: row.address ?? undefined, prefectureEn: row.prefectureEn ?? undefined, locationBias: row.locationBias ?? undefined }).filter(([, value]) => value !== undefined)))
  }
  return queries
}

/** Explicit storage projection: rejection diagnostics cannot leak provider text. */
function safeDiagnostics(value) {
  if (!value) return null
  const number = n => Number.isSafeInteger(n) && n >= 0 ? n : 0
  return { candidates: number(value.candidates), accepted: number(value.accepted),
    httpStatus: number(value.httpStatus),
    rejected: Object.fromEntries(['malformed', 'outsideJapan', 'nameMismatch', 'prefectureMismatch', 'missingPlaceId']
      .filter(key => number(value.rejected?.[key]) > 0).map(key => [key, number(value.rejected[key])])) }
}

export async function runIdentification({ queue, limit, resolve, now, onAttempt = async () => {} }) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError(`${PLACE_IDENTIFICATION_SPEC}: потолок вызовов обязан быть целым не меньше нуля`)
  if (limit > MAX_DIAGNOSTIC_CALLS) throw new TypeError(`${PLACE_IDENTIFICATION_SPEC}: потолок ${limit} превышает разрешённые ${MAX_DIAGNOSTIC_CALLS}`)
  if (typeof resolve !== 'function') throw new TypeError(`${PLACE_IDENTIFICATION_SPEC}: нужен общий резолвер`)
  const rows = []
  let calls = 0
  let stopped = false
  for (const row of queue) {
    const queries = identificationQueries(row)
    const attempts = []
    let last = null
    let observedOn = null
    for (const query of queries) {
      if (calls >= limit || stopped) break
      calls += 1
      const at = now().toISOString()
      observedOn = at.slice(0, 10)
      await onAttempt({ phase: 'intent', sourceKey: row.sourceKey, call: calls, at, query })
      const outcome = await resolve(query)
      if (!outcome || !PLACE_RESOLUTION_OUTCOMES.includes(outcome.outcome)) throw new Error(`${PLACE_IDENTIFICATION_SPEC}: ${row.sourceKey}: резолвер вернул исход вне закрытого списка`)
      const attempt = { query, at, outcome: outcome.outcome, diagnostics: safeDiagnostics(outcome.diagnostics) }
      attempts.push(attempt)
      await onAttempt({ phase: 'outcome', sourceKey: row.sourceKey, call: calls, ...attempt })
      last = outcome
      // A provider failure stops the entire paid suffix; ambiguity is never
      // retried into a convenient single answer. Only notFound tries an alias.
      if (['providerError', 'malformedResponse'].includes(outcome.outcome)) stopped = true
      if (outcome.outcome !== 'notFound') break
    }
    let outcome = last?.outcome ?? (queries.length ? 'notAttempted' : 'noQueryKeys')
    if (outcome === 'notFound' && attempts.length < queries.length) outcome = 'notAttempted'
    const diagnostics = attempts.every(attempt => attempt.diagnostics) && attempts.length ? {
      candidates: attempts.reduce((sum, attempt) => sum + attempt.diagnostics.candidates, 0),
      rejected: attempts.reduce((counts, attempt) => {
        for (const [key, count] of Object.entries(attempt.diagnostics.rejected)) counts[key] = (counts[key] ?? 0) + count
        return counts
      }, {}),
    } : null
    const alternatives = outcome === 'ambiguous' ? storableAlternatives(last.alternatives, observedOn) : []
    const detail = outcome === 'ambiguous' ? `подошли ${alternatives.length} — выбор за человеком`
      : outcome === 'notAttempted' ? (stopped ? 'проверка остановлена после отказа провайдера' : `потолок ${limit} вызовов исчерпан; проверено вариантов ${attempts.length}/${queries.length}`)
      : outcome === 'notFound' && diagnostics ? (diagnostics.candidates === 0 ? 'Google вернул пустую выдачу по всем проверенным вариантам'
        : `кандидатов ${diagnostics.candidates}; отказы: ${Object.entries(diagnostics.rejected).map(([key, count]) => `${key} ${count}`).join(', ')}`)
      : `исход резолвера: ${outcome}`
    rows.push({ ...row, outcome, detail, place: outcome === 'resolved' ? storablePlace(last.place, observedOn) : null,
      alternatives, attempts, review: REVIEW_OUTCOMES.includes(outcome), called: attempts.length > 0,
      ...(attempts.length ? { calledAt: attempts[0].at } : {}) })
  }
  return { rows, calls }
}

/**
 * ОТЧЁТ. Закон сохранения проверяется; стоимость считается по объявленному
 * тарифу, а не по догадке о нём.
 */
export function buildIdentificationReport({ queue, result, limit, priceMicros, createdAt, inputs }) {
  const { rows, calls } = result
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_DIAGNOSTIC_CALLS || !Number.isSafeInteger(calls) || calls < 0 || calls > limit) throw new Error(`${PLACE_IDENTIFICATION_SPEC}: нарушен потолок вызовов`)
  if (rows.length !== queue.length) {
    throw new Error(`${PLACE_IDENTIFICATION_SPEC}: закон сохранения нарушен — в очереди ${queue.length}, исходов ${rows.length}`)
  }
  if (!Number.isSafeInteger(priceMicros) || priceMicros < 0) {
    throw new TypeError(`${PLACE_IDENTIFICATION_SPEC}: тариф обязан быть объявлен целым числом микроединиц — цену этот модуль не выдумывает`)
  }
  const seen = new Set()
  for (const row of rows) {
    if (!IDENTIFICATION_OUTCOMES.includes(row.outcome)) throw new Error(`${PLACE_IDENTIFICATION_SPEC}: ${row.sourceKey}: исход вне закрытого списка`)
    if (seen.has(row.sourceKey)) throw new Error(`${PLACE_IDENTIFICATION_SPEC}: ${row.sourceKey} дважды`)
    seen.add(row.sourceKey)
    if (row.outcome !== 'resolved' && row.place !== null) {
      throw new Error(`${PLACE_IDENTIFICATION_SPEC}: ${row.sourceKey}: исход «${row.outcome}» несёт место — опознанием это не является`)
    }
    if (row.outcome !== 'ambiguous' && (row.alternatives ?? []).length) {
      throw new Error(`${PLACE_IDENTIFICATION_SPEC}: ${row.sourceKey}: исход «${row.outcome}» несёт варианты выбора — выбирать не из чего`)
    }
    /* ПРАВИЛО ХРАНЕНИЯ ПРОВЕРЯЕТСЯ НА ГРАНИЦЕ ОТЧЁТА, а не только при сборке
       строки: отчёт — это то, что ляжет на диск. */
    for (const stored of [row.place, ...(row.alternatives ?? [])].filter(Boolean)) {
      if ('matchedName' in stored || 'displayName' in stored || 'name' in stored) {
        throw new Error(`${PLACE_IDENTIFICATION_SPEC}: ${row.sourceKey}: отображаемое имя Google хранить нельзя (runbook § 3а)`)
      }
      if (!stored.coordinates?.validUntil) {
        throw new Error(`${PLACE_IDENTIFICATION_SPEC}: ${row.sourceKey}: координаты без срока годности — правило хранения требует ${COORDINATE_TTL_DAYS} суток`)
      }
    }
  }
  if (queue.some(row => !seen.has(row.sourceKey)) || new Set(queue.map(row => row.sourceKey)).size !== queue.length) throw new Error(`${PLACE_IDENTIFICATION_SPEC}: состав исходов расходится с очередью`)
  const counted = rows.reduce((sum, row) => sum + (row.attempts ? row.attempts.length : Number(row.called)), 0)
  if (counted !== calls) {
    throw new Error(`${PLACE_IDENTIFICATION_SPEC}: строк с вызовом ${counted}, счётчик вызовов ${calls} — учёт не сходится`)
  }
  const counts = Object.fromEntries(IDENTIFICATION_OUTCOMES.map((outcome) => [outcome, rows.filter((r) => r.outcome === outcome).length]))
  const report = {
    spec: PLACE_IDENTIFICATION_SPEC,
    createdAt,
    portal: 'japan-guide',
    inputs,
    limits: { calls: limit, ceiling: MAX_DIAGNOSTIC_CALLS },
    retention: { placeId: 'бессрочно', coordinatesTtlDays: COORDINATE_TTL_DAYS, googleDisplayNames: 'не хранятся' },
    spend: { calls, priceMicros, maxCostMicros: calls * priceMicros, ceilingCostMicros: limit * priceMicros },
    counts: { queue: queue.length, ...counts, review: rows.filter((r) => r.review).length },
    rows,
    effects: { post: 0, patch: 0, delete: 0 },
  }
  return { ...report, reportDigest: sha256Bytes(canonicalJsonBytes({ ...report, createdAt: null }, PLACE_IDENTIFICATION_SPEC)) }
}

export function summarizeIdentification(report) {
  const c = report.counts
  const s = report.spend
  return [
    `ОПОЗНАНИЕ JA-4 — очередь ${c.queue}: опознано ${c.resolved}, не найдено ${c.notFound}, неоднозначно ${c.ambiguous}, `
    + `отказ провайдера ${c.providerError}, ответ не той формы ${c.malformedResponse}, искать нечем ${c.noQuery + c.noQueryKeys}, не дошли ${c.notAttempted}`,
    `к человеку уходит ${c.review}`,
    `вызовов ${s.calls} из ${report.limits.calls} (потолок решения владельца ${report.limits.ceiling}); `
    + 'фактические расходы проверяются отдельно по биллингу',
    `записей нет: POST/PATCH/DELETE 0`,
  ].join('\n')
}
