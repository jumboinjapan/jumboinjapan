/**
 * JA-0: чистая граница адаптера, не разрешение на запись и не классификатор.
 * Вход уже имеет стабильные ключи (их строит Source/Discovery Adapter).
 * Пакет сверяется с независимо переданным составом источника ДО проекции.
 * Digest доказывает целостность, но не авторство и не истинность наблюдения.
 */
import {
  assertExactKeys, assertIdentity, assertSha256Value, canonicalJsonBytes, deepFreeze,
} from '../../lib/canonical-contract.mjs'
import { sha256Bytes } from '../../lib/byte-digest.mjs'
import { describeThrownSafely } from '../../../src/lib/thrown-value.ts'

export const PORTAL_INTAKE_SPEC = 'poi-portal-intake/v1'
export const PORTAL_INTAKE_REFUSALS = Object.freeze([
  'missingName', 'sourceRecordInvalid', 'unsupportedRecord',
])
const OBSERVED_TEXT = Object.freeze(['nameJa', 'nameKana', 'nameEn', 'address', 'prefectureJa', 'cityJa'])
const BODY_KEYS = Object.freeze(['spec', 'portalId', 'adapterVersion', 'input', 'records'])

export class PortalIntakeRefused extends Error {
  constructor(reason, message) {
    super(message)
    this.name = 'PortalIntakeRefused'
    this.reason = reason
  }
}

function guarded(reason, fn) {
  try { return fn() } catch (error) {
    throw new PortalIntakeRefused(reason, describeThrownSafely(error))
  }
}

// Канонизация проверяет СЫРОЙ объект, включая скрытые поля и дескрипторы.
// Разбор тех же байтов даёт собственную копию без обращения к входу после проверки.
function snapshot(raw) {
  const bytes = canonicalJsonBytes(raw, PORTAL_INTAKE_SPEC)
  return JSON.parse(bytes.toString('utf8').slice(PORTAL_INTAKE_SPEC.length + 1))
}

function versionFirst(raw) {
  const version = guarded('portalIntakeVersion', () => {
    const descriptor = Object.getOwnPropertyDescriptor(raw, 'spec')
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') {
      throw new Error('spec: требуется собственное строковое поле данных')
    }
    return descriptor.value
  })
  if (version !== PORTAL_INTAKE_SPEC) {
    throw new PortalIntakeRefused('portalIntakeVersion', `неподдерживаемая версия: ${version}`)
  }
}

function text(value, where) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${where}: нужна непустая строка`)
}

function url(value, where) {
  text(value, where)
  const parsed = new URL(value)
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${where}: нужен HTTP(S) URL без учётных данных`)
  }
}

function sourceIdentity(record, portalId, where) {
  text(record.sourceKey, `${where}.sourceKey`)
  if (!record.sourceKey.startsWith(`${portalId}:`) || record.sourceKey.length === portalId.length + 1) {
    throw new Error(`${where}.sourceKey: ключ чужого портала или пустой идентификатор`)
  }
  url(record.sourceUrl, `${where}.sourceUrl`)
}

function inputShape(input, portalId) {
  assertExactKeys(input, ['spec', 'digest', 'records'], 'input')
  text(input.spec, 'input.spec')
  assertSha256Value(input.digest, 'input.digest')
  if (!Array.isArray(input.records)) throw new Error('input.records: нужен массив')
  for (const record of input.records) {
    assertExactKeys(record, ['sourceKey', 'sourceUrl'], 'input.record')
    sourceIdentity(record, portalId, 'input.record')
  }
  const keys = input.records.map((record) => record.sourceKey)
  assertIdentity(keys, keys, 'входные ключи')
}

function hintsShape(hints) {
  if (!Array.isArray(hints)) throw new Error('hints: нужен массив')
  for (const hint of hints) {
    assertExactKeys(hint, ['field', 'value', 'sourceUrl', 'confidence', 'verifiedAt'], 'hint')
    text(hint.field, 'hint.field')
    text(hint.value, 'hint.value')
    url(hint.sourceUrl, 'hint.sourceUrl')
    if (hint.confidence !== 'unverified' || hint.verifiedAt !== null) {
      throw new Error('hint: неподтверждённая подсказка не может стать проверенным фактом')
    }
  }
}

function bodyShape(body) {
  assertExactKeys(body, BODY_KEYS, 'portal intake')
  if (body.spec !== PORTAL_INTAKE_SPEC) throw new Error('spec: версия изменилась при чтении')
  text(body.portalId, 'portalId')
  text(body.adapterVersion, 'adapterVersion')
  inputShape(body.input, body.portalId)
  if (!Array.isArray(body.records)) throw new Error('records: нужен массив')
  const source = new Map(body.input.records.map((record) => [record.sourceKey, record.sourceUrl]))
  for (const record of body.records) {
    const keys = record.kind === 'candidate'
      ? ['kind', 'sourceKey', 'sourceUrl', 'observed', 'hints']
      : ['kind', 'sourceKey', 'sourceUrl', 'reason', 'detail', 'hints']
    assertExactKeys(record, keys, 'record')
    sourceIdentity(record, body.portalId, 'record')
    if (source.get(record.sourceKey) !== record.sourceUrl) throw new Error('record: подмена адреса или ключа источника')
    hintsShape(record.hints)
    if (record.kind === 'candidate') {
      assertExactKeys(record.observed, [...OBSERVED_TEXT, 'lat', 'lon'], 'observed')
      for (const key of OBSERVED_TEXT) {
        if (record.observed[key] !== null) text(record.observed[key], `observed.${key}`)
      }
      if (!record.observed.nameJa && !record.observed.nameEn) throw new Error('candidate: нет пригодного имени')
      const { lat, lon } = record.observed
      if ((lat === null) !== (lon === null)) throw new Error('observed: неполная пара координат')
      if (lat !== null && (typeof lat !== 'number' || typeof lon !== 'number' || Math.abs(lat) > 90 || Math.abs(lon) > 180)) {
        throw new Error('observed: координаты вне диапазона')
      }
    } else if (record.kind === 'refused') {
      if (!PORTAL_INTAKE_REFUSALS.includes(record.reason)) throw new Error('refused: неизвестная причина')
      text(record.detail, 'refused.detail')
    } else throw new Error('record: неизвестный исход адаптера')
  }
  assertIdentity(body.input.records.map((record) => record.sourceKey), body.records.map((record) => record.sourceKey), 'сохранение исходных записей')
}

/** Строитель не нормализует и не додумывает поля; неполная форма — отказ. */
export function buildPortalIntakeBatch(rawBody) {
  versionFirst(rawBody)
  return guarded('portalIntakeInvalid', () => {
    const body = snapshot(rawBody)
    bodyShape(body)
    return deepFreeze({ ...body, batchDigest: sha256Bytes(canonicalJsonBytes(body, PORTAL_INTAKE_SPEC)) })
  })
}

/** expected = { portalId, input } приходит от проверенного источника, не из пакета. */
export function readPortalIntakeBatch(raw, expected) {
  versionFirst(raw)
  const batch = guarded('portalIntakeInvalid', () => {
    const value = snapshot(raw)
    assertExactKeys(value, [...BODY_KEYS, 'batchDigest'], 'portal intake')
    const { batchDigest, ...body } = value
    bodyShape(body)
    assertSha256Value(batchDigest, 'batchDigest')
    if (sha256Bytes(canonicalJsonBytes(body, PORTAL_INTAKE_SPEC)) !== batchDigest) throw new Error('batchDigest: содержимое изменено')
    return value
  })
  guarded('portalIntakeInputMismatch', () => {
    const context = snapshot(expected)
    assertExactKeys(context, ['portalId', 'input'], 'expected')
    text(context.portalId, 'expected.portalId')
    inputShape(context.input, context.portalId)
    if (batch.portalId !== context.portalId || batch.input.spec !== context.input.spec || batch.input.digest !== context.input.digest) {
      throw new Error('пакет не принадлежит ожидаемому порталу или снимку')
    }
    const identities = (records) => records.map((record) => JSON.stringify([record.sourceKey, record.sourceUrl]))
    assertIdentity(identities(context.input.records), identities(batch.input.records), 'состав ожидаемого источника')
  })
  return deepFreeze(batch)
}

/** Только явная проекция. Hints и предполагаемые решения не попадают в PoiCandidate. */
export function portalIntakeCandidates(raw, portal, expectedInput) {
  const batch = readPortalIntakeBatch(raw, { portalId: portal.id, input: expectedInput })
  const candidates = batch.records.filter((record) => record.kind === 'candidate').map((record) => ({
    sourceKey: record.sourceKey,
    sourceUrl: record.sourceUrl,
    seedSource: batch.portalId,
    licence: portal.licence ?? null,
    ...record.observed,
    nameJa: record.observed.nameJa ?? '',
    nameKana: record.observed.nameKana ?? '',
    nameEn: record.observed.nameEn ?? '',
    descriptionJa: '',
    descriptionEn: '',
  }))
  const refusedQueue = batch.records.filter((record) => record.kind === 'refused')
  return { batch, candidates, refusedQueue, counts: { input: batch.input.records.length, candidates: candidates.length, refused: refusedQueue.length } }
}
