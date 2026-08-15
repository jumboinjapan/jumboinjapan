/**
 * Журнал исполнения с упреждающей записью: `tmp/poi-model-executions/<id>/journal.jsonl`.
 *
 * Порядок здесь важнее удобства: намерение записывается и синхронизируется
 * ДО эффекта. Обратный порядок означает, что после обрыва питания платный
 * запрос уже ушёл, а следов о нём нет — и следующий прогон повторит его,
 * потому что журнал молчит.
 *
 * Одноразовость обеспечивается не флагом, а именем: `executionId`
 * детерминирован, поэтому одно разрешение всегда попадает в один и тот же
 * каталог, а существование каталога и есть свидетельство потребления.
 *
 * Гонок с подменой РОДИТЕЛЬСКОГО каталога этот модуль не закрывает и не
 * обещает: между `lstat` и `mkdir` каталог можно подменить, и exclusive-флаги
 * здесь не помогают — они атомарны относительно leaf, а не относительно пути
 * к нему. `ax` и `wx` закрывают ровно одно: гонку за само имя файла между
 * проверкой занятости и созданием.
 */
import { open, readFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ARTIFACT_NAMES,
  assertExistingRegularFile,
  assertPathContainment,
  ensureDirectoryChain,
} from '../../lib/path-boundary.mjs'
import { createApprovalStore } from './approval-store.mjs'
import {
  approvalTimeState,
  assertExecutionId,
  assertStrictOptions,
  buildClosedPayload,
  buildOpenedPayload,
  buildRecord,
  EXIT_CODES,
  executionId as computeExecutionId,
  parseAndVerifyJournal,
  summarizeJournal,
} from './model-execution.mjs'

/** Корень репозитория выводится из URL модуля, а не из `process.cwd()`. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

export const EXECUTION_ROOT_SEGMENTS = Object.freeze(['tmp', 'poi-model-executions'])
export const EXECUTION_ROOT_REL = path.join(...EXECUTION_ROOT_SEGMENTS)
export const JOURNAL_FILE_NAME = 'journal.jsonl'

/**
 * Состояния разрешения. `consumed` стоит первым не по алфавиту: он и
 * проверяется первым.
 */
export const APPROVAL_STATES = Object.freeze(['consumed', 'notYetValid', 'active', 'expired'])

/**
 * Настоящие файловые операции. Собраны в один объект не ради подмены: обёртка
 * вокруг НИХ ЖЕ позволяет доказать порядок вызовов, не заменяя файловую
 * систему подделкой. Файлы всё равно создаются настоящие.
 */
export const FILE_IO = Object.freeze({
  open: (target, flags) => open(target, flags),
  syncDirectory: async (dir) => {
    const handle = await open(dir, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  },
})

function splitJournal(text) {
  /* Torn tail — ТОЛЬКО последний фрагмент без завершающего перевода строки.
     Он игнорируется в памяти; файл не меняется. Полная строка, которая не
     разбирается, — повреждение: молчаливое исправление превратило бы
     свидетельство в догадку. */
  if (text === '') return { lines: [], tornTail: '' }
  const parts = text.split('\n')
  const tornTail = parts.pop()
  return { lines: parts, tornTail }
}

/**
 * Хранилище артефактов исполнения, привязанное к корню репозитория.
 *
 * Инъецируется только база; подкаталоги фиксированы и параметра не имеют.
 */
export function createArtifactStore(input) {
  assertStrictOptions(input, { required: ['repoRoot'], optional: ['io'] }, 'createArtifactStore: параметры')
  const { repoRoot, io = FILE_IO } = input
  const root = path.join(repoRoot, ...EXECUTION_ROOT_SEGMENTS)
  const names = ARTIFACT_NAMES.journal
  const approvals = createApprovalStore({ repoRoot, io })

  const executionDir = (id) => {
    assertExecutionId(id, 'executionId')
    return path.join(root, id)
  }
  const journalPath = (id) => path.join(executionDir(id), JOURNAL_FILE_NAME)

  /**
   * Состояние разрешения. Потребление проверяется ПЕРВЫМ и имеет приоритет
   * над сроком: израсходованное разрешение не оживает от того, что срок ещё
   * идёт, и не перестаёт быть израсходованным от того, что срок вышел.
   */
  const approvalState = (input) => {
    assertStrictOptions(input, { required: ['approval', 'at'] }, 'approvalState: параметры')
    const { approval, at } = input
    const id = computeExecutionId({
      approvalDigest: approval.approvalDigest.value,
      planDigest: approval.planDigest.value,
    })
    let entry = null
    try {
      entry = lstatSync(executionDir(id))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (entry) return { state: 'consumed', executionId: id }
    return { state: approvalTimeState({ approval, at }), executionId: id }
  }

  const readRecords = async (id) => {
    const file = journalPath(id)
    assertPathContainment(file, { insideDir: root, names })
    assertExistingRegularFile(file, { names })
    const text = await readFile(file, 'utf8')
    const { lines, tornTail } = splitJournal(text)
    if (!lines.length) {
      /* Пустой файл и файл, от которого после отбрасывания torn tail не
         осталось ни одной полной записи, — повреждение, а не новый журнал.
         Каталог существует, значит разрешение уже израсходовано; трактовать
         пустоту как чистый старт означало бы выдать второй платный прогон. */
      throw new TypeError(`${file}: ни одной полной записи — журнал повреждён, а не пуст`)
    }
    const raw = lines.map((line, i) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new TypeError(`${file}: строка ${i} не разбирается как JSON — ${error.message}`)
      }
    })
    const verified = parseAndVerifyJournal({ records: raw, executionId: id })
    /* Идентификатор пересчитывается из САМОГО журнала и сверяется с именем
       каталога: восстановление обязано работать после удаления плана и файла
       разрешения, и единственное, чем оно тогда располагает, — запись
       `opened`. */
    const recomputed = computeExecutionId({
      approvalDigest: verified[0].payload.approvalDigest,
      planDigest: verified[0].payload.planDigest,
    })
    if (recomputed !== id) {
      throw new TypeError(
        `${file}: журнал лежит в каталоге ${id}, а по своим же подписям принадлежит ${recomputed}`,
      )
    }
    return { verified, file, tornTail }
  }

  /**
   * Ручка журнала. Наружу идут только методы: `seq`, дескриптор и накопленные
   * записи живут в замыкании, и присвоить `seq` вызывающему нечему.
   */
  const createHandle = ({ handle, id, dir, initial }) => {
    let records = initial
    let closed = records.some((record) => record.type === 'closed')
    let poisoned = null

    /**
     * Отказ записи или синхронизации делает ручку непригодной НАВСЕГДА.
     *
     * Между «строка ушла в файл» и «память об этом обновилась» стоит `sync`,
     * и он может упасть уже после того, как байты записаны. Тогда файл
     * содержит запись, о которой ручка не знает, и следующая дозапись
     * повторила бы тот же `seq` — то есть повредила бы журнал руками того же
     * процесса. Продолжить можно только одним способом: перечитать файл и
     * восстановиться через `resumeJournal`.
     */
    const appendVerified = async (type, payload, at) => {
      if (poisoned) {
        throw new Error(
          `${id}: ручка непригодна после отказа записи (${poisoned}). Состояние файла `
          + 'неизвестно: перечитайте журнал и продолжайте через resumeJournal.',
        )
      }
      if (closed) throw new Error(`${id}: журнал закрыт, дозаписи не будет`)
      const record = buildRecord({ seq: records.length, at, executionId: id, type, payload })
      /* Грамматика переходов проверяется ОДНОЙ реализацией — той же, что
         читает чужой файл. Второй, инкрементальной, здесь нет намеренно:
         она разошлась бы с первой молча. */
      const next = parseAndVerifyJournal({ records: [...records, record], executionId: id })
      try {
        await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8')
        await handle.sync()
      } catch (error) {
        poisoned = error.message
        try { await handle.close() } catch { /* дескриптор уже мог быть закрыт */ }
        throw error
      }
      records = next
      if (type === 'closed') closed = true
      return record
    }

    return Object.freeze({
      executionId: id,
      path: path.join(dir, JOURNAL_FILE_NAME),
      poisoned: () => poisoned !== null,
      /** Намерение. Эффект вызывающий выполняет ТОЛЬКО после возврата. */
      /* Строгая форма входа и здесь: метод ручки — такой же публичный вход,
         как и builder, и лишнее поле в нём молча пропадать не должно. */
      dispatching: (input) => {
        assertStrictOptions(input, { required: ['requestItemId', 'at'] }, 'dispatching: параметры')
        return appendVerified('dispatching', { requestItemId: input.requestItemId }, input.at)
      },
      settled: (input) => {
        assertStrictOptions(input, { required: ['requestItemId', 'outcome', 'charged', 'at'] }, 'settled: параметры')
        return appendVerified('settled', {
          requestItemId: input.requestItemId, outcome: input.outcome, charged: input.charged,
        }, input.at)
      },
      /** Закрытие. Счётчики и исход считает модуль контракта из журнала. */
      close: async (input) => {
        assertStrictOptions(input, { required: ['at'] }, 'close: параметры')
        const { at } = input
        /* Закрытие — такая же дозапись: непригодной ручкой закрыть журнал
           нельзя, иначе итог считался бы по памяти, разошедшейся с файлом. */
        if (poisoned) {
          throw new Error(
            `${id}: ручка непригодна после отказа записи (${poisoned}). Состояние файла `
            + 'неизвестно: перечитайте журнал и продолжайте через resumeJournal.',
          )
        }
        await appendVerified('closed', buildClosedPayload({ verified: records, at }), at)
        await handle.close()
        closed = true
        return summarizeJournal(records)
      },
      /** Отпустить дескриптор, не закрывая журнал: обрыв — не закрытие. */
      release: () => handle.close(),
    })
  }

  return Object.freeze({
    root,
    approvals,
    executionDir,
    journalPath,
    approvalState,

    /**
     * Новая сессия. Порядок закреплён: разрешение читается из файла и
     * проверяется, идентификатор выводится из проверенного, состояние
     * определяется потреблением и только потом сроком — и лишь затем
     * что-либо меняется на диске.
     */
    async openJournal(input) {
      assertStrictOptions(
        input, { required: ['approvalFileName', 'plan', 'at'] }, 'openJournal: параметры',
      )
      const { approvalFileName: fileName, plan, at } = input
      const { approval } = await approvals.readApprovalFile({ fileName, plan })
      const { state, executionId: id } = approvalState({ approval, at })
      if (state !== 'active') {
        throw new Error(
          `разрешение ${fileName}: состояние «${state}» — новую сессию исполнения открывать нельзя`,
        )
      }
      const payload = buildOpenedPayload({ approval, plan, at })
      const dir = ensureDirectoryChain(repoRoot, [...EXECUTION_ROOT_SEGMENTS, id], { names })
      const file = path.join(dir, JOURNAL_FILE_NAME)
      const handle = await io.open(file, 'ax')
      const record = buildRecord({ seq: 0, at, executionId: id, type: 'opened', payload })
      try {
        await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8')
        await handle.sync()
        /* Синхронизация каталога — часть того же создания: без неё запись о
           самом файле может не пережить обрыв. Её отказ закрывает дескриптор
           тем же `finally`, что и отказ записи. */
        await io.syncDirectory(dir)
      } catch (error) {
        try { await handle.close() } catch { /* дескриптор уже мог быть закрыт */ }
        throw error
      }
      return createHandle({ handle, id, dir, initial: [record] })
    },

    /**
     * Восстановление. Самодостаточно: ни плана, ни файла разрешения, ни
     * действующего срока не требует — истёкшее разрешение восстанавливать и
     * закрывать можно, начинать заново нельзя.
     */
    async resumeJournal(input) {
      assertStrictOptions(input, { required: ['executionId'] }, 'resumeJournal: параметры')
      const id = input.executionId
      const { verified, file, tornTail } = await readRecords(id)
      /* Оборванный хвост читать можно — дописывать нельзя. `a` приклеит
         следующую строку к недописанной, и журнал, который сейчас лишь
         неполон, станет повреждённым — руками того, кто пришёл его починить.
         Чинить и обрезать файл здесь тоже нечем: это решение владельца, а не
         побочный эффект восстановления. */
      if (tornTail !== '') {
        throw new Error(
          `${file}: последняя строка не дописана (${Buffer.byteLength(tornTail, 'utf8')} байт `
          + 'без перевода строки). '
          + 'Дозапись приклеилась бы к ней и повредила журнал; файл не изменён — разберитесь с '
          + 'хвостом сами.',
        )
      }
      if (verified.some((record) => record.type === 'closed')) {
        throw new Error(`${file}: журнал уже закрыт — дозаписи не будет`)
      }
      const handle = await io.open(file, 'a')
      return createHandle({ handle, id, dir: executionDir(id), initial: verified })
    },

    /**
     * Чтение fail-closed. Файл не меняется ни при каком исходе: повреждённый
     * журнал не чинится и не дописывается.
     */
    async readJournal(id) {
      /* Чтение оборванный хвост игнорирует: неполная строка описывает
         состояние, которого нет. Восстановление — нет: см. resumeJournal. */
      try {
        const { verified } = await readRecords(id)
        return { ...summarizeJournal(verified), records: verified }
      } catch (error) {
        return Object.freeze({
          state: 'journalCorrupt',
          exitCode: EXIT_CODES.journalCorrupt,
          reason: error.message,
          counts: null,
          outcome: null,
          deleteAfter: null,
          records: null,
        })
      }
    },
  })
}

/** Production-экземпляр: та же функция, корень репозитория из модуля. */
export const ARTIFACT_STORE = createArtifactStore({ repoRoot: REPO_ROOT })
