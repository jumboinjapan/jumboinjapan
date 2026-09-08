/**
 * JA‑1 (JG‑1): ЧИСТАЯ ПРОЕКЦИЯ `poi-discovery-snapshot/v3` → `poi-portal-intake/v1`.
 *
 * Снимок discovery Japan Guide (1 140 объектов, 06.09.2026) переводится в пакет
 * общей границы адаптера (`portal-intake-contract.mjs`, JA‑0). Здесь нет ни
 * сети, ни решений: только форма.
 *
 * Что переносится в НАБЛЮДАЕМЫЕ поля кандидата: английское имя (`nameEn` из
 * записи discovery) и адрес страницы. Всё остальное — японское имя, город,
 * координаты, адрес — ЯВНЫЕ ПРОПУСКИ (`null`): источник их не сообщает, и
 * догадка тут запрещена (план JA‑1: «отсутствующие … оставлять явными
 * пропусками»).
 *
 * Что переносится в ПОДСКАЗКИ (`hints`, всегда `unverified`, `verifiedAt: null`):
 * размещения в справочнике (регион/коллекция, позиция, категория источника),
 * факт-лиды страницы (`official_url_hint`, `hours_hint`, `closed_hint`,
 * `admission_hint`) и provenance страницы (отпечаток сырых байтов). Ни одна
 * подсказка не становится проверенным полем — это запрещает сама грамматика
 * пакета, а верность извлечения проверяется контрактом discovery.
 *
 * ОЖИДАЕМЫЙ СОСТАВ ИСТОЧНИКА выводит ВЫЗЫВАЮЩИЙ (`expectedInputFromSnapshot`)
 * из проверенного снимка независимо от проекции: адаптеру нельзя задавать
 * состав для собственной проверки (план JA‑1).
 */
import { assertDiscoverySnapshot } from './discovery-contract.mjs'
import { buildPortalIntakeBatch } from './portal-intake-contract.mjs'

export const JAPAN_GUIDE_INTAKE_VERSION = 'japan-guide-intake/v1'
/** Роды факт-лидов, которые переносятся подсказками; остальное остаётся в снимке. */
export const HINTED_LEAD_KINDS = Object.freeze({
  official_url_hint: 'official_url',
  hours_hint: 'hours',
  closed_hint: 'closed',
  admission_hint: 'admission',
})

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0

/**
 * Независимый вывод ожидаемого состава: только после проверки снимка
 * полным контрактом discovery. Возвращает `{ spec, digest, records }` для
 * `readPortalIntakeBatch`/`evaluatePortalIntakeBatch`.
 */
export function expectedInputFromSnapshot(snapshot) {
  assertDiscoverySnapshot(snapshot)
  return {
    spec: snapshot.contractVersion,
    digest: snapshot.snapshotDigest,
    records: snapshot.records.map((record) => ({ sourceKey: record.sourceKey, sourceUrl: record.url })),
  }
}

/** Одна запись discovery → одна запись пакета (кандидат либо именованный отказ). */
export function projectDiscoveryRecord(record) {
  const hints = []
  const hint = (field, value) => {
    if (nonEmpty(value)) hints.push({ field, value, sourceUrl: record.url, confidence: 'unverified', verifiedAt: null })
  }
  for (const placement of record.placements ?? []) {
    hint('placement', [placement.kind, placement.collectionSourceKey ?? '', placement.listPosition ?? '', placement.editorialLevel ?? ''].join('|'))
    hint('category', placement.categoryHint ?? '')
  }
  for (const lead of record.factLeads ?? []) {
    const field = HINTED_LEAD_KINDS[lead.kind]
    if (field) hint(field, lead.value)
  }
  if (record.pageEvidence?.rawPageDigest) hint('page_digest', record.pageEvidence.rawPageDigest)
  if (!nonEmpty(record.nameEn)) {
    return { kind: 'refused', sourceKey: record.sourceKey, sourceUrl: record.url, reason: 'missingName', detail: 'страница discovery без английского имени — кандидата не построить', hints }
  }
  return {
    kind: 'candidate',
    sourceKey: record.sourceKey,
    sourceUrl: record.url,
    observed: { nameJa: null, nameKana: null, nameEn: record.nameEn.trim(), address: null, prefectureJa: null, cityJa: null, lat: null, lon: null },
    hints,
  }
}

/**
 * Пакет границы адаптера из ПРОВЕРЕННОГО снимка. Состав входа берётся из
 * снимка же — но пакет сам себя не удостоверяет: вызывающий обязан передать
 * в `evaluatePortalIntakeBatch` свой `expectedInputFromSnapshot`.
 */
export function buildJapanGuideIntakeBatch(snapshot, portal) {
  assertDiscoverySnapshot(snapshot)
  if (!portal || portal.id !== 'japan-guide') throw new TypeError(`${JAPAN_GUIDE_INTAKE_VERSION}: проекция только для портала japan-guide`)
  const input = {
    spec: snapshot.contractVersion,
    digest: snapshot.snapshotDigest,
    records: snapshot.records.map((record) => ({ sourceKey: record.sourceKey, sourceUrl: record.url })),
  }
  return buildPortalIntakeBatch({
    spec: 'poi-portal-intake/v1',
    portalId: portal.id,
    adapterVersion: JAPAN_GUIDE_INTAKE_VERSION,
    input,
    records: snapshot.records.map(projectDiscoveryRecord),
  })
}
