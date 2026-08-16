/**
 * Журнал исполнения с упреждающей записью: `tmp/poi-model-executions/<id>/`.
 *
 * Порядок здесь важнее удобства: намерение записывается и синхронизируется
 * ДО эффекта. Обратный порядок означает, что после обрыва питания платный
 * запрос уже ушёл, а следов о нём нет — и следующий прогон повторил бы его,
 * потому что журнал молчит.
 *
 * Одноразовость обеспечивается не флагом, а именем: `executionId`
 * детерминирован, поэтому одно разрешение всегда попадает в один и тот же
 * каталог, а существование каталога и есть свидетельство потребления.
 *
 * ВЛАДЕНИЕ ИСПОЛНЕНИЕМ. Журнал — не один файл, а упорядоченная цепочка
 * сегментов `journal.g1.e<N>.jsonl`. Захват эпохи есть `ax`-создание её
 * сегмента: операция атомарна, одноразова и не зависит ни от часов, ни от
 * чужой добросовестности. Номера эпох строго непрерывны — именно это делает
 * `ax` взаимным исключением, а не гонкой за разные имена.
 *
 * Раздельные файлы несущие, а не косметические: писали бы обе эпохи в один
 * файл, дозапись прежнего владельца вклинилась бы в байтовый поток нового и
 * повредила бы его. Прежний владелец держит дескриптор СТАРОГО файла и в
 * сегмент новой эпохи записать не может физически.
 *
 * ЧТО ГАРАНТИРУЕТСЯ И ЧТО НЕТ. Отрезать живой процесс от его собственного
 * дескриптора локальными средствами нельзя. Гарантируется ровно одно: после
 * перехвата ни одна запись прежнего владельца не входит в логический журнал —
 * сегмент обрывается на границе, объявленной записью `claimed` следующей
 * эпохи, а всё, что за границей, поднимает `journalForked`. Байты, уже
 * отданные чужим живым процессом в сокет, этим не отменяются: их исключает
 * только правдивое утверждение владельца в полномочии перехвата.
 *
 * Гонок с подменой РОДИТЕЛЬСКОГО каталога модуль не закрывает и не обещает:
 * между `lstat` и `mkdir` каталог можно подменить, и exclusive-флаги здесь не
 * помогают — они атомарны относительно leaf, а не относительно пути к нему.
 */
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { deepFreeze } from '../../lib/canonical-contract.mjs'
import { sha256Bytes } from '../../lib/byte-digest.mjs'
import {
  ARTIFACT_NAMES,
  assertExistingRegularFile,
  assertPathContainment,
  ensureDirectoryChain,
} from '../../lib/path-boundary.mjs'
import { createApprovalStore } from './approval-store.mjs'
import {
  appendabilityOfRecords,
  approvalTimeState,
  currentEpochOf,
  JournalContractError,
  JOURNAL_GENERATIONS,
  MAX_EPOCH,
  assertExecutionId,
  assertStrictOptions,
  buildAbortedClosedPayload,
  buildClaimedPayload,
  buildClosedPayload,
  buildOpenedPayload,
  buildReconciledPayload,
  buildRecord,
  buildReleasedPayload,
  EXIT_CODES,
  executionId as computeExecutionId,
  parseAndVerifyJournal,
  parseAndVerifyTakeover,
  parseSegmentName,
  segmentName,
  summarizeJournal,
} from './model-execution.mjs'

/** Корень репозитория выводится из URL модуля, а не из `process.cwd()`. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

export const EXECUTION_ROOT_SEGMENTS = Object.freeze(['tmp', 'poi-model-executions'])
export const EXECUTION_ROOT_REL = path.join(...EXECUTION_ROOT_SEGMENTS)

/**
 * Имя журнала ПРЕЖНЕГО формата. Новых таких файлов не создаётся: имя
 * оставлено только чтению, чтобы уже написанные журналы не пришлось объявлять
 * повреждёнными за то, что протокола владения в них нет.
 */
export const LEGACY_JOURNAL_FILE_NAME = 'journal.jsonl'

/** Поколение формата, которое пишет ЭТОТ код. */
export const JOURNAL_GENERATION = 'g1'

/** Единственный посторонний файл, допустимый в каталоге исполнения. */
export const EXECUTION_REPORT_FILE_NAME = 'report.json'

/**
 * Состояния разрешения. `consumed` стоит первым не по алфавиту: он и
 * проверяется первым.
 */
export const APPROVAL_STATES = Object.freeze(['consumed', 'notYetValid', 'active', 'expired'])

/**
 * Повреждение СОДЕРЖИМОГО журнала — и ничего кроме.
 *
 * Отдельный тип, потому что «не удалось прочитать» и «прочитали и нашли
 * повреждение» — разные ответы. Системная ошибка файловой системы (`EIO`,
 * `EACCES`, `EPERM`) и программный дефект журнал повреждённым не делают и
 * уходят наружу как есть: объявить их повреждением значило бы сказать
 * «проверено», не проверив.
 */
export class JournalCorruptError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'JournalCorruptError'
  }
}

/**
 * Приговор границы ПУТИ — типом.
 *
 * Обёрнуты ровно две проверки пути, и обе выносят вердикт обычным `Error`.
 * Дискриминатор поэтому точный: только `Error` ровно этого класса становится
 * повреждением. `TypeError` и прочие классы означают, что сломался сам
 * проверяющий, а системная ошибка — что путь не удалось проверить; и то и
 * другое уходит наружу нетронутым.
 */
function pathVerdict(check) {
  try {
    return check()
  } catch (error) {
    if (error?.constructor !== Error) throw error
    throw new JournalCorruptError(error.message, { cause: error })
  }
}

/**
 * Настоящие файловые операции. Собраны в один объект не ради подмены: обёртка
 * вокруг НИХ ЖЕ позволяет доказать порядок вызовов, не заменяя файловую
 * систему подделкой. Файлы всё равно создаются настоящие.
 */
export const FILE_IO = Object.freeze({
  open: (target, flags) => open(target, flags),
  readFile: (target) => readFile(target),
  readdir: (dir) => readdir(dir),
  size: async (target) => (await stat(target)).size,
  syncDirectory: async (dir) => {
    const handle = await open(dir, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  },
})

const UTF8 = new TextDecoder('utf-8', { fatal: true })

function decodeSegment(bytes, where) {
  try {
    return UTF8.decode(bytes)
  } catch (error) {
    throw new JournalCorruptError(`${where}: байты не являются корректным UTF-8`, { cause: error })
  }
}

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

/** Смещения полных строк в байтах. Нужны, чтобы назвать сироту точно. */
function lineBounds(lines) {
  const ends = []
  let at = 0
  for (const line of lines) {
    at += Buffer.byteLength(line, 'utf8') + 1
    ends.push(at)
  }
  return { ends, completeBytes: at }
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

  /* Планы, выданные ЭТИМ экземпляром. Непрозрачность здесь не украшение:
     `resumeJournal` иначе доверяет чужому объекту имя файла, запись и границы —
     то есть принимает от вызывающего ровно то, что обязан установить сам.
     `WeakSet` даёт идентичность: клон, копия с правкой и план другого
     хранилища — другие объекты, а повторное использование снимается здесь же. */
  const issuedPlans = new WeakSet()

  const executionDir = (id) => {
    assertExecutionId(id, 'executionId')
    return path.join(root, id)
  }
  const segmentPath = (id, epoch) => path.join(executionDir(id), segmentName(JOURNAL_GENERATION, epoch))
  const legacyPath = (id) => path.join(executionDir(id), LEGACY_JOURNAL_FILE_NAME)

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

  /**
   * Состав каталога исполнения.
   *
   * Неожиданный файл, неканоническое имя сегмента, разрыв в нумерации эпох и
   * соседство прежнего формата с новым — отказы, а не пропуски: каталог, про
   * который непонятно, кем он собран, вердикта не даёт.
   */
  const scanSegments = async (id) => {
    const dir = executionDir(id)
    let entries = []
    try {
      entries = (await io.readdir(dir)).slice().sort()
    } catch (error) {
      /* Отсутствие каталога — «не найдено», а не системный сбой: остальные
         коды уходят наружу нетронутыми. */
      if (error?.code !== 'ENOENT') throw error
      throw new JournalCorruptError(`${dir}: каталог исполнения не найден`, { cause: error })
    }
    const epochs = new Map()
    let legacy = false
    for (const name of entries) {
      if (name === EXECUTION_REPORT_FILE_NAME) continue
      if (name === LEGACY_JOURNAL_FILE_NAME) { legacy = true; continue }
      const parsed = parseSegmentName(name)
      if (parsed === null) {
        throw new JournalCorruptError(
          `${path.join(dir, name)}: неожиданный файл в каталоге исполнения. Имя сегмента обязано `
          + 'быть ровно journal.<поколение>.e<номер>.jsonl без ведущих нулей.',
        )
      }
      if (!JOURNAL_GENERATIONS.includes(parsed.generation)) {
        throw new JournalCorruptError(`${path.join(dir, name)}: неизвестное поколение формата`)
      }
      epochs.set(parsed.epoch, { name, generation: parsed.generation })
    }
    if (legacy && epochs.size) {
      throw new JournalCorruptError(
        `${dir}: журнал прежнего формата рядом с сегментами протокола — каталог собран не одним `
        + 'кодом, и вердикта из этого не выводится',
      )
    }
    if (!legacy && !epochs.size) {
      throw new JournalCorruptError(`${dir}: ни журнала прежнего формата, ни одного сегмента`)
    }
    if (legacy) {
      const file = legacyPath(id)
      pathVerdict(() => {
        assertPathContainment(file, { insideDir: root, names })
        assertExistingRegularFile(file, { names })
      })
      return { protocol: 'preProtocol', files: [{ epoch: null, name: LEGACY_JOURNAL_FILE_NAME, file }] }
    }
    const numbers = [...epochs.keys()].sort((a, b) => a - b)
    if (numbers[0] !== 1 || numbers[numbers.length - 1] !== numbers.length) {
      throw new JournalCorruptError(
        `${dir}: номера эпох обязаны быть непрерывными от 1; найдено ${numbers.join(', ')}`,
      )
    }
    const files = numbers.map((epoch) => {
      const file = path.join(dir, epochs.get(epoch).name)
      pathVerdict(() => {
        assertPathContainment(file, { insideDir: root, names })
        assertExistingRegularFile(file, { names })
      })
      return { epoch, name: epochs.get(epoch).name, file }
    })
    return { protocol: 'g1', files }
  }

  /** Сырые байты сегмента вместе с их отпечатком и разбором на строки. */
  const readSegment = async (entry) => {
    const bytes = await io.readFile(entry.file)
    const buffer = Buffer.from(bytes)
    const text = decodeSegment(buffer, entry.file)
    const { lines, tornTail } = splitJournal(text)
    const { ends, completeBytes } = lineBounds(lines)
    const raw = lines.map((line, i) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new JournalCorruptError(
          `${entry.file}: строка ${i} не разбирается как JSON — ${error.message}`, { cause: error },
        )
      }
    })
    return {
      ...entry,
      buffer,
      bytes: buffer.length,
      rawDigest: sha256Bytes(buffer),
      raw,
      ends,
      completeBytes,
      tornBytes: Buffer.byteLength(tornTail, 'utf8'),
      tornTail,
    }
  }

  const describeSegment = (segment) => Object.freeze({
    name: segment.name, bytes: segment.bytes, rawDigest: segment.rawDigest,
  })

  /**
   * Сборка ЛОГИЧЕСКОГО журнала из сегментов.
   *
   * Сегмент обрывается на границе, объявленной записью `claimed` следующей
   * содержательной эпохи. Байты за границей в журнал не входят никогда — и
   * молча не отбрасываются: они описывают настоящие эффекты и поднимают
   * `journalForked`.
   */
  const assemble = async (id) => {
    const { protocol, files } = await scanSegments(id)
    const segments = []
    for (const entry of files) segments.push(await readSegment(entry))

    if (protocol === 'preProtocol') {
      const only = segments[0]
      if (!only.raw.length) {
        throw new JournalCorruptError(
          `${only.file}: ни одной полной записи — журнал повреждён, а не пуст`,
        )
      }
      return {
        protocol, segments, records: only.raw, tornTail: only.tornTail,
        pending: [], fork: null, tail: only,
      }
    }

    const head = segments[0]
    if (!head.raw.length) {
      /* Головной сегмент без единой записи: `opened` не записан вовсе.
         Разрешение потреблено самим существованием каталога, перехватывать
         нечего, продолжение невозможно. Платного эффекта при этом произойти
         не могло: он не может предшествовать своей записи. */
      throw new JournalCorruptError(
        `${head.file}: ни одной полной записи в головном сегменте — журнал повреждён, а не пуст`,
      )
    }

    const last = segments[segments.length - 1]
    /* Цепочка строится ПОСЛЕДОВАТЕЛЬНО от головы, а не фильтром «есть полная
       строка». Перешагнутый сегмент остаётся вне цепочки навсегда: дописанная
       в него позже запись — сирота, а не эпоха, и решать это по наличию строки
       значило бы отдавать решение тому, кого уже отрезали.

       Перечень перешагнутых готов ДО этого цикла — его собирает отдельный
       проход ниже по всем сегментам сразу. Собирать его по ходу цепочки
       нельзя: объявляет supersession преемница, то есть сегмент ВЫШЕ.

       Структурные проверки записи `claimed` применяются только к членам
       цепочки: у отрезанного сегмента его содержимое не грамматика, а сироты. */
    const byName = new Map(segments.map((segment) => [segment.name, segment]))
    /* Перечень перешагнутых собирается ПЕРВЫМ проходом по ВСЕМ сегментам:
       объявляет supersession преемница, то есть сегмент ВЫШЕ, и собирать его
       по ходу цепочки — значит узнавать о перешагивании уже после того, как
       перешагнутый в цепочку попал.

       Подложный сегмент мог бы объявить перешагнутым честного члена цепочки —
       но тогда рвётся связка `fromEpoch`/`fromSeq`/`fromRecordDigest`, и
       грамматика назовёт это повреждением. Модель угроз здесь — обрыв и
       конкуренция, а не правка диска посторонним. */
    const declared = new Map()
    for (const segment of segments) {
      for (const record of segment.raw) {
        if (record?.type !== 'claimed') continue
        for (const entry of record.payload?.supersededSegments ?? []) {
          if (entry?.name) declared.set(entry.name, entry)
        }
      }
    }
    const chain = []
    const pending = []
    for (const segment of segments) {
      if (declared.has(segment.name)) continue
      if (!segment.raw.length) { pending.push(segment); continue }
      chain.push(segment)

      const named = parseSegmentName(segment.name)
      /* Номер эпохи связывается с ИМЕНЕМ ФИЗИЧЕСКОГО ФАЙЛА до сборки общего
         журнала. После сборки сегменты неразличимы, и два `claimed` в одном
         файле выглядели бы двумя честными эпохами. */
      const claims = segment.raw
        .map((record, index) => ({ record, index }))
        .filter((entry) => entry.record?.type === 'claimed')
      /* Единственное законное исключение — головной сегмент из одной записи
         `opened`: инициализация не завершена, и это отдельное читаемое
         состояние, а не повреждение. */
      const uninitializedHead = segment.epoch === 1
        && segment.raw.length === 1 && segment.raw[0]?.type === 'opened'
      if (!uninitializedHead) {
        if (claims.length !== 1) {
          throw new JournalCorruptError(
            `${segment.file}: записей claimed в сегменте ${claims.length}, допускается ровно одна`,
          )
        }
        const expectedIndex = segment.epoch === 1 ? 1 : 0
        if (claims[0].index !== expectedIndex) {
          throw new JournalCorruptError(
            `${segment.file}: claimed стоит на позиции ${claims[0].index}, ожидается ${expectedIndex}`,
          )
        }
        if (named !== null && claims[0].record.payload?.epoch !== named.epoch) {
          throw new JournalCorruptError(
            `${segment.file}: эпоха в записи claimed `
            + `(${JSON.stringify(claims[0].record.payload?.epoch)}) не совпадает с именем сегмента `
            + `(${named.epoch})`,
          )
        }
      }
      for (const record of segment.raw) {
        if (record?.type !== 'claimed') continue
        if (named !== null && record.payload?.generation !== named.generation) {
          throw new JournalCorruptError(
            `${segment.file}: поколение в записи claimed `
            + `(${JSON.stringify(record.payload?.generation)}) не совпадает с именем сегмента `
            + `(${named.generation})`,
          )
        }
      }
    }

    /* Незавершённые сегменты НАД последней содержательной эпохой — живые
       резервирования: их может быть и несколько, и объявить их пока некому.
       Незавершённый сегмент ПОД ней обязан быть объявлен перешагнутым. */
    const lastContentEpoch = chain[chain.length - 1].epoch
    const reservations = pending.filter((segment) => segment.epoch > lastContentEpoch)
    const stray = pending.find(
      (segment) => segment.epoch < lastContentEpoch && !declared.has(segment.name),
    )
    if (stray) {
      /* Незавершённый сегмент, который никто не объявил перешагнутым, означает
         захват эпохи поверх занятой, минуя перечень `supersededSegments`. */
      throw new JournalCorruptError(
        `${stray.file}: незавершённый сегмент не объявлен перешагнутым — эпоха захвачена поверх занятой`,
      )
    }

    const records = []
    const forks = []
    /* Перешагнутый сегмент обязан остаться ровно теми байтами, которые видел
       владелец, подписывая полномочие. Рост — расщепление; изменение при той
       же длине — уничтоженное свидетельство. */
    for (const [name, entry] of declared) {
      const actual = byName.get(name)
      if (!actual) {
        throw new JournalCorruptError(
          `${path.join(executionDir(id), name)}: объявленный перешагнутым сегмент отсутствует`,
        )
      }
      if (actual.bytes < entry.bytes) {
        throw new JournalCorruptError(
          `${actual.file}: ${actual.bytes} байт против объявленных ${entry.bytes} — сегмент усечён`,
        )
      }
      /* Отпечаток префикса сверяется ВСЕГДА, а не только при совпавшей длине:
         дописать в перешагнутый сегмент и заодно переписать подписанный
         префикс — одно движение, и проверка «только при равной длине»
         пропускала бы вторую половину этого движения. */
      const prefix = sha256Bytes(actual.buffer.subarray(0, entry.bytes))
      if (prefix !== entry.rawDigest) {
        throw new JournalCorruptError(
          `${actual.file}: отпечаток префикса ${entry.bytes} байт перешагнутого сегмента `
          + `не сходится с объявленным: ${prefix} против ${entry.rawDigest}`,
        )
      }
      if (actual.bytes > entry.bytes) {
        const completeOrphanBytes = Math.max(0, actual.completeBytes - entry.bytes)
        const orphanBytes = actual.bytes - entry.bytes
        const insideDeclared = actual.ends.filter((end) => end <= entry.bytes).length
        const orphanRecords = actual.raw.slice(insideDeclared)
        forks.push({
          epoch: actual.epoch,
          name: actual.name,
          boundaryBytes: entry.bytes,
          orphanBytes,
          orphanCount: orphanRecords.length,
          completeOrphanBytes,
          tornOrphanBytes: orphanBytes - completeOrphanBytes,
          /* Номер называется, если за границей появилась ПОЛНАЯ запись:
             «сирот 1, номера нет» было бы описанием, которого не бывает. */
          firstOrphanSeq: orphanRecords.length
            && Number.isSafeInteger(orphanRecords[0]?.seq) ? orphanRecords[0].seq : null,
        })
      }
    }
    for (const [index, segment] of chain.entries()) {
      const next = chain[index + 1] ?? null
      if (next === null) {
        records.push(...segment.raw)
        continue
      }
      const claim = next.raw[0]
      const boundary = claim?.payload?.fromSegmentBytes
      if (!Number.isSafeInteger(boundary) || boundary < 1) {
        throw new JournalCorruptError(
          `${next.file}: первая запись сегмента не объявляет границу прежнего сегмента`,
        )
      }
      if (segment.bytes < boundary) {
        throw new JournalCorruptError(
          `${segment.file}: ${segment.bytes} байт против объявленной границы ${boundary} — `
          + 'сегмент усечён, свидетельство уничтожено',
        )
      }
      /* Отпечаток ТОЧНОГО префикса. Подписи записей его не покрывают:
         оборванная строка входит в файл и в границу, но не в запись, — и без
         этой сверки хвост переписывается равной длиной незамеченным. */
      const declaredPrefix = claim?.payload?.fromSegmentRawDigest
      const actualPrefix = sha256Bytes(segment.buffer.subarray(0, boundary))
      if (actualPrefix !== declaredPrefix) {
        throw new JournalCorruptError(
          `${segment.file}: отпечаток префикса ${boundary} байт не сходится с объявленным `
          + `в ${next.name}: ${actualPrefix} против ${JSON.stringify(declaredPrefix)}`,
        )
      }
      /* Запись внутри границы, только если она ЦЕЛИКОМ внутри. Запись,
         пересекающая границу, дописана после захвата и логическим журналом
         не является. */
      const inside = segment.ends.filter((end) => end <= boundary).length
      records.push(...segment.raw.slice(0, inside))
      if (segment.bytes > boundary) {
        const orphanRecords = segment.raw.slice(inside)
        const orphanBytes = segment.bytes - boundary
        const completeOrphanBytes = Math.max(0, segment.completeBytes - boundary)
        forks.push({
          epoch: segment.epoch,
          name: segment.name,
          boundaryBytes: boundary,
          orphanBytes,
          orphanCount: orphanRecords.length,
          completeOrphanBytes,
          /* Оборванный хвост за границей считается отдельно: сиротой он
             является ровно так же, а записью — нет. */
          tornOrphanBytes: orphanBytes - completeOrphanBytes,
          firstOrphanSeq: orphanRecords.length
            && Number.isSafeInteger(orphanRecords[0]?.seq) ? orphanRecords[0].seq : null,
        })
      }
    }
    /* Расщеплений может быть НЕСКОЛЬКО: осиротеть способен каждый отсечённый
       сегмент, и сообщить о первом значило бы занизить картину. Агрегаты
       считаются по всему массиву и проверяются им же. */
    forks.sort((left, right) => left.epoch - right.epoch)
    const fork = forks.length ? deepFreeze({
      segments: forks,
      totalOrphanRecords: forks.reduce((sum, entry) => sum + entry.orphanCount, 0),
      totalOrphanBytes: forks.reduce((sum, entry) => sum + entry.orphanBytes, 0),
      totalCompleteOrphanBytes: forks.reduce((sum, entry) => sum + entry.completeOrphanBytes, 0),
      totalTornOrphanBytes: forks.reduce((sum, entry) => sum + entry.tornOrphanBytes, 0),
    }) : null
    return {
      protocol,
      segments,
      records,
      tornTail: chain[chain.length - 1].tornTail,
      pending: reservations.map(describeSegment),
      pendingEpoch: reservations.length ? last.epoch : null,
      fork,
      tail: chain[chain.length - 1],
      chain,
    }
  }

  /** Логический журнал плюс право дозаписи. Единственная точка сборки. */
  const readAssembled = async (id) => {
    const assembled = await assemble(id)
    if (assembled.fork !== null) return { ...assembled, verified: null }
    let verified = null
    try {
      verified = parseAndVerifyJournal({
        records: assembled.records, executionId: id, protocol: assembled.protocol,
      })
    } catch (error) {
      if (!(error instanceof JournalContractError)) throw error
      throw new JournalCorruptError(error.message, { cause: error })
    }
    /* Идентификатор пересчитывается из САМОГО журнала и сверяется с именем
       каталога: восстановление обязано работать после удаления плана и файла
       разрешения, и единственное, чем оно тогда располагает, — запись
       `opened`. */
    const recomputed = computeExecutionId({
      approvalDigest: verified[0].payload.approvalDigest,
      planDigest: verified[0].payload.planDigest,
    })
    if (recomputed !== id) {
      throw new JournalCorruptError(
        `${assembled.tail.file}: журнал лежит в каталоге ${id}, а по своим же подписям принадлежит ${recomputed}`,
      )
    }
    return { ...assembled, verified }
  }

  /**
   * Право дозаписи.
   *
   * Протокольное условие НЕ подменяет бизнес-итог: он считается прежним
   * путём и прежней функцией. `indeterminate` — не итог, а отсутствие
   * доказанного владения.
   */
  const appendabilityOf = (assembled) => {
    /* Прежний формат виден в поле `protocol`, закрытие — в `state`.
       Причина заполняется ТОЛЬКО у `indeterminate`, иначе одно и то же
       сообщалось бы двумя полями и рано или поздно разошлось бы. */
    if (assembled.protocol === 'preProtocol') return { value: 'readOnly', reason: null }
    /* Закрытие сильнее всего остального. Закрытый журнал ничего не ждёт, и
       незавершённый сегмент рядом с ним — диагностика (он по-прежнему в
       `pendingSegments`), а не повод объявить владение неопределённым и тем
       более не повод выдать полномочие на перехват. */
    if (assembled.verified.some((record) => record.type === 'closed')) {
      return { value: 'readOnly', reason: null }
    }
    if (assembled.pending.length) {
      return { value: 'indeterminate', reason: 'ownershipIndeterminate' }
    }
    if (currentEpochOf(assembled.verified) === null) {
      return { value: 'indeterminate', reason: 'protocolInitializationIncomplete' }
    }
    if (assembled.tornTail !== '') {
      return { value: 'indeterminate', reason: 'ownershipIndeterminate' }
    }
    const value = appendabilityOfRecords(assembled.verified)
    return { value, reason: null }
  }

  /**
   * Ручка журнала. Наружу идут только методы: `seq`, дескриптор и накопленные
   * записи живут в замыкании, и присвоить `seq` вызывающему нечему.
   *
   * `fence` — ожидаемые длины ВСЕХ отсечённых сегментов и собственная эпоха.
   * Сверяются они и до записи, и после её fsync: расхождение после fsync —
   * единственная проверка, которая успевает остановить владельца ДО эффекта,
   * когда перехват случился уже во время записи.
   */
  const createHandle = ({ handle, id, dir, epoch, initial, fence }) => {
    let records = initial
    let closed = records.some((record) => record.type === 'closed')
    let detached = false
    let poisoned = null

    const poison = (reason) => {
      poisoned = reason
      return new Error(
        `${id}: ручка непригодна (${reason}). Состояние файла неизвестно либо исполнение больше `
        + 'не принадлежит этой эпохе: перечитайте журнал и продолжайте новой эпохой.',
      )
    }

    const assertUsable = () => {
      if (poisoned) {
        throw new Error(
          `${id}: ручка непригодна после отказа (${poisoned}). Состояние файла неизвестно: `
          + 'перечитайте журнал и продолжайте новой эпохой.',
        )
      }
      if (closed) throw new Error(`${id}: журнал закрыт, дозаписи не будет`)
    }

    /**
     * Fencing: чужая эпоха и длины отсечённых сегментов.
     *
     * Длина сверяется на каждом шаге, потому что это один `stat`; полный
     * отпечаток пересчитывается при захвате и при закрытии — ежезаписный
     * пересчёт сделал бы стоимость записи линейной по размеру журнала.
     * Изменение байтов без изменения длины ловится не здесь, а подписями
     * записей и сверкой цепочки при чтении.
     */
    const assertFence = async (where) => {
      let entries = []
      try {
        entries = await io.readdir(dir)
      } catch (error) {
        throw poison(`${where}: каталог исполнения не читается — ${error.message}`)
      }
      for (const name of entries) {
        const parsed = parseSegmentName(name)
        if (parsed !== null && parsed.epoch > epoch) {
          throw poison(
            `${where}: исполнение перехвачено эпохой ${parsed.epoch}, эта ручка держит ${epoch}`,
          )
        }
      }
      for (const expected of fence) {
        let size = null
        try {
          size = await io.size(path.join(dir, expected.name))
        } catch (error) {
          throw poison(`${where}: отсечённый сегмент ${expected.name} не читается — ${error.message}`)
        }
        if (size !== expected.bytes) {
          throw poison(
            `${where}: отсечённый сегмент ${expected.name} изменился — было ${expected.bytes} байт, `
            + `стало ${size}`,
          )
        }
      }
    }

    /**
     * Отказ записи или синхронизации делает ручку непригодной НАВСЕГДА.
     *
     * Между «строка ушла в файл» и «память об этом обновилась» стоит `sync`,
     * и он может упасть уже после того, как байты записаны. Тогда файл
     * содержит запись, о которой ручка не знает, и следующая дозапись
     * повторила бы тот же `seq` — то есть повредила бы журнал руками того же
     * процесса. Продолжить можно только одним способом: перечитать файл и
     * захватить новую эпоху.
     */
    const appendVerified = async (type, payload, at) => {
      assertUsable()
      await assertFence(`перед записью ${type}`)
      const record = buildRecord({ seq: records.length, at, executionId: id, type, payload })
      /* Грамматика переходов проверяется ОДНОЙ реализацией — той же, что
         читает чужой файл. Второй, инкрементальной, здесь нет намеренно:
         она разошлась бы с первой молча. */
      const next = parseAndVerifyJournal({
        records: [...records, record], executionId: id, protocol: 'g1',
      })
      try {
        await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8')
        await handle.sync()
      } catch (error) {
        poisoned = error.message
        try { await handle.close() } catch { /* дескриптор уже мог быть закрыт */ }
        throw error
      }
      /* Сверка ПОСЛЕ fsync: перехват мог случиться во время записи, и только
         здесь владелец узнаёт об этом до того, как выполнит эффект. */
      await assertFence(`после записи ${type}`)
      records = next
      if (type === 'closed') closed = true
      return record
    }

    const finish = async (type, payload, at) => {
      const record = await appendVerified(type, payload, at)
      await handle.close()
      detached = true
      return record
    }

    return Object.freeze({
      executionId: id,
      epoch,
      path: path.join(dir, segmentName(JOURNAL_GENERATION, epoch)),
      poisoned: () => poisoned !== null,
      /** Намерение. Эффект вызывающий выполняет ТОЛЬКО после возврата. */
      /* Строгая форма входа и здесь: метод ручки — такой же публичный вход,
         как и builder, и лишнее поле в нём молча пропадать не должно. */
      dispatching: (input) => {
        assertStrictOptions(
          input, { required: ['requestItemId', 'requestSpecDigest', 'at'] },
          'dispatching: параметры',
        )
        return appendVerified('dispatching', {
          requestItemId: input.requestItemId,
          requestSpecDigest: input.requestSpecDigest,
        }, input.at)
      },
      settled: (input) => {
        assertStrictOptions(input, {
          required: ['requestItemId', 'requestSpecDigest', 'outcome', 'charged', 'result', 'at'],
        }, 'settled: параметры')
        return appendVerified('settled', {
          requestItemId: input.requestItemId,
          requestSpecDigest: input.requestSpecDigest,
          outcome: input.outcome,
          charged: input.charged,
          result: input.result,
        }, input.at)
      },
      /**
       * Локальное свидетельство владельца о судьбе неопределённого запроса.
       *
       * Дописывается тем же путём, что и всё остальное: строится, проверяется
       * общей грамматикой и синхронизируется. Права на новый платный запрос
       * запись не выдаёт — его ограничивает approval.
       */
      reconciled: (input) => {
        assertStrictOptions(input, { required: ['evidence', 'at'] }, 'reconciled: параметры')
        return appendVerified('reconciled', buildReconciledPayload({ evidence: input.evidence }), input.at)
      },
      /**
       * Добровольное освобождение эпохи.
       *
       * Отдельная ЗАПИСЬ, а не закрытие дескриптора: без неё исполнение
       * осталось бы во владении навсегда, и сверке пришлось бы требовать
       * полномочие владельца после каждого штатного обрыва.
       */
      release: async (input) => {
        assertStrictOptions(input, { required: ['at', 'reason'] }, 'release: параметры')
        return finish('released', buildReleasedPayload({ epoch, reason: input.reason }), input.at)
      },
      /**
       * Отпустить дескриптор, НИЧЕГО не записав.
       *
       * Единственный законный случай — непригодная ручка: записать она уже не
       * может, а держать дескриптор незачем. Владение при этом остаётся за
       * эпохой, и продолжение потребует полномочия владельца. Тихой заменой
       * `release` этот метод не является и в успешном пути не участвует.
       */
      detach: async () => {
        if (detached) return false
        detached = true
        await handle.close()
        return true
      },
      /**
       * Закрытие журнала, не дошедшего до первой отправки.
       *
       * Отдельный метод, а не флаг у `close`: закрывают они разное и по разным
       * доказательствам, и один параметр стёр бы эту разницу.
       */
      closeAborted: async (input) => {
        assertStrictOptions(input, { required: ['at'] }, 'closeAborted: параметры')
        const { at } = input
        assertUsable()
        await finish('closed', buildAbortedClosedPayload({ verified: records, at }), at)
        return summarizeJournal(records)
      },
      /** Закрытие. Счётчики и исход считает модуль контракта из журнала. */
      close: async (input) => {
        assertStrictOptions(input, { required: ['at'] }, 'close: параметры')
        const { at } = input
        /* Закрытие — такая же дозапись: непригодной ручкой закрыть журнал
           нельзя, иначе итог считался бы по памяти, разошедшейся с файлом. */
        assertUsable()
        await finish('closed', buildClosedPayload({ verified: records, at }), at)
        return summarizeJournal(records)
      },
    })
  }

  const sameSegments = (left, right) => left.length === right.length
    && left.every((entry, index) => entry.name === right[index].name
      && entry.bytes === right[index].bytes
      && entry.rawDigest === right[index].rawDigest)

  const requireBinding = (assembled, takeover, appendability) => {
    const verified = assembled.verified
    const tail = assembled.chain[assembled.chain.length - 1]
    const lastRecord = verified[verified.length - 1]
    const binding = {
      fromEpoch: tail.epoch,
      fromSeq: lastRecord.seq,
      fromRecordDigest: lastRecord.recordDigest.value,
      fromSegmentBytes: tail.bytes,
      fromSegmentRawDigest: tail.rawDigest,
      supersededSegments: assembled.pending.map((entry) => ({ ...entry })),
    }
    if (appendability.value === 'open') {
      if (takeover !== null) {
        throw new Error(
          `${assembled.tail.file}: эпоха освобождена добровольно — полномочие владельца здесь `
          + 'не требуется и не принимается',
        )
      }
      return { basis: 'released', binding, takeover: null }
    }
    if (takeover === null) {
      throw new Error(
        `${assembled.tail.file}: исполнение принадлежит незакрытой эпохе ${tail.epoch}`
        + (appendability.reason ? ` (${appendability.reason})` : '')
        + '. Дозапись возможна только после освобождения прежним владельцем либо по явному '
        + 'полномочию владельца poi-model-takeover/v1.',
      )
    }
    return { basis: 'takeover', binding, takeover: parseAndVerifyTakeover(takeover) }
  }

  return Object.freeze({
    root,
    approvals,
    executionDir,
    segmentPath,
    journalPath: (id) => segmentPath(id, 1),
    approvalState,

    /**
     * Новая сессия. Порядок закреплён: разрешение читается из файла и
     * проверяется, идентификатор выводится из проверенного, состояние
     * определяется потреблением и только потом сроком — и лишь затем
     * что-либо меняется на диске.
     *
     * `opened` и `claimed` пишутся ОДНИМ вызовом и синхронизируются один раз:
     * два вызова дали бы лишнее окно обрыва, а различимость незавершённой
     * инициализации от прежнего формата обеспечивает имя сегмента, а не
     * количество операций.
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
      const opened = buildRecord({
        seq: 0, at, executionId: id, type: 'opened',
        payload: buildOpenedPayload({ approval, plan, at }),
      })
      const claimed = buildRecord({
        seq: 1,
        at,
        executionId: id,
        type: 'claimed',
        payload: buildClaimedPayload({
          executionId: id,
          generation: JOURNAL_GENERATION,
          epoch: 1,
          basis: 'opened',
          fromEpoch: null,
          fromSeq: 0,
          fromRecordDigest: opened.recordDigest.value,
          fromSegmentBytes: null,
          fromSegmentRawDigest: null,
          supersededSegments: [],
          takeover: null,
        }),
      })
      const initial = parseAndVerifyJournal({
        records: [opened, claimed], executionId: id, protocol: 'g1',
      })
      const dir = ensureDirectoryChain(repoRoot, [...EXECUTION_ROOT_SEGMENTS, id], { names })
      const file = path.join(dir, segmentName(JOURNAL_GENERATION, 1))
      const handle = await io.open(file, 'ax')
      try {
        await handle.writeFile(
          `${JSON.stringify(opened)}\n${JSON.stringify(claimed)}\n`, 'utf8',
        )
        await handle.sync()
        /* Синхронизация каталога — часть того же создания: без неё запись о
           самом файле может не пережить обрыв. Её отказ закрывает дескриптор
           тем же `finally`, что и отказ записи. */
        await io.syncDirectory(dir)
      } catch (error) {
        try { await handle.close() } catch { /* дескриптор уже мог быть закрыт */ }
        throw error
      }
      return createHandle({ handle, id, dir, epoch: 1, initial, fence: [] })
    },

    /**
     * Привязка для полномочия владельца — только чтение.
     *
     * Владелец обязан подписать ТОТ САМЫЙ хвост, который он осматривал, а
     * вывести его вручную нельзя: нужны и последняя запись, и точная длина
     * сегмента, и перечень незавершённых файлов. Поэтому привязку выдаёт то
     * же хранилище, которое потом её и проверит, — а истинность основания
     * по-прежнему остаётся утверждением владельца.
     */
    async takeoverBinding(id) {
      const assembled = await readAssembled(id)
      if (assembled.protocol !== 'g1') {
        throw new Error(`${assembled.tail.file}: журнал прежнего формата перехвату не подлежит`)
      }
      if (assembled.fork !== null) {
        throw new Error(`${executionDir(id)}: журнал расщеплён — перехватывать нечего`)
      }
      if (appendabilityOf(assembled).value === 'readOnly') {
        throw new Error(`${assembled.tail.file}: журнал закрыт — перехватывать нечего`)
      }
      const tail = assembled.chain[assembled.chain.length - 1]
      const lastRecord = assembled.verified[assembled.verified.length - 1]
      return deepFreeze({
        executionId: id,
        fromEpoch: tail.epoch,
        fromSeq: lastRecord.seq,
        fromRecordDigest: lastRecord.recordDigest.value,
        fromSegmentBytes: tail.bytes,
        fromSegmentRawDigest: tail.rawDigest,
        supersededSegments: assembled.pending.map((entry) => ({ ...entry })),
      })
    },

    /**
     * План захвата следующей эпохи — только чтение.
     *
     * Отделён от самого захвата намеренно: захват создаёт файл, который потом
     * не удаляется никогда, и открывать эпоху ради заведомо негодной дозаписи
     * нельзя. Вызывающий проверяет свои будущие записи против журнала, УЖЕ
     * содержащего запись `claimed` этого плана.
     */
    async planResume(input) {
      assertStrictOptions(
        input, { required: ['executionId', 'takeover', 'at'] }, 'planResume: параметры',
      )
      const { executionId: id, takeover, at } = input
      const assembled = await readAssembled(id)
      if (assembled.protocol !== 'g1') {
        throw new Error(
          `${assembled.tail.file}: журнал прежнего формата дозаписи не принимает — протокола `
          + 'владения в нём нет, и появиться задним числом он не может',
        )
      }
      if (assembled.fork !== null) {
        throw new Error(
          `${executionDir(id)}: журнал расщеплён — `
          + `${assembled.fork.totalOrphanRecords} записей и ${assembled.fork.totalOrphanBytes} байт `
          + `за границей перехвата в сегментах `
          + `${assembled.fork.segments.map((entry) => entry.name).join(', ')}. Дозапись закрыта.`,
        )
      }
      const appendability = appendabilityOf(assembled)
      if (appendability.value === 'readOnly') {
        throw new Error(`${assembled.tail.file}: журнал закрыт — дозаписи не будет`)
      }
      const { basis, binding, takeover: checked } = requireBinding(assembled, takeover, appendability)
      const epoch = assembled.segments.length + 1
      if (epoch > MAX_EPOCH) throw new Error(`${id}: номер эпохи вышел за ${MAX_EPOCH}`)
      const record = buildRecord({
        seq: assembled.verified.length,
        at,
        executionId: id,
        type: 'claimed',
        payload: buildClaimedPayload({
          executionId: id,
          generation: JOURNAL_GENERATION,
          epoch,
          basis,
          ...binding,
          takeover: checked,
        }),
      })
      const verified = parseAndVerifyJournal({
        records: [...assembled.verified, record], executionId: id, protocol: 'g1',
      })
      const plan = deepFreeze({
        executionId: id,
        epoch,
        segment: segmentName(JOURNAL_GENERATION, epoch),
        record,
        verified,
        expected: assembled.segments.map(describeSegment),
      })
      issuedPlans.add(plan)
      return plan
    },

    /**
     * Захват эпохи по плану.
     *
     * `EEXIST` — отказ и только отказ: пересчитать номер и попробовать
     * следующую эпоху значило бы обойти то самое взаимное исключение, ради
     * которого номера непрерывны.
     */
    async resumeJournal(input) {
      assertStrictOptions(input, { required: ['plan'] }, 'resumeJournal: параметры')
      const { plan } = input
      /* Одноразовость и происхождение — ДО чтения любого поля плана. */
      if (!issuedPlans.has(plan)) {
        throw new Error(
          'resumeJournal: план не выдан этим хранилищем либо уже использован. '
          + 'Захват идёт только по плану от planResume того же экземпляра, и ровно один раз.',
        )
      }
      issuedPlans.delete(plan)
      const id = plan.executionId
      const dir = executionDir(id)
      const before = await readAssembled(id)
      if (before.fork !== null || !sameSegments(before.segments.map(describeSegment), plan.expected)) {
        throw new Error(
          `${dir}: состояние сегментов изменилось между планом и захватом — план недействителен`,
        )
      }
      /* Имя и вложенность проверяются отдельно от происхождения: одно
         говорит, откуда объект, другое — куда уйдут байты. */
      const named = parseSegmentName(plan.segment)
      if (named === null || named.generation !== JOURNAL_GENERATION || named.epoch !== plan.epoch) {
        throw new Error(
          `resumeJournal: имя сегмента ${JSON.stringify(plan.segment)} не каноническое `
          + `либо не соответствует эпохе ${plan.epoch}`,
        )
      }
      const file = path.join(dir, plan.segment)
      pathVerdict(() => assertPathContainment(file, { insideDir: root, names }))
      let handle = null
      try {
        handle = await io.open(file, 'ax')
      } catch (error) {
        if (error?.code === 'EEXIST') {
          throw new Error(
            `${file}: эпоха ${plan.epoch} уже занята. Номер не пересчитывается и следующая эпоха `
            + 'не пробуется: существование сегмента резервирует эпоху немедленно.',
          )
        }
        throw error
      }
      try {
        /* Повторная сверка ПЕРЕД записью `claimed`: между планом и этой точкой
           незавершённый сегмент мог быть дописан прежним владельцем, и тогда
           полномочие описывает уже не те байты, которые владелец видел. */
        const again = await readAssembled(id)
        if (again.fork !== null || !sameSegments(again.segments.map(describeSegment).filter(
          (entry) => entry.name !== plan.segment,
        ), plan.expected)) {
          throw new Error(
            `${dir}: сегменты изменились после резервирования эпохи ${plan.epoch} — `
            + 'запись claimed не выполняется, эпоха остаётся незавершённой',
          )
        }
        await handle.writeFile(`${JSON.stringify(plan.record)}\n`, 'utf8')
        await handle.sync()
        await io.syncDirectory(dir)
      } catch (error) {
        try { await handle.close() } catch { /* дескриптор уже мог быть закрыт */ }
        throw error
      }
      return createHandle({
        handle,
        id,
        dir,
        epoch: plan.epoch,
        initial: plan.verified,
        fence: plan.expected.map((entry) => ({ name: entry.name, bytes: entry.bytes })),
      })
    },

    /**
     * Обзор ВСЕХ исполнений — только чтение.
     *
     * Нужен preflight'у для предупреждений: незакрытый, расщеплённый или
     * повреждённый чужой журнал знать полезно, но запрещать им новое
     * разрешение нельзя — это разные исполнения, и связи между ними нет.
     * Сканер ничего не создаёт, не чинит, не обрезает и не удаляет.
     */
    async scanExecutions() {
      let entries = []
      try {
        entries = await io.readdir(root)
      } catch (error) {
        if (error.code === 'ENOENT') return []
        throw error
      }
      const seen = []
      for (const name of entries.slice().sort()) {
        if (!/^[0-9a-f]{64}$/.test(name)) continue
        const summary = await this.readJournal(name)
        seen.push(Object.freeze({
          executionId: name,
          state: summary.state,
          outcome: summary.outcome,
          protocol: summary.protocol,
          appendability: summary.appendability,
          appendabilityReason: summary.appendabilityReason,
          fork: summary.fork,
          reason: summary.state === 'journalCorrupt' ? summary.reason : null,
        }))
      }
      return deepFreeze(seen)
    },

    /**
     * Чтение fail-closed. Файл не меняется ни при каком исходе: повреждённый
     * журнал не чинится и не дописывается.
     *
     * Протокол и право дозаписи — ортогональные поля. Бизнес-итог считается
     * прежней функцией и протокольным условием не подменяется: `preProtocol`
     * и `indeterminate` не отменяют того, что журнал уже сообщил о деньгах.
     */
    async readJournal(id) {
      try {
        const assembled = await readAssembled(id)
        const segments = assembled.segments.map(describeSegment)
        if (assembled.fork !== null) {
          return deepFreeze({
            state: 'journalForked',
            exitCode: EXIT_CODES.journalForked,
            reason: `расщеплено сегментов ${assembled.fork.segments.length} `
              + `(${assembled.fork.segments.map((entry) => entry.name).join(', ')}): `
              + `${assembled.fork.totalOrphanRecords} записей, `
              + `${assembled.fork.totalOrphanBytes} байт за границей перехвата, `
              + `из них оборванных ${assembled.fork.totalTornOrphanBytes}`,
            counts: null,
            outcome: null,
            deleteAfter: null,
            records: null,
            protocol: assembled.protocol,
            appendability: 'readOnly',
            appendabilityReason: null,
            pendingSegments: assembled.pending,
            segments,
            fork: assembled.fork,
          })
        }
        const appendability = appendabilityOf(assembled)
        return deepFreeze({
          ...summarizeJournal(assembled.verified),
          records: assembled.verified,
          protocol: assembled.protocol,
          appendability: appendability.value,
          appendabilityReason: appendability.value === 'indeterminate' ? appendability.reason : null,
          pendingSegments: assembled.pending,
          segments,
          fork: null,
        })
      } catch (error) {
        /* Только классифицированное повреждение содержимого. Системная и
           программная ошибка проходят наружу: вердикта из них не выводится. */
        if (!(error instanceof JournalCorruptError)) throw error
        return deepFreeze({
          state: 'journalCorrupt',
          exitCode: EXIT_CODES.journalCorrupt,
          reason: error.message,
          counts: null,
          outcome: null,
          deleteAfter: null,
          records: null,
          protocol: null,
          appendability: 'readOnly',
          appendabilityReason: null,
          pendingSegments: [],
          segments: [],
          fork: null,
        })
      }
    },
  })
}

/** Production-экземпляр: та же функция, корень репозитория из модуля. */
export const ARTIFACT_STORE = createArtifactStore({ repoRoot: REPO_ROOT })
