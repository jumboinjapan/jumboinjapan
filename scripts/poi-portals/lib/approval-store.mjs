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

/**
 * Форма имени файла разрешения.
 *
 * Приватно намеренно: экспортированный `RegExp` — изменяемая глобальная
 * политика, `compile('.*')` отключил бы проверку имени у всех импортёров, и
 * `Object.freeze` этого не запрещает.
 */
const APPROVAL_FILE_NAME = /^[0-9a-f]{64}\.json$/

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
    throw new TypeError(`имя разрешения: ожидается непустая строка, получено ${JSON.stringify(fileName)}`)
  }
  if (path.isAbsolute(fileName) || fileName.includes('/') || fileName.includes('\\')
    || fileName.includes('..') || path.basename(fileName) !== fileName) {
    throw new Error(
      `${JSON.stringify(fileName)}: имя разрешения обязано быть одним компонентом без разделителей `
      + 'и без «..» — путь именем не задаётся.',
    )
  }
  if (!APPROVAL_FILE_NAME.test(fileName)) {
    throw new Error(
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
     * Повторное чтение: имя → границы пути → leaf → байты → полная проверка →
     * сверка имени с пересчитанной подписью.
     *
     * Последний шаг не декоративен: файл, переименованный в имя другого
     * разрешения, прошёл бы всё предыдущее и выдал бы чужое разрешение под
     * запрошенным именем.
     */
    async readApprovalFile(args) {
      assertStrictOptions(args, { required: ['fileName', 'plan'] }, 'readApprovalFile: параметры')
      const { fileName, plan } = args
      const target = approvalPath(fileName)
      assertPathContainment(target, { insideDir: root, names })
      assertExistingRegularFile(target, { names })
      const text = await readFile(target, 'utf8')
      let raw = null
      try {
        raw = JSON.parse(text)
      } catch (error) {
        throw new Error(`${target}: разрешение не разбирается как JSON — ${error.message}`)
      }
      const { approval: verified, plan: verifiedPlan } = parseAndVerifyApproval({ approval: raw, plan })
      const expected = approvalFileName(verified)
      if (expected !== fileName) {
        throw new Error(
          `${target}: имя файла ${JSON.stringify(fileName)} не совпадает с подписью разрешения — `
          + `по ней имя ${JSON.stringify(expected)}. Файл лежит не под своим именем.`,
        )
      }
      return { approval: verified, plan: verifiedPlan, path: target }
    },
  })
}
