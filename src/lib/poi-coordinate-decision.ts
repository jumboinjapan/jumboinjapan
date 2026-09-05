/**
 * Решения владельца о политике координат: контракт записи, реестр под git и
 * ЕДИНСТВЕННЫЙ канал, по которому решение доходит до writer'а.
 *
 * Зачем. `representativePoint` и `notApplicable` — предметные утверждения об
 * объекте, машиной не выводимые (см. poi-coordinate-policy.ts). Их нельзя
 * принять из запроса (круг R5, находка P0-A: всё в запросе задаёт
 * вызывающий), и нельзя принять из объекта, который вызывающий собрал сам
 * (10f-P R1, находка 1: публичная фабрика плюс пересчитанная контрольная
 * сумма давали то же полномочие под другим именем).
 *
 * Откуда берётся полномочие. Только из файла реестра по каноническому пути
 * `config/poi-coordinate-decisions.v1.json`, который лежит под git. Этот
 * модуль читает его статическим импортом — путь не параметр, — проверяет
 * форму и брендирует результат закрытым множеством модуля. Другой фабрики
 * нет, аргумента «прочитать вот этот реестр» нет, `options`/`deps` для
 * решений нет. Единственный способ получить другое полномочие в коде —
 * изменить файл по каноническому пути.
 *
 * Что это доказывает, а что нет — честно. Статический импорт и контрольная
 * сумма НЕ доказывают авторство. Импорт закрывает обходные каналы в коде:
 * решение нельзя собрать вызовом. `integrityDigest` — КОНТРОЛЬНАЯ СУММА
 * целостности записи (sha256 канонических байтов): ловит правку без
 * пересчёта и опечатку; НЕ подпись, пересчитать её может кто угодно.
 * Полномочие задаётся ПРОЦЕССОМ owner review: правка файла реестра попадает
 * в main только через ревью владельца, и удостоверяет решение именно этот
 * процесс — не импорт, не сумма и не этот модуль. Если процесс ревью
 * обойдён, код этого не заметит, и обещать обратное нельзя.
 *
 * С чем связано решение. Не только со строковым `sourceKey`: у части
 * источников ключ строки нестабилен (`row-N`), и перестановка строк перенесла
 * бы решение на другой объект (R1, находка 5). Поэтому запись несёт `subject`
 * — город и хотя бы одно имя объекта, — и применяется ТОЛЬКО когда
 * записываемая запись совпадает с ним по всем названным полям. Несовпадение —
 * не «решения нет», а именованный отказ: решение о другом объекте под этим
 * ключом означает, что ключ перестал указывать на предмет.
 *
 * Тестируемость. Второго канала для тестов нет намеренно: композиция
 * writer + реестр проверяется в песочнице-копии дерева, где по каноническому
 * пути лежит фикстурный реестр (tests/support/production-sandbox.mjs), — так
 * тест исполняет ровно тот путь, что и production, с другим содержимым файла.
 */

import { createHash } from 'node:crypto'
import { canonicalCity, roundCoordinate } from './poi-canon.ts'
import { normalizeName } from './poi-matching.ts'
import { SUBJECT_DECISION_POLICIES, type SubjectDecisionPolicy } from './poi-coordinate-policy.ts'
import rawLedger from '../../config/poi-coordinate-decisions.v1.json' with { type: 'json' }

/** Версия контракта одной записи решения. Входит в контрольную сумму. */
export const COORDINATE_DECISION_SPEC = 'poi-coordinate-decision/v1'
/** Версия файла реестра. */
export const COORDINATE_DECISIONS_LEDGER_VERSION = 'poi-coordinate-decisions/v1'
/** Канонический путь реестра — для сообщений и документации; читается статическим импортом выше. */
export const COORDINATE_DECISIONS_LEDGER_PATH = 'config/poi-coordinate-decisions.v1.json'

export interface CoordinatePoint {
  lat: number
  lon: number
}

/**
 * Предмет решения: город (канонический слаг) и хотя бы одно имя объекта.
 * Сравнивается с записываемой записью тем же `normalizeName`, что и матчер.
 */
export interface CoordinateDecisionSubject {
  siteCity: string
  nameJa?: string
  nameEn?: string
  nameRu?: string
}

export interface CoordinateDecision {
  /** Ключ источника записи в форме `buildSourceKey`: `<source.id>:<externalKey>`. */
  sourceKey: string
  subject: CoordinateDecisionSubject
  decision: SubjectDecisionPolicy
  /** Точка есть ТОЛЬКО у representativePoint; у notApplicable — null. */
  point: CoordinatePoint | null
  /** Ссылка на решение владельца: где и когда оно принято. */
  decisionRef: string
  approver: string
  /** Канонический момент: `2026-09-03T00:00:00.000Z`. */
  decidedAt: string
  /** Почему у объекта нет одной осмысленной точки. Обязательна. */
  note: string
  /** Контрольная сумма целостности записи без этого поля. Не подпись. */
  integrityDigest: string
}

const DECISION_KEYS = Object.freeze(
  ['sourceKey', 'subject', 'decision', 'point', 'decisionRef', 'approver', 'decidedAt', 'note', 'integrityDigest'] as const,
)
const SUBJECT_KEYS = Object.freeze(['siteCity', 'nameJa', 'nameEn', 'nameRu'] as const)
const SUBJECT_NAME_KEYS = Object.freeze(['nameJa', 'nameEn', 'nameRu'] as const)
const LEDGER_KEYS = Object.freeze(['version', 'decisions'] as const)

/** Та же грамматика, что `assertCanonicalInstant` в scripts/lib/canonical-contract.mjs (паритет — тестом). */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value)) return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim()
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function keysWithin(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((k) => allowed.includes(k))
}

function sameKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return keys.length === wanted.length && keys.every((k, i) => k === wanted[i])
}

/**
 * Контрольная сумма записи: спецификация и поля через разделитель записей
 * (0x1f); координаты — после канонического округления; поля предмета — в
 * фиксированном порядке, отсутствующее имя — пустая строка.
 */
export function coordinateDecisionIntegrityDigest(entry: Omit<CoordinateDecision, 'integrityDigest'>): string {
  const lat = finiteNumber(entry.point?.lat) ? String(roundCoordinate(entry.point.lat)) : ''
  const lon = finiteNumber(entry.point?.lon) ? String(roundCoordinate(entry.point.lon)) : ''
  const subject: Record<string, unknown> = isPlainObject(entry.subject) ? entry.subject : {}
  const bytes = [
    COORDINATE_DECISION_SPEC,
    entry.sourceKey,
    ...SUBJECT_KEYS.map((key) => (typeof subject[key] === 'string' ? subject[key] : '')),
    entry.decision,
    lat,
    lon,
    entry.decisionRef,
    entry.approver,
    entry.decidedAt,
    entry.note,
  ].join('\u001f')
  return `sha256:${createHash('sha256').update(bytes, 'utf8').digest('hex')}`
}

/**
 * Проверяет одну запись решения. Возвращает список нарушений: пустой список —
 * запись принята. Контрольная сумма сверяется с пересчитанной: запись,
 * отредактированная без пересчёта, — не решение, а правка.
 */
export function coordinateDecisionIssues(raw: unknown, where = 'решение'): string[] {
  const issues: string[] = []
  if (!isPlainObject(raw)) return [`${where}: ожидается объект`]
  const entry = raw
  if (!sameKeys(entry, DECISION_KEYS)) {
    issues.push(`${where}: набор полей должен быть ровно ${DECISION_KEYS.join(', ')}; получено ${Object.keys(entry).sort().join(', ') || '(пусто)'}`)
    return issues
  }
  if (!nonEmptyString(entry.sourceKey) || !entry.sourceKey.includes(':')) {
    issues.push(`${where}: sourceKey должен иметь вид <источник>:<ключ>`)
  }
  const subject = entry.subject
  if (!isPlainObject(subject) || !keysWithin(subject, SUBJECT_KEYS)) {
    issues.push(`${where}: subject должен быть объектом с полями ${SUBJECT_KEYS.join(', ')}`)
  } else {
    if (!nonEmptyString(subject.siteCity) || canonicalCity(subject.siteCity) !== subject.siteCity) {
      issues.push(`${where}: subject.siteCity должен быть каноническим слагом города`)
    }
    const names = SUBJECT_NAME_KEYS.filter((key) => key in subject)
    if (!names.length) issues.push(`${where}: subject должен называть хотя бы одно имя объекта (nameJa, nameEn или nameRu)`)
    for (const key of names) {
      if (!nonEmptyString(subject[key])) issues.push(`${where}: subject.${key} должен быть непустой строкой без пробелов по краям`)
    }
  }
  const decision = entry.decision
  if (!(SUBJECT_DECISION_POLICIES as readonly unknown[]).includes(decision)) {
    issues.push(`${where}: decision может быть только ${SUBJECT_DECISION_POLICIES.join(' или ')}; получено ${JSON.stringify(decision)}`)
  }
  const point = entry.point
  if (decision === 'representativePoint') {
    if (!isPlainObject(point) || !sameKeys(point, ['lat', 'lon']) || !finiteNumber(point.lat) || !finiteNumber(point.lon)) {
      issues.push(`${where}: representativePoint требует point {lat, lon} с конечными числами — это всё ещё точка`)
    }
  } else if (decision === 'notApplicable') {
    if (point !== null) issues.push(`${where}: notApplicable требует point: null — точка неприменима`)
  }
  if (!nonEmptyString(entry.decisionRef)) issues.push(`${where}: decisionRef обязателен`)
  if (!nonEmptyString(entry.approver)) issues.push(`${where}: approver обязателен`)
  if (!isCanonicalInstant(entry.decidedAt)) issues.push(`${where}: decidedAt должен быть каноническим моментом вида 2026-09-03T00:00:00.000Z`)
  if (!nonEmptyString(entry.note)) issues.push(`${where}: note обязательна — почему у объекта нет одной осмысленной точки`)
  if (issues.length) return issues
  const expected = coordinateDecisionIntegrityDigest(entry as unknown as CoordinateDecision)
  if (entry.integrityDigest !== expected) {
    issues.push(`${where}: integrityDigest не совпадает с пересчитанным (${expected}); запись отредактирована без пересчёта контрольной суммы`)
  }
  return issues
}

export interface LedgerValidation {
  ok: boolean
  issues: string[]
  size: number
  keys: string[]
}

/**
 * Проверка формы реестра целиком — для `--check` и тестов формы. Полномочия
 * НЕ выдаёт: возвращает только вердикт и перечень ключей.
 */
export function validateCoordinateDecisionLedger(raw: unknown): LedgerValidation {
  const issues: string[] = []
  if (!isPlainObject(raw)) return { ok: false, issues: ['реестр решений о координатах: ожидается объект {version, decisions}'], size: 0, keys: [] }
  if (!sameKeys(raw, LEDGER_KEYS)) issues.push(`реестр решений о координатах: набор полей должен быть ровно ${LEDGER_KEYS.join(', ')}`)
  if (raw.version !== COORDINATE_DECISIONS_LEDGER_VERSION) {
    issues.push(`реестр решений о координатах: версия ${JSON.stringify(raw.version)}, ожидается ${COORDINATE_DECISIONS_LEDGER_VERSION}`)
  }
  if (!Array.isArray(raw.decisions)) {
    issues.push('реестр решений о координатах: decisions должен быть массивом')
    return { ok: false, issues, size: 0, keys: [] }
  }
  const keys: string[] = []
  raw.decisions.forEach((entry, index) => {
    const entryIssues = coordinateDecisionIssues(entry, `decisions[${index}]`)
    if (entryIssues.length) { issues.push(...entryIssues.map((i) => `реестр решений о координатах: ${i}`)); return }
    const key = (entry as CoordinateDecision).sourceKey
    if (keys.includes(key)) issues.push(`реестр решений о координатах: decisions[${index}]: ключ ${key} встречается дважды`)
    keys.push(key)
  })
  return { ok: issues.length === 0, issues, size: keys.length, keys }
}

export interface ObservedSubject {
  siteCity?: string | null
  nameJa?: string | null
  nameEn?: string | null
  nameRu?: string | null
}

export interface SubjectVerdict {
  ok: boolean
  /** Поля предмета, по которым запись НЕ совпала с решением. */
  mismatched: string[]
}

/**
 * Совпадает ли записываемая запись с предметом решения. Город — точное
 * равенство слагов; каждое имя, названное в решении, обязано совпасть с
 * соответствующим именем записи после нормализации матчера. Имя, не названное
 * в решении, не проверяется; имя, названное в решении и отсутствующее у
 * записи, — несовпадение.
 */
export function coordinateDecisionSubjectVerdict(subject: CoordinateDecisionSubject, observed: ObservedSubject): SubjectVerdict {
  const mismatched: string[] = []
  if (canonicalCity(observed.siteCity ?? '') !== subject.siteCity) mismatched.push('siteCity')
  for (const key of SUBJECT_NAME_KEYS) {
    const wanted = subject[key]
    if (typeof wanted !== 'string') continue
    const actual = observed[key]
    if (typeof actual !== 'string' || !actual.trim() || normalizeName(actual) !== normalizeName(wanted)) mismatched.push(key)
  }
  return { ok: mismatched.length === 0, mismatched }
}

export interface CoordinateDecisionLookup {
  readonly size: number
  get(sourceKey: string | null | undefined): CoordinateDecision | null
  /** Для отчётов: все ключи реестра в порядке файла. */
  keys(): string[]
}

/* Бренд: lookup считается настоящим только если родился из файла реестра
   здесь. Множество закрыто в модуле, снаружи в него не добавить, а фабрики
   с аргументом-реестром в модуле нет. */
const BRANDED = new WeakSet<object>()

export function isCoordinateDecisionLookup(value: unknown): value is CoordinateDecisionLookup {
  return typeof value === 'object' && value !== null && BRANDED.has(value)
}

function buildLookup(raw: unknown): CoordinateDecisionLookup {
  const verdict = validateCoordinateDecisionLedger(raw)
  if (!verdict.ok) throw new TypeError(verdict.issues.join('; '))
  const byKey = new Map<string, CoordinateDecision>()
  for (const entry of (raw as { decisions: CoordinateDecision[] }).decisions) {
    byKey.set(entry.sourceKey, Object.freeze({
      ...entry,
      subject: Object.freeze({ ...entry.subject }),
      point: entry.point ? Object.freeze({ lat: entry.point.lat, lon: entry.point.lon }) : null,
    }))
  }
  const lookup: CoordinateDecisionLookup = Object.freeze({
    size: byKey.size,
    get: (sourceKey: string | null | undefined) => (sourceKey ? byKey.get(sourceKey) ?? null : null),
    keys: () => [...byKey.keys()],
  })
  BRANDED.add(lookup)
  return lookup
}

let cached: CoordinateDecisionLookup | null = null

/**
 * Единственный production-вход: реестр из файла под git по каноническому
 * пути, без аргументов. Негодный реестр — исключение при первом обращении:
 * писатель с негодным реестром не пишет вовсе.
 */
export function loadCoordinateDecisions(): CoordinateDecisionLookup {
  if (!cached) cached = buildLookup(rawLedger)
  return cached
}

/**
 * ТО САМОЕ ЗНАЧЕНИЕ, по которому строится справочник решений — чтобы манифест
 * прогона считал digest от него (10f-Q R2, находка аудита 2).
 *
 * Реестр приезжает статическим импортом при загрузке модуля, поэтому взять его
 * тождество перечитыванием файла нельзя: перечитанные байты — это уже другой
 * момент времени и, вообще говоря, другой файл. Возвращается ровно тот объект,
 * который получает `buildLookup`; манифест считает его канонический digest.
 * Тождество здесь — контрольная сумма содержимого, и полномочия она, как и
 * `integrityDigest`, не удостоверяет: полномочие даёт процесс owner review.
 */
export function coordinateDecisionsLedgerValue(): unknown {
  return rawLedger
}
