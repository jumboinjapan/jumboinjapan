/* Строит НАСТОЯЩИЙ снимок v1 ОПУБЛИКОВАННЫМ строителем из bd8ebe6.
   Работает вне рабочего дерева, в распакованном архиве коммита. */
import { writeFileSync } from 'node:fs'
import {
  buildDiscoveryRecord, buildDiscoverySnapshot, buildFactLead, buildOrderRecord,
  buildPageEvidence, buildPlacement,
} from '../scripts/poi-portals/lib/discovery-contract.mjs'

const HOST = 'https://www.japan-guide.com'
const AT = '2026-08-18T00:00:00.000Z'
const GATE = {
  httpCharset: 'shift-jis', metaCharset: 'utf-8', decodePolicy: 'mixed-page-utf8-locators-v1',
  decodeErrorCount: 0, decodeReplacements: 0, nonWhitelistedCodepoints: 0,
}
const ev = (url, pageRole, ch) => buildPageEvidence({
  url, pageRole, pageBytes: 1000, rawPageDigest: `sha256:${ch.repeat(64)}`, observedAt: AT, ...GATE,
})
const CHILD = `${HOST}/e/e4000.html`
const record = buildDiscoveryRecord({
  sourceKey: 'japan-guide:e4000',
  url: CHILD,
  nameEn: 'Legacy Child',
  placements: [buildPlacement({
    kind: 'destinationRanking', collectionSourceKey: 'japan-guide:e2157',
    listPosition: 1, editorialLevel: 0, categoryHint: null,
  })],
  factLeads: [buildFactLead({
    kind: 'name_en', appliesTo: null, value: 'Legacy Child', source: CHILD,
    sourceLocator: 'h1', observedAt: AT,
  })],
  omissions: [],
  pageEvidence: ev(CHILD, 'poi', 'b'),
})
const snapshot = buildDiscoverySnapshot({
  scope: { kind: 'full', limit: null },
  entryUrl: `${HOST}/e/e623a.html`,
  incompleteReasons: [],
  robotsEvidence: {
    url: `${HOST}/robots.txt`, bytes: 64, digest: `sha256:${'d'.repeat(64)}`,
    observedAt: AT, appliedGroups: ['*'],
  },
  catalogueEvidence: ev(`${HOST}/e/e623a.html`, 'catalogue', 'a'),
  catalogueTargetEvidence: [{ sourceKey: 'japan-guide:e2157', evidence: ev(`${HOST}/e/e2157.html`, 'collection', 'c') }],
  orderRecords: [buildOrderRecord('japan-guide:e2157', `sha256:${'c'.repeat(64)}`, ['japan-guide:e4000'])],
  records: [record],
  rejected: { targets: [], cards: [], pois: [] },
  counters: {
    networkRequests: 3, catalogueTargetsFound: 1, collectionsFound: 1, directPoisFound: 0,
    poisFound: 1, poisVisited: 1, recordsBuilt: 1, nonCanonicalLinks: 0,
    unknownAdmissionLabels: 0, emptyAdmissionValues: 0,
  },
})
writeFileSync('gen/v1-snapshot.json', `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
console.log('построено строителем bd8ebe6:', snapshot.contractVersion)
console.log('record:', snapshot.records[0].contractVersion, '| orderKeys:', Object.keys(snapshot.orderRecords[0]).join(','))
