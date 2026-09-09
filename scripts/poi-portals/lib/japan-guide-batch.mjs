/**
 * JA-7: ПРОБНАЯ ПАРТИЯ И ЧЕРНОВИК РАЗРЕШЕНИЯ — `poi-japan-guide-batch/v1`.
 *
 * Из отчёта сухого прогона (JA-6) отбирается не более пяти строк, годных к
 * созданию, — из РАЗНЫХ классов сложности, — и к ним готовится ЧЕРНОВИК
 * разрешения `poi-write-approval/v2`.
 *
 * ЧЕРНОВИК — НЕ РАЗРЕШЕНИЕ. Он несёт всё, что должно быть проверено писателем:
 * область, портал, отпечаток эталонного прогона, поимённый список ключей и
 * потолки. Чего в нём нет — подписи и срока действия: их проставляет владелец,
 * выдавая разрешение на КОНКРЕТНУЮ партию. Файл, который сам себе выдаёт срок,
 * разрешением не является, и этот модуль такого файла не производит.
 *
 * ПОТОЛКИ ЖЁСТКИЕ: не более пяти созданий, ноль переименований, ноль удалений
 * (решение владельца 3.2 и план JA-7). Больше пяти здесь не собирается —
 * не «по умолчанию пять», а «шестая строка не влезает».
 *
 * ПУСТАЯ ПАРТИЯ — ЗАКОННЫЙ ИСХОД. Если годных строк нет, партия пуста и
 * названа пустой вместе с причиной: собрать пятёрку из негодных строк значило
 * бы предъявить владельцу к подписи то, что писатель всё равно отвергнет.
 */
import { canonicalJsonBytes } from '../../lib/canonical-contract.mjs'
import { sha256Bytes } from '../../lib/byte-digest.mjs'
import { assertDryRunReport } from './japan-guide-dry-run.mjs'
import { WRITE_APPROVAL_SPEC } from './write-approval.mjs'

export const BATCH_SPEC = 'poi-japan-guide-batch/v1'
/** Потолки партии JA-7. Больше — только отдельным решением владельца. */
export const BATCH_LIMITS = Object.freeze({ maxCreates: 5, maxRenames: 0, maxDeletes: 0 })

/** Наблюдаемые факты официального сайта — ось «сколько о строке известно». */
const OBSERVED_FACTS = Object.freeze(['nameJa', 'nameKana', 'address'])

/**
 * КЛАСС СЛОЖНОСТИ строки. Нужен затем, чтобы пятёрка не оказалась пятью
 * одинаковыми случаями: пробная партия проверяет путь, а путь проверяется
 * разнообразием, а не количеством.
 *
 * ОСИ ПЕРЕСМОТРЕНЫ ПОСЛЕ ПОЯВЛЕНИЯ ГРАНИЦЫ ПОДГОТОВКИ ЗАПРОСА, и это не
 * косметика. Прежде класс складывался из источника координат, наличия
 * японского имени и совпадения с базой. Две первые оси СТАЛИ ПОСТОЯННЫМИ среди
 * годных строк — и не «пока что», а по устройству: без `place_id` и точки
 * резолвера политика координат не выводится, а без японского имени строку
 * отвергает вето `missing_name`. Ось, которая у всех отобранных одна и та же,
 * разнообразия не даёт, а в отчёте выглядит так, будто даёт.
 *
 * Поэтому различие берётся там, где оно действительно есть: СКОЛЬКО о строке
 * рассказал официальный сайт (одно имя; имя и адрес; плюс чтение каной) и
 * совпало ли что-нибудь с базой. Источник координат остался в имени класса как
 * подпись — по нему видно, что годная строка иначе и не выглядит.
 */
export function difficultyClassOf(row) {
  const source = row.provenance?.find((mark) => mark.field === 'coordinates')?.source ?? 'none'
  const facts = OBSERVED_FACTS.filter((field) => row.provenance?.some((mark) => mark.field === field)).length
  const nameMatched = Boolean(row.match?.top)
  return `${source}/facts${facts}/${nameMatched ? 'nameMatched' : 'clean'}`
}

/**
 * ОТБОР. Сначала по одной строке от каждого класса — в порядке отчёта, — и
 * только если пятёрка не набралась, добираются оставшиеся. Так партия из шести
 * классов даёт пять РАЗНЫХ, а не пять из первого попавшегося.
 */
export function selectBatch(report, { limit = BATCH_LIMITS.maxCreates } = {}) {
  /* Отчёт проверяется ЦЕЛИКОМ и своей формулой отпечатка: изменённый исход со
     старым отпечатком до отбора не доходит (аудит JG-3, находка 01). */
  assertDryRunReport(report, BATCH_SPEC)
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > BATCH_LIMITS.maxCreates) {
    throw new TypeError(`${BATCH_SPEC}: потолок партии ${limit} вне разрешённого 0…${BATCH_LIMITS.maxCreates}`)
  }
  const writable = report.rows.filter((row) => row.outcome === 'writable')
  const byClass = new Map()
  for (const row of writable) {
    const key = difficultyClassOf(row)
    if (!byClass.has(key)) byClass.set(key, [])
    byClass.get(key).push(row)
  }
  const picked = []
  for (const [, rows] of byClass) {
    if (picked.length >= limit) break
    picked.push({ ...rows[0], difficultyClass: difficultyClassOf(rows[0]) })
  }
  if (picked.length < limit) {
    for (const row of writable) {
      if (picked.length >= limit) break
      if (picked.some((chosen) => chosen.sourceKey === row.sourceKey)) continue
      picked.push({ ...row, difficultyClass: difficultyClassOf(row) })
    }
  }
  return {
    selected: picked,
    classes: [...byClass.keys()],
    writable: writable.length,
    /* Почему партия пуста — не догадка читателя, а поле отчёта. */
    emptyReason: writable.length ? null : dominantBlocker(report),
  }
}

/** Чем именно упёрся прогон, если годных строк нет. */
function dominantBlocker(report) {
  const counts = {}
  for (const row of report.rows) counts[row.outcome] = (counts[row.outcome] ?? 0) + 1
  const [outcome, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? [null, 0]
  if (!outcome) return 'очередь пуста'
  const blocking = report.rows.find((row) => row.outcome === outcome)?.verdict?.blocking ?? []
  return `ни одна строка не годна к созданию: ${count} из ${report.rows.length} — «${outcome}»`
    + (blocking.length ? `; мешает ${blocking.join(', ')}` : '')
}

/**
 * ЧЕРНОВИК РАЗРЕШЕНИЯ. Форма — `poi-write-approval/v2`, поля `issuedAt` и
 * `expiresAt` НЕ заполняются: срок ставит тот, кто разрешает. Черновик
 * помечен `draft: true` и отдельным отпечатком: подсунуть его писателю вместо
 * разрешения нельзя — контракт разрешения такого файла не примет.
 */
/**
 * @param referenceFileDigest отпечаток ТОЧНЫХ БАЙТОВ файла эталонного отчёта.
 *
 * Аудит JG-3 (находка 02): писатель сравнивает `referenceDigest` разрешения с
 * SHA-256 байтов файла `--monitor` (`collect-pois.mjs`), а не с внутренним
 * отпечатком отчёта. Черновик, несущий внутренний, после подстановки срока
 * отказывался настоящей проверкой со словами «владелец видел другой
 * результат». Поэтому в разрешение идёт байтовый отпечаток, а предметный
 * остаётся в отчёте партии отдельным полем.
 */
export function buildApprovalDraft({ selection, scopeId, portal, note, referenceFileDigest }) {
  if (typeof referenceFileDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(referenceFileDigest)) {
    throw new TypeError(`${BATCH_SPEC}: нужен отпечаток байтов эталонного файла — с внутренним отпечатком разрешение не сойдётся`)
  }
  const sourceKeys = selection.selected.map((row) => row.sourceKey).sort()
  if (sourceKeys.length > BATCH_LIMITS.maxCreates) {
    throw new Error(`${BATCH_SPEC}: в партии ${sourceKeys.length} ключей при потолке ${BATCH_LIMITS.maxCreates}`)
  }
  return {
    draft: true,
    forSpec: WRITE_APPROVAL_SPEC,
    scopeId,
    portal,
    /* Эталон — отпечаток БАЙТОВ того файла, который владелец видел: ровно то
       значение, которое сверит писатель. */
    referenceDigest: referenceFileDigest,
    sourceKeys,
    maxCreates: sourceKeys.length,
    maxRenames: BATCH_LIMITS.maxRenames,
    note,
    /* Чего в черновике нет — и почему. */
    missingBeforeUse: ['issuedAt', 'expiresAt'],
    missingReason: 'срок действия проставляет владелец, выдавая разрешение на конкретную партию',
  }
}

export function buildBatchReport({ selection, report, scopeId, portal, note, createdAt, referenceFileDigest }) {
  const draft = buildApprovalDraft({ selection, scopeId, portal, note, referenceFileDigest })
  const body = {
    spec: BATCH_SPEC,
    createdAt,
    portal,
    scopeId,
    limits: { ...BATCH_LIMITS },
    dryRun: {
      /* Предметный отпечаток отчёта — для человека и для сверки содержания; */
      digest: report.reportDigest,
      /* байтовый — для писателя: именно его сверяет разрешение. */
      fileDigest: referenceFileDigest,
      queue: report.counts.queue,
      writable: report.counts.writable,
      copyPlan: report.copyPlan ?? null,
    },
    selection: {
      count: selection.selected.length,
      classes: selection.classes,
      emptyReason: selection.emptyReason,
      rows: selection.selected.map((row) => ({
        sourceKey: row.sourceKey,
        nameEn: row.nameEn,
        sourceUrl: row.sourceUrl,
        difficultyClass: row.difficultyClass,
        provenance: row.provenance,
        match: row.match,
        /* Незавершённая редактура объявлена в самой партии: владелец видит,
           что описание ещё не написано, до того как что-то подпишет. */
        copyPending: row.verdict?.copyPending ?? false,
      })),
    },
    approvalDraft: draft,
    effects: { post: 0, patch: 0, delete: 0 },
    note: 'Это ЧЕРНОВИК. Запись в Airtable выполняется только по разрешению владельца на эту конкретную партию; '
      + 'сам по себе файл полномочий не даёт и писателем как разрешение не принимается.',
  }
  return { ...body, reportDigest: sha256Bytes(canonicalJsonBytes({ ...body, createdAt: null }, BATCH_SPEC)) }
}

export function summarizeBatch(report) {
  const s = report.selection
  return [
    `ПРОБНАЯ ПАРТИЯ JA-7 — отобрано ${s.count} из ${report.dryRun.writable} годных (потолок ${report.limits.maxCreates})`,
    s.count
      ? `классы сложности: ${s.rows.map((row) => row.difficultyClass).join('; ')}`
      : `партия пуста: ${s.emptyReason}`,
    `эталон — сухой прогон ${report.dryRun.digest} (байты файла ${report.dryRun.fileDigest})`,
    s.count && s.rows.every((row) => row.copyPending)
      ? 'у всех строк партии описание ещё не написано — записи остаются черновиками'
      : null,
    `черновик разрешения: создать ${report.approvalDraft.maxCreates}, переименований ${report.approvalDraft.maxRenames}, удалений 0; `
    + `не заполнено: ${report.approvalDraft.missingBeforeUse.join(', ')} — ${report.approvalDraft.missingReason}`,
    'записей нет: POST/PATCH/DELETE 0',
  ].filter(Boolean).join('\n')
}
