#!/usr/bin/env node
/**
 * Контракт файла `--existing` и коды возврата настоящего процесса коллектора.
 *
 * Узел 1.6 графа: прежний разбор ловил любую ошибку, печатал её и возвращал
 * пустой массив. Недостоверный вход становился неотличим от корректного файла
 * без совпадений — счётчик ноль, процесс успешен, артефакт создан.
 * Воспроизведено через настоящий CLI на пяти входах.
 *
 * Узел 1.7 графа: у коллектора две ветки ненулевого исхода — перехваченная
 * ошибка `main()` и `monitorFailure`, который бросается уже ПОСЛЕ записи
 * отчёта. Код обеих был написан давно, исполняющего теста не имел ни одной.
 * Здесь обе проверяются НА НАСТОЯЩЕМ ПРОЦЕССЕ, а не на экспортированной
 * функции: код возврата — свойство процесса, и внутри него он не наблюдаем.
 *
 * Сеть не используется: `globalThis.fetch` подменяется `--import`-модулем.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadExistingBase, describeExistingBase, EXISTING_CONSUMED_KEYS, EXISTING_MATCHABLE_FIELDS, EXISTING_NAME_FIELDS } from '../scripts/poi-portals/lib/existing-file.mjs'
import { matchAgainstExisting } from '../scripts/poi-portals/lib/dedupe.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLI = path.join(ROOT, 'scripts/poi-portals/collect-pois.mjs')
let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok += 1
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const box = fs.mkdtempSync(path.join(os.tmpdir(), 'existing-file-'))
const P = (name) => path.join(box, name)
const write = (name, value) => {
  const file = P(name)
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
  return file
}
const boom = async (fn) => { try { await fn(); return 'без ошибки' } catch (e) { return e.message } }
const has = (label, message, needle) => t(label, message.includes(needle), true)

const GOOD = [
  { poiId: 'POI-000001', nameRu: 'Осакский замок', nameEn: 'Osaka Castle', nameJa: '大阪城',
    siteCity: 'osaka', lat: 34.6873, lon: 135.5259, sourceKey: 'bodik-osaka-tourism:1' },
]

try {
  // ── 1. Контракт файла: каждая ветка исполняется ─────────────────────────
  t('без аргумента файл не читается вовсе', (await loadExistingBase(null)).records.length, 0)
  t('и статистики нет', (await loadExistingBase(null)).stats, null)

  has('отсутствующий файл', await boom(() => loadExistingBase(P('нет.json'))), 'файл не прочитан')
  has('каталог вместо файла', await boom(() => loadExistingBase(box)), 'файл не прочитан')
  has('невалидный JSON', await boom(() => loadExistingBase(write('broken.json', '{сломано'))), 'не разбирается как JSON')
  has('объект без records', await boom(() => loadExistingBase(write('shape.json', { foo: 1 }))), 'ожидается массив записей')
  has('строка вместо массива', await boom(() => loadExistingBase(write('str.json', '"строка"'))), 'ожидается массив записей')
  has('null вместо массива', await boom(() => loadExistingBase(write('null.json', 'null'))), 'ожидается массив записей')
  has('пустой массив', await boom(() => loadExistingBase(write('empty.json', []))), 'список пуст')
  has('пустой records', await boom(() => loadExistingBase(write('empty2.json', { records: [] }))), 'список пуст')
  has('элемент не объект', await boom(() => loadExistingBase(write('prim.json', [1, 2]))), 'запись №1 не объект')
  has('элемент null', await boom(() => loadExistingBase(write('nulls.json', [null]))), 'запись №1 не объект')
  has('элемент массив', await boom(() => loadExistingBase(write('arrs.json', [[]]))), 'запись №1 не объект')
  // Пустая строка и строка из одних пробелов — разные отказы, и это не
  // придирка: первое «ключа нет», второе «ключ есть, но с пробелами».
  has('пустой sourceKey', await boom(() => loadExistingBase(write('sk0.json', [{ sourceKey: '', nameEn: 'X' }]))),
    'sourceKey задан, но пуст')
  has('sourceKey из одних пробелов', await boom(() => loadExistingBase(write('sk.json', [{ sourceKey: '  ', nameEn: 'X' }]))),
    'с краевыми пробелами')
  has('sourceKey не строка', await boom(() => loadExistingBase(write('sk2.json', [{ sourceKey: 7, nameEn: 'X' }]))),
    'сравнивается он как строка')
  has('дубль sourceKey', await boom(() => loadExistingBase(write('dup.json', [
    { sourceKey: 'a:1', nameEn: 'X' }, { sourceKey: 'a:1', nameEn: 'Y' },
  ]))), 'уже встречался в записи №1')
  has('координата не число', await boom(() => loadExistingBase(write('c1.json', [{ nameEn: 'X', lat: 'нет', lon: 1 }]))),
    'lat не конечное число')
  has('координата NaN', await boom(() => loadExistingBase(write('c2.json', [{ nameEn: 'X', lat: 1, lon: null }, { nameEn: 'Y' }]))),
    'одна координата из двух')
  has('половина пары', await boom(() => loadExistingBase(write('c3.json', [{ nameEn: 'X', lat: 34.1 }]))),
    'одна координата из двух')
  has('нечем совпасть', await boom(() => loadExistingBase(write('void.json', [{ poiId: 'POI-1', siteCity: 'osaka' }]))),
    'ни ключа источника, ни имени, ни пары координат')

  // Нормальный путь не изменился: те же формы принимаются, что и раньше.
  const okArray = await loadExistingBase(write('good.json', GOOD))
  t('корректный массив принимается', okArray.records.length, 1)
  t('и статистика посчитана', okArray.stats.withSourceKey, 1)
  t('имена посчитаны', okArray.stats.withName, 1)
  t('координаты посчитаны', okArray.stats.withCoords, 1)
  const okWrapped = await loadExistingBase(write('good2.json', { records: GOOD }))
  t('обёртка records принимается', okWrapped.records.length, 1)
  const okMinimal = await loadExistingBase(write('good3.json', [{ nameJa: '大阪城' }]))
  t('записи с одним лишь именем достаточно', okMinimal.records.length, 1)
  const okCoords = await loadExistingBase(write('good4.json', [{ lat: 34.1, lon: 135.1 }]))
  t('записи с одной лишь парой координат достаточно', okCoords.records.length, 1)
  const okExtra = await loadExistingBase(write('good5.json', [{ ...GOOD[0], recordId: 'rec1', placeId: 'PID', чужое: true }]))
  t('чужие поля выгрузки не запрещены', okExtra.records.length, 1)
  t('список полей, по которым запись может совпасть, закрыт', EXISTING_MATCHABLE_FIELDS.join(','),
    'sourceKey,nameJa,nameEn,nameRu')
  t('описание статистики называет файл', describeExistingBase(okArray.stats).includes('good.json'), true)
  t('без статистики описания нет', describeExistingBase(null), null)

  // ── 1б. Форма ключа — та же, в какой её читает матчер ──────────────────
  // Круг 10f-M R1: контракт смотрел на подрезанные копии, матчер читает сырые
  // значения, и между ними была щель. Воспроизведено композицией
  // loadExistingBase → matchAgainstExisting.
  t('список читаемых матчером ключей закрыт', Object.keys(EXISTING_CONSUMED_KEYS).join(','),
    'sourceKey,nameJa,nameEn,nameRu,lat,lon')
  has('краевые пробелы в sourceKey', await boom(() => loadExistingBase(write('sp.json', [
    { sourceKey: ' bodik:1 ', nameRu: 'X' },
  ]))), 'с краевыми пробелами')
  has('ведущий пробел в sourceKey', await boom(() => loadExistingBase(write('sp2.json', [
    { sourceKey: ' bodik:1', nameRu: 'X' },
  ]))), 'с краевыми пробелами')
  has('перевод строки в sourceKey', await boom(() => loadExistingBase(write('sp3.json', [
    { sourceKey: 'bodik:1' + String.fromCharCode(10), nameRu: 'X' },
  ]))), 'с краевыми пробелами')
  has('sourceKey массивом', await boom(() => loadExistingBase(write('ska.json', [
    { sourceKey: ['bodik:1'], nameRu: 'X' },
  ]))), 'сравнивается он как строка')
  for (const field of ['nameRu', 'nameEn', 'nameJa']) {
    has(`${field} массивом`, await boom(() => loadExistingBase(write(`n-${field}-a.json`, [
      { sourceKey: 'bodik:1', [field]: ['Tsutenkaku'] },
    ]))), 'даёт совпадение, которого нет')
    has(`${field} числом`, await boom(() => loadExistingBase(write(`n-${field}-n.json`, [
      { sourceKey: 'bodik:1', [field]: 42 },
    ]))), 'даёт совпадение, которого нет')
    has(`${field} логическим значением`, await boom(() => loadExistingBase(write(`n-${field}-b.json`, [
      { sourceKey: 'bodik:1', [field]: true },
    ]))), 'даёт совпадение, которого нет')
  }
  // Пустая строка в имени допустима: она ничему не соответствует и в счёт
  // «есть чем совпасть» не идёт. Пробелы в имени тоже допустимы — сравнение
  // имён их нормализует, и отвергать их значило бы придумывать правило.
  t('пустое имя при наличии ключа принимается',
    (await loadExistingBase(write('emptyname.json', [{ sourceKey: 'bodik:1', nameRu: '' }]))).records.length, 1)
  t('и в счёт имён не идёт',
    (await loadExistingBase(write('emptyname2.json', [{ sourceKey: 'bodik:1', nameRu: '' }]))).stats.withName, 0)
  t('имя с краевыми пробелами принимается: его сравнение нормализует',
    (await loadExistingBase(write('spacename.json', [{ nameRu: '  Осакский замок  ' }]))).records.length, 1)
  t('null в поле имени — это отсутствие поля, а не тип',
    (await loadExistingBase(write('nullname.json', [{ sourceKey: 'bodik:1', nameRu: null }]))).records.length, 1)

  // ── 1б-2. Имя пригодно ПОСЛЕ нормализации, а не по сырой длине ─────────
  // Круг 10f-M R2: пригодность считалась по value.length > 0, и строка из
  // пробелов проходила. Матчер нормализует имя, и от такой строки не остаётся
  // ничего: запись принималась, withName показывал единицу, а совпасть она не
  // могла ни с чем. Одного trim() мало — «—·—» он оставляет непустым.
  t('поля имён названы отдельно от ключа', EXISTING_NAME_FIELDS.join(','), 'nameJa,nameEn,nameRu')
  has('имя из одних пробелов без других признаков отвергается',
    await boom(() => loadExistingBase(write('ws.json', [{ nameEn: '   ' }]))),
    'ни ключа источника, ни имени, ни пары координат')
  has('имя из пунктуации без других признаков отвергается',
    await boom(() => loadExistingBase(write('punct.json', [{ nameRu: '—·—' }]))),
    'ни ключа источника, ни имени, ни пары координат')
  has('имя из одних дефисов без других признаков отвергается',
    await boom(() => loadExistingBase(write('dash.json', [{ nameJa: '- - -' }]))),
    'ни ключа источника, ни имени, ни пары координат')
  has('имя из скобок и кавычек без других признаков отвергается',
    await boom(() => loadExistingBase(write('brackets.json', [{ nameEn: '(( ))' }]))),
    'ни ключа источника, ни имени, ни пары координат')
  {
    // При ключе источника такое имя допустимо — но пригодным не считается.
    const withKey = await loadExistingBase(write('ws-key.json', [{ sourceKey: 'bodik:1', nameEn: '   ' }]))
    t('при ключе источника пустое после нормализации имя принимается', withKey.records.length, 1)
    t('и withName его не считает', withKey.stats.withName, 0)
    const withCoords = await loadExistingBase(write('ws-geo.json', [{ lat: 34.1, lon: 135.1, nameRu: '—·—' }]))
    t('при координатах — то же самое: запись принята', withCoords.records.length, 1)
    t('и withName его не считает', withCoords.stats.withName, 0)
    // Содержательное имя с краевыми пробелами остаётся пригодным.
    const spaced = await loadExistingBase(write('spaced.json', [{ nameRu: '  Осакский замок  ' }]))
    t('содержательное имя с краевыми пробелами принимается', spaced.records.length, 1)
    t('и считается в withName', spaced.stats.withName, 1)
  }

  // ── 1в. Композиционный контроль: контракт и матчер согласны ────────────
  // Проверяется не «принял ли контракт файл», а «нашёл ли матчер то, ради чего
  // файл давали». Без этого утверждения контракт мог бы стать сколь угодно
  // строгим и при этом пропускать записи, по которым совпадения не будет.
  {
    const candidate = { sourceKey: 'bodik-osaka-tourism:1', nameJa: '大阪城', nameEn: 'Osaka Castle',
      lat: 34.6873, lon: 135.5259 }
    const base = await loadExistingBase(write('compose.json', [
      { poiId: 'POI-000001', sourceKey: 'bodik-osaka-tourism:1', nameRu: 'Осакский замок',
        nameEn: 'Osaka Castle', nameJa: '大阪城', lat: 34.6873, lon: 135.5259 },
    ]))
    const m = matchAgainstExisting(candidate, base.records)
    t('композиция: принятая запись действительно совпадает', m.verdict, 'same')
    t('композиция: и совпадает по ключу источника', m.matches[0].reasons.includes('source_key'), true)

    // Тот же кандидат против записи с ДРУГИМ ключом и другим местом обязан
    // остаться новым: иначе утверждение выше проходило бы на чём угодно.
    const other = await loadExistingBase(write('compose2.json', [
      { poiId: 'POI-000002', sourceKey: 'bodik-osaka-tourism:777', nameRu: 'Совсем другое место',
        nameEn: 'Somewhere Else', lat: 43.06, lon: 141.35 },
    ]))
    t('композиция: непохожая запись остаётся новой', matchAgainstExisting(candidate, other.records).verdict, 'new')

    // Содержательное имя с краевыми пробелами обязано не просто пройти
    // контракт, а СОВПАСТЬ: иначе строгость предиката ничем не ограничена.
    const spacedBase = await loadExistingBase(write('compose-spaced.json', [
      { poiId: 'POI-000004', nameRu: '  Osaka Castle  ' },
    ]))
    const spacedMatch = matchAgainstExisting({ sourceKey: 'иной:1', nameEn: 'Osaka Castle', lat: null, lon: null },
      spacedBase.records)
    t('композиция: имя с краевыми пробелами совпадает после нормализации',
      spacedMatch.matches.length > 0 && spacedMatch.verdict !== 'new', true)
    t('композиция: и совпадает именно по имени',
      spacedMatch.matches[0]?.reasons.some((r) => r.startsWith('name_')), true)

    // И контрпример к самому исправлению: запись, которую контракт теперь
    // отвергает, при прежнем поведении дала бы verdict=new по ключу.
    const wouldPass = [{ poiId: 'POI-000003', sourceKey: ' bodik-osaka-tourism:1 ', nameRu: 'Другое имя' }]
    t('композиция: сырой ключ с пробелами матчером не находится',
      matchAgainstExisting(candidate, wouldPass).verdict, 'new')
    has('и контракт такой файл больше не принимает',
      await boom(() => loadExistingBase(write('compose3.json', wouldPass))), 'с краевыми пробелами')
  }

  // ── 2. Настоящий процесс: --existing ────────────────────────────────────
  const CSV = "ID,名称,名称_英語,説明,説明_英語,所在地_都道府県,所在地_市区町村,所在地_連結表記,緯度,経度,URL,利用可能曜日,開始時間,終了時間,連絡先電話番号,アクセス方法\n\"1\",\"大阪城\",\"Osaka Castle\",\"大阪を代表する歴史的建造物であり、天守閣の内部は博物館として公開されています。豊臣秀吉によって築かれた城の歴史や、大坂の陣に関する資料が数多く展示されており、最上階の展望台からは大阪市街を一望することができます。周囲は公園として整備されています。\",\"A landmark historic castle in the centre of Osaka whose main keep houses a museum devoted to the history of the fortress and the sieges it endured. The top floor observation deck offers a wide view over the modern city, and the surrounding grounds form a large public park with seasonal blossom.\",\"大阪府\",\"大阪市\",\"大阪府大阪市中央区大阪城1-1\",\"34.6873\",\"135.5259\",\"https://example.invalid/1\",\"月曜日\",\"09:00\",\"17:00\",\"06-6941-3044\",\"地下鉄谷町四丁目駅から徒歩15分\"\n\"2\",\"通天閣\",\"Tsutenkaku\",\"大阪を代表する歴史的建造物であり、天守閣の内部は博物館として公開されています。豊臣秀吉によって築かれた城の歴史や、大坂の陣に関する資料が数多く展示されており、最上階の展望台からは大阪市街を一望することができます。周囲は公園として整備されています。\",\"A landmark historic castle in the centre of Osaka whose main keep houses a museum devoted to the history of the fortress and the sieges it endured. The top floor observation deck offers a wide view over the modern city, and the surrounding grounds form a large public park with seasonal blossom.\",\"大阪府\",\"大阪市\",\"大阪府大阪市浪速区恵美須東1-18-6\",\"34.6525\",\"135.5063\",\"https://example.invalid/2\",\"毎日\",\"10:00\",\"20:00\",\"06-6641-9555\",\"地下鉄恵美須町駅から徒歩3分\""
  const CAT = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Japan Guide</title></head><body><header class=\"dest_top__section_header\"><h1 class=\"dest_top__section_title\">Destinations</h1></header><div class=\"dest_top_destinations__regions\"><div class=\"dest_top_destinations__region\"><div class=\"dest_top_destinations__region_text\"><div class=\"dest_top_destinations__region_dests\"><a href=\"/destinations/kansai/\">Kansai</a></div></div></div></div></body></html>"
  const DEST = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Kansai</title></head><body><div class=\"page_title\"><h1 class=\"page_title__title\">Kansai</h1></div><p>no spot list here</p></body></html>"
  // Заглушка портала отмечает КАЖДЫЙ обмен: по её следу видно, дошло ли дело
  // до сети. Отсутствие следа — и есть «побочных действий не было».
  const MARK = P('обмены.log')
  const csvStub = write('stub-csv.mjs', `
import { appendFileSync } from 'node:fs'
const CSV = ${JSON.stringify(CSV)}
globalThis.fetch = async (u) => {
  appendFileSync(${JSON.stringify(MARK)}, String(u) + String.fromCharCode(10))
  const url = String(u)
  if (url.includes('package_show')) return { ok: true, status: 200, json: async () => ({ success: true, result: {
    license_id: 'cc-by', metadata_modified: '2026-03-30T00:00:00',
    resources: [{ format: 'CSV', url: 'https://example.invalid/data.csv', last_modified: '2026-03-30T00:00:00' }] } }) }
  if (url.includes('data.csv')) return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(CSV).buffer }
  throw new Error('в этом прогоне сеть не предусмотрена: ' + url)
}
`)
  // spawnSync, а не execFileSync: последний отдаёт stderr только при падении,
  // и утверждение об успешном прогоне проверять было бы нечем.
  const run = (args, stub) => {
    const full = ['--import', new URL(`file://${stub}`).href, CLI, ...args]
    const r = spawnSync(process.execPath, full, { cwd: ROOT, encoding: 'utf8' })
    return { rc: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' }
  }

  const goodFile = P('good.json')
  const control = run(['--portal', 'bodik-osaka-tourism', '--limit', '2', '--existing', goodFile,
    '--out', P('report-control.json')], csvStub)
  t('контроль: корректный файл — процесс успешен', control.rc, 0)
  if (control.rc !== 0) bad.push(`контроль не зелёный: ${control.err.slice(0, 300)}`)
  const controlReport = fs.existsSync(P('report-control.json'))
    ? JSON.parse(fs.readFileSync(P('report-control.json'), 'utf8')) : { portals: [{ totals: {} }] }
  t('контроль: сверка с базой состоялась', controlReport.portals[0].totals.matchedExistingBase, 1)
  t('контроль: статистика файла названа в stderr', control.err.includes('существующие POI'), true)

  const BADS = [
    ['каталог', box, 'файл не прочитан'],
    ['отсутствующий', P('нет-такого.json'), 'файл не прочитан'],
    ['невалидный JSON', P('broken.json'), 'не разбирается как JSON'],
    ['форма', P('shape.json'), 'ожидается массив записей'],
    ['элемент не объект', P('prim.json'), 'запись №1 не объект'],
    ['пустой список', P('empty.json'), 'список пуст'],
  ]
  for (const [label, file, needle] of BADS) {
    if (fs.existsSync(MARK)) fs.rmSync(MARK)
    const out = P(`report-${label.replace(/\W+/g, '-')}.json`)
    const r = run(['--portal', 'bodik-osaka-tourism', '--limit', '2', '--existing', file, '--out', out], csvStub)
    t(`процесс: «${label}» даёт ненулевой код`, r.rc, 1)
    t(`процесс: «${label}» называет причину`, r.err.includes(needle), true)
    t(`процесс: «${label}» не создаёт артефакт`, fs.existsSync(out), false)
    t(`процесс: «${label}» не идёт в сеть`, fs.existsSync(MARK), false)
  }

  // ── 3. Узел 1.7, ветка первая: перехваченная ошибка main() ──────────────
  if (fs.existsSync(MARK)) fs.rmSync(MARK)
  const caught = P('report-caught.json')
  const errRun = run(['--portal', 'japan-guide', '--monitor', P('нет.json'), '--limit', '5', '--out', caught], csvStub)
  t('1.7а: перехваченная ошибка main() даёт ненулевой код процесса', errRun.rc, 1)
  t('1.7а: и называет причину', errRun.err.includes('--monitor несовместим с --limit'), true)
  t('1.7а: артефакт не создан', fs.existsSync(caught), false)
  t('1.7а: сети не было', fs.existsSync(MARK), false)

  // ── 4. Узел 1.7, ветка вторая: monitorFailure ───────────────────────────
  // Discovery-портал доходит до конца, а снимок для сравнения нечитаем.
  // Отчёт при этом ОБЯЗАН быть записан: снимок прогона нужен человеку
  // независимо от того, удалось ли сравнение, — и именно поэтому исход
  // процесса здесь единственный способ узнать, что сравнение не состоялось.
  const discoveryStub = write('stub-discovery.mjs', `
import { appendFileSync } from 'node:fs'
const ROBOTS = ['User-agent: *', 'Allow: /', ''].join(String.fromCharCode(10))
const CAT = ${JSON.stringify(CAT)}
const DEST = ${JSON.stringify(DEST)}
const streamOf = (text) => {
  const bytes = new TextEncoder().encode(text)
  let done = false
  return { getReader: () => ({ read: async () => (done ? { done: true, value: undefined } : (done = true, { done: false, value: bytes })), releaseLock() {}, cancel: async () => {} }) }
}
globalThis.fetch = async (u) => {
  appendFileSync(${JSON.stringify(MARK)}, String(u) + String.fromCharCode(10))
  const url = String(u)
  const isRobots = url.includes('robots.txt')
  const body = isRobots ? ROBOTS : (url.includes('/destinations/') ? DEST : CAT)
  return {
    ok: true, status: 200, url, redirected: false, type: 'basic',
    headers: { get: (k) => { const n = String(k).toLowerCase()
      if (n === 'content-type') return isRobots ? 'text/plain; charset=utf-8' : 'text/html; charset=shift-jis'
      if (n === 'content-length') return String(new TextEncoder().encode(body).length)
      return null } },
    body: streamOf(body),
    text: async () => body,
  }
}
`)
  if (fs.existsSync(MARK)) fs.rmSync(MARK)
  const monitored = P('report-monitor.json')
  const mon = run(['--portal', 'japan-guide', '--out', monitored, '--monitor', P('снимка-нет.json')], discoveryStub)
  t('1.7б: monitorFailure даёт ненулевой код процесса', mon.rc, 1)
  if (!mon.err.includes('--monitor: снимок')) bad.push(`1.7б диагностика: ${(mon.err || mon.out).slice(0, 400)}`)
  t('1.7б: и называет отказ сравнения', mon.err.includes('--monitor: снимок'), true)
  t('1.7б: отчёт всё же записан — он нужен человеку', fs.existsSync(monitored), true)
  const monReport = fs.existsSync(monitored) ? JSON.parse(fs.readFileSync(monitored, 'utf8')) : {}
  t('1.7б: отказ сравнения виден и в отчёте', Boolean(monReport.monitor?.error), true)
  t('1.7б: портал дошёл до конца', monReport.portals?.[0]?.mode, 'discovery')

  // Контрпример, различающий ветку: тот же прогон с ЧИТАЕМЫМ снимком
  // завершается нулём. Без него утверждение выше проходило бы и на прогоне,
  // который падает по любой другой причине.
  const snapshot = write('снимок.json', monReport)
  const monOk = run(['--portal', 'japan-guide', '--out', P('report-monitor-ok.json'), '--monitor', snapshot], discoveryStub)
  t('1.7б: с читаемым снимком тот же прогон успешен', monOk.rc, 0)
} finally {
  fs.rmSync(box, { recursive: true, force: true })
}

if (bad.length) {
  console.error(`✗ файл существующих POI: ${bad.length} из ${ok + bad.length}`)
  for (const b of bad) console.error(`  ${b}`)
  process.exit(1)
}
console.log(`✓ файл существующих POI: ${ok} проверок пройдено`)
