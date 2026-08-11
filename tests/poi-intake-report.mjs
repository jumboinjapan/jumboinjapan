/**
 * Ветки отчёта бота приёма. До 11.08.2026 ни одна теста не имела: приём
 * умел ровно два исхода, и любой новый уезжал владельцу под заголовком
 * «не прошла канон» — с неверной причиной, по которой не починить ничего.
 */
import { buildReport } from '../src/lib/poi-intake-report.ts'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${expected}, получили ${actual}`)
}
const has = (label, text, needle) => t(label, text.includes(needle), true)

const research = {
  nameRu: 'Храм Дзёдзёдзи', nameEn: 'Jojoji Temple', siteCity: 'tokyo', prefectureRu: 'Токио',
  prefectureEn: 'Tokyo', categoriesRu: [], workingHours: '', ticketsNote: '', website: '',
  descriptionRu: '', descriptionEn: '', parentNameRu: '', parentNameEn: '',
  otherLocations: [], sources: [], openQuestions: [], operatingStatus: 'Работает',
}
const base = {
  created: false, screen: { verdict: 'clear', blockingDuplicate: null, duplicates: [], parent: null,
    parentAmbiguous: [], geoNeighbours: [], geoRefutedDuplicate: null, reasons: [] },
  poiId: '', recordId: '', research, duplicates: [], parent: null, parentCreatedAsStub: false,
  parentNotLinked: null, stubs: [], stubsSkippedAsExisting: [], stubsNeedsReview: [], stubsRejected: [],
  canonIssues: [], outcome: 'rejected_canon', explanation: '', airtableUrl: 'https://airtable.com/x',
}

// ── остановка гейта ─────────────────────────────────────────────────────
const stopped = buildReport({
  ...base,
  outcome: 'needs_review',
  explanation: 'Нужна проверка человеком, запись не заведена. Похоже на POI-000700 «Храм Дзёдзёдзи» (0.85).',
  duplicates: [{ poiId: 'POI-000700', nameRu: 'Храм Дзёдзёдзи', siteCity: 'tokyo' }],
})
has('остановка помечена своим заголовком', stopped, 'Остановил: нужна ваша проверка')
t('и не выдаётся за отказ канона', stopped.includes('не прошла канон'), false)
t('и не выдаётся за дубль', stopped.includes('Уже есть в базе'), false)
has('причина показана', stopped, 'Похоже на POI-000700')
has('похожие записи перечислены', stopped, 'POI-000700')
has('предложен force', stopped, 'заведу его принудительно')

// ── отказ канона остался собой ──────────────────────────────────────────
const rejected = buildReport({ ...base, outcome: 'rejected_canon', explanation: 'Не соответствует канону: нет города.' })
has('канон помечен своим заголовком', rejected, 'не прошла канон')
t('и не выдаётся за остановку', rejected.includes('Остановил'), false)

// ── дубль остался собой ─────────────────────────────────────────────────
const dup = buildReport({ ...base, outcome: 'blocked_duplicate', poiId: 'POI-000700', recordId: 'rec1', explanation: 'Уже есть.' })
has('дубль помечен своим заголовком', dup, 'Уже есть в базе')
has('дана ссылка на существующую запись', dup, 'Открыть существующую запись')

// ── заглушки: остановленные отдельно от «уже в базе» ─────────────────────
const withStubs = buildReport({
  ...base, created: true, outcome: 'created', poiId: 'POI-000900', recordId: 'rec9',
  stubsSkippedAsExisting: [{ poiId: 'POI-000111', nameRu: 'Храм Сэнсодзи', siteCity: 'tokyo' }],
  stubsNeedsReview: [{ nameRu: 'Ворота Каминаримон', siteCity: 'tokyo', outcome: 'needs_review', reason: 'Рядом уже есть: POI-000111.' }],
  stubsRejected: [{ nameRu: 'Без города', siteCity: '', outcome: 'rejected_canon', reason: 'Не соответствует канону: нет города.' }],
  parentNotLinked: { nameRu: 'Асакуса', siteCity: 'tokyo', outcome: 'needs_review', reason: 'Нужна проверка человеком.' },
})
has('остановленные локации в своём списке', withStubs, 'Остановлено на проверку: 1')
has('и названы поимённо', withStubs, 'Ворота Каминаримон')
has('отвергнутые каноном в своём списке', withStubs, 'Не прошли канон: 1')
has('уже существующие остались отдельно', withStubs, 'Уже в базе (пропущены)')
has('несвязанный родитель не исчезает', withStubs, 'Родитель «Асакуса» не связан')

if (bad.length) {
  console.error(`\n✗ провалено ${bad.length} из ${ok + bad.length}\n`)
  for (const b of bad) console.error(`  ${b}`)
  process.exitCode = 1
} else {
  console.log(`✓ отчёт приёма POI: ${ok} проверок пройдено`)
}
