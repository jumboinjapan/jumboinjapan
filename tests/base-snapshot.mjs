/**
 * Контракт снимка базы для --base-snapshot и хранилище поверх него.
 *
 * Зачем. Режим заводился, чтобы прогнать весь путь записи против настоящей
 * базы без права её испортить. Он этого не делал: снимок принимался как
 * любой JSON, а findBySourceKey отвечал «не найдено» всегда — ветка
 * идемпотентности в ingestPoi не исполнялась ни в одном прогоне, и прогон
 * объявлял новыми записи, которые в базе уже есть.
 *
 * Каждая проверка ниже ИСПОЛНЯЕТ ветку, а не ищет текст в исходнике.
 */
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { assertSnapshotRows, createSnapshotStore, loadBaseSnapshot, SNAPSHOT_ROW_FIELDS } from '../scripts/poi-portals/lib/base-snapshot.mjs'
import { main, writeRun } from '../scripts/poi-portals/collect-pois.mjs'
import { ingestPoi, ingestPoiBatch } from '../src/lib/poi-ingest.ts'

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

const dir = await mkdtemp(path.join(tmpdir(), 'snapshot-'))
let n = 0
const withFile = async (body) => {
  const file = path.join(dir, `s${n++}.json`)
  await writeFile(file, typeof body === 'string' ? body : JSON.stringify(body), 'utf8')
  return file
}
const boom = async (fn) => { try { await fn(); return '(без ошибки)' } catch (e) { return e.message } }

/** Полностью объявленная строка снимка. recordId уникален по умолчанию. */
const row = (over = {}) => {
  const merged = {
    poiId: 'POI-000024', recordId: null, nameRu: 'Храм Токэйдзи', nameEn: 'Tokeiji Temple',
    siteCity: 'kamakura', lat: 35.336, lon: 139.543, placeId: null, sourceKey: null, ...over,
  }
  return { ...merged, recordId: 'recordId' in over ? over.recordId : `rec-${merged.poiId}` }
}

// ── 1. Контракт файла ─────────────────────────────────────────────────────
has('нет файла', await boom(() => loadBaseSnapshot(path.join(dir, 'нет.json'))), 'файл не прочитан')
has('пустой путь', await boom(() => loadBaseSnapshot('')), 'путь к файлу не задан')
has('не JSON', await boom(async () => loadBaseSnapshot(await withFile('{не json'))), 'не разбирается как JSON')
has('не массив', await boom(async () => loadBaseSnapshot(await withFile({ records: [] }))), 'ожидается массив')
has('пустой массив', await boom(async () => loadBaseSnapshot(await withFile([]))), 'снимок пуст')
has('строка не объект', await boom(async () => loadBaseSnapshot(await withFile(['x']))), 'не объект')

// Ровно тот файл, который уже уезжал в прогон: список POI старой формы.
has(
  'старая форма {id, ru, en}',
  await boom(async () => loadBaseSnapshot(await withFile([{ id: 'POI-000024', ru: 'Храм', en: 'Temple' }]))),
  'неизвестные поля',
)
const missing = { ...row() }
delete missing.sourceKey
delete missing.placeId
has('поля не объявлены', await boom(async () => loadBaseSnapshot(await withFile([missing]))), 'не объявлены поля «placeId», «sourceKey»')
has('лишнее поле', await boom(async () => loadBaseSnapshot(await withFile([{ ...row(), extra: 1 }]))), 'неизвестные поля «extra»')
has('пустой poiId', await boom(async () => loadBaseSnapshot(await withFile([row({ poiId: '' })]))), 'не формы POI-000000')
has('lat строкой', await boom(async () => loadBaseSnapshot(await withFile([row({ lat: '35.3' })]))), 'lat не число')
has('половина координаты', await boom(async () => loadBaseSnapshot(await withFile([row({ lon: null })]))), 'наполовину')
has(
  'повтор poiId',
  await boom(async () => loadBaseSnapshot(await withFile([row(), row({ nameRu: 'Другой' })]))),
  'повторяется',
)
has(
  'повтор sourceKey',
  await boom(async () => loadBaseSnapshot(await withFile([
    row({ sourceKey: 'test:X1' }), row({ poiId: 'POI-000025', sourceKey: 'test:X1' }),
  ]))),
  'sourceKey «test:X1» повторяется',
)

{
  const file = await withFile([row({ sourceKey: 'test:X1' }), row({ poiId: 'POI-000025', nameRu: 'Храм Энкакудзи', sourceKey: null, lat: null, lon: null })])
  const { rows, stats } = await loadBaseSnapshot(file)
  t('валидный снимок читается', rows.length, 2)
  t('счётчик ключей источника', stats.withSourceKey, 1)
  t('счётчик координат', stats.withCoords, 1)
  t('состав полей объявлен одним списком', SNAPSHOT_ROW_FIELDS.length, 9)
}

// ── 2. Хранилище: поиск по ключу ──────────────────────────────────────────
{
  const store = createSnapshotStore([row({ sourceKey: 'test:X1' })])
  t('ключ найден', (await store.findBySourceKey('test:X1'))?.poiId, 'POI-000024')
  t('чужой ключ не найден', await store.findBySourceKey('test:X2'), null)
  t('пустой ключ не совпадает', await store.findBySourceKey(''), null)
  t('пробельный ключ не совпадает', await store.findBySourceKey('   '), null)
  t('null не совпадает', await store.findBySourceKey(null), null)
  t('снимок отдаётся копией', (await store.listExisting()) === (await store.listExisting()), false)
}

{
  // Строки БЕЗ ключа источника не попадают в индекс. Иначе кандидат, у
  // которого ключа нет, поймал бы первую попавшуюся запись без ключа и
  // прогон объявил бы её «уже принятой».
  const store = createSnapshotStore([
    row({ sourceKey: null }),
    row({ poiId: 'POI-000025', nameRu: 'Другой', sourceKey: null }),
  ])
  t('null-ключ не индексируется', await store.findBySourceKey(null), null)
  t('пустая строка не индексируется', await store.findBySourceKey(''), null)
  t('пробелы не индексируются', await store.findBySourceKey('   '), null)
}

// ── 3. Поведение приёма против снимка ─────────────────────────────────────
const counted = (store) => {
  let creates = 0
  return {
    calls: () => creates,
    store: {
      listExisting: store.listExisting,
      findBySourceKey: store.findBySourceKey,
      async create(fields) { creates += 1; return store.create(fields) },
    },
  }
}
/**
 * Точка приходит ОТ РЕЗОЛВЕРА и записывается ровно та же: только так политика
 * координат выводится машинно. Круг R5: поля «решение человека» на машинной
 * границе больше нет, и массовая подстановка notApplicable убрана — она
 * объявляла машину человеком.
 *
 * По умолчанию точка выводится из имени: одинаковые имена дают одинаковую
 * точку, разные разнесены на километры. Где фикстура обязана совпасть с точкой
 * записи в пуле — точка передаётся явно, иначе расстояние опровергнет дубль,
 * который тест и проверяет.
 */
const pt = (nameRu, over = {}) => {
  let h = 0
  for (const ch of String(nameRu)) h = (h * 31 + ch.codePointAt(0)) % 997
  const lat = typeof over.lat === 'number' ? over.lat : Number((34 + h * 0.004).toFixed(7))
  const lon = typeof over.lon === 'number' ? over.lon : Number((133 + h * 0.004).toFixed(7))
  return { lat, lon, resolved: { placeId: `PID-${nameRu}`, lat, lon } }
}

// Фикстуры этого файла проверяют контракт снимка и идемпотентность, а не
// политику координат, поэтому несут подтверждённую точку резолвера. Ветка
// «портальный путь без резолвера останавливается» проверяется отдельно,
// в разделе 7, и там точки намеренно нет.
const req = (nameRu, city, extra = {}, at = {}) => ({
  source: { kind: 'portal-collector', id: 'test', ...extra },
  poi: { nameRu, siteCity: city, descriptionRu: 'Описание объекта.', descriptionEn: 'Object description.', categoriesRu: ['Буддийский храм'], ...pt(nameRu, at) },
})

{
  const c = counted(createSnapshotStore([row({ sourceKey: 'test:X1' })]))
  const r = await ingestPoi(req('Храм Токэйдзи', 'kamakura', { externalKey: 'X1' }), c.store)
  t('ключ из снимка → already_ingested', r.outcome, 'already_ingested')
  t('и найденная запись названа', r.poiId, 'POI-000024')
  t('create при этом не вызывался', c.calls(), 0)
}

{
  const c = counted(createSnapshotStore([row({ poiId: 'POI-000100', nameRu: 'Совсем другое', sourceKey: null, lat: null, lon: null })]))
  const results = await ingestPoiBatch([
    req('Храм Гокуракудзи', 'kamakura', { externalKey: 'Y7' }),
    req('Храм Гокуракудзи', 'kamakura', { externalKey: 'Y7' }),
  ], c.store)
  t('первая строка пакета создаётся', results[0].outcome, 'created')
  t('вторая с тем же ключом — already_ingested', results[1].outcome, 'already_ingested')
  t('и указывает на первую', results[1].poiId, results[0].poiId)
  t('create вызван ровно один раз', c.calls(), 1)
}

{
  // Гейт дублей по именам и координатам не должен пострадать от появления
  // поиска по ключу: у кандидата ключа нет вовсе.
  const c = counted(createSnapshotStore([row()]))
  const r = await ingestPoi(req('Храм Токэйдзи', 'kamakura', {}, { lat: 35.336, lon: 139.543 }), c.store)
  t('дубль по имени и городу ловится', r.outcome, 'blocked_duplicate')
  t('create не вызывался', c.calls(), 0)
}

{
  // Пустой ключ в снимке не превращается в совпадение.
  const c = counted(createSnapshotStore([row({ poiId: 'POI-000200', nameRu: 'Ничего общего', sourceKey: null, lat: null, lon: null })]))
  const noKey = await ingestPoi(req('Храм Дзётикудзи', 'kamakura'), c.store)
  t('кандидат без ключа не ловится на пустой ключ', noKey.outcome, 'created')
  const withKey = await ingestPoi(req('Храм Хоккайдзи', 'kamakura', { externalKey: 'Z9' }), c.store)
  t('кандидат с новым ключом создаётся', withKey.outcome, 'created')
}

// ── 4. Порядок: снимок проверяется до адаптера ────────────────────────────
{
  const good = await withFile([row({ sourceKey: 'test:X1' })])
  const badFile = await withFile('{сломано')
  const probe = { calls: 0 }
  const adapters = {
    'opendata-csv': async () => { probe.calls += 1; throw new Error('АДАПТЕР ВЫЗВАН') },
  }
  const argv = (file) => ['node', 'collect-pois.mjs', '--portal', 'bodik-osaka-tourism', '--base-snapshot', file]

  const message = await boom(() => main(argv(badFile), { adapters }))
  has('плохой снимок роняет прогон', message, 'не разбирается как JSON')
  t('адаптер портала не вызывался', probe.calls, 0)

  // Обратная сторона: с годным снимком до адаптера дело доходит — иначе
  // предыдущая проверка была бы зелёной по любой причине.
  const log = console.log
  const err = console.error
  console.log = () => {}
  console.error = () => {}
  try { await main(argv(good), { adapters }) } finally { console.log = log; console.error = err }
  t('с годным снимком адаптер вызывается', probe.calls, 1)
}

// ── 5. Бессодержательный снимок не принимается ────────────────────────────
/* Контрпримеры владельца 12.08: контракт принимал строки, формально
   правильные и бессмысленные по сути. Такой снимок хуже отсутствующего —
   он выглядит проверенным. */
has('poiId не формы POI-000000', await boom(async () => loadBaseSnapshot(await withFile([row({ poiId: 'x' })]))), 'не формы POI-000000')
has('координаты вне диапазона', await boom(async () => loadBaseSnapshot(await withFile([row({ lat: 999, lon: 999 })]))), 'вне допустимого диапазона')
has('пустой nameRu', await boom(async () => loadBaseSnapshot(await withFile([row({ nameRu: '' })]))), 'nameRu пуст')
has('пробельный nameRu', await boom(async () => loadBaseSnapshot(await withFile([row({ nameRu: '   ' })]))), 'nameRu пуст')
for (const field of ['sourceKey', 'placeId', 'recordId', 'siteCity', 'nameEn']) {
  has(
    `пробельный ${field}`,
    await boom(async () => loadBaseSnapshot(await withFile([row({ [field]: '   ' })]))),
    `${field} — пустая или пробельная строка`,
  )
}
// Ноль живое хранилище считает отсутствием координаты; снимок обязан
// говорить это тем же способом, иначе withCoords врёт.
has('нулевые координаты', await boom(async () => loadBaseSnapshot(await withFile([row({ lat: 0, lon: 0 })]))), 'равен нулю')
has(
  'повтор recordId',
  await boom(async () => loadBaseSnapshot(await withFile([
    row(), row({ poiId: 'POI-000025', nameRu: 'Другой', recordId: 'rec-POI-000024' }),
  ]))),
  'recordId «rec-POI-000024» повторяется',
)

// ── 6. Валидатор не обходится ─────────────────────────────────────────────
/* Контрпример владельца: строки передавались хранилищу и прогону мимо файла,
   и никто их не проверял. Валидатор теперь один, и через него проходит всё. */
has('store не принимает непроверенные строки', await boom(async () => createSnapshotStore([{ poiId: 'NOT-CANONICAL' }])), 'не формы POI-000000')
has('store не принимает не массив', await boom(async () => createSnapshotStore({ rows: [] })), 'ожидается массив')
has('assertSnapshotRows публичен', await boom(async () => assertSnapshotRows([{ poiId: 'x' }], 'проба')), 'проба:')

{
  /* writeRun больше не берёт готовые строки из args: снимок читается из
     файла и проверяется. Доказывается поведением — прогон идёт по ФАЙЛУ
     (ключ из файла даёт already_ingested), а не по подсунутым строкам. */
  const routed = (r) => ({ entityKind: 'tourist_poi', poiPrimaryType: 'historic_site', classificationSource: 'rule', ...r })
  const report = {
    portals: [{
      portalId: 'bodik-osaka-tourism',
      source: { url: 'https://x' },
      writable: [routed({ sourceKey: 'bodik-osaka-tourism:1', nameJa: '大阪城', nameKana: null, nameEn: 'Osaka Castle', siteCity: 'osaka', prefectureJa: '大阪府', lat: 34.687, lon: 135.526 })],
    }],
  }
  const names = await withFile({ 'bodik-osaka-tourism:1': { nameRu: 'Осакский замок' } })
  const good = await withFile([row({ poiId: 'POI-000300', nameRu: 'Осакский замок', siteCity: 'osaka', sourceKey: 'bodik-osaka-tourism:1' })])

  /* Резолвер места называет ВЫЗЫВАЮЩИЙ, и здесь он подставной: портальный путь
     теперь проходит ту же границу `resolvePlace`, что и Telegram, а умолчания
     из окружения у writeRun нет — оно означало бы платный запрос из тестового
     прогона. Опознанное место этому разделу нужно лишь затем, чтобы кандидат
     дошёл до ingestPoiBatch: предмет проверки — снимок, а не место. */
  const osakaCastle = async () => ({
    place: {
      placeId: 'PID-OSAKA-CASTLE',
      lat: 34.687,
      lon: 135.526,
      businessStatus: 'OPERATIONAL',
      prefecture: { en: 'Osaka', ru: 'Осака', ja: '大阪府' },
      matchedName: 'Osaka Castle',
    },
    reason: 'Опознано как «Osaka Castle»',
  })
  const deps = { placeResolver: osakaCastle, now: new Date('2026-09-02T00:00:00.000Z') }

  const result = await writeRun(report, { names, baseSnapshot: good, baseSnapshotRows: [{ poiId: 'NOT-CANONICAL' }] }, deps)
  t('подсунутые строки не используются', result.outcomes.already_ingested, 1)
  t('и ничего не создаётся', result.outcomes.created, undefined)
  t('счётчики снимка — из файла', result.baseSnapshot.total, 1)

  const badFile = await withFile([{ poiId: 'NOT-CANONICAL' }])
  has(
    'испорченный файл роняет writeRun до ingestPoiBatch',
    await boom(() => writeRun(report, { names, baseSnapshot: badFile, baseSnapshotRows: [row()] }, deps)),
    'не формы POI-000000',
  )
}

// ── 7. place_id: ось наполняется, гейт по ней работает ────────────────────
{
  /* Контрпример владельца: одинаковый place_id у снимка и кандидата давал
     created. Гейт в poi-ingest сравнивает request.poi.resolved.placeId со
     снимком — и работает. Вторая половина («коллектор resolved не наполняет»)
     закрыта пакетом 10f-N: портальный путь проходит канонический resolvePlace,
     и его композиция проверяется в tests/poi-portal-place.mjs. Здесь остаётся
     сторона приёма: что делает ingestPoi, когда место есть и когда его нет. */
  const snap = [row({ poiId: 'POI-000400', nameRu: 'Совсем другое имя', siteCity: 'nara', placeId: 'PID-SAME', lat: null, lon: null })]

  const withResolved = await ingestPoi({
    source: { kind: 'portal-collector', id: 'test', externalKey: 'P1' },
    poi: { nameRu: 'Никак не похожее', siteCity: 'nara', descriptionRu: 'Описание объекта.', descriptionEn: 'Object description.', categoriesRu: ['Буддийский храм'], lat: pt('Никак не похожее').lat, lon: pt('Никак не похожее').lon, resolved: { placeId: 'PID-SAME', lat: pt('Никак не похожее').lat, lon: pt('Никак не похожее').lon } },
  }, createSnapshotStore(snap))
  t('place_id из снимка ловит дубль, когда он передан', withResolved.outcome, 'blocked_duplicate')
  t('и называет запись снимка', withResolved.poiId, 'POI-000400')

  /* Портальный путь без резолвера ОСТАНАВЛИВАЕТСЯ. Прежде эта же строка
     ждала created: ось place_id молчала, и запись всё равно заводилась —
     без политики координат, пополняя долг. Теперь молчание оси означает
     остановку, а не тихое создание. */
  const c7 = counted(createSnapshotStore(snap))
  const withoutResolved = await ingestPoi({
    source: { kind: 'portal-collector', id: 'test', externalKey: 'P2' },
    poi: { nameRu: 'Никак не похожее', siteCity: 'nara', descriptionRu: 'Описание объекта.', descriptionEn: 'Object description.', categoriesRu: ['Буддийский храм'] },
  }, c7.store)
  t('без резолвера портальный путь останавливается', withoutResolved.outcome, 'needs_review')
  t('и называет причину структурно', withoutResolved.coordinatePolicy.refusal, 'noCoordinates')
  t('поля не собраны', withoutResolved.fields, null)
  t('store.create не вызывался ни разу', c7.calls(), 0)

  /* force не открывает эту дверь: он подтверждает не-дубль, а не
     происхождение координаты. */
  const c7f = counted(createSnapshotStore(snap))
  const forced = await ingestPoi({
    source: { kind: 'portal-collector', id: 'test', externalKey: 'P3' },
    poi: { nameRu: 'Никак не похожее', siteCity: 'nara', descriptionRu: 'Описание объекта.', descriptionEn: 'Object description.', categoriesRu: ['Буддийский храм'] },
  }, c7f.store, { force: true })
  t('force не обходит инвариант политики', forced.outcome, 'needs_review')
  t('и записей по force тоже нет', c7f.calls(), 0)

  /* Полная пара от доверенного резолвера — и только она — даёт точку. */
  const c7ok = counted(createSnapshotStore([row({ poiId: 'POI-000900', nameRu: 'Ничего похожего', siteCity: 'tokyo', sourceKey: null, lat: null, lon: null })]))
  const trusted = await ingestPoi({
    source: { kind: 'portal-collector', id: 'test', externalKey: 'P4' },
    poi: {
      nameRu: 'Опознанное место', siteCity: 'nara', descriptionRu: 'Описание объекта.', descriptionEn: 'Object description.',
      categoriesRu: ['Буддийский храм'], lat: 34.6851, lon: 135.8048,
      resolved: { placeId: 'PID-TRUSTED', lat: 34.6851, lon: 135.8048 },
    },
  }, c7ok.store)
  t('точка резолвера даёт exactObjectPoint', trusted.fields['Coordinate Policy'], 'exactObjectPoint')
  t('и запись создана', trusted.outcome, 'created')
}

if (bad.length) {
  console.error(`✗ снимок базы: ${bad.length} из ${ok + bad.length}`)
  for (const b of bad) console.error(`  ${b}`)
  process.exit(1)
}
console.log(`✓ снимок базы: ${ok} проверок пройдено`)
