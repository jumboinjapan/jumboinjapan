/**
 * BASELINE ЖИВОГО ОБХОДА: ОПИСАНИЕ, АРТЕФАКТ И ИХ ПРОВЕРКА.
 *
 * Снимок полного обхода весит 6,2 МБ. Раньше он лежал в `tmp/`, а манифест на
 * него ссылался — то есть baseline существовал ровно до первой уборки и не
 * существовал вовсе в свежем клоне. Теперь артефакт лежит В РЕПОЗИТОРИИ, сжатый
 * до ~0,7 МБ, и его отсутствие — порча репозитория, а не «локально нет файла».
 *
 * ЧТО ЗАКРЕПЛЯЕТСЯ:
 *
 *   · ДВА представления артефакта, каждое своими байтами и своим отпечатком.
 *     Сжатое доказывает, что в Git лежит именно этот файл; распакованное — что
 *     из него получается именно тот отчёт. Совпадение одного о другом не
 *     говорит: перепаковка меняет первое, не трогая второе;
 *   · `snapshotDigest` — третий отпечаток, уже про содержание снимка;
 *   · версии всех форматов, счётчики целиком, топология;
 *   · нижняя граница обменов, ПЕРЕСЧИТАННАЯ из состава;
 *   · раздел `uncovered` — чего в этом прогоне не встретилось.
 *
 * ЧЕМ ДОКАЗЫВАЕТСЯ АРТЕФАКТ. Отпечатками ТРЁХ представлений, а не пересборкой.
 * Прежняя редакция обещала, что сжатие «детерминировано по построению» и файл
 * получится одинаковым на любой машине. Обещание неверно: фиксированная шапка
 * убирает из контейнера имя, время и код ОС, но САМ ПОТОК DEFLATE зависит от
 * сборки zlib, и аудит 25.08 предъявил пересборку в 714 522 байта против 683 037
 * у файла в репозитории — при том же содержимом. Поэтому tracked-байты
 * НЕИЗМЕНЯЕМЫ: их не пересобирают и с пересобранными не сравнивают, а сверяют
 * отпечатком сжатого файла, отпечатком распакованного отчёта и `snapshotDigest`
 * — тремя независимыми утверждениями.
 */
import { createHash } from 'node:crypto'
import { posix as posixPath } from 'node:path'
import { crc32, deflateRawSync, gunzipSync } from 'node:zlib'
import {
  assertExactKeys,
  assertInteger,
  assertNonEmptyString,
  assertSha256Value,
  assertStringList,
} from '../../lib/canonical-contract.mjs'
import {
  COLLECTION_KINDS,
  NETWORK_POLICY_KEYS,
  REASON_KEYS,
  SCOPE_KEYS,
  SNAPSHOT_SCOPES,
  VERSION_POLICY,
  assertEnum,
  orderedPoiKeys,
  orderedCollectionKeys,
} from './discovery-contract.mjs'
import { canonicalDiscoveryUrl, sourceKeyFamily } from './html-fetch.mjs'

export const DISCOVERY_BASELINE_SPEC = 'poi-discovery-baseline/v1'

/**
 * ФОРМАТ СНИМКА, КОТОРЫЙ ЭТОТ BASELINE УМЕЕТ ОПИСЫВАТЬ. Ровно один.
 *
 * Прежде версия снимка бралась из таблицы форматов, и манифест с меткой
 * `poi-discovery-snapshot/v1` проходил валидатор — при том, что описать
 * НАСТОЯЩИЙ снимок `v1` этот модуль не может вовсе: `describeDiscoveryBaseline`
 * читает `nestedCollectionEvidence`, которого у `v1` нет, и падает. Аудит 25.08
 * показал и то, и другое; проверка, «убитая» таким манифестом, доказывала
 * состояние, которого не бывает.
 *
 * Поэтому поддержка объявлена честно: baseline `v1` описывает снимок `v3`.
 * Появится `v4` — потребуется `poi-discovery-baseline/v2` либо явный мигратор,
 * а не расширение этой строки.
 */
export const BASELINE_SNAPSHOT_SPEC = 'poi-discovery-snapshot/v3'

/**
 * Сверка поддерживаемой версии — ОДНА на модуль.
 *
 * Ею пользуются и манифест, и само описание: реестр поддерживаемых версий не
 * размножается, а значит и разойтись ему негде.
 */
export function assertBaselineSnapshotVersion(version, where) {
  if (version !== BASELINE_SNAPSHOT_SPEC) {
    throw new TypeError(
      `${where}: baseline этого формата описывает ТОЛЬКО «${BASELINE_SNAPSHOT_SPEC}», `
      + `получено ${JSON.stringify(version)} — для другого формата снимка нужен `
      + 'poi-discovery-baseline/v2 или явный мигратор')
  }
}

/**
 * ПОТОЛОК РАСПАКОВКИ.
 *
 * Архив в двадцать байт разворачивается в гигабайты, и проверка, читающая
 * «просто файл из репозитория», обязана иметь предел раньше, чем память. Пять
 * мегабайт запаса над нынешними 6,5 — не граница задачи, а операционный
 * потолок: вырос корпус — поднимаем осознанно.
 */
export const MAX_BASELINE_BYTES = 12 * 1024 * 1024

const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`

/**
 * Канонический контейнер gzip поверх сырого deflate.
 *
 * Шапка: магия `1f 8b`, метод deflate, НУЛЕВЫЕ флаги (значит ни имени, ни
 * комментария), нулевой mtime, `XFL=2` и `OS=255` — «неизвестна». Это убирает
 * из файла метаданные машины: имя, время и код ОС в него не попадают.
 *
 * ЧЕГО ЭТО НЕ ДАЁТ: одинаковых байт на разных реализациях zlib. Тело потока
 * пишет `deflateRawSync`, и его вывод — свойство сборки, а не формата. Функция
 * годится, чтобы СОЗДАТЬ артефакт и собрать фикстуру; доказательством
 * тождества служит отпечаток файла, а не повторный вызов этой функции.
 */
export function canonicalGzip(bytes) {
  const header = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x02, 0xff])
  const body = deflateRawSync(bytes, { level: 9 })
  const tail = Buffer.alloc(8)
  tail.writeUInt32LE(crc32(bytes), 0)
  tail.writeUInt32LE(bytes.length % 2 ** 32, 4)
  return Buffer.concat([header, body, tail])
}

/**
 * Распаковка ПОД ПОТОЛКОМ.
 *
 * Потолок держит сам `zlib`: он останавливает поток, а не сообщает постфактум,
 * что буфер уже выделен. Своей проверки размера здесь нет намеренно — ни до
 * распаковки, ни после. Обе были бы неотличимы по поведению от
 * `maxOutputLength`: объявленный в хвосте `ISIZE` проверяет сам gzip, и архив,
 * у которого он лжёт, не читается вовсе. Второй сторож того же держался бы в
 * матрице строкой, которую нечем убить.
 */
export function readCanonicalGzip(compressed, limit = MAX_BASELINE_BYTES) {
  return gunzipSync(compressed, { maxOutputLength: limit })
}

/* ── Точная схема манифеста ───────────────────────────────────────────── */

const STRING = 'string'
const COUNT = 'count'
const POSITIVE = 'positive'
const BOOLEAN = 'boolean'
const DIGEST = 'digest'
const TIMESTAMP = 'timestamp'
const TALLY = 'tally'
const KEYS = 'keys'
const STRING_LIST = 'string-list'
const BY_POLICY = 'by-policy'
const ARTEFACT_PATH = 'artefact-path'

/** Каталог, в котором живут baseline. Артефакт вне его — чужой файл. */
export const BASELINE_DIR = 'docs/poi-intake/baselines'

/** Момент наблюдения: ISO-8601 с миллисекундами и `Z`. */
const TIMESTAMP_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/**
 * СХЕМА ОБЪЯВЛЕНА, А НЕ ПОДРАЗУМЕВАЕТСЯ.
 *
 * Прежняя сверка обходила ПОЛЯ МАНИФЕСТА и сравнивала их с описанием. Поле,
 * ИЗ манифеста удалённое, она не посещала вовсе — и молчала. Это fail-open в
 * чистом виде: чем меньше манифест утверждает, тем легче ему сойтись.
 *
 * Вторая редакция закрыла отсутствие и лишнее, но остановилась на верхнем
 * слое: `scope: {}`, `recordVersions: [123]`, `incompleteReasons: [123]`,
 * лишнее поле в `networkPolicy` и путь `../../outside.json.gz` она принимала —
 * «объект», «массив» и «строка» ей хватало. Аудит 25.08 предъявил все пять.
 * Поэтому проверка идёт ДО ЛИСТА: у каждого листа своя область значений, а
 * там, где область задаёт версия формата, лист помечен `BY_POLICY` и
 * проверяется политикой ниже — вторым списком здесь её не переписывают.
 */
const BASELINE_SHAPE = Object.freeze({
  contractVersion: STRING,
  label: STRING,
  note: STRING,
  artefact: {
    path: ARTEFACT_PATH,
    encoding: STRING,
    portalId: STRING,
    trackedInGit: BOOLEAN,
    compressedBytes: POSITIVE,
    compressedDigest: DIGEST,
    decompressedBytes: POSITIVE,
    decompressedDigest: DIGEST,
  },
  snapshot: {
    contractVersion: STRING,
    recordVersions: STRING_LIST,
    snapshotDigest: DIGEST,
    entryUrl: STRING,
    scope: BY_POLICY,
    complete: BOOLEAN,
    incompleteReasons: BY_POLICY,
    networkPolicy: BY_POLICY,
    observedAt: { robots: TIMESTAMP, catalogue: TIMESTAMP },
  },
  counters: KEYS,
  rejected: KEYS,
  topology: {
    catalogueTargets: COUNT,
    catalogueCollections: COUNT,
    directPois: COUNT,
    nestedCollections: STRING_LIST,
    collectionsTotal: COUNT,
    orderRecords: COUNT,
    records: COUNT,
    recordsWithSeveralPlacements: COUNT,
    collectionKinds: TALLY,
    placementKinds: TALLY,
    recordUrlFamilies: TALLY,
    factLeads: COUNT,
    omissions: COUNT,
  },
  integrity: {
    composedExchangeBound: COUNT,
    declaredExchanges: COUNT,
    collectionsWithoutOrder: COUNT,
    ordersWithoutCollection: COUNT,
    placedPoisWithoutRecord: COUNT,
    placedCollectionsWithoutEvidence: COUNT,
    recordsNeitherPlacedNorDirect: COUNT,
  },
  uncovered: {
    containerCollections: COUNT,
    containerChildPlacements: COUNT,
    rejectionsOfAnyKind: COUNT,
  },
})

/**
 * ПУТЬ АРТЕФАКТА — КАНОНИЧЕСКИЙ И ВНУТРЕННИЙ.
 *
 * Манифест указывает файл, который сверка ПРОЧИТАЕТ. Путь `../../outside.json.gz`
 * прошёл бы прежнюю проверку («непустая строка») и увёл бы чтение за пределы
 * репозитория: сверка сравнивала бы отпечатки чужого файла и объявляла бы
 * baseline сошедшимся.
 */
function assertArtefactPath(value, at) {
  assertNonEmptyString(value, at)
  if (value.includes('\\') || posixPath.isAbsolute(value) || posixPath.normalize(value) !== value) {
    throw new TypeError(
      `${at}: ожидается канонический относительный путь POSIX, получено ${JSON.stringify(value)}`)
  }
  if (posixPath.dirname(value) !== BASELINE_DIR) {
    throw new TypeError(
      `${at}: артефакт обязан лежать прямо в ${BASELINE_DIR}/, получено ${JSON.stringify(value)} — `
      + 'путь наружу читал бы чужой файл под видом baseline')
  }
  if (!value.endsWith('.json.gz')) {
    throw new TypeError(`${at}: ожидается имя вида …json.gz, получено ${JSON.stringify(value)}`)
  }
}

function assertShape(value, shape, at) {
  if (shape === BY_POLICY) return undefined
  if (shape === STRING) return assertNonEmptyString(value, at)
  if (shape === COUNT) return assertInteger(value, at, 0)
  if (shape === POSITIVE) return assertInteger(value, at, 1)
  if (shape === DIGEST) return assertSha256Value(value, at)
  if (shape === STRING_LIST) return assertStringList(value, at)
  if (shape === ARTEFACT_PATH) return assertArtefactPath(value, at)
  if (shape === TIMESTAMP) {
    assertNonEmptyString(value, at)
    if (!TIMESTAMP_SHAPE.test(value)) {
      throw new TypeError(`${at}: ожидается момент вида 2026-08-25T01:30:23.730Z`)
    }
    return undefined
  }
  if (shape === BOOLEAN) {
    if (typeof value !== 'boolean') throw new TypeError(`${at}: ожидается логическое значение`)
    return undefined
  }
  if (shape === TALLY || shape === KEYS) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError(`${at}: ожидается объект`)
    }
    if (shape === TALLY) {
      for (const [key, count] of Object.entries(value)) {
        assertNonEmptyString(key, `${at}: имя разряда`)
        assertInteger(count, `${at}.${key}`, 0)
      }
    }
    return undefined
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${at}: ожидается объект`)
  }
  assertExactKeys(value, Object.keys(shape), at)
  for (const [key, inner] of Object.entries(shape)) assertShape(value[key], inner, `${at}.${key}`)
  return undefined
}

/**
 * Поля, чья область значений задана ВЕРСИЕЙ ФОРМАТА снимка.
 *
 * Списки берутся из `VERSION_POLICY` и из контракта — тех же, которыми
 * пользуется производственная проверка снимка. Второго списка здесь нет
 * намеренно: манифест, объявляющий причину или потолок, которых формат не
 * знает, обязан отвергаться той же таблицей, а не похожей.
 */
function assertPolicyFields(manifest, policy, where) {
  const snapshot = manifest.snapshot

  assertExactKeys(snapshot.scope, SCOPE_KEYS, `${where}.snapshot.scope`)
  assertEnum(snapshot.scope.kind, SNAPSHOT_SCOPES, `${where}.snapshot.scope.kind`)
  if (snapshot.scope.kind === 'full') {
    if (snapshot.scope.limit !== null) {
      throw new TypeError(`${where}.snapshot.scope.limit: у полного обхода предела нет`)
    }
  } else {
    assertInteger(snapshot.scope.limit, `${where}.snapshot.scope.limit`, 1)
  }

  assertExactKeys(snapshot.networkPolicy, NETWORK_POLICY_KEYS, `${where}.snapshot.networkPolicy`)
  assertInteger(snapshot.networkPolicy.maxNetworkRequests,
    `${where}.snapshot.networkPolicy.maxNetworkRequests`, 1)
  assertInteger(snapshot.networkPolicy.maxRedirects,
    `${where}.snapshot.networkPolicy.maxRedirects`, 0)

  /* Формат записи у снимка ровно один: список версий записи — утверждение о
     нём, а не свободный перечень. `[123]` прежде проходил как «массив». */
  if (!snapshot.recordVersions.length) {
    throw new TypeError(`${where}.snapshot.recordVersions: пустой список версий записи`)
  }
  for (const [index, version] of snapshot.recordVersions.entries()) {
    if (version !== policy.record) {
      throw new TypeError(
        `${where}.snapshot.recordVersions[${index}]: ${JSON.stringify(version)} при формате записи `
        + `«${policy.record}» у снимка ${snapshot.contractVersion}`)
    }
  }

  if (!Array.isArray(snapshot.incompleteReasons)) {
    throw new TypeError(`${where}.snapshot.incompleteReasons: ожидается массив`)
  }
  const named = new Set()
  snapshot.incompleteReasons.forEach((reason, index) => {
    const at = `${where}.snapshot.incompleteReasons[${index}]`
    if (!reason || typeof reason !== 'object' || Array.isArray(reason)) {
      throw new TypeError(`${at}: ожидается объект причины`)
    }
    assertExactKeys(reason, REASON_KEYS, at)
    assertEnum(reason.code, policy.incompleteReasons, `${at}.code`)
    assertInteger(reason.count, `${at}.count`, 1)
    if (named.has(reason.code)) throw new TypeError(`${at}.code: причина названа дважды`)
    named.add(reason.code)
  })

  /*
   * ── РАЗРЯДЫ ПЕРЕЧНЕЙ И КЛЮЧИ — ТОЖЕ ОБЛАСТЬ ЗНАЧЕНИЙ ──
   *
   * `TALLY` проверял только ЧИСЛА, и манифест с разрядами `{ invented: 151 }`
   * проходил: имена разрядов ничем не были связаны с форматом. Аудит 25.08
   * предъявил сразу три таких перечня и `nestedCollections: ['garbage']`.
   * Агрегатная сверка поймала бы это позже — расхождением со снимком, — но
   * публичный валидатор обязан быть не слабее объявленного контракта.
   */
  const tallyDomain = (tally, allowed, at) => {
    for (const key of Object.keys(tally)) {
      if (!allowed.includes(key)) {
        throw new TypeError(
          `${at}: разряд «${key}» формату ${snapshot.contractVersion} неизвестен — `
          + `допустимы [${allowed.join(', ')}]`)
      }
    }
  }
  const topology = manifest.topology
  tallyDomain(topology.collectionKinds, policy.collectionKind ? COLLECTION_KINDS : [],
    `${where}.topology.collectionKinds`)
  tallyDomain(topology.placementKinds, policy.placementKinds, `${where}.topology.placementKinds`)
  tallyDomain(topology.recordUrlFamilies, policy.urlFamilies, `${where}.topology.recordUrlFamilies`)
  /* Ключ вложенной коллекции обязан ВЫВОДИТЬСЯ из канонического адреса: строка
     «garbage» ключом не является, сколько бы она ни выглядела как строка.
     Сверять семейство с политикой здесь незачем — формат снимка ровно один, и
     все его семейства разрешены; проверка была бы строкой, которую нечем
     убить. */
  topology.nestedCollections.forEach((key, index) => {
    const at = `${where}.topology.nestedCollections[${index}]`
    const parsed = sourceKeyFamily(key)
    if (!parsed.ok) {
      throw new TypeError(`${at}: ${JSON.stringify(key)} не выводится ни из одного канонического адреса`)
    }
  })

  /* `complete` — вывод, а не мнение: полный обход без причин неполноты. */
  const expected = snapshot.scope.kind === 'full' && snapshot.incompleteReasons.length === 0
  if (snapshot.complete !== expected) {
    throw new TypeError(
      `${where}.snapshot.complete: объявлено ${snapshot.complete}, а из состава следует ${expected}`)
  }
}

/**
 * Манифест baseline: точная форма и внутренняя согласованность.
 *
 * Наборы счётчиков и каналов отказа берутся ИЗ ПОЛИТИКИ версии снимка, а не
 * переписаны сюда вторым списком: иначе манифест мог бы объявлять счётчик,
 * которого формат не знает, и сверка этого бы не заметила.
 */
export function assertDiscoveryBaseline(manifest, where = DISCOVERY_BASELINE_SPEC) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new TypeError(`${where}: ожидается объект манифеста`)
  }
  if (manifest.contractVersion !== DISCOVERY_BASELINE_SPEC) {
    throw new TypeError(
      `${where}.contractVersion: ожидается «${DISCOVERY_BASELINE_SPEC}», `
      + `получено ${JSON.stringify(manifest.contractVersion)} — развитие формата идёт через новую `
      + 'версию или мигратор, а не через частичное сравнение')
  }
  assertShape(manifest, BASELINE_SHAPE, where)

  assertBaselineSnapshotVersion(manifest.snapshot.contractVersion, `${where}.snapshot.contractVersion`)
  const policy = VERSION_POLICY[BASELINE_SNAPSHOT_SPEC]
  assertPolicyFields(manifest, policy, where)
  assertExactKeys(manifest.counters, policy.counterKeys, `${where}.counters`)
  for (const key of policy.counterKeys) assertInteger(manifest.counters[key], `${where}.counters.${key}`, 0)
  assertExactKeys(manifest.rejected, policy.rejectionChannels, `${where}.rejected`)
  for (const key of policy.rejectionChannels) {
    assertInteger(manifest.rejected[key], `${where}.rejected.${key}`, 0)
  }
  if (manifest.artefact.encoding !== 'gzip') {
    throw new TypeError(`${where}.artefact.encoding: известно только «gzip»`)
  }
  if (manifest.artefact.trackedInGit !== true) {
    throw new TypeError(
      `${where}.artefact.trackedInGit: baseline вне Git — это ссылка на файл, который можно потерять`)
  }
  if (manifest.artefact.decompressedBytes > MAX_BASELINE_BYTES) {
    throw new TypeError(
      `${where}.artefact.decompressedBytes: ${manifest.artefact.decompressedBytes} `
      + `при потолке ${MAX_BASELINE_BYTES}`)
  }
  return manifest
}

/* ── Описание снимка ──────────────────────────────────────────────────── */

const tally = (values) => {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/**
 * Нижняя граница обменов, посчитанная ИЗ СОСТАВА снимка.
 *
 * Повтор арифметики контракта намеренный: контракт требует, чтобы счётчик был
 * не меньше границы, а baseline закрепляет, что у ЭТОГО прогона они совпали.
 */
export function composedExchangeBound(snapshot) {
  const directPoiKeys = new Set(snapshot.catalogueTargetEvidence
    .filter((row) => row.evidence.pageRole === 'poi')
    .map((row) => row.sourceKey))
  const beyondDirect = snapshot.records
    .filter((record) => !directPoiKeys.has(record.sourceKey)).length
  return 2
    + snapshot.catalogueTargetEvidence.length
    + snapshot.nestedCollectionEvidence.length
    + beyondDirect
}

/**
 * Всё, что baseline утверждает о снимке. Чистая функция от снимка.
 *
 * ВЕРСИЯ ПРОВЕРЯЕТСЯ ЗДЕСЬ ЖЕ. Описание читает `nestedCollectionEvidence`,
 * `collectionKind` и прочее, чего у замороженных форматов нет: на настоящем
 * снимке `v1` оно падало сырым `Cannot read properties of undefined`. Публичная
 * функция обязана отвергать неподдержанный формат ДЕТЕРМИНИРОВАННО и поимённо,
 * а не разваливаться на первом отсутствующем поле.
 */
export function describeDiscoveryBaseline(snapshot) {
  assertBaselineSnapshotVersion(snapshot?.contractVersion,
    `${DISCOVERY_BASELINE_SPEC}.snapshot.contractVersion`)
  const catalogueCollections = snapshot.catalogueTargetEvidence
    .filter((row) => row.evidence.pageRole === 'collection')
    .map((row) => row.sourceKey)
  const directPois = snapshot.catalogueTargetEvidence
    .filter((row) => row.evidence.pageRole === 'poi')
    .map((row) => row.sourceKey)
  const nested = snapshot.nestedCollectionEvidence.map((row) => row.sourceKey)
  const recordKeys = new Set(snapshot.records.map((record) => record.sourceKey))
  const placedPoiKeys = new Set(snapshot.orderRecords.flatMap((row) => orderedPoiKeys(row)))
  const placedCollectionKeys = new Set(
    snapshot.orderRecords.flatMap((row) => orderedCollectionKeys(row)))
  const collections = new Set([...catalogueCollections, ...nested])
  const orderKeys = new Set(snapshot.orderRecords.map((row) => row.destinationSourceKey))

  return {
    snapshot: {
      contractVersion: snapshot.contractVersion,
      recordVersions: [...new Set(snapshot.records.map((r) => r.contractVersion))].sort(),
      snapshotDigest: snapshot.snapshotDigest,
      entryUrl: snapshot.entryUrl,
      scope: snapshot.scope,
      complete: snapshot.complete,
      incompleteReasons: snapshot.incompleteReasons,
      networkPolicy: snapshot.networkPolicy,
      observedAt: {
        robots: snapshot.robotsEvidence.observedAt,
        catalogue: snapshot.catalogueEvidence.observedAt,
      },
    },
    counters: { ...snapshot.counters },
    rejected: Object.fromEntries(
      Object.entries(snapshot.rejected).map(([channel, rows]) => [channel, rows.length])),
    topology: {
      catalogueTargets: snapshot.catalogueTargetEvidence.length,
      catalogueCollections: catalogueCollections.length,
      directPois: directPois.length,
      nestedCollections: nested,
      collectionsTotal: collections.size,
      orderRecords: snapshot.orderRecords.length,
      records: snapshot.records.length,
      recordsWithSeveralPlacements: snapshot.records
        .filter((record) => record.placements.length > 1).length,
      collectionKinds: tally(snapshot.orderRecords.map((row) => row.collectionKind)),
      placementKinds: tally(snapshot.records.flatMap((r) => r.placements.map((p) => p.kind))),
      recordUrlFamilies: tally(snapshot.records.map((r) => canonicalDiscoveryUrl(r.url).family)),
      factLeads: snapshot.records.reduce((sum, r) => sum + r.factLeads.length, 0),
      omissions: snapshot.records.reduce((sum, r) => sum + r.omissions.length, 0),
    },
    integrity: {
      composedExchangeBound: composedExchangeBound(snapshot),
      declaredExchanges: snapshot.counters.networkRequests,
      collectionsWithoutOrder: [...collections].filter((key) => !orderKeys.has(key)).length,
      ordersWithoutCollection: [...orderKeys].filter((key) => !collections.has(key)).length,
      placedPoisWithoutRecord: [...placedPoiKeys].filter((key) => !recordKeys.has(key)).length,
      placedCollectionsWithoutEvidence:
        [...placedCollectionKeys].filter((key) => !collections.has(key)).length,
      recordsNeitherPlacedNorDirect: [...recordKeys]
        .filter((key) => !placedPoiKeys.has(key) && !directPois.includes(key)).length,
    },
    /* Ветвь грамматики, которую живой корпус не задел, baseline НЕ
       подтверждает — и молчать об этом нельзя. */
    uncovered: {
      containerCollections: snapshot.orderRecords
        .filter((row) => row.collectionKind === 'container').length,
      containerChildPlacements: snapshot.records
        .flatMap((r) => r.placements).filter((p) => p.kind === 'containerChild').length,
      rejectionsOfAnyKind: Object.values(snapshot.rejected)
        .reduce((sum, rows) => sum + rows.length, 0),
    },
  }
}

/**
 * Сравнение манифеста с описанием — ДВУСТОРОННЕЕ.
 *
 * Обходятся ключи ОБЕИХ сторон, а не только ожидаемой: иначе поле, из манифеста
 * пропавшее, не посещалось бы и расхождением не считалось.
 */
export function baselineDifferences(expected, actual, at = '') {
  const out = []
  const keys = [...new Set([...Object.keys(expected ?? {}), ...Object.keys(actual ?? {})])].sort()
  for (const key of keys) {
    const here = at ? `${at}.${key}` : key
    const mine = expected?.[key]
    const other = actual?.[key]
    const bothPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    if (bothPlain(mine) && bothPlain(other)) {
      out.push(...baselineDifferences(mine, other, here))
      continue
    }
    if (JSON.stringify(mine) !== JSON.stringify(other)) {
      out.push(`${here}: в манифесте ${JSON.stringify(mine)}, у снимка ${JSON.stringify(other)}`)
    }
  }
  return out
}

/** Оба представления артефакта и отпечаток снимка — три разных утверждения. */
export function artefactDifferences(manifest, { compressed, decompressed, snapshot }) {
  const out = []
  const declared = manifest.artefact
  if (compressed.length !== declared.compressedBytes) {
    out.push(`artefact.compressedBytes: в манифесте ${declared.compressedBytes}, у файла ${compressed.length}`)
  }
  const compressedDigest = sha256(compressed)
  if (compressedDigest !== declared.compressedDigest) {
    out.push(`artefact.compressedDigest: в манифесте ${declared.compressedDigest}, у файла ${compressedDigest}`)
  }
  if (decompressed.length !== declared.decompressedBytes) {
    out.push(`artefact.decompressedBytes: в манифесте ${declared.decompressedBytes}, распаковано ${decompressed.length}`)
  }
  const decompressedDigest = sha256(decompressed)
  if (decompressedDigest !== declared.decompressedDigest) {
    out.push(`artefact.decompressedDigest: в манифесте ${declared.decompressedDigest}, распаковано ${decompressedDigest}`)
  }
  if (snapshot && snapshot.snapshotDigest !== manifest.snapshot.snapshotDigest) {
    out.push(`snapshot.snapshotDigest: в манифесте ${manifest.snapshot.snapshotDigest}, `
      + `у снимка ${snapshot.snapshotDigest}`)
  }
  return out
}

/** Снимок нужного портала из распакованного отчёта — портал НАЗЫВАЕТСЯ. */
export function selectPortalSnapshot(report, portalId) {
  const portal = report?.portals?.find((row) => row.portalId === portalId)
  if (!portal?.discovery) {
    const seen = (report?.portals ?? []).map((row) => row.portalId).join(', ') || '—'
    throw new TypeError(
      `${DISCOVERY_BASELINE_SPEC}: портала «${portalId}» со снимком в отчёте нет (есть: ${seen}) — `
      + 'брать первый попавшийся нельзя: снимок другого портала прошёл бы сверку как свой')
  }
  return portal.discovery
}

export { sha256 as baselineDigest }
