/**
 * Хранилище разрешений владельца: `tmp/poi-model-approvals/`.
 *
 * Разрешение — не значение в памяти, а файл. Пока исполнение можно было
 * начать по объекту, полученному откуда угодно, каталог оставался
 * необязательным побочным хранилищем, а «разрешение владельца» — тем, что
 * вызывающий назвал разрешением. Поэтому сессия исполнения открывается
 * только по СОХРАНЁННОМУ и заново проверенному файлу.
 *
 * Имя файла детерминировано и выводится из подписи разрешения. Так повтор
 * виден `wx`, а подмена содержимого под чужим именем — сверке имени с
 * пересчитанной подписью.
 *
 * Ожидаемый отказ и сбой среды здесь РАЗНЫЕ вещи, и различает их тип, а не
 * текст сообщения. «Имя не то», «файла нет», «на месте файла не файл», «байты
 * не UTF-8», «не JSON», «разрешение не сходится», «файл лежит не под своим
 * именем» — приговор о разрешении, и он приходит `ApprovalRejected`. Отказ
 * самого чтения (EIO, EACCES, EPERM) приговором не становится никогда: он
 * говорит «не прочитано», а не «отвергнуто», и уходит наружу как есть.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import {
  ARTIFACT_NAMES,
  assertExclusiveJsonTarget,
  assertExistingRegularFile,
  assertPathContainment,
  ensureDirectoryChain,
} from '../../lib/path-boundary.mjs'
import { assertSha256Value } from '../../lib/canonical-contract.mjs'
import { parseAndVerifyApproval } from './model-approval.mjs'
import { assertStrictOptions } from './model-execution.mjs'

/** Каталог разрешений относительно корня репозитория. Параметра для него нет. */
export const APPROVAL_ROOT_SEGMENTS = Object.freeze(['tmp', 'poi-model-approvals'])
export const APPROVAL_ROOT_REL = path.join(...APPROVAL_ROOT_SEGMENTS)

/** Закрытый список причин отказа. Разбирать текст сообщения незачем. */
export const APPROVAL_REJECTION_REASONS = Object.freeze([
  'fileName', 'pathBoundary', 'leaf', 'notUtf8', 'notJson', 'approvalShape', 'fileNameMismatch',
])

/**
 * Ожидаемый отказ разрешения. Именно им — и только им — вызывающий вправе
 * отвечать «разрешение отвергнуто».
 *
 * Отдельный класс, а не строка в сообщении: превратить сбой файловой системы
 * в аккуратное «отвергнуто» значит сказать «проверено и не разрешено» там,
 * где на деле «не проверено», и остановить прогон по несуществующей причине.
 */
export class ApprovalRejected extends Error {
  constructor(reason, message, options) {
    super(message, options)
    if (!APPROVAL_REJECTION_REASONS.includes(reason)) {
      throw new TypeError(
        `ApprovalRejected: причина ${JSON.stringify(reason)} не из закрытого списка `
        + `${APPROVAL_REJECTION_REASONS.join(', ')} — список закрыт проверкой, а не комментарием`,
      )
    }
    this.name = 'ApprovalRejected'
    this.reason = reason
  }
}

/**
 * Приговор границы пути — типом.
 *
 * Обёрнута РОВНО одна production-проверка, и её отказ — суждение о пути:
 * ссылка в компоненте, файла нет, на месте файла не обычный файл. Системная
 * ошибка (у неё есть `syscall`) из тех же проверок уходит наружу как есть:
 * `EACCES` на компоненте пути означает «проверить не удалось», а не
 * «разрешение отвергнуто».
 */
function rejectBoundary(reason, check) {
  try {
    check()
  } catch (error) {
    if (typeof error?.syscall === 'string') throw error
    throw new ApprovalRejected(reason, error.message, { cause: error })
  }
}

/**
 * Форма имени файла разрешения.
 *
 * Приватно намеренно: экспортированный `RegExp` — изменяемая глобальная
 * политика, `compile('.*')` отключил бы проверку имени у всех импортёров, и
 * `Object.freeze` этого не запрещает.
 */
const APPROVAL_FILE_NAME = /^[0-9a-f]{64}\.json$/

/** Строгое декодирование: символа-замены здесь нет, битые байты — отказ. */
const UTF8 = new TextDecoder('utf-8', { fatal: true })

/** Имя файла разрешения: строчный hex подписи плюс `.json`. */
export function approvalFileName(approval) {
  const value = approval?.approvalDigest?.value
  assertSha256Value(value, `${APPROVAL_ROOT_REL}: имя выводится из approvalDigest.value`)
  return `${value.slice('sha256:'.length)}.json`
}

/**
 * Имя проверяется ДО чтения и до любого обращения к файловой системе.
 *
 * Имя приходит снаружи и путём быть не может: абсолютный путь, разделитель
 * каталогов в любую сторону, `..` и вложенные компоненты — отказ, а не
 * нормализация. `path.join` со свободным именем увёл бы чтение куда угодно, и
 * containment родителей этого бы не заметил, потому что проверять он стал бы
 * уже уведённый путь.
 */
function assertApprovalFileName(fileName) {
  if (typeof fileName !== 'string' || !fileName.length) {
    throw new ApprovalRejected(
      'fileName',
      `имя разрешения: ожидается непустая строка, получено ${JSON.stringify(fileName)}`,
    )
  }
  if (path.isAbsolute(fileName) || fileName.includes('/') || fileName.includes('\\')
    || fileName.includes('..') || path.basename(fileName) !== fileName) {
    throw new ApprovalRejected(
      'fileName',
      `${JSON.stringify(fileName)}: имя разрешения обязано быть одним компонентом без разделителей `
      + 'и без «..» — путь именем не задаётся.',
    )
  }
  if (!APPROVAL_FILE_NAME.test(fileName)) {
    throw new ApprovalRejected(
      'fileName',
      `${JSON.stringify(fileName)}: имя разрешения обязано быть ровно 64 строчными hex-знаками `
      + 'и «.json» — оно выводится из подписи, а не выбирается.',
    )
  }
}

/**
 * Хранилище, привязанное к корню репозитория.
 *
 * Инъецируется ТОЛЬКО база: подкаталоги фиксированы и параметра не имеют.
 * Это не тестовая ветка — production вызывает тот же конструктор, разница
 * лишь в базе, ровно как с часами.
 */
export function createApprovalStore(input) {
  assertStrictOptions(input, { required: ['repoRoot', 'io'] }, 'createApprovalStore: параметры')
  const { repoRoot, io } = input
  const root = path.join(repoRoot, ...APPROVAL_ROOT_SEGMENTS)
  const names = ARTIFACT_NAMES.approval

  const approvalPath = (fileName) => {
    assertApprovalFileName(fileName)
    return path.join(root, fileName)
  }

  return Object.freeze({
    root,
    approvalPath,

    /** Проверка разрешения и плана — ДО создания каталогов и до записи. */
    async writeApprovalFile(args) {
      assertStrictOptions(args, { required: ['approval', 'plan'] }, 'writeApprovalFile: параметры')
      const { approval: verified } = parseAndVerifyApproval({ approval: args.approval, plan: args.plan })
      const target = approvalPath(approvalFileName(verified))
      ensureDirectoryChain(repoRoot, APPROVAL_ROOT_SEGMENTS, { names })
      assertExclusiveJsonTarget(target, { insideDir: root, names })
      const handle = await io.open(target, 'wx')
      try {
        await handle.writeFile(`${JSON.stringify(verified, null, 2)}\n`, 'utf8')
        await handle.sync()
        await io.syncDirectory(root)
      } finally {
        await handle.close()
      }
      return { path: target, approval: verified }
    },

    /**
     * Сырое чтение и ничего сверх него: имя → физическая граница → обычный
     * файл → точные байты.
     *
     * Плана здесь нет и быть не может: сырому чтению он не нужен, а параметр,
     * который ни на что не влияет, читается как проверка, которой нет.
     * Разбор JSON и проверка разрешения сюда тоже не входят — они принадлежат
     * тому, кто обязан назвать ИМЕННО СВОЙ отказ.
     */
    async readApprovalRaw(args) {
      assertStrictOptions(args, { required: ['fileName'] }, 'readApprovalRaw: параметры')
      const target = approvalPath(args.fileName)
      rejectBoundary('pathBoundary', () => assertPathContainment(target, { insideDir: root, names }))
      rejectBoundary('leaf', () => assertExistingRegularFile(target, { names }))
      /* Отказ самого чтения не классифицируется намеренно: EIO, EACCES и
         EPERM говорят «не прочитано», а не «отвергнуто», и приговором
         разрешению стать не имеют права. */
      return { bytes: await readFile(target), target }
    },

    /**
     * Чтение с полной проверкой: байты → строгий UTF-8 → JSON → полное
     * разрешение вместе с его подписью → сверка имени с пересчитанной
     * подписью.
     *
     * Последний шаг не декоративен: файл, переименованный в имя другого
     * разрешения, прошёл бы всё предыдущее и выдал бы чужое разрешение под
     * запрошенным именем.
     */
    async readApprovalFile(args) {
      assertStrictOptions(args, { required: ['fileName', 'plan'] }, 'readApprovalFile: параметры')
      const { fileName, plan } = args
      const { bytes, target } = await this.readApprovalRaw({ fileName })
      let text = null
      try {
        text = UTF8.decode(bytes)
      } catch (error) {
        throw new ApprovalRejected(
          'notUtf8',
          `${target}: байты разрешения не декодируются как UTF-8 — ${error.message}. `
          + 'Символа-замены здесь нет: подставить U+FFFD значило бы подписать не то, что лежит в файле.',
          { cause: error },
        )
      }
      let raw = null
      try {
        raw = JSON.parse(text)
      } catch (error) {
        throw new ApprovalRejected(
          'notJson', `${target}: разрешение не разбирается как JSON — ${error.message}`, { cause: error },
        )
      }
      /* Валидатор чистый: файловой системы и сети он не касается, поэтому
         любой его отказ — вердикт о разрешении, а не сбой среды. */
      let verified = null
      let verifiedPlan = null
      try {
        const result = parseAndVerifyApproval({ approval: raw, plan })
        verified = result.approval
        verifiedPlan = result.plan
      } catch (error) {
        throw new ApprovalRejected('approvalShape', error.message, { cause: error })
      }
      const expected = approvalFileName(verified)
      if (expected !== fileName) {
        throw new ApprovalRejected(
          'fileNameMismatch',
          `${target}: имя файла ${JSON.stringify(fileName)} не совпадает с подписью разрешения — `
          + `по ней имя ${JSON.stringify(expected)}. Файл лежит не под своим именем.`,
        )
      }
      return { approval: verified, plan: verifiedPlan, path: target }
    },
  })
}
