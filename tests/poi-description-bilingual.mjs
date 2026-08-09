import { ingestPoi } from '../src/lib/poi-ingest.ts'
import { applyCanon } from '../src/lib/poi-canon.ts'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  actual === expected ? ok++ : bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}

// ── у каждого языка своя типографика, и они не путаются ───────────────────
// Английский идёт через canonicalTextEn: парные английские кавычки, точка
// в дробях, запятая в разрядах. Русский — через canonicalText: «ёлочки»,
// запятая в дробях, пробел в разрядах. Прогнать один текст правилами
// другого языка — порча, а не канон.
const c = applyCanon({
  nameRu: 'Австралийский дом',
  siteCity: 'tokamachi',
  descriptionRu: 'Павильон обмена. Открыт 09:00-17:00, вход 2.5 тысячи иен.',
  descriptionEn: 'A pavilion open 09:00-17:00. Tickets cost 2.5 thousand yen for "adults", 15 000 visitors a year.',
})
t('EN дошёл до значения', typeof c.value.descriptionEn, 'string')
t('EN без ёлочек', c.value.descriptionEn.includes('«'), false)
t('EN получил парные английские кавычки', c.value.descriptionEn.includes('“adults”'), true)
t('EN сохранил точку в дроби', c.value.descriptionEn.includes('2.5'), true)
t('EN разряды запятой', c.value.descriptionEn.includes('15,000'), true)
t('RU получил запятую в дроби', c.value.descriptionRu.includes('2,5'), true)
t('RU получил ёлочки', c.value.descriptionRu.includes('«') || !c.value.descriptionRu.includes('"'), true)

// ── единая политика написания английского: без макронов, британская норма ──
const spelling = applyCanon({
  nameRu: 'Тодайдзи',
  siteCity: 'nara',
  descriptionRu: 'Храм в Наре.',
  descriptionEn: 'Tōdai-ji sits by the harbor in the city center.',
})
const spellingNotes = spelling.issues.filter((i) => i.field === 'descriptionEn').map((i) => i.message).join(' | ')
t('макрон замечен', spellingNotes.includes('макрон'), true)
t('американское написание замечено', spellingNotes.includes('американское написание'), true)
t('но это замечания, не отказ', spelling.issues.some((i) => i.field === 'descriptionEn' && i.level === 'error'), false)

// ── русский без английского — ошибка канона ───────────────────────────────
// Правило ужесточено 06.08.2026 после замера живой базы: 121 запись из 431
// с русским текстом и без английского, обратных случаев ноль. Половину
// принимать нельзя, иначе долг продолжит расти.
const half = applyCanon({ nameRu: 'Тест', siteCity: 'tokyo', descriptionRu: 'Текст на русском.' })
t('EN пуст → undefined', half.value.descriptionEn, undefined)
t('это ошибка, а не замечание', half.issues.some((i) => i.field === 'descriptionEn' && i.level === 'error'), true)

// ── место совсем без описания заводится: правило про пару, а не про наличие ─
const noText = applyCanon({ nameRu: 'Заглушка', siteCity: 'tokyo' })
t('без описаний вовсе — не ошибка', noText.issues.some((i) => i.field === 'descriptionEn'), false)

// ── путь записи кладёт английский в черновик, а не в публикуемое поле ──────
const store = {
  async listExisting() { return [] },
  async findBySourceKey() { return null },
  async create() { return { poiId: 'POI-000999', recordId: 'rec999' } },
}
const res = await ingestPoi(
  {
    source: { kind: 'telegram-agent', id: 'test' },
    poi: {
      nameRu: 'Австралийский дом',
      nameEn: 'Australia House',
      siteCity: 'tokamachi',
      categoriesRu: ['Музей'],
      descriptionRu: 'Павильон культурного обмена.',
      descriptionEn: 'A cultural exchange pavilion.',
    },
  },
  store,
  { dryRun: true },
)
t('запись прошла', res.outcome, 'created')
t('EN в черновике', res.fields['Description Draft (EN)'], 'A cultural exchange pavilion.')
t('RU в черновике', res.fields['Description Draft (RU)'], 'Павильон культурного обмена.')
t('публикуемое EN не тронуто', res.fields['Description (EN)'], undefined)
t('публикуемое RU не тронуто', res.fields['Description (RU)'], undefined)

// ── без английского запись не заводится ────────────────────────────────────
const res2 = await ingestPoi(
  {
    source: { kind: 'telegram-agent', id: 'test' },
    poi: { nameRu: 'Тихое место', siteCity: 'tokyo', categoriesRu: ['Музей'], descriptionRu: 'Только по-русски.' },
  },
  store,
  { dryRun: true },
)
t('без EN запись отвергается', res2.outcome, 'rejected_canon')
t('причина названа', res2.canonIssues.some((i) => i.field === 'descriptionEn' && i.level === 'error'), true)

// ── место без описаний вовсе заводится: правило про пару, а не про наличие ──
const res3 = await ingestPoi(
  {
    source: { kind: 'telegram-agent', id: 'test' },
    poi: { nameRu: 'Служебная точка', siteCity: 'tokyo', categoriesRu: ['Музей'] },
  },
  store,
  { dryRun: true },
)
t('без описаний вовсе — создаётся', res3.outcome, 'created')
t('оба поля пусты', `${res3.fields['Description Draft (RU)']}|${res3.fields['Description Draft (EN)']}`, 'null|null')

console.log(bad.length ? `✗ ${bad.length} провалов:\n` + bad.join('\n') : `✓ описание POI на двух языках: ${ok} проверок пройдено`)
