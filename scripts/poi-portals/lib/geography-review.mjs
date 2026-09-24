/**
 * Охват и связи в реестре review (`config/poi-japan-guide-review.v1.json`):
 * необязательные `geographicScope` и `relations` строки. Здесь — только
 * форма, привязка к фактам строки и сборка документа `poi-geography/v1`.
 * Хранилища и записи нет; writer — прежний `ingestPoi` (создание) и
 * `poi:jg-copy --links` (существующая запись).
 *
 * ДОКАЗАТЕЛЬСТВО ОБЯЗАТЕЛЬНО У КАЖДОЙ СТРОКИ. Территория ссылается на
 * официальный источник из `facts` строки (не на Japan Guide: принадлежность
 * префектуре — административный факт), связь — на любой https-источник из
 * `facts`, чей текст называет цель. Агент проверяет смысл факта и роль источника;
 * код проверяет конкретную ссылку на факт, но не доказывает отношение по одному
 * упоминанию названия. Соседство и пункты меню не являются доказательством связи.
 */
import assert from 'node:assert/strict'
import { assertExactKeys } from '../../lib/canonical-contract.mjs'
import { canonicalPrefecture } from '../../../src/lib/prefectures.ts'
import {
  assertPoiGeographyDocument, EVIDENCE_STATUSES, POI_GEOGRAPHY_SPEC, RELATION_DIRECTION, RELATION_KINDS,
} from '../../../src/lib/poi-geography-document.ts'

export const REVIEW_GEOGRAPHY_KEYS = Object.freeze(['geographicScope', 'relations'])
const keyShape = /^japan-guide:e\d+(?:-[a-z0-9]+)*$/
const poiIdShape = /^POI-\d{6}$/
const filled = (s) => typeof s === 'string' && s.trim() === s && s.length > 0
// Authority is an explicit researched declaration, never inferred from a
// hostname. Pin the exact fact: one page can describe several different places.
const factFor = (row, entry) => {
  assert(Number.isInteger(entry.factIndex) && entry.factIndex >= 0, 'Evidence needs a factIndex')
  const fact = row.facts[entry.factIndex]
  assert(fact && fact.sourceUrl === entry.sourceUrl, 'Evidence needs a source recorded at the declared factIndex')
  const url = new URL(entry.sourceUrl)
  assert(url.protocol === 'https:' && !url.username && !url.password, 'Evidence source must be https')
  assert(filled(fact.text), 'Evidence fact must contain text')
  return fact
}
const isOfficialDeclaration = (entry) => {
  const host = new URL(entry.sourceUrl).hostname
  return entry.sourceRole === 'official' && host !== 'japan-guide.com' && !host.endsWith('.japan-guide.com')
}

/** Проверка необязательных полей строки реестра. Возвращает то, что нашла. */
export function assertReviewGeography(row) {
  const scope = Object.hasOwn(row, 'geographicScope') ? row.geographicScope : null
  const relations = Object.hasOwn(row, 'relations') ? row.relations : null
  if (scope !== null) {
    assert(Array.isArray(scope) && scope.length > 0 && scope.length <= 47, 'geographicScope must list 1..47 territories')
    const seen = new Set()
    for (const t of scope) {
      assertExactKeys(t, ['prefectureEn', 'municipalityJa', 'status', 'sourceUrl', 'factIndex', 'sourceRole'], 'review territory')
      assert(canonicalPrefecture(t.prefectureEn)?.en === t.prefectureEn, 'Territory prefecture must be canonical')
      assert(t.municipalityJa === null || filled(t.municipalityJa), 'Territory municipality must be text or null')
      assert(EVIDENCE_STATUSES.includes(t.status), 'Territory status outside the closed list')
      const fact = factFor(row, t)
      assert(fact && isOfficialDeclaration(t), 'Territory needs an official source recorded in the row facts')
      const key = `${t.prefectureEn}|${t.municipalityJa ?? ''}`
      assert(!seen.has(key), 'Territory repeated'); seen.add(key)
    }
  }
  if (relations !== null) {
    assert(Array.isArray(relations) && relations.length > 0 && relations.length <= 50, 'relations must list 1..50 rows')
    const seen = new Set()
    for (const r of relations) {
      assertExactKeys(r, ['kind', 'targetKey', 'status', 'sourceUrl', 'factIndex'], 'review relation')
      assert(RELATION_KINDS.includes(r.kind), 'Relation kind outside the closed list')
      assert(keyShape.test(r.targetKey) || poiIdShape.test(r.targetKey), 'Relation target must be a reviewed key or POI ID')
      assert(r.targetKey !== row.sourceKey && r.targetKey !== row.existingPoiId, 'Self relation forbidden')
      assert(EVIDENCE_STATUSES.includes(r.status), 'Relation status outside the closed list')
      assert(factFor(row, r), 'Relation needs a source recorded in the row facts')
      const key = `${r.kind}|${r.targetKey}`
      assert(!seen.has(key), 'Relation repeated'); seen.add(key)
    }
  }
  return { scope, relations }
}

/**
 * Связи реестра целятся в ключи; документ хранит POI ID и record id цели.
 * Цель разрешается вызывающим (снимок базы или хранилище) — здесь лишь
 * собирается документ и называются неразрешённые ключи. Текст факта обязан
 * называть цель по имени: иначе источник доказывает что-то другое.
 */
export function reviewGeographyDocument(row, { resolveTarget, today }) {
  const { scope, relations } = assertReviewGeography(row)
  if (scope === null && relations === null) return { document: null, unresolved: [] }
  const territories = (scope ?? []).map((t) => ({
    prefectureEn: t.prefectureEn, municipalityJa: t.municipalityJa, status: t.status,
    source: { url: t.sourceUrl, checkedOn: factFor(row, t).checkedOn, factId: null, decisionRef: row.decisionRef },
  }))
  const unresolved = []
  const resolved = []
  for (const r of relations ?? []) {
    const target = resolveTarget(r.targetKey)
    if (!target) { unresolved.push(r.targetKey); continue }
    if (poiIdShape.test(r.targetKey)) assert.equal(target.poiId,r.targetKey,'Relation target identity drift')
    const fact = factFor(row, r)
    assert(filled(target.nameRu) && fact.text.includes(target.nameRu), `Relation fact does not name the target ${r.targetKey}`)
    resolved.push({
      kind: r.kind, target: { poiId: target.poiId, recordId: target.recordId }, direction: RELATION_DIRECTION, status: r.status,
      source: { url: r.sourceUrl, checkedOn: fact.checkedOn, factId: null, decisionRef: row.decisionRef },
    })
  }
  const document = assertPoiGeographyDocument({ spec: POI_GEOGRAPHY_SPEC, updatedAt: today, territories, relations: resolved }, row.existingPoiId ?? null)
  return { document, unresolved }
}
