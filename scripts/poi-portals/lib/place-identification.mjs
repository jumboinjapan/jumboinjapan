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

/**
 * ЧТО ОПОЗНАЁМ. Строки очереди обогащения, дошедшие до ответа сайта, — то есть
 * `enriched` и `noFacts`. Строка, до которой JA-3 не добрался
 * (`budgetNotSpent`), сюда не попадает: платить за неё, не закончив
 * бесплатного этапа, — платить раньше времени.
 *
 * Ключ поиска собирается из НАБЛЮДЕНИЙ JA-3, а не из подсказок Japan Guide:
 * японское имя и координаты, если они получены со официального сайта; иначе
 * английское имя из discovery. Наблюдение остаётся наблюдением — в запрос оно
 * идёт как ключ поиска, а не как утверждение о карточке.
 */
export function identificationQueueFrom(enrichmentReport) {
  /* `factsConflict` в платный этап НЕ идёт: страница назвала несколько мест, и
     какое из них наше — вопрос к человеку, а не к поиску (аудит JG-2, 03). */
  const rows = enrichmentReport.rows.filter((row) => row.outcome === 'enriched' || row.outcome === 'noFacts')
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
    return {
      sourceKey: row.sourceKey,
      sourceUrl: row.sourceUrl,
      nameJa: factOf('nameJa'),
      nameEn: row.nameEn,
      address: factOf('address'),
      locationBias: bias,
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
export async function runIdentification({ queue, limit, resolve, now }) {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new TypeError(`${PLACE_IDENTIFICATION_SPEC}: потолок вызовов обязан быть целым не меньше нуля`)
  }
  if (limit > MAX_DIAGNOSTIC_CALLS) {
    throw new TypeError(
      `${PLACE_IDENTIFICATION_SPEC}: потолок ${limit} превышает разрешённые ${MAX_DIAGNOSTIC_CALLS} — `
      + 'диагностический прогон ограничен решением владельца 3.2, и обойти его здесь нечем')
  }
  if (typeof resolve !== 'function') throw new TypeError(`${PLACE_IDENTIFICATION_SPEC}: нужен общий резолвер`)
  const rows = []
  let calls = 0

  for (const row of queue) {
    if (!row.nameJa && !row.nameEn) {
      rows.push({ ...row, outcome: 'noQueryKeys', detail: 'ни японского, ни английского имени', place: null, alternatives: [], review: true, called: false })
      continue
    }
    if (calls >= limit) {
      rows.push({ ...row, outcome: 'notAttempted', detail: `потолок ${limit} вызовов исчерпан`, place: null, alternatives: [], review: false, called: false })
      continue
    }
    /* СЧЁТЧИК РАСТЁТ ДО ОБРАЩЕНИЯ: вызов, который не вернулся, всё равно был. */
    calls += 1
    const at = now().toISOString()
    const observedOn = at.slice(0, 10)
    const outcome = await resolve({
      nameJa: row.nameJa ?? undefined,
      nameEn: row.nameEn ?? undefined,
      locationBias: row.locationBias ?? undefined,
    })
    if (!outcome || !PLACE_RESOLUTION_OUTCOMES.includes(outcome.outcome)) {
      throw new Error(`${PLACE_IDENTIFICATION_SPEC}: ${row.sourceKey}: резолвер вернул исход вне закрытого списка`)
    }
    /* НЕОДНОЗНАЧНОСТЬ НЕ РАЗРЕШАЕТСЯ ЗДЕСЬ. `place` у неё null по контракту
       резолвера, и подставлять «первого попавшегося» этому модулю нечем. */
    /*
     * ПРИЧИНА РЕЗОЛВЕРА В ОТЧЁТ НЕ ПОПАДАЕТ. Она написана для человека и несёт
     * отображаемые имена Google в кавычках — то самое, что хранить нельзя.
     * Вместо неё в отчёт идёт наш собственный `detail`, собранный из
     * исчислимого: исхода и числа вариантов.
     */
    const alternatives = outcome.outcome === 'ambiguous' ? storableAlternatives(outcome.alternatives, observedOn) : []
    rows.push({
      ...row,
      outcome: outcome.outcome,
      detail: outcome.outcome === 'ambiguous'
        ? `подошли ${alternatives.length} — выбор за человеком`
        : `исход резолвера: ${outcome.outcome}`,
      place: outcome.outcome === 'resolved' ? storablePlace(outcome.place, observedOn) : null,
      alternatives,
      review: REVIEW_OUTCOMES.includes(outcome.outcome),
      called: true,
      calledAt: at,
    })
  }
  return { rows, calls }
}

/**
 * ОТЧЁТ. Закон сохранения проверяется; стоимость считается по объявленному
 * тарифу, а не по догадке о нём.
 */
export function buildIdentificationReport({ queue, result, limit, priceMicros, createdAt, inputs }) {
  const { rows, calls } = result
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
  const counted = rows.filter((row) => row.called).length
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
    + `верхняя граница стоимости ${s.maxCostMicros} микроединиц по объявленному тарифу ${s.priceMicros}`,
    `записей нет: POST/PATCH/DELETE 0`,
  ].join('\n')
}
