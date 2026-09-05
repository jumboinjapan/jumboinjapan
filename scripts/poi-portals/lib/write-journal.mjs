/**
 * ЖУРНАЛ ЭФФЕКТОВ PARSER-OWNED WRITE-PATH — `poi-write-journal/v1` (10f-R, P09.2).
 *
 * Дефект, который это закрывает (воспроизведён на production-композиции,
 * `tmp/10f-r-repro-OLD-2026-09-05.log`): POST создал запись, следующее чтение
 * отказало, весь исход прогона схлопнулся в `report.write = { error }`, код
 * возврата остался нулевым — и о созданной записи не осталось ни строчки. По
 * такому прогону нельзя ответить ни «что мы собирались сделать», ни «что из
 * этого получилось».
 *
 * Журнал отвечает ровно на эти два вопроса и ни на какой другой. Он не
 * повторяет запись, не откатывает её и ничего не удаляет: он хранит НАМЕРЕНИЕ
 * (до эффекта) и ИСХОД (после), чтобы поздняя сверка могла установить состояние
 * чтением базы, а не догадкой.
 *
 * Порядок обязателен и проверяется:
 *   1. `intent` записан и СБРОШЕН НА ДИСК (`fsync`) — ДО первого сетевого вызова;
 *   2. эффект;
 *   3. `outcome` — после независимого перечитывания, тоже с `fsync`.
 * Отказ на шаге 1 отменяет эффект (его ещё не было). Отказ на шаге 3 означает
 * `recoveryRequired`: эффект мог состояться, а доказательства нет.
 *
 * НАМЕРЕНИЕ НЕСЁТ ОЖИДАЕМЫЕ ЗНАЧЕНИЯ, а не только имена полей (10f-R R1,
 * находка аудита 2). Главный аварийный случай — эффект состоялся, исход не
 * записался. Поздняя сверка находит запись и обязана доказать, что это именно
 * задуманный результат: доказывать нечем, если в намерении нет самих
 * значений. Поэтому `intent` хранит поля целиком и их канонический digest.
 *
 * Формат — NDJSON, дозапись. Строка не переписывается никогда: журнал читается
 * последовательно, и последняя строка о записи — её текущее известное
 * состояние. Читатель строг (находка аудита 3): последовательность и форма
 * каждой строки проверяются грамматикой, а не «это JSON и spec совпал».
 */
import { mkdir, open, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { describeThrownSafely, thrownCode } from '../../../src/lib/thrown-value.ts'
import { canonicalJsonBytes } from '../../lib/canonical-contract.mjs'
import { sha256Bytes } from '../../lib/byte-digest.mjs'

export const WRITE_JOURNAL_SPEC = 'poi-write-journal/v1'
/** Каталог журналов по умолчанию. Переопределяется флагом `--write-journal`. */
export const WRITE_JOURNAL_DIR = 'tmp/poi-write-journal'
/** Имя файла журнала внутри каталога прогона. */
export const WRITE_JOURNAL_FILE = 'journal.ndjson'

/** Роды строк журнала — закрытый список. */
export const JOURNAL_KINDS = Object.freeze(['runStarted', 'intent', 'outcome', 'runFinished'])
/** Домен digest ожидаемых полей записи. */
export const INTENT_FIELDS_SPEC = 'poi-write-intent-fields/v1'
/** Способ независимой проверки — ЗАКРЫТЫЙ список из одного значения. */
export const VERIFICATION_KINDS = Object.freeze(['liveRead'])
/**
 * Шаги намерения — закрытый список и обязательный порядок на один ключ:
 *   prepare  — граница получила поля и собирается писать (ещё без нагрузки store);
 *   create   — хранилище назвало ТОЧНУЮ нагрузку POST, включая свои поля;
 *   rename   — хранилище собирается переименовать номер (PATCH) — и это тоже эффект.
 * Полный ожидаемый итог = нагрузка `create` с номером последнего `rename`.
 */
export const INTENT_STEPS = Object.freeze(['prepare', 'create', 'rename'])
/** Закрытые схемы строк: ровно эти ключи, ни одним больше и ни одним меньше. */
export const LINE_KEYS = Object.freeze({
  runStarted: Object.freeze(['spec', 'seq', 'at', 'runId', 'kind', 'meta']),
  intent: Object.freeze(['spec', 'seq', 'at', 'runId', 'kind', 'sourceKey', 'verification', 'step', 'fields', 'fieldsDigest', 'recordId', 'from']),
  outcome: Object.freeze(['spec', 'seq', 'at', 'runId', 'kind', 'sourceKey', 'verification', 'state', 'reason', 'recordId', 'poiId', 'differing']),
  runFinished: Object.freeze(['spec', 'seq', 'at', 'runId', 'kind', 'attempts', 'failed']),
})

/** Канонический digest полей записи — то, что намерение обещает базе. */
export function intentFieldsDigest(fields) {
  return sha256Bytes(canonicalJsonBytes(fields, INTENT_FIELDS_SPEC))
}

/**
 * Состояния исхода одной попытки записи — ЗАКРЫТЫЙ СПИСОК.
 *
 * Успех ровно один. «Неизвестно» — отдельное состояние, а не отсутствие
 * записи: неизвестный исход после возможной отправки нельзя считать ни
 * успехом, ни отсутствием эффекта.
 */
export const WRITE_STATES = Object.freeze([
  'verified',    // независимое чтение нашло ровно одну запись с этим ключом
  'notApplied',  // независимое чтение доказало, что записи нет
  'ambiguous',   // независимое чтение нашло больше одной записи с этим ключом
  'mismatch',    // запись есть, но это не та, о которой отчитался writer
  'unknown',     // проверить нечем: чтение отказало или эффект оборвался
  'dryRun',      // живого эффекта не было по устройству прогона
])
/** Состояния, требующие ручного разбора по журналу. */
export const RECOVERY_STATES = Object.freeze(['ambiguous', 'mismatch', 'unknown'])

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Открывает журнал прогона. Каталог прогона — свой у каждого `runId`: два
 * прогона в один файл не пишут, и перепутать их строки нельзя.
 *
 * @param options.dir   корневой каталог журналов
 * @param options.runId идентификатор прогона (входит в путь)
 * @param options.now   момент открытия
 */
/**
 * Сброс дескриптора на носитель. Вынесен отдельно, чтобы производственный
 * вызов и проверка целились в одну функцию: подменять `sync` ради теста нельзя,
 * а наблюдать его вызов — можно.
 */
export async function durable(handle) {
  await handle.sync()
}

/**
 * Сброс КАТАЛОГА на носитель (10f-R R2, находка аудита 3). `fsync` файла
 * фиксирует его содержимое, но не запись о нём в каталоге: после сбоя питания
 * файл с зафиксированными байтами может не существовать по имени. Поэтому
 * после создания каталога прогона синхронизируется родитель, а после создания
 * файла журнала — сам каталог прогона. Отказ здесь — отказ ДО первого эффекта.
 */
export async function durableDirectory(dirPath) {
  const handle = await open(dirPath, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Файловые операции цепочки долговечности — подменяемы только для наблюдения. */
export const DIRECTORY_IO = Object.freeze({ stat, mkdir, durableDirectory, open })

/**
 * ПОЛНАЯ ЦЕПОЧКА ДОЛГОВЕЧНОСТИ ВНОВЬ СОЗДАННЫХ ИМЁН (10f-R R3, находка
 * аудита 4). `mkdir(..., { recursive: true })` на первом запуске создаёт
 * несколько уровней разом, а синхронизировался только родитель каталога
 * прогона: записи о промежуточных каталогах — и о самом корне журналов в
 * содержащем его каталоге — оставались незафиксированными
 * (`tmp/10f-r-r3-repro-OLD-2026-09-05.log`, strace: пять `mkdir`, два `fsync`).
 *
 * Теперь каталоги создаются ПО ОДНОМУ, от самого глубокого существующего
 * предка вниз, и после КАЖДОГО создания синхронизируется каталог, в котором
 * появилось новое имя. Существующие каталоги не трогаются и не
 * синхронизируются: у них нового имени нет. Возвращает список созданных
 * каталогов — сверху вниз.
 */
/**
 * Обычная ошибка с устойчивым описанием вместо произвольного брошенного
 * значения (10f-R R7). Враждебное значение не покидает модуль журнала: дальше
 * с ним работал бы чужой код — отчёт, лог, сравнение, — и каждый такой шаг
 * снова исполнял бы ловушки.
 */
const journalError = (context, thrown) => new Error(`${WRITE_JOURNAL_SPEC}: ${context}: ${describeThrownSafely(thrown)}`)

export async function ensureDurableDirectory(dirPath, io = DIRECTORY_IO) {
  const target = path.resolve(dirPath)
  const missing = []
  let probe = target
  for (;;) {
    let exists = false
    try {
      const info = await io.stat(probe)
      if (!info.isDirectory()) throw new Error(`${WRITE_JOURNAL_SPEC}: ${probe} существует и не является каталогом — цепочка каталогов не строится`)
      exists = true
    } catch (error) {
      /* Код ошибки читается безопасно: `error?.code` на отозванном Proxy —
         ловушка `get`, и она срывала бы сам fail-closed шаг (10f-R R7). */
      const code = thrownCode(error)
      if (code === 'ENOTDIR') throw new Error(`${WRITE_JOURNAL_SPEC}: на пути к ${target} лежит файл, а не каталог (${probe})`)
      if (code !== 'ENOENT') throw journalError(`проверка каталога ${probe} отказала`, error)
    }
    if (exists) break
    missing.unshift(probe)
    const parent = path.dirname(probe)
    if (parent === probe) throw new Error(`${WRITE_JOURNAL_SPEC}: корень файловой системы не найден при создании ${target}`)
    probe = parent
  }
  for (const dir of missing) {
    try {
      await io.mkdir(dir)
    } catch (error) {
      /* Кто-то создал каталог между stat и mkdir: имя есть, но зафиксировано
         ли оно — неизвестно; синхронизировать родителя всё равно. */
      if (thrownCode(error) !== 'EEXIST') throw journalError(`создание каталога ${dir} отказало`, error)
    }
    await io.durableDirectory(path.dirname(dir))
  }
  return missing
}

export async function openWriteJournal({ dir = WRITE_JOURNAL_DIR, runId, now = new Date(), meta = {}, io: injectedIo = null } = {}) {
  /* Файловые операции подменяемы по одной — только для наблюдения и отказов в тестах. */
  const io = { ...DIRECTORY_IO, ...(injectedIo ?? {}) }
  if (typeof runId !== 'string' || !runId.trim()) {
    throw new TypeError(`${WRITE_JOURNAL_SPEC}: runId обязателен и не может быть пустым`)
  }
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(runId)) {
    throw new TypeError(`${WRITE_JOURNAL_SPEC}: runId «${runId}» содержит недопустимые символы: журнал адресуется путём`)
  }
  const runDir = path.join(dir, runId)
  const file = path.join(runDir, WRITE_JOURNAL_FILE)
  /* Каждое вновь созданное имя — от корня журналов до каталога прогона —
     зафиксировано в содержащем его каталоге ДО первого эффекта. */
  await ensureDurableDirectory(runDir, io)
  /* ЗАНЯТОЕ ИМЯ — ОТКАЗ, А НЕ ДОЗАПИСЬ В ЧУЖОЙ ЖУРНАЛ. Два прогона в одном
     файле неразличимы: исход первого читался бы как исход второго. Создание
     эксклюзивное, и отказ приходит ДО первого эффекта. */
  let seq = 0
  let closed = false
  let created = false
  /* ТА ЖЕ ГРАММАТИКА, ЧТО У ЧИТАТЕЛЯ, — ДО ЗАПИСИ (10f-R R3, находка 3).
     Писатель не может произвести строку, которую читатель отвергнет:
     повторную попытку для ключа, `verified` без объявленного эффекта,
     закрывающую строку, противоречащую попыткам. Отказ — до эффекта. */
  const grammar = journalGrammar(file)
  /* ПЕЧАТЬ ПОСЛЕ ОТКАЗА ЗАПИСИ (10f-R R4, находка аудита 1). Отказавшая
     дозапись могла оставить на диске часть строки; следующая строка, дописанная
     за ней, склеилась бы с обрывком в нечитаемую — и журнал с уже сохранённым
     намерением стал бы непригоден для сверки. Поэтому после ЛЮБОГО отказа
     дозаписи журнал запечатывается: дальнейшие строки — включая закрывающую —
     отказываются с именем отказавшей строки; на диске остаётся сплошной
     префикс долговечных строк и, самое большее, оборванный хвост, который
     читатель распознаёт и отбрасывает. */
  let sealed = null

  const append = async (kind, payload) => {
    if (closed) throw new Error(`${WRITE_JOURNAL_SPEC}: журнал ${file} уже закрыт, дозапись невозможна`)
    if (sealed) {
      throw new Error(`${WRITE_JOURNAL_SPEC}: журнал ${file} запечатан после отказа записи строки ${sealed.seq} (${sealed.kind}): ${sealed.reason}; дозапись запрещена, сохранённые строки 1–${seq} читаются`)
    }
    if (!JOURNAL_KINDS.includes(kind)) {
      throw new TypeError(`${WRITE_JOURNAL_SPEC}: неизвестный род строки ${JSON.stringify(kind)}`)
    }
    if (!isPlainObject(payload)) {
      throw new TypeError(`${WRITE_JOURNAL_SPEC}.${kind}: полезная нагрузка обязана быть простым объектом`)
    }
    const line = { spec: WRITE_JOURNAL_SPEC, seq: seq + 1, at: new Date(now.getTime()).toISOString(), runId, kind, ...payload }
    /* Грамматика проверяет строку ДО записи, но состояние (и seq) не
       подтверждает её раньше долговечной записи: строка существует, когда её
       байты на носителе, а не когда она сочинена (10f-R R4, находка 1). */
    grammar.accept(line, { last: kind === 'runFinished', apply: false })
    const text = `${JSON.stringify(line)}\n`
    /* ФИКСАЦИЯ НА ДИСКЕ — ЧАСТЬ КОНТРАКТА, А НЕ ОБЕЩАНИЕ (10f-R R1, находка
       аудита 4). `appendFile` возвращает управление, когда байты ушли в
       страничный кэш; сбой питания между ним и эффектом оставил бы эффект без
       намерения. Поэтому строка пишется через дескриптор и `sync()` — вызов
       не возвращается, пока ядро не подтвердит запись на носитель. Первая
       строка создаёт файл эксклюзивно (`wx`): существующий журнал этого
       прогона — отказ, а не приглашение дописать. */
    /**
     * ПЕЧАТЬ ЖУРНАЛА ПО ЛЮБОМУ БРОШЕННОМУ ЗНАЧЕНИЮ (10f-R R6, находка 1).
     *
     * Прежняя редакция строила причину сама — `instanceof Error`, `.message`,
     * `String(...)`. Каждое из трёх — чужой код на враждебном значении:
     * отозванный Proxy бросает уже на `instanceof` (ловушка `getPrototypeOf`).
     * Тогда из `append` выходил ВТОРИЧНЫЙ TypeError, `sealed` оставался null,
     * `finish()` дописывал строку с тем же `seq`, и журнал становился
     * нечитаемым (`tmp/10f-r-r6-repro-OLD-2026-09-05.log`).
     *
     * Причина строится единственным безопасным описателем проекта
     * (`describeThrownSafely`, `src/lib/thrown-value.ts`) — второй редакции той
     * же fail-closed процедуры в проекте быть не должно: расходятся они ровно
     * на том значении, ради которого написаны. Барьер описателя гарантирует,
     * что отказ форматирования не покидает его самого; поэтому печать здесь
     * ставится ВСЕГДА и до любого другого действия.
     *
     * Наружу уходит обычная `Error` с устойчивым текстом: враждебное значение
     * дальше границы журнала не путешествует.
     */
    const seal = (thrown) => {
      const reason = describeThrownSafely(thrown)
      sealed = { seq: line.seq, kind, reason }
      return new Error(`${WRITE_JOURNAL_SPEC}: ${file}, строка ${line.seq} (${kind}) не записана: ${reason}`)
    }
    let handle
    try {
      handle = await io.open(file, created ? 'a' : 'wx')
    } catch (error) {
      if (thrownCode(error) === 'EEXIST') {
        /* ПУТЬ НЕ ПОВТОРЯЕТСЯ ВО ВЛОЖЕННОЙ ПРИЧИНЕ (10f-R R8). Внешний текст
           печати уже называет файл, а вложенная причина проходит через
           обрезку описателя (200 кодовых точек): повтор длинного пути съедал
           бюджет, и признаки «уже существует» и «дозапись в чужой журнал
           запрещена» терялись на длинном каталоге — на macOS с его длинным
           TMPDIR это давало 369/370 при 370/370 с `TMPDIR=/tmp`. Признаки
           стоят первыми и от длины пути больше не зависят. */
        throw seal(new Error(`журнал этого прогона уже существует — прогон ${runId} уже записан, дозапись в чужой журнал запрещена`))
      }
      throw seal(error)
    }
    /* Отказ ЛЮБОГО шага — печать, включая close() после удачного sync
       (10f-R R5, находка 1): строка может лежать на диске полной, но писатель
       её не подтверждает; без печати следующая строка получила бы тот же seq. */
    /* ОТКАЗ ОПОЗНАЁТСЯ ФАКТОМ, А НЕ ИСТИННОСТЬЮ ЗНАЧЕНИЯ (10f-R R6). Бросить
       можно `null`, `undefined` и `0`; проверка `if (failure)` пропускала их
       как успех — тот же класс дефекта, что и разбор значения в `seal`.
       Признак отказа — булев флаг, само значение только описывается. */
    let failed = false
    let failure = null
    try {
      await handle.writeFile(text, 'utf8')
      await durable(handle)
    } catch (error) {
      failed = true
      failure = error
    }
    try {
      await handle.close()
    } catch (error) {
      if (!failed) {
        failed = true
        failure = error
      }
    }
    if (failed) throw seal(failure)
    if (!created) {
      /* Первая строка создала файл: запись о нём фиксируется в каталоге
         прогона. Без этого зафиксированные байты могут не иметь имени. */
      try {
        await io.durableDirectory(runDir)
      } catch (error) {
        throw seal(error)
      }
    }
    /* ТОЛЬКО ТЕПЕРЬ строка существует: состояние грамматики и seq. */
    grammar.accept(line, { last: kind === 'runFinished' })
    seq += 1
    created = true
    return line
  }

  await append('runStarted', { meta })

  return {
    file,
    runDir,
    get entries() { return seq },
    /** Печать после отказа дозаписи: `{ seq, kind, reason }` или null. */
    get sealed() { return sealed },
    /**
     * Намерение — ДО эффекта, С ОЖИДАЕМЫМИ ЗНАЧЕНИЯМИ. Отказ здесь означает,
     * что эффекта не было. Намерение без полей не принимается: сверять потом
     * было бы нечего.
     */
    async intent(payload) {
      if (!INTENT_STEPS.includes(payload?.step)) {
        throw new TypeError(`${WRITE_JOURNAL_SPEC}.intent.step: ожидается один из ${INTENT_STEPS.join(', ')}, получено ${JSON.stringify(payload?.step)}`)
      }
      if (!VERIFICATION_KINDS.includes(payload?.verification)) {
        throw new TypeError(`${WRITE_JOURNAL_SPEC}.intent.verification: ожидается один из ${VERIFICATION_KINDS.join(', ')}`)
      }
      if (!isPlainObject(payload?.fields) || !Object.keys(payload.fields).length) {
        throw new TypeError(`${WRITE_JOURNAL_SPEC}.intent: намерение обязано нести ожидаемые поля записи целиком`)
      }
      const fieldsDigest = intentFieldsDigest(payload.fields)
      if (payload.fieldsDigest !== undefined && payload.fieldsDigest !== fieldsDigest) {
        throw new TypeError(`${WRITE_JOURNAL_SPEC}.intent: fieldsDigest не совпадает с полями`)
      }
      return append('intent', {
        sourceKey: payload.sourceKey,
        verification: payload.verification,
        step: payload.step,
        fields: payload.fields,
        fieldsDigest,
        recordId: payload.recordId ?? null,
        from: payload.from ?? null,
      })
    },
    /** Исход — ПОСЛЕ независимого чтения. */
    async outcome(payload) {
      if (!WRITE_STATES.includes(payload?.state)) {
        throw new TypeError(
          `${WRITE_JOURNAL_SPEC}.outcome.state: ожидается один из ${WRITE_STATES.join(', ')}, `
          + `получено ${JSON.stringify(payload?.state)}`,
        )
      }
      if (!VERIFICATION_KINDS.includes(payload?.verification)) {
        throw new TypeError(`${WRITE_JOURNAL_SPEC}.outcome.verification: ожидается один из ${VERIFICATION_KINDS.join(', ')}`)
      }
      return append('outcome', {
        sourceKey: payload.sourceKey,
        verification: payload.verification,
        state: payload.state,
        reason: String(payload.reason ?? ''),
        recordId: payload.recordId ?? null,
        poiId: payload.poiId ?? null,
        differing: Array.isArray(payload.differing) ? payload.differing : [],
      })
    },
    /**
     * Закрывающая строка ВЫВОДИТСЯ из попыток, а не сообщается вызывающим:
     * `attempts` — число намерений `prepare`, `failed` — есть ли попытка без
     * исхода `verified`. Сообщённые вызывающим значения не принимаются:
     * строка, противоречащая журналу, не должна существовать.
     */
    async finish() {
      const line = await append('runFinished', grammar.closing())
      closed = true
      return line
    },
    /** Что журнал знает о попытках прямо сейчас — для отчёта прогона. */
    get closing() { return grammar.closing() },
  }
}

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
/**
 * Момент — календарно строгий (10f-R R2): форма по регулярному выражению
 * пропускала `2026-02-31T25:61:61.999Z`. Настоящий момент разбирается и,
 * сериализованный обратно, совпадает с записанным побайтово.
 */
export const isCanonicalInstant = (value) => {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}
const exactKeys = (entry, keys) => {
  const own = Object.keys(entry).sort()
  const want = [...keys].sort()
  return own.length === want.length && own.every((k, i) => k === want[i])
}

/**
 * ГРАММАТИКА ЖУРНАЛА — строгая, и читатель fail-closed (10f-R R1/R2).
 *
 * До R1 проверялись только JSON, `spec` и `kind`; до R2 — непустота
 * `verification` и форма момента регулярным выражением: строка с
 * `verification: trusted-cache` и моментом `2026-02-31T25:61:61.999Z`
 * принималась. Журнал, которому нельзя верить по форме, не годится и по
 * содержанию.
 *
 * Правила:
 *   • каждая строка — ЗАКРЫТАЯ схема своего рода (ровно объявленные ключи);
 *   • первая строка — `runStarted`, и только она; `runFinished` — только
 *     последней, не более одной;
 *   • `seq` — сплошная нумерация с 1; `runId` один на весь файл;
 *   • `at` — календарно строгий канонический момент;
 *   • `verification` — только из закрытого списка, и одинаковый у всех
 *     строк одного ключа;
 *   • на один ключ источника шаги идут строго `prepare` → `create`? →
 *     `rename`* → `outcome`; `rename` без `create` и `create` без `prepare`
 *     — отказ; повторный `prepare` до исхода — отказ;
 *   • `intent` несёт поля и сходящийся digest; `rename` несёт `recordId`,
 *     `from` и ровно одно поле `POI ID`.
 * Незавершённый журнал (без `runFinished` и/или без исхода) — законная форма:
 * так выглядит оборванный прогон, и именно его сверка разбирает.
 */
/**
 * ГРАММАТИКА ЖУРНАЛА — одна и та же у писателя (до записи строки) и у
 * читателя (при чтении). Семантика, а не только форма (10f-R R3, находка 3):
 *   - ключ источника открывается `prepare` РОВНО ОДИН РАЗ за журнал —
 *     повторная попытка не записывается и не читается, скрыть первую нельзя;
 *   - `verified` возможен только после объявленного эффекта (`create`/`rename`):
 *     успех без эффекта — не успех;
 *   - `runFinished.attempts` равен числу `prepare`, `failed` — истина ровно
 *     тогда, когда есть попытка без исхода `verified`; иная закрывающая
 *     строка противоречит журналу и отвергается.
 */
export function journalGrammar(file = '(журнал)') {
  const where = `${WRITE_JOURNAL_SPEC}: ${file}`
  let count = 0
  let runId = null
  let finished = false
  /* sourceKey → { step, verification, state } — state null, пока исхода нет. */
  const attempts = new Map()
  const closing = () => ({
    attempts: attempts.size,
    failed: [...attempts.values()].some((a) => a.state !== 'verified'),
  })
  return {
    accept(entry, { last = false, apply = true } = {}) {
      const i = count
      const refuse = (why) => { throw new Error(`${where}, строка ${i + 1}: ${why}`) }
      /* Изменения состояния копятся и применяются ТОЛЬКО после всех проверок
         и только при `apply`: писатель проверяет строку до записи, а
         подтверждает её после долговечной записи (10f-R R4). */
      const mutations = []
      if (finished) refuse('runFinished допустим только последней строкой')
      if (!isPlainObject(entry) || entry.spec !== WRITE_JOURNAL_SPEC) refuse('не принадлежит журналу этой версии')
      if (!JOURNAL_KINDS.includes(entry.kind)) refuse(`неизвестный род ${JSON.stringify(entry.kind)}`)
      if (!exactKeys(entry, LINE_KEYS[entry.kind])) {
        refuse(`строка рода ${entry.kind} не соответствует закрытой схеме: ожидались ровно ключи ${LINE_KEYS[entry.kind].join(', ')}`)
      }
      if (entry.seq !== i + 1) refuse(`seq ${JSON.stringify(entry.seq)} нарушает сплошную нумерацию (ожидалось ${i + 1})`)
      const expectedRunId = i === 0 ? entry.runId : runId
      if (i === 0) mutations.push(() => { runId = entry.runId })
      if (!isNonEmptyString(entry.runId) || entry.runId !== expectedRunId) refuse('runId отсутствует или отличается от первой строки')
      if (!isCanonicalInstant(entry.at)) refuse(`at ${JSON.stringify(entry.at)} — не календарно строгий канонический момент`)
      if (i === 0 && entry.kind !== 'runStarted') refuse('журнал обязан начинаться с runStarted')
      if (i > 0 && entry.kind === 'runStarted') refuse('runStarted допустим только первой строкой')
      if (entry.kind === 'runStarted' && !isPlainObject(entry.meta)) refuse('runStarted.meta обязан быть объектом')
      if (entry.kind === 'runFinished') {
        if (!last) refuse('runFinished допустим только последней строкой')
        if (!Number.isInteger(entry.attempts) || entry.attempts < 0 || typeof entry.failed !== 'boolean') refuse('runFinished: attempts — целое ≥ 0, failed — булево')
        const expected = closing()
        if (entry.attempts !== expected.attempts) refuse(`runFinished.attempts ${entry.attempts} противоречит журналу: намерений prepare — ${expected.attempts}`)
        if (entry.failed !== expected.failed) {
          refuse(`runFinished.failed ${entry.failed} противоречит журналу: ${expected.failed ? 'есть попытка без исхода verified' : 'все попытки verified'}`)
        }
        mutations.push(() => { finished = true })
      }
      if (entry.kind === 'intent' || entry.kind === 'outcome') {
        if (!isNonEmptyString(entry.sourceKey)) refuse(`${entry.kind} без ключа источника`)
        if (!VERIFICATION_KINDS.includes(entry.verification)) refuse(`${entry.kind}.verification ${JSON.stringify(entry.verification)} вне закрытого списка (${VERIFICATION_KINDS.join(', ')})`)
      }
      if (entry.kind === 'intent') {
        if (!INTENT_STEPS.includes(entry.step)) refuse(`intent.step ${JSON.stringify(entry.step)} вне закрытого списка`)
        if (!isPlainObject(entry.fields) || !Object.keys(entry.fields).length) refuse('intent без ожидаемых полей')
        if (entry.fieldsDigest !== intentFieldsDigest(entry.fields)) refuse('fieldsDigest не совпадает с полями намерения')
        const known = attempts.get(entry.sourceKey)
        if (entry.step === 'prepare') {
          if (known) {
            refuse(known.state === null
              ? `повторное намерение для ${entry.sourceKey} без исхода предыдущего`
              : `повторная попытка для ${entry.sourceKey}: ключ уже завершён исходом ${known.state}, вторая попытка в том же журнале запрещена`)
          }
          if (entry.recordId !== null || entry.from !== null) refuse('prepare не несёт recordId и from')
          mutations.push(() => attempts.set(entry.sourceKey, { step: 'prepare', verification: entry.verification, state: null }))
        } else if (entry.step === 'create') {
          if (!known || known.state !== null || known.step !== 'prepare') refuse(`create для ${entry.sourceKey} без предшествующего prepare`)
          if (known.verification !== entry.verification) refuse('способ проверки отличается от prepare')
          if (entry.recordId !== null || entry.from !== null) refuse('create не несёт recordId и from')
          if (!isNonEmptyString(entry.fields['POI ID'])) refuse('create обязан нести POI ID в нагрузке')
          mutations.push(() => { known.step = 'create' })
        } else {
          if (!known || known.state !== null || (known.step !== 'create' && known.step !== 'rename')) refuse(`rename для ${entry.sourceKey} без предшествующего create`)
          if (known.verification !== entry.verification) refuse('способ проверки отличается от prepare')
          if (!isNonEmptyString(entry.recordId) || !isNonEmptyString(entry.from)) refuse('rename обязан нести recordId и from')
          const keys = Object.keys(entry.fields)
          if (keys.length !== 1 || keys[0] !== 'POI ID' || !isNonEmptyString(entry.fields['POI ID'])) refuse('rename несёт ровно одно поле — новый POI ID')
          mutations.push(() => { known.step = 'rename' })
        }
      }
      if (entry.kind === 'outcome') {
        if (!WRITE_STATES.includes(entry.state)) refuse(`outcome с состоянием вне закрытого списка: ${JSON.stringify(entry.state)}`)
        if (typeof entry.reason !== 'string') refuse('outcome.reason обязан быть строкой')
        if (!Array.isArray(entry.differing) || entry.differing.some((d) => !isNonEmptyString(d))) refuse('outcome.differing — список имён полей')
        const known = attempts.get(entry.sourceKey)
        if (!known || known.state !== null) refuse(`outcome для ${entry.sourceKey} без предшествующего intent`)
        if (known.verification !== entry.verification) refuse('способ проверки исхода отличается от намерения')
        if (entry.state === 'verified') {
          if (known.step === 'prepare') refuse(`verified для ${entry.sourceKey} без объявленного эффекта (create/rename): успех без эффекта — не успех`)
          if (!isNonEmptyString(entry.recordId) || !isNonEmptyString(entry.poiId)) refuse('verified обязан нести recordId и poiId из базы')
        }
        mutations.push(() => { known.state = entry.state })
      }
      if (apply) {
        for (const mutate of mutations) mutate()
        count += 1
      }
    },
    closing,
  }
}

/** Проверка всего журнала той же грамматикой. Возвращает строки как есть. */
export function assertWriteJournalGrammar(entries, file = '(журнал)') {
  if (!Array.isArray(entries) || !entries.length) throw new Error(`${WRITE_JOURNAL_SPEC}: ${file}: журнал пуст`)
  const grammar = journalGrammar(file)
  entries.forEach((entry, i) => grammar.accept(entry, { last: i === entries.length - 1 }))
  return entries
}

/**
 * Чтение журнала с разбором ОБОРВАННОГО ХВОСТА (10f-R R4, находка 1).
 * Строка существует, когда её байты и завершающий перевод строки долговечны.
 * Отказ дозаписи мог оставить на диске начало строки без `\n`; такой хвост —
 * не повреждение, а след отказавшей записи: он называется (`tornTail`) и не
 * входит в строки. Всё, что заканчивается переводом строки, обязано быть
 * законной строкой; обрывок посреди файла — отказ, как и прежде.
 */
export async function readWriteJournalDetailed(file) {
  const text = await readFile(file, 'utf8')
  const segments = text.split('\n')
  const terminated = text.endsWith('\n')
  /* Завершающий перевод строки даёт последний пустой сегмент — это артефакт
     разделителя, а не строка. Всё остальное — физические строки, и каждая
     обязана быть одной JSON-записью. */
  if (terminated) segments.pop()
  const tail = terminated ? '' : (segments.pop() ?? '')
  /* ФИЗИЧЕСКАЯ ГРАММАТИКА FAIL-CLOSED (10f-R R6, находка 2). Прежняя редакция
     отбрасывала пустые строки (`filter(line => line.length)`): лишний перевод
     строки после `runFinished` проходил молча, хотя обещано отвергать любые
     последующие байты, и пустая строка внутри журнала исчезала бесследно. */
  const empty = segments.findIndex((line) => !line.length)
  if (empty !== -1) {
    throw new Error(
      `${WRITE_JOURNAL_SPEC}: ${file}, строка ${empty + 1} пуста — журнал повреждён: `
      + 'каждая завершённая физическая строка обязана быть одной JSON-записью, '
      + 'а после runFinished не может быть никаких байтов',
    )
  }
  const lines = segments
  const entries = lines.map((line, i) => {
    try {
      return JSON.parse(line)
    } catch (error) {
      throw new Error(`${WRITE_JOURNAL_SPEC}: ${file}, строка ${i + 1} не разбирается: ${error.message}`)
    }
  })
  assertWriteJournalGrammar(entries, file)
  /* Оборванный хвост допустим только у НЕЗАВЕРШЁННОГО журнала: после
     `runFinished` писатель ничего не дописывает, и любые байты за ней —
     повреждение, а не след отказавшей записи (10f-R R5, находка 3). */
  if (tail.length && entries[entries.length - 1]?.kind === 'runFinished') {
    throw new Error(`${WRITE_JOURNAL_SPEC}: ${file}: ${Buffer.byteLength(tail, 'utf8')} байт после runFinished — журнал повреждён, аварийный хвост после закрывающей строки невозможен`)
  }
  return {
    entries,
    tornTail: tail.length ? { bytes: Buffer.byteLength(tail, 'utf8'), preview: tail.slice(0, 80) } : null,
  }
}

export async function readWriteJournal(file) {
  return (await readWriteJournalDetailed(file)).entries
}

/**
 * Сводит журнал к состоянию каждой попытки: намерение и последний известный
 * исход. Намерение без исхода — `unknown`: строка, у которой эффект мог
 * состояться, а запись об исходе не легла.
 */
export function summarizeWriteJournal(entries) {
  const bySourceKey = new Map()
  const known = (key) => {
    if (!bySourceKey.has(key)) bySourceKey.set(key, { sourceKey: key, prepare: null, create: null, renames: [], outcome: null })
    return bySourceKey.get(key)
  }
  for (const entry of entries) {
    if (entry.kind === 'intent') {
      const attempt = known(entry.sourceKey)
      if (entry.step === 'prepare') {
        /* СВОДКА НЕ СКРЫВАЕТ ПОПЫТОК (10f-R R3, находка 3). Грамматика
           повторный `prepare` не пропускает; если строки пришли мимо неё —
           отказ, а не «последняя попытка побеждает»: за поздним `verified`
           исчезал ранний `mismatch`, и `recoveryRequired` становился пустым. */
        if (attempt.prepare) throw new Error(`${WRITE_JOURNAL_SPEC}: сводка отказана — повторная попытка для ${entry.sourceKey} в одном журнале`)
        attempt.prepare = entry
      }
      if (entry.step === 'create') attempt.create = entry
      if (entry.step === 'rename') attempt.renames.push(entry)
    } else if (entry.kind === 'outcome') {
      const attempt = known(entry.sourceKey)
      if (attempt.outcome) throw new Error(`${WRITE_JOURNAL_SPEC}: сводка отказана — второй исход для ${entry.sourceKey}`)
      attempt.outcome = entry
    }
  }
  const attempts = [...bySourceKey.values()].map((attempt) => {
    const lastRename = attempt.renames[attempt.renames.length - 1] ?? null
    /* ПОЛНЫЙ ОЖИДАЕМЫЙ ИТОГ: нагрузка `create` (со всеми полями, которые
       добавило хранилище) с номером последнего переименования. Только
       `prepare` — итога нет: хранилище не успело назвать нагрузку, и эффекта
       быть не могло (намерение пишется ДО него). */
    const expectedFields = attempt.create
      ? { ...attempt.create.fields, ...(lastRename ? { 'POI ID': lastRename.fields['POI ID'] } : {}) }
      : null
    return {
      sourceKey: attempt.sourceKey,
      state: attempt.outcome?.state ?? 'unknown',
      reason: attempt.outcome?.reason ?? (attempt.outcome ? null : 'намерение записано, исход — нет'),
      recordId: attempt.outcome?.recordId ?? lastRename?.recordId ?? null,
      poiId: attempt.outcome?.poiId ?? null,
      verification: attempt.outcome?.verification ?? attempt.prepare?.verification ?? null,
      effectIntended: Boolean(attempt.create),
      expectedFields,
      expectedDigest: expectedFields ? intentFieldsDigest(expectedFields) : null,
    }
  })
  const byState = {}
  for (const attempt of attempts) byState[attempt.state] = (byState[attempt.state] ?? 0) + 1
  return {
    attempts,
    byState,
    recoveryRequired: attempts.filter((a) => RECOVERY_STATES.includes(a.state)),
  }
}
