/**
 * OFFLINE-ПРИЁМКА P05.3 на настоящем корпусе Осаки.
 *
 * Двадцать РЕАЛЬНЫХ строк портала `bodik-osaka-tourism` — с японскими именами и
 * координатами источника, ровно в том виде, в каком их отдаёт адаптер, —
 * заморожены в `tests/fixtures/poi-canary-osaka/`. У всех двадцати английского
 * имени нет: именно из-за этого прежний портальный путь, искавший только по
 * английскому названию, давал на production-корпусе ноль опознанных мест.
 *
 * Ответы Google тоже заморожены. Сети нет, Airtable нет, денег нет: приёмка
 * обязана быть воспроизводимой в свежем клоне и не зависеть ни от выдачи
 * провайдера, ни от файлов в `tmp/`.
 *
 * Прогон идёт через ПРОИЗВОДСТВЕННУЮ КОМПОЗИЦИЮ `writeRun` → `resolvePortalPlace`
 * → канонический `resolvePlace` → `ingestPoiBatch` → `ingestPoi` → store.
 */
import { readFileSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { writeRun } from '../scripts/poi-portals/collect-pois.mjs'
import { createSnapshotStore } from '../scripts/poi-portals/lib/base-snapshot.mjs'
import { resolvePlace } from '../src/lib/place-resolve.ts'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const has = (label, text, needle) => {
  if (typeof text === 'string' && text.includes(needle)) ok++
  else bad.push(`${label}: в «${text}» нет «${needle}»`)
}
const boom = async (fn) => { try { await fn(); return '(без ошибки)' } catch (e) { return e.message } }
const quiet = async (fn) => {
  const realErr = console.error
  const realLog = console.log
  console.error = () => {}
  console.log = () => {}
  try { return await fn() } finally { console.error = realErr; console.log = realLog }
}

const here = new URL('./fixtures/poi-canary-osaka/', import.meta.url)
const readFixture = (name) => readFileSync(new URL(name, here), 'utf8')
const digest = (name) => createHash('sha256').update(readFixture(name)).digest('hex').slice(0, 16)

const ROWS = JSON.parse(readFixture('rows.json'))
const NAMES = JSON.parse(readFixture('names.json'))

/* Фикстура ПРИВЯЗАНА ОТПЕЧАТКАМИ: подмена корпуса меняет предмет приёмки. */
t('корпус — двадцать строк', ROWS.length, 20)
t('у всех есть японское имя', ROWS.every((r) => r.nameJa), true)
t('у всех полная пара координат',
  ROWS.every((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon)), true)
t('английского имени нет ни у одной', ROWS.some((r) => r.nameEn), false)
t('чтения каной нет ни у одной', ROWS.some((r) => r.nameKana), false)
t('отпечаток корпуса', digest('rows.json'), 'cc8b8850750defb4')
t('отпечаток файла имён', digest('names.json'), '9c97f5d406fcc3b3')

const key = (n) => `bodik-osaka-tourism:OSAKA${String(n).padStart(7, '0')}`
const KEYS = {
  alreadyIngested: key(47),
  ambiguous: key(133),
  foreignGeneric: key(138),
  foreignPrefecture: key(147),
  noPrefecture: key(186),
  nullBody: key(195),
}

/* ── ЗАМОРОЖЕННЫЕ ОТВЕТЫ GOOGLE ─────────────────────────────────────────
   Ключ — японское имя, которым идёт запрос. Ответ на неизвестное имя — пустая
   выдача: фикстура не должна молча «находить» то, чего в ней нет. */
const place = (id, name, lat, lon, prefecture = 'Osaka Prefecture') => ({
  id,
  displayName: { text: name },
  location: { latitude: lat, longitude: lon },
  businessStatus: 'OPERATIONAL',
  ...(prefecture ? { addressComponents: [{ types: ['administrative_area_level_1'], longText: prefecture }] } : {}),
})

const byName = new Map()
for (const row of ROWS) {
  byName.set(row.nameJa, { places: [place(`PID-${row.sourceKey.split(':')[1]}`, row.nameJa, row.lat, row.lon)] })
}
const nameOf = (k) => ROWS.find((r) => r.sourceKey === k).nameJa

/* Чужое родовое слово: спрашивали 大阪城公園, Google отдал 大阪城 — другой объект. */
byName.set(nameOf(KEYS.foreignGeneric), { places: [place('PID-CASTLE', '大阪城', 34.6873, 135.5259)] })
/* Двое прошедших: одно и то же имя у двух разных мест. */
byName.set(nameOf(KEYS.ambiguous), {
  places: [
    place('PID-KEEP-1', nameOf(KEYS.ambiguous), 34.6863, 135.5258),
    place('PID-KEEP-2', nameOf(KEYS.ambiguous), 34.6864, 135.5259),
  ],
})
/* Чужая префектура. У строки корпуса своя префектура (大阪府) известна, поэтому
   такого кандидата отвергает САМ резолвер собственным гейтом — до границы дело
   не доходит. Это не то же самое, что конфликт направления, и путать их нельзя. */
byName.set(nameOf(KEYS.foreignPrefecture), {
  places: [place('PID-KYOTO', nameOf(KEYS.foreignPrefecture), 35.0116, 135.7681, 'Kyoto Prefecture')],
})
/* Префектуры в ответе нет вовсе. */
byName.set(nameOf(KEYS.noPrefecture), {
  places: [place('PID-NOPREF', nameOf(KEYS.noPrefecture), 34.6853, 135.4942, null)],
})

let lookups = 0
const frozenGoogle = async (_url, init) => {
  lookups += 1
  const body = JSON.parse(init.body)
  if (body.textQuery === nameOf(KEYS.nullBody)) return { ok: true, json: async () => null }
  return { ok: true, json: async () => byName.get(body.textQuery) ?? { places: [] } }
}
const canaryResolver = (query) => resolvePlace(query, { apiKey: 'ключ-фикстуры', fetchImpl: frozenGoogle })

/* ── Портальный отчёт из настоящих строк ────────────────────────────────
   Классификация здесь проставлена фикстурой: она предмет вехи P04, а не P05.3,
   и подменять ею опознание места нельзя. */
const writable = ROWS.map((row) => ({
  ...row,
  entityKind: 'tourist_poi',
  poiPrimaryType: 'historic_site',
  classificationSource: 'rule',
}))
const report = { portals: [{ portalId: 'bodik-osaka-tourism', source: { url: 'https://example.jp/bodik' }, writable }] }

const dir = await mkdtemp(path.join(tmpdir(), 'canary-osaka-'))
const namesFile = path.join(dir, 'names.json')
await writeFile(namesFile, JSON.stringify(NAMES), 'utf8')

const snapshotRow = (over = {}) => ({
  poiId: 'POI-000700', recordId: 'rec-POI-000700', nameRu: 'Уже принятая запись', nameEn: null,
  siteCity: 'osaka', lat: 34.5, lon: 135.3, placeId: null, sourceKey: null, ...over,
})

const countedStore = (inner) => {
  const seen = { creates: 0 }
  const created = []
  return {
    seen,
    created,
    store: {
      async listExisting() { return inner.listExisting() },
      async findBySourceKey(k) { return inner.findBySourceKey(k) },
      async create(fields) { seen.creates += 1; created.push(fields); return inner.create(fields) },
    },
  }
}

/* ── ПРОГОН ─────────────────────────────────────────────────────────────── */
lookups = 0
const c = countedStore(createSnapshotStore([
  snapshotRow({ poiId: 'POI-000700', sourceKey: KEYS.alreadyIngested, nameRu: 'Уже принятая запись' }),
]))
const run = await quiet(() => writeRun(
  report,
  { names: namesFile, maxPlaceLookups: 20 },
  { placeResolver: canaryResolver, store: c.store, now: new Date('2026-09-02T00:00:00.000Z') },
))

const queue = new Map(run.placeUnresolvedQueue.map((r) => [r.sourceKey, r]))
const refusal = (k) => queue.get(k)?.refusal ?? '(нет в очереди)'

/* Уже принятая строка Google не оплачивает. */
t('уже принятая строка пропущена без обращения', run.placeBudget.skippedAlreadyIngested, 1)
t('и получила терминальный исход приёма', run.outcomes.already_ingested, 1)
t('и в очередь неопознанных не попала', queue.has(KEYS.alreadyIngested), false)

/* Обращений ровно столько, сколько НОВЫХ строк. */
t('обращений к Google = новых строк', run.placeBudget.performed, 19)
t('и счётчик совпадает с фактическими вызовами fetch', lookups, 19)
t('объявленный лимит виден', run.placeBudget.limit, 20)

/* Именованные исходы особых строк. */
t('чужое родовое слово не принимается за то же место', refusal(KEYS.foreignGeneric), 'notResolved')
t('двое прошедших дают ambiguous', refusal(KEYS.ambiguous), 'ambiguous')
t('чужую префектуру отвергает сам резолвер', refusal(KEYS.foreignPrefecture), 'notResolved')
t('отсутствие префектуры даёт siteCityUnverifiable', refusal(KEYS.noPrefecture), 'siteCityUnverifiable')
t('повреждённое тело даёт providerUnusable', refusal(KEYS.nullBody), 'providerUnusable')

/* Положительные: остальные пятнадцать доходят до записи. */
t('создано записей', run.outcomes.created, 14)
t('store.create вызван столько же раз', c.seen.creates, 14)
t('неопознанных ровно пять', run.placeUnresolved, 5)

/* ЗАКОН СОХРАНЕНИЯ по всем строкам входа. */
t('сумма терминальных исходов равна числу строк',
  run.attempted + run.unnamed + run.placeUnresolved, ROWS.length)
/* Сумма по ВСЕМ исходам приёма, а не по двум избранным. Пока в сумме стояли
   только `created` и `already_ingested`, строка, дошедшая до приёма и
   остановленная гейтом дублей, из арифметики выпадала — и ровно так живой
   canary 02.09.2026 напечатал «10 + 9» при двадцати строках на входе. */
t('сумма ВСЕХ исходов приёма равна attempted',
  Object.values(run.outcomes).reduce((a, b) => a + b, 0), run.attempted)
t('и в этом прогоне исходов ровно два вида', Object.keys(run.outcomes).sort().join(','),
  'already_ingested,created')

/* Поля созданной записи: японский путь доводит место до Intake. */
const sample = c.created.find((f) => f['POI Name (RU)'] === 'Храм Ситэннодзи')
has('Place ID доехал до полей записи', String(sample?.['Google Place ID']), 'PID-OSAKA0000148')
t('политика координат выведена машинно', sample?.['Coordinate Policy'], 'exactObjectPoint')
t('префектура из ответа провайдера', sample?.['Prefecture (EN)'], 'Osaka')
const shitennoji = ROWS.find((r) => r.sourceKey === key(148))
t('широта — точка резолвера', sample?.Latitude, shitennoji.lat)
t('долгота — точка резолвера', sample?.Longitude, shitennoji.lon)
t('направление сохранено', sample?.['Site City'], 'osaka')

/* ── КОНФЛИКТ НАПРАВЛЕНИЯ ────────────────────────────────────────────────
   Отдельный прогон: владелец переопределил направление строки в файле имён на
   `kyoto`, а место опознано в Осаке. Резолвер тут возразить не может — он ищет
   по префектуре из адреса источника; возражает граница, которой направление и
   принадлежит. */
{
  const overridden = path.join(dir, 'names-kyoto.json')
  const one = ROWS.find((r) => r.sourceKey === key(148))
  await writeFile(overridden, JSON.stringify({
    [one.sourceKey]: { nameRu: NAMES[one.sourceKey].nameRu, siteCity: 'kyoto' },
  }), 'utf8')
  const c3 = countedStore(createSnapshotStore([snapshotRow()]))
  const conflict = await quiet(() => writeRun(
    { portals: [{ portalId: 'bodik-osaka-tourism', source: { url: 'https://example.jp/bodik' },
      writable: writable.filter((r) => r.sourceKey === one.sourceKey) }] },
    { names: overridden, maxPlaceLookups: 1 },
    { placeResolver: canaryResolver, store: c3.store, now: new Date('2026-09-02T00:00:00.000Z') },
  ))
  t('направление против места даёт cityConflict',
    conflict.placeUnresolvedQueue[0]?.refusal, 'cityConflict')
  has('и отказ называет обе префектуры', conflict.placeUnresolvedQueue[0]?.message, 'Kyoto')
  t('и записи не появилось', c3.seen.creates, 0)
}

/* ── ПРОШЛА ГРАНИЦУ МЕСТА, ЗАПИСЬЮ НЕ СТАЛА ──────────────────────────────
   Строка 189 (ミライザ大阪城) и строка 47 (музей Кайёдо в ТОМ ЖЕ здании) стоят
   в девятнадцати метрах друг от друга, а русские имена у них непохожие. Место
   опознаётся у обеих, но гейт дублей вторую останавливает: «рядом уже есть».

   В основном прогоне выше строка 47 заведена в снимок как уже принятая, поэтому
   соседа у 189 там нет — и этот класс исхода основной прогон не покрывает.
   Живой прогон его нашёл. Здесь он закрыт отдельным прогоном и офлайн: приём
   обязан назвать такую строку своим исходом, а не потерять её между
   «создано» и «место не опознано». */
{
  const pair = writable.filter((r) => r.sourceKey === key(47) || r.sourceKey === key(189))
  t('пара соседей в корпусе есть', pair.length, 2)
  const c4 = countedStore(createSnapshotStore([snapshotRow()]))
  const near = await quiet(() => writeRun(
    { portals: [{ portalId: 'bodik-osaka-tourism', source: { url: 'https://example.jp/bodik' }, writable: pair }] },
    { names: namesFile, maxPlaceLookups: 2 },
    { placeResolver: canaryResolver, store: c4.store, now: new Date('2026-09-02T00:00:00.000Z') },
  ))
  t('место опознано у обеих', near.attempted, 2)
  t('но записью стала одна', near.outcomes.created, 1)
  t('вторую остановил приём именованным исходом', near.outcomes.needs_review, 1)
  t('и store.create вызван ровно один раз', c4.seen.creates, 1)
  t('неопознанных мест здесь нет', near.placeUnresolved, 0)
  has('отчёт называет остановленную строку и причину',
    near.notCreated[0] ?? '', 'Рядом уже есть')
  t('сумма ВСЕХ исходов равна attempted и здесь',
    Object.values(near.outcomes).reduce((a, b) => a + b, 0), near.attempted)
}

/* ── БЮДЖЕТ: превышение останавливает до первого обращения ─────────────── */
lookups = 0
const c2 = countedStore(createSnapshotStore([snapshotRow()]))
const stopped = await boom(() => quiet(() => writeRun(
  report,
  { names: namesFile, maxPlaceLookups: 5 },
  { placeResolver: canaryResolver, store: c2.store, now: new Date('2026-09-02T00:00:00.000Z') },
)))
has('бюджет 5 при двадцати новых строках останавливает прогон', stopped, 'Бюджет обращений к резолверу места превышен')
t('и до первого обращения к Google дело не дошло', lookups, 0)
t('и записей не появилось', c2.seen.creates, 0)

console.log(bad.length
  ? `✗ offline-приёмка Осаки: провалено ${bad.length} из ${ok + bad.length}:\n  ` + bad.join('\n  ')
  : `✓ offline-приёмка Осаки: ${ok} проверок пройдено (${run.placeBudget.performed} обращений, `
    + `${run.outcomes.created} записей, ${run.placeUnresolved} к разбору)`)
process.exitCode = bad.length ? 1 : 0
