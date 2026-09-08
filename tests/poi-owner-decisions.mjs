#!/usr/bin/env node
/**
 * JA-5: артефакт решений владельца — только действительно неоднозначные строки.
 *
 *   node tests/poi-owner-decisions.mjs
 *
 * Доказывается:
 *   • поводов спросить ровно четыре, и все — о тождестве либо о запрете;
 *     совпадение имени без независимого признака и категориальная
 *     неоднозначность вопросами НЕ становятся (решение владельца 3.3);
 *   • ни одно машинное предложение не выдано за решение: `answer` пуст,
 *     предложенное помечено `machine`, русское имя требует редакторской сверки;
 *   • файл не выдаёт полномочий: сеть, запись и Git в нём объявлены закрытыми;
 *   • превышение потолка названо, а не обрезано молча.
 */
import {
  collectOwnerDecisions, DECISION_ANSWERS, DECISION_REASONS, MAX_DECISIONS,
  OWNER_DECISIONS_SPEC, proposeRussianName, summarizeOwnerDecisions,
} from '../scripts/poi-portals/lib/owner-decisions.mjs'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const has = (label, text, needle) => {
  if (typeof text === 'string' && text.includes(needle)) ok++
  else bad.push(`${label}: в «${String(text).slice(0, 240)}» нет «${needle}»`)
}

const AT = '2026-09-08T14:00:00.000Z'
const reviewRow = (key, reason, extra = {}) => ({
  sourceKey: key, nameEn: `Object ${key}`, url: `https://www.japan-guide.com/e/${key}.html`,
  reason, detail: 'подробность', categories: ['Temple'], classification: { poiPrimaryType: 'buddhist_temple' },
  nameMatches: [], ...extra,
})
const queuesOf = (rows) => ({ reportDigest: `sha256:${'a'.repeat(64)}`, queues: { review: rows, candidate: [] } })

/* ── 1. Спрашиваем только о тождестве и запрете ─────────────────────────── */
{
  const queues = queuesOf([
    reviewRow('e1', 'ambiguousName', { nameMatches: ['POI-000001', 'POI-000002'] }),
    reviewRow('e2', 'linkConflict'),
    reviewRow('e3', 'nameMatchWithoutIndependentSignal', { nameMatches: ['POI-000009'] }),
    reviewRow('e4', 'categoryAmbiguous'),
    reviewRow('e5', 'categoryUnresolved'),
    reviewRow('e6', 'categoryConflict'),
  ])
  const report = collectOwnerDecisions({ queues, createdAt: AT })
  t('поводов ровно четыре', DECISION_REASONS.join(','), 'ambiguousName,linkConflict,placeAmbiguous,sourceForbidden')
  t('спрошено только о тождестве', report.items.map((i) => i.sourceKey).join(','), 'e1,e2')
  t('  совпадение имени без признака вопросом не стало', report.items.some((i) => i.sourceKey === 'e3'), false)
  t('  категориальная неоднозначность вопросом не стала', report.items.some((i) => ['e4', 'e5', 'e6'].includes(i.sourceKey)), false)
  t('вопрос сформулирован для человека', report.items[0].question.includes('Какая из них'), true)
  t('возможные дубли названы', report.items[0].possibleDuplicates.join(','), 'POI-000001,POI-000002')
  t('источник назван', report.items[0].source.url, 'https://www.japan-guide.com/e/e1.html')
  t('счётчики сходятся', `${report.counts.asked}/${report.counts.found}/${report.counts.beyondLimit}`, '2/2/0')
  t('  и разложены по поводам', report.counts.byReason.ambiguousName, 1)
}

/* ── 2. Машинное не выдаётся за человеческое ────────────────────────────── */
{
  const enrichment = {
    reportDigest: `sha256:${'b'.repeat(64)}`,
    rows: [{
      sourceKey: 'japan-guide:e1', outcome: 'enriched', facts: [
        { field: 'nameJa', value: '清水寺' }, { field: 'nameKana', value: 'キヨミズデラ' },
        { field: 'address', value: '京都府京都市東山区清水1-294' }, { field: 'lat', value: '34.9949' }, { field: 'lon', value: '135.7850' },
      ],
    }],
  }
  const report = collectOwnerDecisions({ queues: queuesOf([reviewRow('japan-guide:e1', 'ambiguousName')]), enrichment, createdAt: AT })
  const item = report.items[0]
  t('ответ не проставлен', item.answer, null)
  t('  и варианты предложены', item.answers.join(','), DECISION_ANSWERS.join(','))
  t('предполагаемый тип помечен машинным', item.suggestedType.source, 'machine')
  t('русское имя помечено машинным', item.names.ru.source, 'machine')
  t('  и требует редакторской сверки', item.names.ru.needsEditorialReview, true)
  t('  и получено по кане через Поливанова', item.names.ru.note, 'Поливанов по кане')
  t('  и это непустое предложение', typeof item.names.ru.value === 'string' && item.names.ru.value.length > 0, true)
  t('японское имя из наблюдений JA-3', item.names.ja, '清水寺')
  t('география из наблюдений JA-3', `${item.geography.lat},${item.geography.lon}`, '34.9949,135.7850')
  t('  и адрес тоже', item.geography.address, '京都府京都市東山区清水1-294')
  const noKana = proposeRussianName({ nameJa: null, nameKana: null, nameEn: 'Kiyomizudera Temple' })
  t('без каны предложение идёт от английского', noKana.note, 'по английскому имени')
  t('  и всё равно требует сверки', noKana.needsEditorialReview, true)
  const nothing = proposeRussianName({ nameJa: null, nameKana: null, nameEn: '' })
  t('предложить нечем — так и сказано', nothing.note, 'предложить нечем')
  t('  и значение не выдумано', nothing.value, null)
}

/* ── 3. Файл не выдаёт полномочий ───────────────────────────────────────── */
{
  const report = collectOwnerDecisions({ queues: queuesOf([reviewRow('e1', 'ambiguousName')]), createdAt: AT })
  t('сеть не разрешена', report.grants.network, false)
  t('запись не разрешена', report.grants.write, false)
  t('Git не разрешён', report.grants.git, false)
  has('и это сказано словами', report.note, 'НЕ является разрешением')
  has('сводка повторяет это человеку', summarizeOwnerDecisions(report), 'не даёт полномочий')
  t('версия названа', report.spec, OWNER_DECISIONS_SPEC)
  t('отпечаток не зависит от момента', report.reportDigest,
    collectOwnerDecisions({ queues: queuesOf([reviewRow('e1', 'ambiguousName')]), createdAt: '2027-01-01T00:00:00.000Z' }).reportDigest)
}

/* ── 4. Неоднозначное опознание и запрет сайта ──────────────────────────── */
{
  const identification = {
    reportDigest: `sha256:${'c'.repeat(64)}`,
    rows: [
      {
        sourceKey: 'japan-guide:e7', nameEn: 'Twin Temple', sourceUrl: 'https://x/e7', outcome: 'ambiguous',
        detail: 'подошли 2 — выбор за человеком', place: null,
        alternatives: [
          { placeId: 'ChIJaaaaaaaaaaaaaaaaaaaaa1', businessStatus: 'OPERATIONAL', prefecture: 'Osaka', coordinates: { lat: 34.1, lon: 135.1, observedOn: '2026-09-08', validUntil: '2026-10-08', ttlDays: 30 } },
          { placeId: 'ChIJbbbbbbbbbbbbbbbbbbbbb2', businessStatus: 'OPERATIONAL', prefecture: 'Tokyo', coordinates: { lat: 35.2, lon: 139.2, observedOn: '2026-09-08', validUntil: '2026-10-08', ttlDays: 30 } },
        ],
      },
      { sourceKey: 'japan-guide:e8', nameEn: 'Solo', sourceUrl: 'https://x/e8', outcome: 'resolved', detail: 'исход резолвера: resolved', place: { placeId: 'ChIJ1' }, alternatives: [] },
    ],
  }
  const enrichment = {
    reportDigest: `sha256:${'d'.repeat(64)}`,
    rows: [
      { sourceKey: 'japan-guide:e9', nameEn: 'Closed Site', sourceUrl: 'https://x/e9', outcome: 'policyDenied', domain: 'closed.jp', detail: 'robotsDenied: /', facts: [] },
      { sourceKey: 'japan-guide:e10', nameEn: 'Quiet', sourceUrl: 'https://x/e10', outcome: 'policyUnknown', domain: 'silent.jp', detail: 'robotsUnavailable', facts: [] },
    ],
  }
  const report = collectOwnerDecisions({ queues: queuesOf([]), enrichment, identification, createdAt: AT })
  const ambiguous = report.items.find((i) => i.reason === 'placeAmbiguous')
  t('неоднозначное опознание спрашивается', Boolean(ambiguous), true)
  t('  и вопрос несёт варианты', ambiguous.placeAlternatives.length, 2)
  t('  различимые идентификаторами', ambiguous.placeAlternatives.map((a) => a.placeId).join(','), 'ChIJaaaaaaaaaaaaaaaaaaaaa1,ChIJbbbbbbbbbbbbbbbbbbbbb2')
  t('  и географией', ambiguous.placeAlternatives.map((a) => a.prefecture).join(','), 'Osaka,Tokyo')
  t('  имён Google в вариантах нет', JSON.stringify(ambiguous.placeAlternatives).includes('Temple'), false)
  has('  вопрос указывает, где смотреть варианты', ambiguous.question, 'placeAlternatives')
  t('  а опознанное — нет', report.items.some((i) => i.sourceKey === 'japan-guide:e8'), false)
  t('запрет сайта спрашивается', report.items.some((i) => i.reason === 'sourceForbidden'), true)
  t('  а молчание сайта вопросом не становится: спрашивать не о чем', report.items.some((i) => i.sourceKey === 'japan-guide:e10'), false)
  t('отпечатки всех трёх этапов названы', `${report.inputs.queues !== null}/${report.inputs.enrichment !== null}/${report.inputs.identification !== null}`, 'true/true/true')
  t('этап без отчёта не мешает', collectOwnerDecisions({ queues: queuesOf([]), createdAt: AT }).inputs.enrichment, null)
}

/* ── 5. Потолок назван, а не применён молча ─────────────────────────────── */
{
  const many = Array.from({ length: MAX_DECISIONS + 7 }, (_, i) => reviewRow(`e${String(i).padStart(3, '0')}`, 'ambiguousName'))
  const report = collectOwnerDecisions({ queues: queuesOf(many), createdAt: AT })
  t('в файл попало не больше потолка', report.items.length, MAX_DECISIONS)
  t('  найдено названо целиком', report.counts.found, MAX_DECISIONS + 7)
  t('  и остаток за потолком назван', report.counts.beyondLimit, 7)
  has('  сводка говорит об остатке', summarizeOwnerDecisions(report), 'за потолком 7')
  t('потолок объявлен', MAX_DECISIONS, 40)
  const small = collectOwnerDecisions({ queues: queuesOf(many), createdAt: AT, limit: 3 })
  t('потолок можно сузить', `${small.counts.asked}/${small.counts.beyondLimit}`, `3/${MAX_DECISIONS + 4}`)
  t('пустая очередь — пустой файл, а не ошибка', collectOwnerDecisions({ queues: queuesOf([]), createdAt: AT }).counts.asked, 0)
}

/* ── 6. JG2-06: вопрос без вариантов не задаётся ────────────────────────── */
{
  const identification = {
    reportDigest: `sha256:${'e'.repeat(64)}`,
    rows: [{ sourceKey: 'japan-guide:e7', nameEn: 'Twin', sourceUrl: 'https://x/e7', outcome: 'ambiguous', detail: 'подошли 2', place: null, alternatives: [] }],
  }
  let message = '(без ошибки)'
  try { collectOwnerDecisions({ queues: queuesOf([]), identification, createdAt: AT }) } catch (e) { message = e.message }
  has('неоднозначность без вариантов — отказ, а не вопрос без ответа', message, 'на который нельзя ответить')
  /*
   * РАСХОЖДЕНИЕ МЕСТ — ИСХОД JA-3, И ЧИТАЕТСЯ ОН У JA-3.
   *
   * Очередь `review` отчёта JG-1 здесь ПУСТА намеренно: в настоящем прогоне
   * строка, дошедшая до обогащения, была у JG-1 в `candidate`, и исхода
   * `factsConflict` в его review-очереди не бывает вовсе. Вопрос обязан
   * появиться именно из отчёта обогащения — и ровно один.
   */
  const place = (field, value, at) => ({
    field, value, place: at, sourceUrl: 'https://two.jp/', observedAt: AT,
    locator: 'jsonld:Place', confidence: 'unverified', verifiedAt: null,
  })
  const conflictEnrichment = {
    reportDigest: `sha256:${'f'.repeat(64)}`,
    rows: [{
      sourceKey: 'japan-guide:e11', nameEn: 'Two Museums', sourceUrl: 'https://www.japan-guide.com/e/e11.html',
      outcome: 'factsConflict', detail: 'на странице 2 мест, расходятся поля: lat, lon, nameJa',
      conflicts: ['lat', 'lon', 'nameJa'],
      facts: [
        place('nameJa', '博物館A', 0), place('lat', '34.39', 0), place('lon', '132.45', 0),
        place('nameJa', '博物館B', 1), place('lat', '33.83', 1), place('lon', '132.76', 1),
      ],
    }],
  }
  const savedFetch = globalThis.fetch
  let googleCalls = 0
  globalThis.fetch = async () => { googleCalls += 1; throw new Error('сети здесь быть не должно') }
  let withConflict
  try {
    withConflict = collectOwnerDecisions({
      queues: queuesOf([]), enrichment: conflictEnrichment, identification: null, createdAt: AT,
    })
  } finally { globalThis.fetch = savedFetch }
  /* Доступ через `?.`: пропавший вопрос обязан назваться расхождением, а не
     оборвать сюиту на обращении к несуществующей строке. */
  const conflictItem = withConflict.items[0] ?? null
  t('при пустой review-очереди JG-1 вопрос всё равно появляется', withConflict.counts.asked, 1)
  t('  ровно один', withConflict.items.length, 1)
  t('  и это вопрос о тождестве', conflictItem?.reason ?? null, 'linkConflict')
  has('  вопрос называет расходящиеся поля', conflictItem?.question ?? '', 'lat, lon, nameJa')
  has('  и указывает, где смотреть факты', conflictItem?.question ?? '', 'sourcePlaces')
  t('  факты разложены по местам', conflictItem?.sourcePlaces?.length ?? 0, 2)
  t('  первое место — со своими значениями', JSON.stringify(conflictItem?.sourcePlaces?.[0] ?? null), JSON.stringify({ place: 0, facts: { nameJa: '博物館A', lat: '34.39', lon: '132.45' } }))
  t('  второе — со своими', JSON.stringify(conflictItem?.sourcePlaces?.[1] ?? null), JSON.stringify({ place: 1, facts: { nameJa: '博物館B', lat: '33.83', lon: '132.76' } }))
  t('  сводного имени нет', conflictItem ? conflictItem.names.ja : 'строки нет', null)
  t('  и сводных координат нет: третьей точки не собирается', conflictItem ? `${conflictItem.geography.lat}/${conflictItem.geography.lon}` : 'строки нет', 'null/null')
  t('  Google не вызывался', googleCalls, 0)
  t('  и опознания не требовалось', withConflict.inputs.identification, null)
  /* Тот же исход, положенный в чужой обход, вопросом больше не становится. */
  const misplaced = collectOwnerDecisions({
    queues: queuesOf([{ ...reviewRow('japan-guide:e12', 'factsConflict'), nameEn: 'Misplaced' }]),
    createdAt: AT,
  })
  t('исход JA-3 в review-очереди JG-1 вопросом не становится', misplaced.counts.asked, 0)
  /* Вопрос о нескольких местах без самих мест не собирается. */
  let bare = '(без ошибки)'
  try {
    collectOwnerDecisions({
      queues: queuesOf([]),
      enrichment: { reportDigest: `sha256:${'0'.repeat(64)}`, rows: [{ ...conflictEnrichment.rows[0], conflicts: [], facts: [] }] },
      createdAt: AT,
    })
  } catch (e) { bare = e.message }
  has('расхождение без названных полей — отказ', bare, 'спрашивать не о чем')
  let single = '(без ошибки)'
  try {
    collectOwnerDecisions({
      queues: queuesOf([]),
      enrichment: { reportDigest: `sha256:${'0'.repeat(64)}`, rows: [{ ...conflictEnrichment.rows[0], facts: [place('lat', '34.39', 0)] }] },
      createdAt: AT,
    })
  } catch (e) { single = e.message }
  has('одно место в вопросе о нескольких — отказ', single, 'выбирать не из чего')
}

if (bad.length) {
  console.error(`\n✗ провалено ${bad.length} из ${ok + bad.length}\n`)
  for (const line of bad) console.error(`  ${line}`)
  process.exitCode = 1
} else {
  console.log(`✓ JA-5 артефакт решений владельца: ${ok} проверок пройдено`)
}
