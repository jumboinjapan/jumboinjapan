/**
 * РАЗРЕШЕНИЕ ВЛАДЕЛЬЦА НА СЕРИЮ ОБНОВЛЕНИЙ — `poi-update-approval/v1`
 * (10h-B, DAG 2.8; решения владельца I‑2.1–2.4, I‑4.1, I‑4.3, I‑4.6).
 *
 * Разрешение на создание (`poi-write-approval/v2`) называет ключи источника и
 * потолок POST. Разрешение на обновление называет ДРУГОЕ: точную карточку
 * обновления (`cardDigest` — отпечаток того, что владелец видел), список
 * полей, которые серии позволено менять (`fields`; по решению I‑2.2 пилот
 * ограничен часами работы, и список это закрепляет), и потолок PATCH
 * (`maxUpdates`, I‑4.3). Разрешение без карточки или с чужой карточкой не
 * действует: полномочие относится к точной карточке (change-policy § 20).
 *
 * Дисциплина — та же, что у разрешения на создание: версия проверяется первой,
 * закрытый состав полей, полный интервал `issuedAt <= now < expiresAt`,
 * одноразовость по каноническому отпечатку через долговечную отметку в
 * `used/`, закрытый список причин отказа, ни одного враждебного значения наружу.
 */
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import {
  assertCanonicalInstant,
  assertExactKeys,
  assertInteger,
  assertNonEmptyString,
  assertSha256Value,
  assertStringList,
  canonicalJsonBytes,
  deepFreeze,
} from '../../lib/canonical-contract.mjs'
import { sha256Bytes } from '../../lib/byte-digest.mjs'
import { assertExistingRegularFile, assertPathContainment } from '../../lib/path-boundary.mjs'
/* Цепочка долговечности — одна на проект: берётся журнальная. */
import { DIRECTORY_IO, durable, ensureDurableDirectory } from './write-journal.mjs'
import { describeThrownSafely, thrownCode } from '../../../src/lib/thrown-value.ts'
import { UPDATE_PROTECTED_FIELDS } from './update-journal.mjs'
import { updateCardDigest } from './update-card.mjs'

export const UPDATE_APPROVAL_SPEC = 'poi-update-approval/v1'
export const UPDATE_APPROVAL_ROOT_SEGMENTS = Object.freeze(['tmp', 'poi-update-approvals'])
export const UPDATE_APPROVAL_ROOT_REL = path.join(...UPDATE_APPROVAL_ROOT_SEGMENTS)
export const UPDATE_APPROVAL_USED_SEGMENT = 'used'
/** Точный состав разрешения — закрытый список. */
export const UPDATE_APPROVAL_KEYS = Object.freeze([
  'spec', 'scopeId', 'portal', 'issuedAt', 'expiresAt', 'cardDigest', 'fields', 'maxUpdates', 'note',
])
/** Закрытый список причин отказа. */
export const UPDATE_APPROVAL_REFUSALS = Object.freeze([
  'updateApprovalMissing', 'updateApprovalVersion', 'updateApprovalShape', 'updateApprovalExpired',
  'updateApprovalNotYetValid', 'updateApprovalScope', 'updateApprovalPortal', 'updateApprovalCardDrift',
  'updateApprovalFields', 'updateApprovalCeiling', 'updateApprovalAlreadyUsed', 'updateApprovalClaimFailed',
])

export class UpdateApprovalRefused extends Error {
  constructor(reason, message) {
    super(message)
    this.name = 'UpdateApprovalRefused'
    if (!UPDATE_APPROVAL_REFUSALS.includes(reason)) {
      throw new TypeError(`UpdateApprovalRefused: причина ${JSON.stringify(reason)} не из закрытого списка ${UPDATE_APPROVAL_REFUSALS.join(', ')}`)
    }
    this.reason = reason
  }
}

const refuse = (reason, message) => { throw new UpdateApprovalRefused(reason, message) }
const isPlain = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

export function updateApprovalDigest(approval) {
  return sha256Bytes(canonicalJsonBytes(approval, UPDATE_APPROVAL_SPEC))
}

/** Разбор и проверка ФОРМЫ. Применимость к прогону — отдельно. */
export function parseUpdateApproval(raw, where = UPDATE_APPROVAL_SPEC) {
  if (!isPlain(raw)) refuse('updateApprovalShape', `${where}: разрешение обязано быть объектом JSON`)
  const specSlot = Object.getOwnPropertyDescriptor(raw, 'spec')
  const spec = specSlot && 'value' in specSlot ? specSlot.value : undefined
  if (spec !== UPDATE_APPROVAL_SPEC) {
    refuse('updateApprovalVersion', `${where}.spec: ожидается ${UPDATE_APPROVAL_SPEC}, получено ${JSON.stringify(spec)}`)
  }
  try {
    assertExactKeys(raw, UPDATE_APPROVAL_KEYS, where)
    assertNonEmptyString(raw.scopeId, `${where}.scopeId`)
    assertNonEmptyString(raw.portal, `${where}.portal`)
    assertNonEmptyString(raw.note, `${where}.note`)
    assertCanonicalInstant(raw.issuedAt, `${where}.issuedAt`)
    assertCanonicalInstant(raw.expiresAt, `${where}.expiresAt`)
    if (Date.parse(raw.expiresAt) <= Date.parse(raw.issuedAt)) throw new TypeError(`${where}.expiresAt: срок обязан быть позже выдачи`)
    assertSha256Value(raw.cardDigest, `${where}.cardDigest`)
    assertStringList(raw.fields, `${where}.fields`)
    if (!raw.fields.length) throw new TypeError(`${where}.fields: непустой список разрешённых полей обязателен — разрешение называет поля поимённо`)
    const protectedFields = raw.fields.filter((f) => UPDATE_PROTECTED_FIELDS.includes(f))
    if (protectedFields.length) throw new TypeError(`${where}.fields: защищённые поля (${protectedFields.join(', ')}) обновлению не подлежат`)
    assertInteger(raw.maxUpdates, `${where}.maxUpdates`, 1)
  } catch (error) {
    if (error instanceof UpdateApprovalRefused) throw error
    refuse('updateApprovalShape', describeThrownSafely(error))
  }
  return deepFreeze({ ...raw, fields: [...raw.fields] })
}

/**
 * Применимость разрешения К ЭТОЙ КАРТОЧКЕ и К ЭТОМУ ПРОГОНУ. Вызывается до
 * журнала, до хранилища и до первого эффекта.
 *
 * @param input.card        РАЗОБРАННАЯ карточка обновления — её отпечаток вычисляется здесь
 * @param input.cardDigest  необязательное заявление вызывающего; обязано совпасть с вычисленным
 */
export function assertUpdateApprovalApplies({ approval, now, scopeId, portal, card, cardDigest = undefined }) {
  const where = UPDATE_APPROVAL_SPEC
  /* ОТПЕЧАТОК СЧИТАЕТСЯ С САМОЙ КАРТОЧКИ (10h-B R1, находка 02). Прежняя
     редакция сверяла разрешение с отпечатком, который НАЗВАЛ вызывающий:
     чужая карточка с чужим заявлением проходила. Заявление вызывающего, если
     передано, обязано совпасть с вычисленным — иначе это тоже дрейф. */
  let actualDigest
  try {
    actualDigest = updateCardDigest(card)
  } catch (error) {
    refuse('updateApprovalShape', `${where}: отпечаток карточки не вычислен: ${describeThrownSafely(error)}`)
  }
  if (cardDigest !== undefined && cardDigest !== actualDigest) {
    refuse('updateApprovalCardDrift', `${where}: заявленный отпечаток карточки ${cardDigest} не равен вычисленному ${actualDigest} — заявлению вызывающего не верим`)
  }
  cardDigest = actualDigest
  if (approval.scopeId !== scopeId) refuse('updateApprovalScope', `${where}: разрешение выдано на область ${JSON.stringify(approval.scopeId)}, прогон идёт в ${JSON.stringify(scopeId)}`)
  if (approval.portal !== portal) refuse('updateApprovalPortal', `${where}: разрешение выдано на портал ${JSON.stringify(approval.portal)}, прогон идёт по ${JSON.stringify(portal)}`)
  const moment = now instanceof Date ? now.getTime() : Date.parse(String(now))
  if (!Number.isFinite(moment)) refuse('updateApprovalShape', `${where}: момент прогона не разобран`)
  if (moment < Date.parse(approval.issuedAt)) refuse('updateApprovalNotYetValid', `${where}: разрешение выдано ${approval.issuedAt}, прогон в ${new Date(moment).toISOString()} — оно ещё не действует`)
  if (moment >= Date.parse(approval.expiresAt)) refuse('updateApprovalExpired', `${where}: срок разрешения истёк ${approval.expiresAt}, прогон в ${new Date(moment).toISOString()}`)
  if (approval.cardDigest !== cardDigest) {
    refuse('updateApprovalCardDrift', `${where}: разрешение выдано на карточку ${approval.cardDigest}, а прогон идёт по карточке ${cardDigest ?? '(нет)'} — владелец видел другой состав`)
  }
  if (card.scopeId !== scopeId || card.portal !== portal) refuse('updateApprovalScope', `${where}: карточка выдана на ${card.scopeId}/${card.portal}, прогон идёт в ${scopeId}/${portal}`)
  for (const row of card.rows) {
    const foreign = Object.keys(row.proposed).filter((f) => !approval.fields.includes(f))
    if (foreign.length) refuse('updateApprovalFields', `${where}: строка ${row.recordId} меняет поля вне разрешения (${foreign.join(', ')}); разрешены только ${approval.fields.join(', ')}`)
  }
  if (approval.maxUpdates < card.rows.length) {
    refuse('updateApprovalCeiling', `${where}: потолок PATCH ${approval.maxUpdates} меньше числа строк карточки ${card.rows.length} — потолок обязан покрывать разрешённое`)
  }
  return approval
}

/**
 * ОДНОРАЗОВОСТЬ — по каноническому отпечатку разрешения, долговечной отметкой
 * в `used/` ДО первого эффекта. Занятая отметка — именованный отказ.
 */
export async function claimUpdateApproval(repoRoot, approval, claim, io = {}) {
  const chain = { ...DIRECTORY_IO, ...io }
  let identity
  try {
    identity = updateApprovalDigest(approval)
  } catch (error) {
    refuse('updateApprovalClaimFailed', `${UPDATE_APPROVAL_SPEC}: отпечаток разрешения не вычислен: ${describeThrownSafely(error)}`)
  }
  const hex = identity.slice(identity.indexOf(':') + 1)
  const usedDir = path.join(repoRoot, ...UPDATE_APPROVAL_ROOT_SEGMENTS, UPDATE_APPROVAL_USED_SEGMENT)
  const target = path.join(usedDir, `${hex}.json`)
  try {
    assertPathContainment(target, { insideDir: usedDir })
  } catch (error) {
    refuse('updateApprovalClaimFailed', `${UPDATE_APPROVAL_SPEC}: отметка исполнения вне каталога разрешений: ${describeThrownSafely(error)}`)
  }
  try {
    await ensureDurableDirectory(usedDir, chain)
  } catch (error) {
    refuse('updateApprovalClaimFailed', `${UPDATE_APPROVAL_SPEC}: каталог отметок исполнения не создан долговечно: ${describeThrownSafely(error)}`)
  }
  let handle
  try {
    handle = await chain.open(target, 'wx')
  } catch (error) {
    if (thrownCode(error) === 'EEXIST') {
      refuse('updateApprovalAlreadyUsed', `${UPDATE_APPROVAL_SPEC}: разрешение ${identity} уже исполнено — отметка ${target} занята. Копия и переименование исполнению не подлежат`)
    }
    refuse('updateApprovalClaimFailed', `${UPDATE_APPROVAL_SPEC}: отметку исполнения не создать: ${describeThrownSafely(error)}`)
  }
  let failure = null
  try {
    await handle.writeFile(`${JSON.stringify({ ...claim, identity }, null, 2)}\n`, 'utf8')
    await durable(handle)
  } catch (error) {
    failure = `отметка исполнения не записана: ${describeThrownSafely(error)}`
  }
  try {
    await handle.close()
  } catch (error) {
    failure = failure ?? `дескриптор отметки не закрыт: ${describeThrownSafely(error)}`
  }
  if (failure) refuse('updateApprovalClaimFailed', `${UPDATE_APPROVAL_SPEC}: ${failure}`)
  try {
    await chain.durableDirectory(usedDir)
  } catch (error) {
    refuse('updateApprovalClaimFailed', `${UPDATE_APPROVAL_SPEC}: каталог отметок не синхронизирован — имя отметки может не пережить сбой: ${describeThrownSafely(error)}`)
  }
  return { path: target, identity }
}

/** Чтение разрешения ПО ИМЕНИ в каноническом каталоге; наружу — только `UpdateApprovalRefused`. */
export async function readUpdateApprovalFile(repoRoot, name, io = { readFile }) {
  let target
  try {
    assertNonEmptyString(name, 'разрешение на обновление: имя файла')
    if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
      refuse('updateApprovalShape', `разрешение на обновление ${JSON.stringify(name)}: ожидается ИМЯ файла в ${UPDATE_APPROVAL_ROOT_REL}/, а не путь`)
    }
    const root = path.join(repoRoot, ...UPDATE_APPROVAL_ROOT_SEGMENTS)
    target = path.join(root, name.endsWith('.json') ? name : `${name}.json`)
    assertPathContainment(target, { insideDir: root })
  } catch (error) {
    if (error instanceof UpdateApprovalRefused) throw error
    refuse('updateApprovalShape', `разрешение на обновление: имя отвергнуто: ${describeThrownSafely(error)}`)
  }
  let text
  try {
    assertExistingRegularFile(target)
    text = await io.readFile(target, 'utf8')
  } catch (error) {
    refuse('updateApprovalMissing', `разрешение на обновление: файл ${target} не прочитан: ${describeThrownSafely(error)}`)
  }
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    refuse('updateApprovalShape', `${target}: не разбирается как JSON: ${describeThrownSafely(error)}`)
  }
  const approval = parseUpdateApproval(raw, target)
  let digest
  try {
    digest = updateApprovalDigest(approval)
  } catch (error) {
    refuse('updateApprovalShape', `${target}: отпечаток разрешения не вычислен: ${describeThrownSafely(error)}`)
  }
  return { approval, file: target, digest }
}
