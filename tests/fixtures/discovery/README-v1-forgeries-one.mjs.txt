/* Строит ОДИН вариант снимка v1 строителями ЛОКАЛЬНОГО дерева.
   Дерево — копия bd8ebe6 с ОДНОЙ точечной заплатой: в перечисление v1
   добавлено состояние, которого у настоящего v1 не было. Отпечатки при этом
   считаются доменами v1 — то есть снимок получается ВНУТРЕННЕ СОГЛАСОВАННЫМ.
   Именно такую подделку обязан отвергнуть текущий читатель: не по отпечатку,
   а по версии формата. */
import { writeFileSync } from 'node:fs'
import {
  buildDiscoveryRecord, buildDiscoverySnapshot, buildFactLead, buildOmission, buildOrderRecord,
  buildPageEvidence, buildPlacement,
} from './scripts/poi-portals/lib/discovery-contract.mjs'

const variant = process.argv[2]
const HOST = 'https://www.japan-guide.com'
const AT = '2026-08-18T00:00:00.000Z'
const GATE = {
  httpCharset: 'shift-jis', metaCharset: 'utf-8', decodePolicy: 'mixed-page-utf8-locators-v1',
  decodeErrorCount: 0, decodeReplacements: 0, nonWhitelistedCodepoints: 0,
}
const ev = (url, pageRole, ch) => buildPageEvidence({
  url, pageRole, pageBytes: 1000, rawPageDigest: `sha256:${ch.repeat(64)}`, observedAt: AT, ...GATE,
})

const PAGE_ROLE_VARIANTS = {
  pageRoleAmbiguous: 'pageRoleAmbiguous',
  pageRoleUnknown: 'pageRoleUnknown',
  containerTopologyAmbiguous: 'containerTopologyAmbiguous',
}

/*
 * `targetEvidenceLegacySuffix` — адрес нового семейства стоит НЕ в записи, а
 * в свидетельстве цели каталога. Запись остаётся законной `legacy`, поэтому
 * проверка семейства у записи такую подделку не видит вовсе.
 *
 * Охват ОГРАНИЧЕННЫЙ: цель найдена, но до её страницы обход не дошёл —
 * записи у неё нет и быть не должно. Это самый дешёвый законный способ
 * внести в снимок цель без записи.
 */
const targetSuffix = variant === 'targetEvidenceLegacySuffix'

/*
 * ЧЕТЫРЕ СНИМКА, КОТОРЫЕ ОПУБЛИКОВАННЫЙ v1 ПРИНИМАЛ САМ.
 *
 * Заплат они не требуют вовсе: `orderRecord.order[]`, `rejected.targets[].ref`,
 * `rejected.pois[].ref` и `rejected.cards[].destination` хранят ключ без
 * адреса, и v1 их не проверял ничем, кроме формы строки. Это не подделки
 * версии, а дыры в связности — и текущий читатель обязан закрыть их для
 * ОБОИХ форматов.
 */
const orderSuffix = variant === 'orderLegacySuffix'
const failedTargetSuffix = variant === 'failedTargetLegacySuffix'
const orphanCard = variant === 'orphanCardRejection'
const orphanPoi = variant === 'orphanPoiRejection'
const limited = targetSuffix || orderSuffix || orphanPoi
const url = variant === 'legacySuffix' ? `${HOST}/e/e5036_fish.html` : `${HOST}/e/e4000.html`
const key = variant === 'legacySuffix' ? 'japan-guide:e5036_fish' : 'japan-guide:e4000'
const placement = variant === 'containerChild'
  ? buildPlacement({
    kind: 'containerChild', collectionSourceKey: 'japan-guide:e2157',
    listPosition: null, editorialLevel: null, categoryHint: null,
  })
  : buildPlacement({
    kind: 'destinationRanking', collectionSourceKey: 'japan-guide:e2157',
    listPosition: 1, editorialLevel: 0, categoryHint: null,
  })
const omissions = variant === 'unknownAdmissionLabel'
  ? [buildOmission({ code: 'unknownAdmissionLabel', locator: 'hours_fees_block', originalLengthBytes: 7 })]
  : []

const record = buildDiscoveryRecord({
  sourceKey: key,
  url,
  nameEn: 'Legacy Child',
  placements: [placement],
  factLeads: [buildFactLead({
    kind: 'name_en', appliesTo: null, value: 'Legacy Child', source: url,
    sourceLocator: 'h1', observedAt: AT,
  })],
  omissions,
  pageEvidence: ev(url, 'poi', 'b'),
})

const roleCode = PAGE_ROLE_VARIANTS[variant] ?? null
const rejectedTargets = roleCode
  ? [{ ref: 'japan-guide:e9001', code: roleCode }]
  : (failedTargetSuffix ? [{ ref: 'japan-guide:e5036_fish', code: 'structureMismatch' }] : [])
/* ЗАКОННЫЙ снимок v1 с отвергнутой карточкой: заплат не потребовал вовсе —
   коды отказа карточек у v1 и v2 совпадают. Текущий читатель ОБЯЗАН его
   принять; на нём и проверяется, что `policy.cardRejectionCodes` читается. */
const rejectedCards = variant === 'cardRejected'
  ? [{ destination: 'japan-guide:e2157', position: 3, code: 'rankRepeated' }]
  : (orphanCard ? [{ destination: 'japan-guide:e9999', position: 1, code: 'rankRepeated' }] : [])
/* Отвергнутый объект, которого нет ни в одном порядке: порядок несёт ДРУГОЙ
   ключ, поэтому счётчики сходятся и подмену не показывают. */
const rejectedPois = orphanPoi ? [{ ref: 'japan-guide:e9999', code: 'structureMismatch' }] : []
const orderKeys = orderSuffix
  ? [key, 'japan-guide:e5036_fish']
  : (orphanPoi ? [key, 'japan-guide:e9998'] : [key])
const orderRecord = variant === 'collectionKind'
  ? buildOrderRecord('japan-guide:e2157', `sha256:${'c'.repeat(64)}`, orderKeys, 'ranked')
  : buildOrderRecord('japan-guide:e2157', `sha256:${'c'.repeat(64)}`, orderKeys)

/* Строится ЛЕНИВО: у копий без заплаты грамматики такой адрес не разбирается
   вовсе, и вычислять его для всех вариантов значило бы уронить их все. */
const suffixTargets = () => [{
  sourceKey: 'japan-guide:e5036_fish',
  evidence: ev(`${HOST}/e/e5036_fish.html`, 'poi', 'e'),
}]

const snapshot = buildDiscoverySnapshot({
  scope: limited ? { kind: 'limited', limit: 1 } : { kind: 'full', limit: null },
  entryUrl: `${HOST}/e/e623a.html`,
  incompleteReasons: [
    ...(rejectedCards.length ? [{ code: 'cardRejected', count: rejectedCards.length }] : []),
    ...(limited ? [{ code: 'limitApplied', count: 1 }] : []),
    ...(rejectedPois.length ? [{ code: 'poiStructureMismatch', count: rejectedPois.length }] : []),
    ...(roleCode || failedTargetSuffix ? [{ code: 'targetStructureMismatch', count: 1 }] : []),
  ],
  robotsEvidence: {
    url: `${HOST}/robots.txt`, bytes: 64, digest: `sha256:${'d'.repeat(64)}`,
    observedAt: AT, appliedGroups: ['*'],
  },
  catalogueEvidence: ev(`${HOST}/e/e623a.html`, 'catalogue', 'a'),
  catalogueTargetEvidence: [
    { sourceKey: 'japan-guide:e2157', evidence: ev(`${HOST}/e/e2157.html`, 'collection', 'c') },
    ...(targetSuffix ? suffixTargets() : []),
  ],
  orderRecords: [orderRecord],
  records: [record],
  rejected: { targets: rejectedTargets, cards: rejectedCards, pois: rejectedPois },
  counters: {
    networkRequests: 3,
    catalogueTargetsFound: roleCode || targetSuffix || failedTargetSuffix ? 2 : 1,
    collectionsFound: 1,
    directPoisFound: targetSuffix ? 1 : 0,
    poisFound: targetSuffix || orderSuffix || orphanPoi ? 2 : 1,
    poisVisited: 1 + rejectedPois.length,
    recordsBuilt: 1,
    nonCanonicalLinks: 0,
    unknownAdmissionLabels: variant === 'unknownAdmissionLabel' ? 1 : 0, emptyAdmissionValues: 0,
  },
})
writeFileSync(`gen-${variant}.json`, JSON.stringify(snapshot), 'utf8')
console.log(`ok ${variant} ${snapshot.contractVersion} ${snapshot.records[0].contractVersion}`)
