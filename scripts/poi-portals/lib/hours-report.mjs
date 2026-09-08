/**
 * ОТЧЁТ «ЧТО ИЗМЕНИЛОСЬ БЫ» ПО ЧАСАМ РАБОТЫ — `poi-hours-report/v1`
 * (10h-C, SC‑005 U3; решения владельца I‑2.1–2.4, I‑4.4).
 *
 * Режим «только отчёт»: парсер считает и печатает расхождения между источником
 * (наблюдения `poi-hours-observation/v1`) и базой (снимок записей с
 * `Source Key`), НИЧЕГО НЕ ПИШЕТ и не готовит эффектов. Отчёт — полный список
 * `old → proposed`, а не обрезанный образец: каждая запись базы с ключом и
 * каждая строка источника попадает ровно в одну корзину, и это проверяется
 * законом сохранения, а не обещается.
 *
 * Корзины базы (записи с `Source Key` этого портала):
 *   proposed        источник утверждает часы (`stated`), они отличаются от базы —
 *                   строка карточки `old → proposed`;
 *   noChange        утверждает те же часы;
 *   needsReview     наблюдение не `stated` (пусто, частично, противоречиво,
 *                   временно) и при этом отличается от базы, ЛИБО запись с
 *                   ключом не найдена в источнике; решает человек (I‑4.4);
 *   absentBoth      источник молчит и в базе часов нет — расхождения нет.
 * Вне области (считаются, не предлагаются): записи без `Source Key`
 * (`legacyWithoutSourceKey`, I‑2.3), записи с ключом другого портала
 * (`otherPortal`), строки источника без записи в базе (`unmatchedSource` —
 * это путь создания, не обновления).
 *
 * Расхождения по ДРУГИМ полям (сайт) — отдельная очередь `otherFieldReview`:
 * в карточку они не попадают никогда (I‑2.2).
 *
 * `draftCard` — та карточка обновления (`poi-update-card/v1`), которую
 * подписало бы разрешение U4; здесь она информационная: отпечаток известен,
 * эффектов нет.
 */
import { buildUpdateCard, updateCardDigest } from './update-card.mjs'
import { HOURS_FIELD, HOURS_OBSERVATION_KINDS, HOURS_OBSERVATION_SPEC } from './hours-observation.mjs'
import { fieldEquals } from './verified-write.mjs'

export const HOURS_REPORT_SPEC = 'poi-hours-report/v1'
/** Снимок базы для отчёта — закрытая форма записи. */
export const HOURS_BASE_SPEC = 'poi-hours-base/v1'
export const HOURS_BASE_RECORD_KEYS = Object.freeze(['recordId', 'poiId', 'sourceKey', 'workingHours', 'website'])
export const HOURS_BUCKETS = Object.freeze(['proposed', 'noChange', 'needsReview', 'absentBoth', 'legacyWithoutSourceKey', 'otherPortal'])
/** Поля, по которым сравнивается «прочее» — только в очередь просмотра. */
export const OTHER_REVIEW_FIELDS = Object.freeze(['website'])

const isPlain = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v) => (typeof v === 'string' ? v.trim() : '')
const RECORD_ID = /^rec[A-Za-z0-9]{14}$/

/** Проверка снимка базы: закрытая форма, уникальные recordId, ключи уникальны среди непустых. */
export function parseHoursBase(raw, where = HOURS_BASE_SPEC) {
  if (!isPlain(raw) || raw.spec !== HOURS_BASE_SPEC) throw new TypeError(`${where}: ожидается объект с spec ${HOURS_BASE_SPEC}`)
  if (!Array.isArray(raw.records)) throw new TypeError(`${where}.records: ожидается массив`)
  if (typeof raw.readAt !== 'string' || !raw.readAt) throw new TypeError(`${where}.readAt: момент чтения обязателен`)
  const ids = new Set()
  const keys = new Set()
  const records = raw.records.map((r, i) => {
    const at = `${where}.records[${i}]`
    if (!isPlain(r)) throw new TypeError(`${at}: ожидается объект`)
    const extra = Object.keys(r).filter((k) => !HOURS_BASE_RECORD_KEYS.includes(k))
    if (extra.length) throw new TypeError(`${at}: лишние поля ${extra.join(', ')}`)
    if (typeof r.recordId !== 'string' || !RECORD_ID.test(r.recordId)) throw new TypeError(`${at}.recordId: не идентификатор записи`)
    if (ids.has(r.recordId)) throw new TypeError(`${at}.recordId: повтор ${r.recordId}`)
    ids.add(r.recordId)
    const sourceKey = str(r.sourceKey) || null
    if (sourceKey) {
      if (keys.has(sourceKey)) throw new TypeError(`${at}.sourceKey: ключ ${sourceKey} у двух записей — тождество нарушено, отчёт не строится`)
      keys.add(sourceKey)
    }
    return {
      recordId: r.recordId,
      poiId: str(r.poiId) || null,
      sourceKey,
      workingHours: str(r.workingHours) || null,
      website: str(r.website) || null,
    }
  })
  return { spec: HOURS_BASE_SPEC, readAt: raw.readAt, records }
}

/**
 * Сборка отчёта. Чистая функция: ни сети, ни файлов, ни эффектов.
 *
 * @param input.portal        `{ id }` — ключи портала начинаются с `${id}:`
 * @param input.observations  наблюдения `poi-hours-observation/v1`
 * @param input.candidates    кандидаты адаптера (для сравнения прочих полей); необязательно
 * @param input.base          снимок базы `poi-hours-base/v1` (разобранный)
 * @param input.source        `{ dataUpdated, rawPayloadDigest, url }` — тождество выгрузки
 * @param input.createdAt     момент отчёта (канонический ISO)
 */
export function buildHoursReport({ portal, observations, candidates = [], base, source, createdAt, scopeId = 'poi-autoupdate-pilot-v1' }) {
  if (!isPlain(portal) || typeof portal.id !== 'string' || !portal.id) throw new TypeError(`${HOURS_REPORT_SPEC}: портал без id`)
  if (!Array.isArray(observations)) throw new TypeError(`${HOURS_REPORT_SPEC}: ожидается массив наблюдений`)
  if (!isPlain(base) || !Array.isArray(base.records)) throw new TypeError(`${HOURS_REPORT_SPEC}: ожидается разобранный снимок базы`)
  const prefix = `${portal.id}:`
  const byKey = new Map()
  for (const o of observations) {
    if (!isPlain(o) || o.spec !== HOURS_OBSERVATION_SPEC || !HOURS_OBSERVATION_KINDS.includes(o.kind)) throw new TypeError(`${HOURS_REPORT_SPEC}: наблюдение чужой формы`)
    if (byKey.has(o.sourceKey)) throw new Error(`${HOURS_REPORT_SPEC}: наблюдение для ${o.sourceKey} дважды`)
    byKey.set(o.sourceKey, o)
  }
  const candidateByKey = new Map()
  for (const c of candidates) if (isPlain(c) && typeof c.sourceKey === 'string') candidateByKey.set(c.sourceKey, c)

  const buckets = { proposed: [], noChange: [], needsReview: [], absentBoth: [], legacyWithoutSourceKey: [], otherPortal: [] }
  const otherFieldReview = []
  const matchedKeys = new Set()
  for (const record of base.records) {
    const identity = { recordId: record.recordId, poiId: record.poiId, sourceKey: record.sourceKey }
    if (!record.sourceKey) { buckets.legacyWithoutSourceKey.push(identity); continue }
    if (!record.sourceKey.startsWith(prefix)) { buckets.otherPortal.push(identity); continue }
    const observation = byKey.get(record.sourceKey)
    if (!observation) {
      buckets.needsReview.push({ ...identity, reason: 'missingInSource', detail: 'запись с ключом этого портала не найдена в текущей выгрузке', old: record.workingHours, observed: null })
      continue
    }
    matchedKeys.add(record.sourceKey)
    const old = record.workingHours
    if (observation.kind === 'stated') {
      if (fieldEquals(observation.hours, old)) buckets.noChange.push({ ...identity, hours: old })
      else buckets.proposed.push({ ...identity, old, proposed: observation.hours, rowIndex: observation.rowIndex })
    } else if (observation.kind === 'absent' && old === null) {
      buckets.absentBoth.push(identity)
    } else {
      buckets.needsReview.push({ ...identity, reason: observation.kind, detail: observation.reasons.join('; '), old, observed: observation.raw, rowIndex: observation.rowIndex })
    }
    /* Прочие поля — только очередь просмотра, никогда не карточка. */
    const candidate = candidateByKey.get(record.sourceKey)
    if (candidate) {
      for (const field of OTHER_REVIEW_FIELDS) {
        const sourceValue = str(candidate[field]) || null
        const baseValue = record[field] ?? null
        /* Отсутствие значения с одной стороны — тоже расхождение. Оно не
           разрешает обновление, но обязано остаться в очереди владельца:
           иначе исчезнувший сайт источника или новый сайт при пустом поле
           базы терялся бы из отчёта вопреки I‑4.4. */
        if (!fieldEquals(sourceValue, baseValue)) {
          otherFieldReview.push({ ...identity, field, base: baseValue, source: sourceValue })
        }
      }
    }
  }
  const unmatchedSource = observations.filter((o) => !matchedKeys.has(o.sourceKey)).map((o) => ({ sourceKey: o.sourceKey, kind: o.kind, rowIndex: o.rowIndex }))

  /* ЗАКОН СОХРАНЕНИЯ — проверяется, а не обещается. */
  const bucketTotal = HOURS_BUCKETS.reduce((n, b) => n + buckets[b].length, 0)
  if (bucketTotal !== base.records.length) {
    throw new Error(`${HOURS_REPORT_SPEC}: закон сохранения нарушен — записей базы ${base.records.length}, по корзинам ${bucketTotal}`)
  }
  if (matchedKeys.size + unmatchedSource.length !== observations.length) {
    throw new Error(`${HOURS_REPORT_SPEC}: закон сохранения нарушен — наблюдений ${observations.length}, сопоставлено ${matchedKeys.size}, без записи ${unmatchedSource.length}`)
  }
  const seenIds = new Set()
  for (const b of HOURS_BUCKETS) for (const row of buckets[b]) {
    if (seenIds.has(row.recordId)) throw new Error(`${HOURS_REPORT_SPEC}: запись ${row.recordId} в двух корзинах`)
    seenIds.add(row.recordId)
  }

  /* Черновик карточки — из тех же наблюдений базы и предложений; подписи нет. */
  let draftCard = null
  if (buckets.proposed.length) {
    const built = buildUpdateCard({
      scopeId,
      portal: portal.id,
      createdAt,
      note: `черновик отчёта часов ${portal.id}, без разрешения и без эффектов`,
      observations: buckets.proposed.map((row) => ({ recordId: row.recordId, poiId: row.poiId, sourceKey: row.sourceKey, fields: { [HOURS_FIELD]: row.old } })),
      proposals: buckets.proposed.map((row) => ({ recordId: row.recordId, proposed: { [HOURS_FIELD]: row.proposed } })),
    })
    if (!built.card || built.card.rows.length !== buckets.proposed.length) throw new Error(`${HOURS_REPORT_SPEC}: черновик карточки не сходится с корзиной proposed`)
    draftCard = { digest: updateCardDigest(built.card), rows: built.card.rows.length, card: built.card }
  }

  const sortById = (rows) => [...rows].sort((a, b) => (a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0))
  return {
    spec: HOURS_REPORT_SPEC,
    createdAt,
    portal: portal.id,
    field: HOURS_FIELD,
    source: { url: source?.url ?? null, dataUpdated: source?.dataUpdated ?? null, rawPayloadDigest: source?.rawPayloadDigest ?? null, observations: observations.length },
    base: { readAt: base.readAt, records: base.records.length },
    counts: {
      ...Object.fromEntries(HOURS_BUCKETS.map((b) => [b, buckets[b].length])),
      unmatchedSource: unmatchedSource.length,
      otherFieldReview: otherFieldReview.length,
    },
    proposed: sortById(buckets.proposed),
    noChange: sortById(buckets.noChange),
    needsReview: sortById(buckets.needsReview),
    absentBoth: sortById(buckets.absentBoth),
    legacyWithoutSourceKey: sortById(buckets.legacyWithoutSourceKey),
    otherPortal: sortById(buckets.otherPortal),
    unmatchedSource: [...unmatchedSource].sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : 1)),
    otherFieldReview: sortById(otherFieldReview),
    draftCard,
    /* Утверждение проверяется тестом: отчёт не пишет. */
    effects: { post: 0, patch: 0, delete: 0 },
  }
}

/** Краткая сводка для stdout; полный список — только в файле отчёта. */
export function summarizeHoursReport(report) {
  const c = report.counts
  return [
    `ОТЧЁТ ЧАСОВ ${report.portal} — режим «только отчёт», эффектов 0`,
    `база: ${report.base.records} записей (прочитано ${report.base.readAt}); источник: ${report.source.observations} наблюдений (данные ${report.source.dataUpdated ?? '?'})`,
    `предложено изменить: ${c.proposed}; без изменений: ${c.noChange}; в очередь просмотра: ${c.needsReview}; молчат оба: ${c.absentBoth}`,
    `вне области: без Source Key ${c.legacyWithoutSourceKey}, другой портал ${c.otherPortal}, строк источника без записи ${c.unmatchedSource}; расхождений по прочим полям: ${c.otherFieldReview}`,
    report.draftCard ? `черновик карточки: ${report.draftCard.rows} строк, отпечаток ${report.draftCard.digest} (разрешения нет, эффектов нет)` : 'черновик карточки: нет — предлагать нечего',
  ].join('\n')
}
