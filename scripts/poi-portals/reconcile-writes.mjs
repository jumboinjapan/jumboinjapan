#!/usr/bin/env node
/**
 * ПОЗДНЯЯ СВЕРКА ЭФФЕКТОВ ЗАПИСИ ПО ЖУРНАЛУ (10f-R, P09.2).
 *
 *   node scripts/poi-portals/reconcile-writes.mjs tmp/poi-write-journal/<runId>/journal.ndjson
 *   npm run poi:reconcile -- <журнал>            # то же самое
 *   npm run poi:reconcile -- <журнал> --resolve  # с живым ЧТЕНИЕМ базы
 *
 * Зачем. Прогон мог оборваться между эффектом и доказательством: запись
 * отправлена, ответ потерян, исход неизвестен. «Неизвестно» не превращается ни
 * в успех, ни в отсутствие эффекта — оно остаётся `recoveryRequired` и ждёт
 * человека. Этот инструмент отвечает на вопрос «что там на самом деле», читая
 * базу, и НИЧЕГО не меняет.
 *
 * Чего инструмент не делает — намеренно и навсегда:
 *   • не повторяет запись (повтор после неизвестного исхода создаёт дубль);
 *   • не откатывает и не удаляет (отката у Airtable нет, а удаление — R3);
 *   • не переписывает журнал (доказательство неизменяемо: сверка пишет свой
 *     отчёт рядом, а не поверх улики).
 *
 * Без `--resolve` инструмент вообще не ходит в сеть: печатает сводку журнала.
 * С `--resolve` делает по одному GET на каждую неустановленную строку — и
 * только GET. Отсутствие токена — отказ с именем, а не «нечего проверять».
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createAirtablePoiStore } from './lib/airtable-store.mjs'
import { classifyWriteOutcome } from './lib/verified-write.mjs'
import { readWriteJournalDetailed, RECOVERY_STATES, summarizeWriteJournal } from './lib/write-journal.mjs'
import { describeThrownSafely } from '../../src/lib/thrown-value.ts'

export const RECONCILE_SPEC = 'poi-write-reconcile/v1'

export function parseReconcileArgs(argv) {
  const args = { journal: null, resolve: false }
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--resolve') { args.resolve = true; continue }
    if (a.startsWith('--')) throw new Error(`Неизвестный аргумент: ${a}`)
    if (args.journal !== null) throw new Error('Журнал указывается один раз')
    args.journal = a
  }
  if (!args.journal) throw new Error('Укажите файл журнала: reconcile-writes.mjs <journal.ndjson> [--resolve]')
  return args
}

/**
 * Сводит журнал и, если разрешено, устанавливает исход ЧТЕНИЕМ базы.
 * Чистая относительно журнала: файл не трогается ни при каком исходе.
 *
 * @param options.read  функция независимого чтения по ключу источника
 */
export async function reconcileWriteJournal(file, { read = null, readByPoiId = null } = {}) {
  /* Сверка с живым чтением — двумя чтениями: по ключу источника (содержание)
     и по номеру (постинвариант уникальности, 10f-R R3). Одно без другого —
     отказ: `verified` без чтения по номеру невозможен, и молча выдавать
     `unknown` на каждую попытку было бы сверкой, которая не сверяет. */
  if ((read && !readByPoiId) || (!read && readByPoiId)) {
    throw new TypeError(`${RECONCILE_SPEC}: живая сверка требует обоих чтений — по ключу источника и по номеру POI ID`)
  }
  const { entries, tornTail } = await readWriteJournalDetailed(file)
  const summary = summarizeWriteJournal(entries)
  const resolved = []
  for (const attempt of summary.attempts) {
    if (!RECOVERY_STATES.includes(attempt.state)) continue
    if (!read) {
      resolved.push({ ...attempt, resolution: 'notChecked', reason: 'живое чтение не запрашивалось (--resolve)' })
      continue
    }
    /* Ожидаемый итог — ПОЛНЫЙ: нагрузка `create` с номером последнего
       переименования. Только `prepare` (хранилище не назвало нагрузку) —
       эффекта не могло быть: пустое чтение подтверждает `notApplied`,
       непустое — расхождение. */
    let found = null
    let readError = null
    try {
      found = await read(attempt.sourceKey, Object.keys(attempt.expectedFields ?? {}))
    } catch (thrown) {
      readError = describeThrownSafely(thrown)
    }
    let uniqueness = null
    const expectedPoiId = attempt.expectedFields?.['POI ID']
    if (typeof expectedPoiId === 'string' && expectedPoiId) {
      try {
        uniqueness = { found: await readByPoiId(expectedPoiId), readError: null }
      } catch (thrown) {
        uniqueness = { found: null, readError: describeThrownSafely(thrown) }
      }
    }
    const classified = classifyWriteOutcome({
      /* Заявка writer'а — из журнала: если он успел назвать запись, сверка
         обязана сравнить с ней. Если не успел (intent-only — главный
         аварийный случай), доказательством служат ОЖИДАЕМЫЕ ПОЛЯ намерения:
         найденная запись верифицируется по содержанию (10f-R R1, находка 2). */
      claimed: attempt.recordId ? { recordId: attempt.recordId, poiId: attempt.poiId } : null,
      expected: attempt.expectedFields ? { fields: attempt.expectedFields } : null,
      found,
      readError,
      effectIntended: attempt.effectIntended,
      uniqueness,
    })
    resolved.push({
      ...attempt,
      resolution: classified.state,
      reason: classified.reason,
      /* Тождество — из базы; из журнала оно не подставляется (R3). */
      recordId: classified.recordId ?? null,
      poiId: classified.poiId ?? null,
      ...(classified.differing ? { differing: classified.differing } : {}),
      /* Ожидаемые поля в отчёт сверки не копируются целиком — их digest
         достаточно, а сам журнал лежит рядом. */
      expectedFields: undefined,
    })
  }
  return {
    spec: RECONCILE_SPEC,
    journal: file,
    lines: entries.length,
    /* Оборванный хвост — след отказавшей дозаписи: назван, не скрыт (R4). */
    tornTail,
    byState: summary.byState,
    attempts: summary.attempts,
    recoveryRequired: summary.recoveryRequired.map((a) => a.sourceKey),
    resolved,
    /* Сверка не пишет: это утверждение проверяется тестом, а не обещанием. */
    wrote: false,
  }
}

export async function runReconcileCli(argv = process.argv, deps = {}, target = process) {
  try {
    const args = parseReconcileArgs(argv)
    let read = deps.read ?? null
    let readByPoiId = deps.readByPoiId ?? null
    if (args.resolve && !read) {
      const token = process.env.AIRTABLE_TOKEN?.trim()
      const baseId = process.env.AIRTABLE_BASE_ID?.trim() || 'apppwhjFN82N9zNqm'
      if (!token) {
        throw new Error(
          '--resolve требует AIRTABLE_TOKEN: без него живое чтение невозможно, '
          + 'а объявлять неустановленный исход установленным нельзя.',
        )
      }
      const store = createAirtablePoiStore({ token, baseId })
      read = (sourceKey, fieldNames) => store.readFreshBySourceKey(sourceKey, fieldNames)
      readByPoiId = (poiId) => store.readFreshByPoiId(poiId)
    }
    const result = await reconcileWriteJournal(path.resolve(args.journal), { read, readByPoiId })
    console.log(JSON.stringify(result, null, 2))
    /* Неустановленный исход остаётся неустановленным и после сверки — это
       ненулевой код возврата, а не «проверили и ладно». */
    const unresolved = result.resolved.filter((r) => r.resolution !== 'verified' && r.resolution !== 'notApplied')
    target.exitCode = unresolved.length ? 1 : 0
    return target.exitCode
  } catch (thrown) {
    target.exitCode = 1
    try { console.error(`[poi-reconcile] ${describeThrownSafely(thrown)}`) } catch { /* код уже выставлен */ }
    return target.exitCode
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runReconcileCli()
}
