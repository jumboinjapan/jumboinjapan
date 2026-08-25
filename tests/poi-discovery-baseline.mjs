/**
 * BASELINE ЖИВОГО ОБХОДА И МОНИТОРИНГ `v3` → `v3`.
 *
 * ЭТОТ НАБОР НЕ ПРОПУСКАЕТ НИЧЕГО И НИКОГДА. Артефакт лежит В РЕПОЗИТОРИИ, в
 * сжатом виде, поэтому свежий клон проверяет живой baseline полностью — а не
 * сообщает, что файла нет. Прежняя редакция ссылалась на `tmp/`, и в чистом
 * клоне «зелено» означало «сверка не выполнялась».
 *
 * Проверяется три слоя, и порядок неслучаен:
 *   1. контейнер: канонические байты шапки, потолок распаковки, круговой ход;
 *   2. манифест: точная форма, отсутствие и лишнее — по полному пути;
 *   3. живой снимок: сверка с манифестом и мониторинг `v3` → `v3` на нём.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import {
  CATALOGUE_SOURCE_KEY,
  buildDiscoveryRecord,
  buildDiscoverySnapshot,
  buildOrderRecord,
  buildPageEvidence,
  orderItem,
} from '../scripts/poi-portals/lib/discovery-contract.mjs'
import {
  BASELINE_DIR,
  BASELINE_SNAPSHOT_SPEC,
  DISCOVERY_BASELINE_SPEC,
  artefactDifferences,
  MAX_BASELINE_BYTES,
  assertDiscoveryBaseline,
  baselineDigest,
  canonicalGzip,
  composedExchangeBound,
  describeDiscoveryBaseline,
  readCanonicalGzip,
  selectPortalSnapshot,
} from '../scripts/poi-portals/lib/discovery-baseline.mjs'
import {
  loadBaselineArtefact,
  verifyDiscoveryBaseline,
} from '../scripts/poi-portals/verify-discovery-baseline.mjs'
import { diffDiscoverySnapshot } from '../scripts/poi-portals/lib/japan-guide-html.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = 'docs/poi-intake/baselines/japan-guide-v3-2026-08-25.json'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (Object.is(actual, expected)) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const eq = (label, a, b) => t(label, JSON.stringify(a), JSON.stringify(b))
const throwsWith = (label, fn, expect = null) => {
  try {
    fn()
    bad.push(`${label}: ждали отказ, вызов прошёл`)
  } catch (error) {
    if (expect && !String(error.message).includes(expect)) {
      bad.push(`${label}: ждали отказ «${expect}», получили «${error.message}»`)
    } else ok++
  }
}
const finish = () => {
  if (bad.length) {
    console.error(`Baseline discovery: ${bad.length} провалов из ${ok + bad.length}`)
    for (const line of bad) console.error(`  ✗ ${line}`)
    process.exit(1)
  }
  console.log(`Baseline discovery: ${ok} проверок пройдено`)
  process.exit(0)
}

/* ══ 1. КОНТЕЙНЕР ═══════════════════════════════════════════════════════ */

const sample = Buffer.from('{"portals":[]}\n'.repeat(40), 'utf8')
const packed = canonicalGzip(sample)
/*
 * ЧЕГО ЗДЕСЬ НЕ УТВЕРЖДАЕТСЯ: что эти байты получатся такими же в другой
 * среде. Прежняя редакция обещала «детерминировано по построению», и аудит
 * 25.08 предъявил пересборку того же отчёта в 714 522 байта против 683 037 —
 * тело потока пишет `deflateRawSync`, и его вывод зависит от сборки zlib.
 * Повторный вызов В ОДНОЙ среде совпадает — и только это здесь и проверяется;
 * тождество артефакта доказывают ТРИ ОТПЕЧАТКА, а не повторное сжатие.
 */
t('повторный вызов в одной среде даёт те же байты',
  Buffer.compare(canonicalGzip(sample), packed), 0)
t('и распаковка возвращает те же байты', Buffer.compare(readCanonicalGzip(packed), sample), 0)
/*
 * Шапка КАНОНИЧЕСКАЯ, и это проверяется побайтово: ни имени файла, ни времени,
 * ни кода ОС в неё не попадает. `zlib.gzipSync` кладёт в байт OS то, под что
 * собран Node — на macOS `3`, на Windows `11`, — и это метаданные машины в
 * файле, который лежит в репозитории.
 */
t('магия gzip на месте', packed.readUInt16LE(0), 0x8b1f)
t('метод — deflate', packed[2], 8)
t('флагов нет: ни имени файла, ни комментария', packed[3], 0)
t('время в шапке обнулено', packed.readUInt32LE(4), 0)
t('и ОС объявлена неизвестной, а не машиной сборки', packed[9], 0xff)
t('у zlib.gzipSync байт ОС другой — оттого контейнер и собран вручную',
  gzipSync(sample)[9] === 0xff, false)

/*
 * ПОТОЛОК РАСПАКОВКИ. Архив в двадцать байт разворачивается в гигабайты, и
 * проверка, читающая файл из репозитория, обязана иметь предел раньше, чем
 * память. Держит его сам распаковщик; своей проверки длины рядом нет, потому
 * что она была бы неотличима от него по поведению.
 */
throwsWith('потолок распаковки держится распаковщиком',
  () => readCanonicalGzip(packed, 16))
t('при достаточном потолке тот же архив читается',
  readCanonicalGzip(packed, MAX_BASELINE_BYTES).length, sample.length)
/* Подменённый хвостовой ISIZE не проходит: его проверяет сам gzip. */
const lying = Buffer.from(packed)
lying.writeUInt32LE(1, lying.length - 4)
throwsWith('архив с подменённым объявленным размером не читается',
  () => readCanonicalGzip(lying, MAX_BASELINE_BYTES))
throwsWith('и битый архив не разбирается молча',
  () => readCanonicalGzip(Buffer.concat([packed.subarray(0, 40), Buffer.from([0, 1, 2, 3])])))
t('потолок объявлен и он не бесконечен', MAX_BASELINE_BYTES > 0, true)

/* ══ 2. МАНИФЕСТ: ТОЧНАЯ ФОРМА ══════════════════════════════════════════ */

const manifest = JSON.parse(readFileSync(path.join(REPO, MANIFEST), 'utf8'))
assertDiscoveryBaseline(manifest); ok++
t('манифест объявляет свою версию', manifest.contractVersion, DISCOVERY_BASELINE_SPEC)
t('артефакт версионируется вместе с ним', manifest.artefact.trackedInGit, true)
t('и лежит рядом, а не в tmp/',
  manifest.artefact.path.startsWith('docs/poi-intake/baselines/'), true)
t('кодировка названа', manifest.artefact.encoding, 'gzip')
t('портал назван поимённо', manifest.artefact.portalId, 'japan-guide')
/* Три РАЗНЫХ отпечатка: сжатого, распакованного и снимка. */
t('отпечаток сжатого не равен отпечатку распакованного',
  manifest.artefact.compressedDigest === manifest.artefact.decompressedDigest, false)
t('и ни один из них не равен отпечатку снимка',
  [manifest.artefact.compressedDigest, manifest.artefact.decompressedDigest]
    .includes(manifest.snapshot.snapshotDigest), false)
t('непокрытое названо числом', typeof manifest.uncovered.containerCollections, 'number')
t('в этом прогоне контейнерных коллекций не было', manifest.uncovered.containerCollections, 0)

/*
 * FAIL-OPEN ЗАКРЫТ: УДАЛЁННОЕ ПОЛЕ — ОТКАЗ.
 *
 * Аудит 25.08 убрал из манифеста `snapshot.snapshotDigest` и
 * `counters.recordsBuilt`, и сверка вернула «ноль расхождений»: она обходила
 * поля манифеста и просто не посещала то, чего в нём нет. Чем меньше манифест
 * утверждал, тем легче ему было сойтись.
 */
const without = (mutate) => {
  const copy = JSON.parse(JSON.stringify(manifest))
  mutate(copy)
  return copy
}
for (const [label, cut, expect] of [
  ['snapshot.snapshotDigest', (m) => { delete m.snapshot.snapshotDigest }, 'snapshotDigest'],
  ['counters.recordsBuilt', (m) => { delete m.counters.recordsBuilt }, 'recordsBuilt'],
  ['artefact.compressedDigest', (m) => { delete m.artefact.compressedDigest }, 'compressedDigest'],
  ['artefact.decompressedBytes', (m) => { delete m.artefact.decompressedBytes }, 'decompressedBytes'],
  ['topology.records', (m) => { delete m.topology.records }, 'records'],
  ['integrity.composedExchangeBound', (m) => { delete m.integrity.composedExchangeBound }, 'composedExchangeBound'],
  ['uncovered.containerCollections', (m) => { delete m.uncovered.containerCollections }, 'containerCollections'],
  ['rejected.nodes', (m) => { delete m.rejected.nodes }, 'nodes'],
  ['весь блок snapshot', (m) => { delete m.snapshot }, 'snapshot'],
]) {
  throwsWith(`удалённое поле «${label}» — отказ`, () => assertDiscoveryBaseline(without(cut)), expect)
}
for (const [label, add] of [
  ['верхнего уровня', (m) => { m.extra = 1 }],
  ['в counters', (m) => { m.counters.madeUp = 7 }],
  ['в artefact', (m) => { m.artefact.mirror = 'x' }],
  ['в rejected', (m) => { m.rejected.invented = 0 }],
]) {
  throwsWith(`лишнее поле ${label} — отказ`, () => assertDiscoveryBaseline(without(add)), 'лишние поля')
}
/* Наборы счётчиков и каналов берутся из ПОЛИТИКИ версии, а не переписаны в
   манифест: счётчик, которого формат не знает, не проходит. */
/* Сообщение называет ОБА расхождения: и потерянный счётчик текущей версии, и
   пришедший из замороженной. Проверять только одно значило бы согласиться на
   отчёт, по которому не видно, что подменили. */
throwsWith('счётчик замороженной версии не проходит вместо текущего',
  () => assertDiscoveryBaseline(without((m) => {
    delete m.counters.recordsAttempted
    m.counters.poisVisited = 1140
  })), 'recordsAttempted')
throwsWith('и он же назван лишним',
  () => assertDiscoveryBaseline(without((m) => { m.counters.poisVisited = 1140 })), 'poisVisited')
throwsWith('чужая версия манифеста разбору не подлежит',
  () => assertDiscoveryBaseline(without((m) => { m.contractVersion = 'poi-discovery-baseline/v9' })),
  'через новую версию или мигратор')
throwsWith('baseline вне Git манифестом не считается',
  () => assertDiscoveryBaseline(without((m) => { m.artefact.trackedInGit = false })), 'вне Git')
throwsWith('чужая кодировка артефакта',
  () => assertDiscoveryBaseline(without((m) => { m.artefact.encoding = 'zstd' })), 'известно только')
throwsWith('размер распакованного выше потолка',
  () => assertDiscoveryBaseline(without((m) => {
    m.artefact.decompressedBytes = MAX_BASELINE_BYTES + 1
  })), 'при потолке')
throwsWith('строка вместо числа в счётчике',
  () => assertDiscoveryBaseline(without((m) => { m.counters.recordsBuilt = '1140' })), 'recordsBuilt')
throwsWith('логическое поле строкой',
  () => assertDiscoveryBaseline(without((m) => { m.snapshot.complete = 'да' })), 'complete')

/*
 * ══ 2б. ВАЛИДАТОР ПРОВЕРЯЕТСЯ ПРЯМО, И ДО ЛИСТА ══════════════════════════
 *
 * Аудит 25.08 предъявил пять входов, которые прежняя редакция принимала:
 * `scope: {}`, `recordVersions: [123]`, `incompleteReasons: [123]`, лишнее
 * поле в `networkPolicy` и путь `../../outside.json.gz`. Каждому из них здесь
 * стоит собственная регрессия, и зовётся ПУБЛИЧНЫЙ валидатор, а не сверка
 * целиком: сторож, проверяемый только через агрегат, живёт ровно до того дня,
 * когда агрегат начнёт падать по соседней причине.
 */
const rejects = (label, mutate, expect) =>
  throwsWith(label, () => assertDiscoveryBaseline(without(mutate)), expect)

/* Область снимка. */
rejects('пустой scope', (m) => { m.snapshot.scope = {} }, 'scope: нет обязательных полей')
rejects('лишнее поле в scope', (m) => { m.snapshot.scope.глубина = 3 }, 'scope: лишние поля')
rejects('неизвестный вид обхода', (m) => { m.snapshot.scope.kind = 'частичный' }, 'scope.kind')
rejects('у полного обхода объявлен предел',
  (m) => { m.snapshot.scope.limit = 50 }, 'у полного обхода предела нет')
rejects('у ограниченного обхода предела нет', (m) => {
  m.snapshot.scope.kind = 'limited'
  m.snapshot.complete = false
}, 'scope.limit')

/* Версии записи. */
rejects('версия записи числом', (m) => { m.snapshot.recordVersions = [123] }, 'recordVersions[0]')
rejects('чужая версия записи',
  (m) => { m.snapshot.recordVersions = ['poi-discovery-record/v1'] }, 'при формате записи')
rejects('пустой список версий записи', (m) => { m.snapshot.recordVersions = [] }, 'пустой список')
rejects('повтор в списке версий', (m) => {
  m.snapshot.recordVersions = ['poi-discovery-record/v2', 'poi-discovery-record/v2']
}, 'повторы')

/* Причины неполноты. */
rejects('причина числом', (m) => {
  m.snapshot.incompleteReasons = [123]
  m.snapshot.complete = false
}, 'ожидается объект причины')
rejects('неизвестный код причины', (m) => {
  m.snapshot.incompleteReasons = [{ code: 'придумано', count: 1 }]
  m.snapshot.complete = false
}, 'incompleteReasons[0].code')
rejects('лишнее поле у причины', (m) => {
  m.snapshot.incompleteReasons = [{ code: 'limitApplied', count: 1, почему: 'так' }]
  m.snapshot.complete = false
}, 'лишние поля')
rejects('причина без счёта', (m) => {
  m.snapshot.incompleteReasons = [{ code: 'limitApplied', count: 0 }]
  m.snapshot.complete = false
}, 'count')
rejects('одна причина названа дважды', (m) => {
  m.snapshot.incompleteReasons = [
    { code: 'limitApplied', count: 1 }, { code: 'limitApplied', count: 2 },
  ]
  m.snapshot.complete = false
}, 'названа дважды')
/* `complete` — вывод из состава, а не мнение манифеста. */
rejects('полнота объявлена вопреки причинам', (m) => {
  m.snapshot.incompleteReasons = [{ code: 'limitApplied', count: 1 }]
}, 'а из состава следует')
rejects('и неполнота без причин — тоже',
  (m) => { m.snapshot.complete = false }, 'а из состава следует')

/* Потолки сети. */
rejects('лишнее поле в networkPolicy',
  (m) => { m.snapshot.networkPolicy.выдумка = 1 }, 'networkPolicy: лишние поля')
rejects('пропавший потолок',
  (m) => { delete m.snapshot.networkPolicy.maxRedirects }, 'networkPolicy: нет обязательных полей')
rejects('нулевой бюджет обменов',
  (m) => { m.snapshot.networkPolicy.maxNetworkRequests = 0 }, 'maxNetworkRequests')
rejects('отрицательный потолок редиректов',
  (m) => { m.snapshot.networkPolicy.maxRedirects = -1 }, 'maxRedirects')
/* Ноль редиректов — законный режим, и он обязан проходить. */
assertDiscoveryBaseline(without((m) => { m.snapshot.networkPolicy.maxRedirects = 0 })); ok++

/* Путь артефакта. */
for (const [label, value, expect] of [
  ['наружу через ..', '../../outside.json.gz', 'обязан лежать прямо в'],
  ['абсолютный', '/etc/passwd.json.gz', 'канонический относительный путь'],
  ['неканонический', 'docs/poi-intake/baselines/./x.json.gz', 'канонический относительный путь'],
  ['с обратным слэшем', 'docs\\poi-intake\\baselines\\x.json.gz', 'канонический относительный путь'],
  ['во вложенном каталоге', 'docs/poi-intake/baselines/sub/x.json.gz', 'обязан лежать прямо в'],
  ['в чужом каталоге', 'docs/other/x.json.gz', 'обязан лежать прямо в'],
  ['не архив', 'docs/poi-intake/baselines/x.json', 'вида …json.gz'],
]) {
  rejects(`путь артефакта ${label}`, (m) => { m.artefact.path = value }, expect)
}

/* Разряды перечней и ключи — область значений, а не «объект и массив». */
rejects('выдуманный разряд collectionKinds',
  (m) => { m.topology.collectionKinds = { invented: 151 } }, 'collectionKinds: разряд «invented»')
rejects('выдуманный разряд placementKinds',
  (m) => { m.topology.placementKinds = { invented: 1140 } }, 'placementKinds: разряд «invented»')
rejects('выдуманное семейство адресов',
  (m) => { m.topology.recordUrlFamilies = { invented: 1140 } }, 'recordUrlFamilies: разряд «invented»')
rejects('вид коллекции из другого формата',
  (m) => { m.topology.collectionKinds = { ...m.topology.collectionKinds, legacyKind: 1 } },
  'collectionKinds: разряд «legacyKind»')
rejects('ключ вложенной коллекции не выводится из адреса',
  (m) => { m.topology.nestedCollections = ['garbage'] }, 'не выводится ни из одного канонического адреса')
rejects('ключ чужого портала во вложенных',
  (m) => { m.topology.nestedCollections = ['benesse-artsite:chichu'] },
  'не выводится ни из одного канонического адреса')
/*
 * BASELINE ОПИСЫВАЕТ РОВНО ОДИН ФОРМАТ СНИМКА.
 *
 * Прежде версия бралась из общей таблицы форматов, и манифест с меткой
 * `poi-discovery-snapshot/v1` проходил — хотя описать НАСТОЯЩИЙ `v1` этот
 * модуль не может вовсе: `describeDiscoveryBaseline` читает
 * `nestedCollectionEvidence`, которого у `v1` нет. Проверка, «убитая» таким
 * манифестом, доказывала состояние, которого не бывает; теперь поддержка
 * объявлена честно.
 */
t('baseline называет формат снимка, который описывает',
  BASELINE_SNAPSHOT_SPEC, 'poi-discovery-snapshot/v3')
for (const version of [
  'poi-discovery-snapshot/v1', 'poi-discovery-snapshot/v2', 'poi-discovery-snapshot/v4',
]) {
  rejects(`манифест с меткой ${version}`,
    (m) => { m.snapshot.contractVersion = version }, 'описывает ТОЛЬКО')
}
/* И это не «неизвестный формат», а именно закрытая поддержка: `v1` и `v2`
   производственный контракт знает, читать их baseline всё равно не берётся. */
throwsWith('замороженный формат назван поимённо, а не «неизвестным»',
  () => assertDiscoveryBaseline(without((m) => {
    m.snapshot.contractVersion = 'poi-discovery-snapshot/v1'
  })), 'нужен poi-discovery-baseline/v2 или явный мигратор')

/* Настоящий ключ известного семейства проходит. */
assertDiscoveryBaseline(without((m) => {
  m.topology.nestedCollections = ['japan-guide:destinations:nikko']
})); ok++

/* Отпечатки — синтаксис, а не «непустая строка». */
rejects('отпечаток снимка не отпечаток',
  (m) => { m.snapshot.snapshotDigest = 'sha256:зззз' }, 'ровно 64 строчных hex')
rejects('отпечаток сжатого короче положенного',
  (m) => { m.artefact.compressedDigest = `sha256:${'a'.repeat(63)}` }, 'ровно 64 строчных hex')
rejects('отпечаток распакованного без алгоритма',
  (m) => { m.artefact.decompressedDigest = 'a'.repeat(64) }, 'ровно 64 строчных hex')

/* Числовые области. */
rejects('нулевой размер сжатого', (m) => { m.artefact.compressedBytes = 0 }, 'compressedBytes')
rejects('отрицательный размер распакованного',
  (m) => { m.artefact.decompressedBytes = -1 }, 'decompressedBytes')
rejects('дробный счётчик', (m) => { m.counters.recordsBuilt = 1140.5 }, 'recordsBuilt')
rejects('отрицательный разряд в перечне',
  (m) => { m.topology.collectionKinds.ranked = -1 }, 'collectionKinds')

/* Моменты наблюдения. */
rejects('момент наблюдения не в каноническом виде',
  (m) => { m.snapshot.observedAt.robots = '25 августа 2026' }, 'observedAt.robots')
/* Список вложенных коллекций — список строк, отсортированный и без повторов. */
rejects('вложенная коллекция числом',
  (m) => { m.topology.nestedCollections = [5041] }, 'nestedCollections[0]')
rejects('список вложенных не отсортирован',
  (m) => { m.topology.nestedCollections = ['japan-guide:e9', 'japan-guide:e1'] }, 'отсортирован')

/* ══ 3. ЖИВОЙ BASELINE ══════════════════════════════════════════════════ */

const artefact = loadBaselineArtefact(manifest, REPO)
eq('живой baseline сошёлся с манифестом целиком',
  verifyDiscoveryBaseline(manifest, artefact), [])

/* Байтовые подделки ловятся ДО разбора отчёта. */
const forged = (mutate) => {
  const copy = JSON.parse(JSON.stringify(manifest))
  mutate(copy)
  return verifyDiscoveryBaseline(copy, artefact)
}
eq('подменённый отпечаток сжатого назван поимённо',
  forged((m) => { m.artefact.compressedDigest = `sha256:${'0'.repeat(64)}` })
    .map((line) => line.split(':')[0]), ['artefact.compressedDigest'])
eq('подменённый отпечаток распакованного — тоже',
  forged((m) => { m.artefact.decompressedDigest = `sha256:${'1'.repeat(64)}` })
    .map((line) => line.split(':')[0]), ['artefact.decompressedDigest'])
eq('подменённый размер сжатого — тоже',
  forged((m) => { m.artefact.compressedBytes += 1 })
    .map((line) => line.split(':')[0]), ['artefact.compressedBytes'])
t('подменённый отпечаток снимка ловится после разбора',
  forged((m) => { m.snapshot.snapshotDigest = `sha256:${'2'.repeat(64)}` })
    .some((line) => line.startsWith('snapshot.snapshotDigest')), true)
t('и подменённый счётчик — тоже',
  forged((m) => { m.counters.recordsBuilt = 1 })
    .some((line) => line.startsWith('counters.recordsBuilt')), true)

throwsWith('битый архив разбору не подлежит',
  () => verifyDiscoveryBaseline(manifest, {
    compressed: Buffer.concat([
      artefact.compressed.subarray(0, 1000),
      Buffer.from([0xff, 0xff, 0xff, 0xff]),
      artefact.compressed.subarray(1004),
    ]),
  }))
/* Загрузчик проверяет манифест САМ и ДО чтения файла: прежде сверка звала его
   аргументом, то есть читала файл раньше, чем узнавала, годен ли манифест. */
throwsWith('загрузчик отвергает негодный манифест раньше файловой системы',
  () => loadBaselineArtefact(without((m) => { m.artefact.path = '../../outside.json.gz' }), REPO),
  'обязан лежать прямо в')
throwsWith('отсутствующий артефакт — порча репозитория, а не пропуск',
  () => loadBaselineArtefact({ ...manifest, artefact: { ...manifest.artefact, path: 'docs/poi-intake/baselines/нет-такого.json.gz' } }, REPO),
  'порча клона')

/*
 * ССЫЛКА ИЗ КАТАЛОГА BASELINE НАРУЖУ.
 *
 * Строка манифеста может быть безупречной, а файл под ней — символьной
 * ссылкой куда угодно. `assertDiscoveryBaseline` об этом не знает и знать не
 * может: он судит текст. Поэтому разрешённый путь судится второй раз, уже
 * файловой системой, и проверяется это на СВОЁМ репозитории — чтобы отказ
 * доказывал сторож, а не отсутствие файла.
 */
{
  const fake = mkdtempSync(path.join(tmpdir(), 'jj-baseline-'))
  try {
    mkdirSync(path.join(fake, BASELINE_DIR), { recursive: true })
    const inside = path.join(fake, manifest.artefact.path)
    writeFileSync(inside, artefact.compressed)
    t('файл внутри каталога baseline читается',
      loadBaselineArtefact(manifest, fake).compressed.length, manifest.artefact.compressedBytes)
    const outside = path.join(fake, 'снаружи.json.gz')
    writeFileSync(outside, artefact.compressed)
    const linked = {
      ...manifest,
      artefact: { ...manifest.artefact, path: `${BASELINE_DIR}/через-ссылку.json.gz` },
    }
    symlinkSync(outside, path.join(fake, linked.artefact.path))
    throwsWith('символьная ссылка наружу читается не будет',
      () => loadBaselineArtefact(linked, fake), 'за пределы')
  } finally {
    rmSync(fake, { recursive: true, force: true })
  }
}

/*
 * ШАПКА ОТСЛЕЖИВАЕМОГО АРТЕФАКТА — а не только шапка `canonicalGzip(sample)`.
 *
 * Проверять свойства функции и молчать о файле, который лежит в Git, значит
 * доказывать не то: в репозиторий кладут байты, а не вызов. Байты тела здесь
 * не обсуждаются вовсе — они зависят от сборки zlib; обсуждается ровно то, что
 * мы обещаем: в шапке нет метаданных машины.
 */
t('у файла в репозитории та же магия', artefact.compressed.readUInt16LE(0), 0x8b1f)
t('и метод deflate', artefact.compressed[2], 8)
t('и флагов нет: ни имени файла, ни комментария', artefact.compressed[3], 0)
t('и время обнулено', artefact.compressed.readUInt32LE(4), 0)
t('и ОС объявлена неизвестной', artefact.compressed[9], 0xff)

const decompressed = readCanonicalGzip(artefact.compressed)
const report = JSON.parse(decompressed.toString('utf8'))
const live = selectPortalSnapshot(report, manifest.artefact.portalId)
throwsWith('портал выбирается поимённо, а не первым попавшимся',
  () => selectPortalSnapshot({ portals: [{ portalId: 'чужой', discovery: live }] }, 'japan-guide'),
  'брать первый попавшийся нельзя')
t('и настоящий портал находится', live.snapshotDigest, manifest.snapshot.snapshotDigest)

/*
 * ВЕРСИЯ ВНУТРИ АРХИВА — ТОЖЕ УТВЕРЖДЕНИЕ, И ОНО СВЕРЯЕТСЯ.
 *
 * Аудит 25.08 упаковал НАСТОЯЩИЙ снимок `v1` каноническим gzip, пересчитал все
 * три отпечатка и оставил манифесту заявление `v3`. Байты сошлись, контракт
 * снимок принял — и сверка дошла до описания, которого для `v1` не существует:
 * падение было сырым `Cannot read properties of undefined`. Ложного зелёного
 * не было, но и названного отказа тоже.
 */
{
  const genuineV1 = JSON.parse(readFileSync(
    path.join(REPO, 'tests/fixtures/discovery/v1-snapshot.json'), 'utf8'))
  const rawV1 = Buffer.from(`${JSON.stringify({
    portals: [{ portalId: manifest.artefact.portalId, discovery: genuineV1 }],
  }, null, 2)}\n`, 'utf8')
  const packedV1 = canonicalGzip(rawV1)
  const declaredV3 = JSON.parse(JSON.stringify(manifest))
  declaredV3.artefact.compressedBytes = packedV1.length
  declaredV3.artefact.compressedDigest = baselineDigest(packedV1)
  declaredV3.artefact.decompressedBytes = rawV1.length
  declaredV3.artefact.decompressedDigest = baselineDigest(rawV1)
  declaredV3.snapshot.snapshotDigest = genuineV1.snapshotDigest
  eq('подделка сошлась по всем трём отпечаткам',
    artefactDifferences(declaredV3, { compressed: packedV1, decompressed: rawV1 }), [])
  throwsWith('но формат снимка в архиве назван и отвергнут',
    () => verifyDiscoveryBaseline(declaredV3, { compressed: packedV1 }),
    'в архиве лежит снимок')
  /* И само описание отвергает неподдержанный формат ДЕТЕРМИНИРОВАННО. */
  throwsWith('описание не берётся за замороженный формат',
    () => describeDiscoveryBaseline(genuineV1), 'описывает ТОЛЬКО')
  throwsWith('и за снимок без версии — тоже',
    () => describeDiscoveryBaseline({}), 'описывает ТОЛЬКО')
  t('а настоящий v3 описывается по-прежнему',
    describeDiscoveryBaseline(live).snapshot.contractVersion, BASELINE_SNAPSHOT_SPEC)
}

/* ── Вторая синтетическая фикстура: то, чего нет в живом корпусе ───────── */

const HOST = 'https://www.japan-guide.com'
const ENTRY = `${HOST}/e/e623a.html`
const DEST = `${HOST}/e/e2157.html`
const POI = `${HOST}/e/e4000.html`
const NESTED = `${HOST}/e/e5041.html`
const DIRECT = `${HOST}/e/e4100.html`
const AT = '2026-08-25T00:00:00.000Z'
const DIGEST = (letter) => `sha256:${letter.repeat(64)}`
const evidence = (url, pageRole, rawPageDigest) => buildPageEvidence({
  url,
  pageRole,
  pageBytes: 1024,
  rawPageDigest,
  observedAt: AT,
  httpCharset: 'shift-jis',
  metaCharset: 'utf-8',
  decodePolicy: 'mixed-page-utf8-locators-v1',
  decodeErrorCount: 0,
  decodeReplacements: 0,
  nonWhitelistedCodepoints: 0,
})
/*
 * В живом корпусе прямых объектов, контейнерных коллекций и объектов с двумя
 * привязками либо нет, либо они не отличимы от нуля. На такой фикстуре четыре
 * величины описания совпадали бы случайно — мутации это и показали. Здесь
 * каждая отлична и от нуля, и от своего двойника.
 */
const rich = buildDiscoverySnapshot({
  scope: { kind: 'full', limit: null },
  entryUrl: ENTRY,
  incompleteReasons: [],
  networkPolicy: { maxNetworkRequests: 6000, maxRedirects: 2 },
  robotsEvidence: {
    url: `${HOST}/robots.txt`, bytes: 64, digest: DIGEST('c'), observedAt: AT, appliedGroups: ['*'],
  },
  catalogueEvidence: evidence(ENTRY, 'catalogue', DIGEST('a')),
  catalogueTargetEvidence: [
    { sourceKey: 'japan-guide:e2157', evidence: evidence(DEST, 'collection', DIGEST('b')) },
    { sourceKey: 'japan-guide:e4100', evidence: evidence(DIRECT, 'poi', DIGEST('8')) },
  ],
  nestedCollectionEvidence: [
    { sourceKey: 'japan-guide:e5041', evidence: evidence(NESTED, 'collection', DIGEST('5')) },
  ],
  orderRecords: [
    buildOrderRecord({
      destinationSourceKey: 'japan-guide:e2157',
      sourcePageDigest: DIGEST('b'),
      collectionKind: 'ranked',
      items: [orderItem('poi', 'japan-guide:e4000'), orderItem('collection', 'japan-guide:e5041')],
    }),
    buildOrderRecord({
      destinationSourceKey: 'japan-guide:e5041',
      sourcePageDigest: DIGEST('5'),
      collectionKind: 'container',
      items: [orderItem('poi', 'japan-guide:e4000')],
    }),
  ],
  records: [
    buildDiscoveryRecord({
      sourceKey: 'japan-guide:e4000',
      url: POI,
      nameEn: 'Shared Object',
      placements: [
        {
          kind: 'destinationRanking',
          collectionSourceKey: 'japan-guide:e2157',
          listPosition: 1,
          editorialLevel: 0,
          categoryHint: null,
        },
        {
          kind: 'containerChild',
          collectionSourceKey: 'japan-guide:e5041',
          listPosition: null,
          editorialLevel: null,
          categoryHint: null,
        },
      ],
      factLeads: [],
      omissions: [],
      pageEvidence: evidence(POI, 'poi', DIGEST('9')),
    }),
    buildDiscoveryRecord({
      sourceKey: 'japan-guide:e4100',
      url: DIRECT,
      nameEn: 'Direct Object',
      placements: [{
        kind: 'catalogueDirect',
        collectionSourceKey: CATALOGUE_SOURCE_KEY,
        listPosition: null,
        editorialLevel: null,
        categoryHint: null,
      }],
      factLeads: [],
      omissions: [],
      pageEvidence: evidence(DIRECT, 'poi', DIGEST('8')),
    }),
  ],
  rejected: { targets: [], cards: [], nodes: [], pois: [] },
  counters: {
    /* Заведомо ВЫШЕ границы: иначе «граница» и «счётчик» неотличимы. */
    networkRequests: 9,
    catalogueTargetsFound: 2,
    catalogueCollectionsFound: 1,
    nestedCollectionsFound: 1,
    directPoisFound: 1,
    poisFound: 2,
    recordsAttempted: 2,
    recordsBuilt: 2,
    nonCanonicalLinks: 0,
    unknownAdmissionLabels: 0,
    emptyAdmissionValues: 0,
  },
})
const richDescribed = describeDiscoveryBaseline(rich)
eq('описание детерминировано', describeDiscoveryBaseline(rich), richDescribed)
t('контейнерная коллекция названа непокрытием, а не нулём',
  richDescribed.uncovered.containerCollections, 1)
t('и размещение containerChild тоже', richDescribed.uncovered.containerChildPlacements, 1)
t('объект с двумя привязками посчитан', richDescribed.topology.recordsWithSeveralPlacements, 1)
t('прямые объекты отделены от достижимых', richDescribed.topology.directPois, 1)
t('граница выведена из состава', composedExchangeBound(rich), 6)
t('и не равна объявленному счётчику', richDescribed.integrity.declaredExchanges, 9)

/* Манифест, собранный из описания, обязан проходить собственный валидатор. */
const richPacked = canonicalGzip(Buffer.from(JSON.stringify({
  portals: [{ portalId: 'japan-guide', discovery: rich }],
}), 'utf8'))
const richManifest = {
  contractVersion: DISCOVERY_BASELINE_SPEC,
  label: 'rich',
  note: 'синтетическая фикстура',
  artefact: {
    path: 'docs/poi-intake/baselines/rich.artifact.json.gz',
    encoding: 'gzip',
    portalId: 'japan-guide',
    trackedInGit: true,
    compressedBytes: richPacked.length,
    compressedDigest: baselineDigest(richPacked),
    decompressedBytes: Buffer.byteLength(JSON.stringify({
      portals: [{ portalId: 'japan-guide', discovery: rich }],
    })),
    decompressedDigest: baselineDigest(Buffer.from(JSON.stringify({
      portals: [{ portalId: 'japan-guide', discovery: rich }],
    }), 'utf8')),
  },
  ...richDescribed,
}
assertDiscoveryBaseline(richManifest); ok++
eq('и сходится со своим артефактом',
  verifyDiscoveryBaseline(richManifest, { compressed: richPacked }), [])

/*
 * СВЕРКА ДВУСТОРОННЯЯ, И ЭТО ВИДНО ТОЛЬКО НА СВОБОДНЫХ НАБОРАХ.
 *
 * Точная схема закрывает поля, перечисленные поимённо. Но `collectionKinds`,
 * `placementKinds` и семейства адресов — свободные наборы: их ключи заранее не
 * известны. Односторонний обход, идущий по манифесту, НОВЫЙ вид коллекции у
 * снимка не посетил бы вовсе — и появление контейнерных коллекций в живом
 * корпусе прошло бы молча, ровно там, где baseline обязан кричать.
 */
/*
 * КОНТРАКТ СНИМКА ВЫЗЫВАЕТСЯ РАНЬШЕ СРАВНЕНИЯ, И ЭТО ПРОВЕРЯЕТСЯ.
 *
 * Архив может быть побайтово тем, что обещает манифест, и при этом содержать
 * снимок, который контракт не принимает. Обсуждать «сошёлся ли он с baseline»
 * в таком случае бессмысленно: он не снимок. Здесь артефакт честный по байтам
 * — отпечатки пересчитаны под испорченное содержимое, — а снимок внутри
 * подделан, и сверка обязана упасть на контракте, а не выдать список
 * расхождений.
 */
const brokenReport = JSON.parse(JSON.stringify({
  portals: [{ portalId: 'japan-guide', discovery: rich }],
}))
brokenReport.portals[0].discovery.counters.recordsBuilt = 999
const brokenRaw = Buffer.from(JSON.stringify(brokenReport), 'utf8')
const brokenPacked = canonicalGzip(brokenRaw)
throwsWith('снимок, не проходящий контракт, до сравнения не допускается',
  () => verifyDiscoveryBaseline({
    ...richManifest,
    artefact: {
      ...richManifest.artefact,
      compressedBytes: brokenPacked.length,
      compressedDigest: baselineDigest(brokenPacked),
      decompressedBytes: brokenRaw.length,
      decompressedDigest: baselineDigest(brokenRaw),
    },
  }, { compressed: brokenPacked }), 'recordsBuilt')

const richWithoutContainer = JSON.parse(JSON.stringify(richManifest))
delete richWithoutContainer.topology.collectionKinds.container
assertDiscoveryBaseline(richWithoutContainer); ok++
t('вид коллекции, появившийся у снимка, но не в манифесте, назван',
  verifyDiscoveryBaseline(richWithoutContainer, { compressed: richPacked })
    .some((line) => line.startsWith('topology.collectionKinds.container')), true)
/* Разряд ЗАКОННЫЙ, но которого у снимка нет: свободный перечень может
   прирастать ключами, и лишний в манифесте обязан быть назван. Выдуманное имя
   здесь не годится — его отвергает сам валидатор, и проверялся бы он, а не
   двусторонний обход. */
const richExtraFamily = JSON.parse(JSON.stringify(richManifest))
richExtraFamily.topology.recordUrlFamilies.destinationRoot = 3
t('и лишний вид в манифесте — тоже',
  verifyDiscoveryBaseline(richExtraFamily, { compressed: richPacked })
    .some((line) => line.startsWith('topology.recordUrlFamilies.destinationRoot')), true)

/* ── Мониторинг v3 → v3 на живом снимке ───────────────────────────────── */

/**
 * Пересборка снимка производственными строителями.
 *
 * Записи, которых возмущение НЕ коснулось, проходят насквозь: они уже собраны
 * теми же строителями и несут верные отпечатки, а пересчёт 1140 записей на
 * каждое возмущение стоил бы девять секунд на прогон и делал бы матрицу
 * мутаций неподъёмной. Изменённая запись пересобирается по-настоящему — иначе
 * возмущение проверяло бы правку JSON, а не путь обхода. Что сквозной проход
 * ничего не искажает, доказано отдельной проверкой: полная пересборка без
 * изменений даёт тот же `snapshotDigest`.
 */
const rebuild = (mutate, { rebuildEveryRecord = false } = {}) => {
  const draft = JSON.parse(JSON.stringify(live))
  mutate(draft)
  const before = new Map(live.records.map((record) => [record.sourceKey, JSON.stringify(record)]))
  const touched = (record) => rebuildEveryRecord
    || before.get(record.sourceKey) !== JSON.stringify(record)
  return buildDiscoverySnapshot({
    scope: draft.scope,
    entryUrl: draft.entryUrl,
    incompleteReasons: draft.incompleteReasons,
    networkPolicy: draft.networkPolicy,
    robotsEvidence: draft.robotsEvidence,
    catalogueEvidence: draft.catalogueEvidence,
    catalogueTargetEvidence: draft.catalogueTargetEvidence,
    nestedCollectionEvidence: draft.nestedCollectionEvidence,
    orderRecords: draft.orderRecords.map((row) => buildOrderRecord({
      destinationSourceKey: row.destinationSourceKey,
      sourcePageDigest: row.sourcePageDigest,
      collectionKind: row.collectionKind,
      items: row.items.map((item) => orderItem(item.role, item.sourceKey)),
    })),
    records: draft.records.map((record) => (touched(record) ? buildDiscoveryRecord({
      sourceKey: record.sourceKey,
      url: record.url,
      nameEn: record.nameEn,
      placements: record.placements,
      factLeads: record.factLeads,
      omissions: record.omissions,
      pageEvidence: buildPageEvidence({
        url: record.pageEvidence.url,
        pageRole: record.pageEvidence.pageRole,
        pageBytes: record.pageEvidence.pageBytes,
        rawPageDigest: record.pageEvidence.rawPageDigest,
        observedAt: record.pageEvidence.observedAt,
        httpCharset: record.pageEvidence.encodingDiagnostics.httpCharset,
        metaCharset: record.pageEvidence.encodingDiagnostics.metaCharset,
        decodePolicy: record.pageEvidence.encodingDiagnostics.decodePolicy,
        decodeErrorCount: record.pageEvidence.encodingDiagnostics.decodeErrorCount,
        decodeReplacements: record.pageEvidence.encodingDiagnostics.decodeReplacements,
        nonWhitelistedCodepoints: record.pageEvidence.encodingDiagnostics.nonWhitelistedCodepoints,
      }),
    }) : record)),
    rejected: draft.rejected,
    counters: draft.counters,
  })
}
/*
 * ПОЛНАЯ ПЕРЕСБОРКА — оправдание сквозного прохода, и стоит она шесть секунд:
 * 1140 записей через настоящие строители, с отпечатком на каждую. В `npm test`
 * она идёт ВСЕГДА. В матрице мутаций, где наборы запускаются двести раз, она
 * пропускается по `JJ_MUTATION_RUN` — и это не послабление: она проверяет
 * ЛЕСА этого набора (что сквозной проход не искажает), а не production-код.
 * Мутации целятся в production, и им эта проверка ничего не добавляет.
 */
if (!process.env.JJ_MUTATION_RUN) {
  t('полная пересборка живого снимка воспроизводит его отпечаток',
    rebuild(() => {}, { rebuildEveryRecord: true }).snapshotDigest, live.snapshotDigest)
}
t('и сквозной проход даёт тот же отпечаток', rebuild(() => {}).snapshotDigest, live.snapshotDigest)

const shape = (diff) => (diff.comparable
  ? [diff.appeared, diff.vanished, diff.semanticChanges, diff.reorderedDestinations,
    diff.evidenceChanges, diff.parentPageChanges, diff.graphChanges, diff.encodingChanges]
  : ['несравнимы'])
const LABELS = ['появилось', 'исчезло', 'смысл', 'перестановки', 'наблюдение',
  'родительские', 'топология', 'кодировка']
const reports = (label, mutate, expected) =>
  eq(`${label} → ${LABELS.filter((_, i) => expected[i]).join(', ') || 'ничего'}`,
    shape(diffDiscoverySnapshot(rebuild(mutate), live)), expected)

/* Главная проверка на ложные срабатывания: 1140 настоящих записей. */
reports('снимок сам с собой', () => {}, [0, 0, 0, 0, 0, 0, 0, 0])

/*
 * ЖИВАЯ МАТРИЦА ВОЗМУЩЕНИЙ — девять снимков по 1140 записей, каждый со своими
 * отпечатками: шесть секунд на прогон. В `npm test` она идёт ВСЕГДА, потому
 * что это и есть проверка мониторинга на живых данных. В матрице мутаций,
 * где наборы запускаются двести раз, она пропускается: разделы монитора там
 * уже покрыты синтетическими регрессиями набора Japan Guide, а мутациям эти
 * шесть секунд не добавляют ни одного убитого.
 */
if (!process.env.JJ_MUTATION_RUN) {
  const victim = live.records.find((record) => record.placements.length === 1
    && record.placements[0].kind === 'destinationRanking')
  const parentKey = victim.placements[0].collectionSourceKey
  const nestedKey = live.nestedCollectionEvidence[0].sourceKey

  reports('переименование объекта', (d) => {
    d.records.find((r) => r.sourceKey === victim.sourceKey).nameEn = 'Renamed For Monitor Check'
  }, [0, 0, 1, 0, 0, 0, 0, 0])

  reports('те же данные, другие байты страницы объекта', (d) => {
    const record = d.records.find((r) => r.sourceKey === victim.sourceKey)
    record.pageEvidence.pageBytes += 137
    record.pageEvidence.rawPageDigest = DIGEST('d')
  }, [0, 0, 0, 0, 1, 0, 0, 0])

  reports('перестановка карточек внутри коллекции', (d) => {
    const order = d.orderRecords.find((o) => o.destinationSourceKey === parentKey)
    const [first, second] = [order.items[0], order.items[1]]
    order.items[0] = second
    order.items[1] = first
    for (const key of [first.sourceKey, second.sourceKey]) {
      const placement = d.records.find((r) => r.sourceKey === key).placements
        .find((p) => p.collectionSourceKey === parentKey)
      placement.listPosition = placement.listPosition === 1 ? 2 : 1
    }
  }, [0, 0, 0, 1, 0, 0, 0, 0])

  /* Перевёрстка — НЕ перестановка: байты и отпечаток едут вместе, порядок
     перечитан с новых байтов, список карточек тот же. */
  reports('перевёрстка страницы коллекции', (d) => {
    const next = DIGEST('e')
    const target = d.catalogueTargetEvidence.find((row) => row.sourceKey === parentKey)
    target.evidence.pageBytes += 512
    target.evidence.rawPageDigest = next
    d.orderRecords.find((o) => o.destinationSourceKey === parentKey).sourcePageDigest = next
  }, [0, 0, 0, 0, 0, 1, 0, 0])

  reports('перевёрстка страницы ВЛОЖЕННОЙ коллекции', (d) => {
    const next = DIGEST('f')
    const nested = d.nestedCollectionEvidence[0]
    nested.evidence.pageBytes += 64
    nested.evidence.rawPageDigest = next
    d.orderRecords.find((o) => o.destinationSourceKey === nestedKey).sourcePageDigest = next
  }, [0, 0, 0, 0, 0, 1, 0, 0])

  reports('перевёрстка страницы каталога', (d) => {
    d.catalogueEvidence.pageBytes += 11
    d.catalogueEvidence.rawPageDigest = DIGEST('1')
  }, [0, 0, 0, 0, 0, 1, 0, 0])

  reports('сигналы кодировки вложенной коллекции', (d) => {
    d.nestedCollectionEvidence[0].evidence.encodingDiagnostics.nonWhitelistedCodepoints += 3
  }, [0, 0, 0, 0, 0, 0, 0, 1])

  const direct = live.records.find((record) => record.placements.length === 1
    && record.placements[0].kind === 'catalogueDirect')
  reports('исчезновение прямого объекта каталога', (d) => {
    d.records = d.records.filter((r) => r.sourceKey !== direct.sourceKey)
    d.catalogueTargetEvidence = d.catalogueTargetEvidence
      .filter((row) => row.sourceKey !== direct.sourceKey)
    d.counters.catalogueTargetsFound -= 1
    d.counters.directPoisFound -= 1
    d.counters.poisFound -= 1
    d.counters.recordsAttempted -= 1
    d.counters.recordsBuilt -= 1
    d.counters.networkRequests -= 1
  }, [0, 1, 0, 0, 0, 0, 0, 0])

  const collectionVanished = diffDiscoverySnapshot(rebuild((d) => {
    d.nestedCollectionEvidence = []
    d.orderRecords = d.orderRecords.filter((o) => o.destinationSourceKey !== nestedKey)
    for (const order of d.orderRecords) {
      order.items = order.items.filter((item) => item.sourceKey !== nestedKey)
    }
    for (const record of d.records) {
      record.placements = record.placements.filter((p) => p.collectionSourceKey !== nestedKey)
    }
    const orphans = d.records.filter((record) => !record.placements.length).length
    d.records = d.records.filter((record) => record.placements.length)
    d.counters.nestedCollectionsFound -= 1
    d.counters.poisFound -= orphans
    d.counters.recordsAttempted -= orphans
    d.counters.recordsBuilt -= orphans
    d.counters.networkRequests -= 1 + orphans
  }), live)
  t('исчезновение коллекции сообщено топологией', collectionVanished.graphChanges, 1)
  eq('и названо так, что вывод о закрытии из него не следует',
    [collectionVanished.details.graphChanges[0].change,
      collectionVanished.details.graphChanges[0].sourceKey],
    ['collectionVanishedForHumanReview', nestedKey])
  t('вместе с ним сообщены и потерянные привязки общих объектов',
    collectionVanished.semanticChanges > 0, true)
}

/* Снимки разных версий несравнимы — отказ раньше сравнения отпечатков. */
const asV2 = { ...JSON.parse(JSON.stringify(rich)), contractVersion: 'poi-discovery-snapshot/v2' }
t('снимки разных версий несравнимы', diffDiscoverySnapshot(rich, asV2).comparable, false)

finish()
