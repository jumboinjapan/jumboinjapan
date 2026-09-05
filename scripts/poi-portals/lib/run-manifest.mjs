/**
 * Манифест прогона коллектора — `run-manifest/v2` — и pre-write drift gate.
 *
 * ЗАЧЕМ. До 10f-Q отчёт коллектора нёс версию политики матчера, а всё
 * остальное, от чего зависит результат, — точные байты выгрузки источника,
 * файл существующих POI, снимок базы, файл имён, реестр таксономии, коммит
 * кода — нигде не фиксировалось. Сравнение с прежним прогоном (`--monitor`)
 * считалось ПОСЛЕ `writeRun`: дрейф входа или политики обнаруживался, когда
 * запись уже состоялась (воспроизведено: tmp/10f-q-r0-repro-p08-OLD-*.json —
 * `monitor.removed = 1`, политика несравнима, а `write.outcomes.created = 1`).
 *
 * ЧТО ЭТО. Один детерминированный объект на прогон: чем именно и по каким
 * правилам получен результат. Производитель — `collect-pois.mjs` (main);
 * потребитель — он же, в роли gate: перед записью текущий манифест сверяется
 * с манифестом ЭТАЛОННОГО прогона (прежний отчёт из `--monitor`), и любой
 * дрейф компонента — входа, базы, политики, таксономии, имён, кода —
 * называется отдельным исходом и останавливает прогон ДО создания store и до
 * первого эффекта. Post-run сравнение (`diffAgainstSnapshot`) остаётся
 * отчётом и допуска не даёт.
 *
 * ТОЖДЕСТВО — ТОЛЬКО БАЙТАМИ. Ни имя файла, ни время, ни счётчик тождеством
 * не являются: у файла в манифесте есть `file` для человека и `digest` для
 * сравнения; сравнение читает digest. Вход источника — SHA-256 сырого
 * payload (если адаптер его отдал) и SHA-256 канонического набора кандидатов;
 * канонический набор сравним только при одной версии адаптера (ADR-0002 § 8).
 *
 * ЧИСТЫЙ МОДУЛЬ: ни файлов, ни сети, ни часов. Все значения — снаружи.
 * Строгие формы и канонические байты — из `scripts/lib/canonical-contract.mjs`,
 * своей сериализации здесь нет.
 */
import { RAW_FILE_BYTES_SPEC, sha256Bytes, DIGEST_ALGORITHM } from '../../lib/byte-digest.mjs'
import {
  assertCanonicalInstant,
  assertCodeIdentity,
  assertDigestShape,
  assertExactKeys,
  assertInteger,
  assertNonEmptyString,
  assertSha256Value,
  assertStrictOwnKeys,
  canonicalJsonBytes,
  deepFreeze,
  digest,
  isPlainObject,
} from '../../lib/canonical-contract.mjs'

/**
 * ВЕРСИЯ КОНТРАКТА МАНИФЕСТА. Форма менялась дважды, и оба раза несовместимо:
 * R1 сделал `code.tree` обязательным, R2 заменил его графом импортов, добавил
 * `code.deps` и `registries`. Манифест прежней формы под этой версией не
 * читается — и это единственный честный исход: селектор версии обязан
 * отвергать чужую форму, а не спотыкаться об отсутствующее поле (10f-Q R2,
 * находка аудита 3 — под `run-manifest/v1` жили два несовместимых формата).
 */
export const RUN_MANIFEST_SPEC = 'run-manifest/v2'
/** Домен digest канонического набора кандидатов одного портала. */
export const CANDIDATE_SET_SPEC = 'poi-candidate-set/v1'
/** Домен digest графа исполняемого кода конвейера. */
export const CODE_GRAPH_SPEC = 'poi-code-graph/v1'
/** Домен digest ЗНАЧЕНИЯ реестра — того экземпляра, который загрузил процесс. */
export const REGISTRY_VALUE_SPEC = 'poi-registry-value/v1'

/** Режимы прогона. `write` — единственный с эффектом в живой базе. */
export const RUN_MODES = Object.freeze(['read-only', 'dry-write', 'snapshot', 'write'])

export const MANIFEST_KEYS = Object.freeze([
  'contractVersion', 'startedAt', 'mode', 'code', 'intakeContract', 'registries', 'matcherPolicy',
  'portals', 'base', 'names', 'manifestDigest',
])
/** Ключи одной записи реестра в манифесте. */
export const MANIFEST_REGISTRY_KEYS = Object.freeze(['id', 'version', 'valueDigest', 'entries'])
export const MANIFEST_PORTAL_KEYS = Object.freeze(['portalId', 'adapter', 'input'])
export const MANIFEST_INPUT_KEYS = Object.freeze(['rawPayload', 'canonical'])
export const MANIFEST_FILE_KEYS = Object.freeze(['file', 'digest', 'bytes'])

/** Компоненты, дрейф которых gate называет отдельно. Закрытый список. */
export const DRIFT_COMPONENTS = Object.freeze([
  'portals', 'input', 'base', 'matcherPolicy', 'registries', 'names', 'code', 'intakeContract',
])

/**
 * Тождество ИСПОЛНЯЕМОГО КОДА конвейера: SHA-256 пар «путь → digest файла».
 *
 * Коммита мало (10f-Q R1, находка 2): рабочее дерево можно изменить, не меняя
 * `HEAD`, и `dirty: true` без сравнения самих байтов говорит только «что-то
 * менялось», а не «менялось ли то, что исполняется».
 *
 * Состава по правилу тоже мало (10f-Q R2, находка 1): правило по каталогам —
 * тот же перечень известных имён, только записанный иначе, и устаревает оно
 * так же молча. Файлы приходят СНАРУЖИ, обходом ФАКТИЧЕСКОГО ГРАФА ИМПОРТОВ от
 * точки входа (`lib/code-graph.mjs`): в отпечаток входит ровно то, что процесс
 * способен загрузить, включая JSON-реестры. Этот модуль файловой системы не
 * касается — он только считает.
 *
 * @param files [{path: string, bytes: Uint8Array}] — пути относительно корня репозитория
 */
export function codeGraphIdentity(files) {
  if (!Array.isArray(files) || !files.length) {
    throw new TypeError(`${CODE_GRAPH_SPEC}: ожидается непустой список файлов исполняемого кода`)
  }
  const seen = new Set()
  const entries = files.map(({ path: filePath, bytes }, i) => {
    assertNonEmptyString(filePath, `${CODE_GRAPH_SPEC}: файл №${i + 1}.path`)
    if (!(bytes instanceof Uint8Array)) throw new TypeError(`${CODE_GRAPH_SPEC}: файл «${filePath}» без байтов`)
    if (seen.has(filePath)) throw new TypeError(`${CODE_GRAPH_SPEC}: путь «${filePath}» встречается более одного раза`)
    seen.add(filePath)
    return { path: filePath, digest: sha256Bytes(bytes) }
  })
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return {
    spec: CODE_GRAPH_SPEC,
    digest: sha256Bytes(canonicalJsonBytes(entries, CODE_GRAPH_SPEC)),
    files: entries.length,
  }
}

/**
 * Тождество ЗНАЧЕНИЯ реестра — того экземпляра, который загрузил процесс.
 *
 * Байты файла и значение отвечают на разные вопросы (10f-Q R2, находка 2).
 * Байты говорят, что лежит на диске; значение — по чему на самом деле
 * принимались решения. До R2 подписывались только байты таксономии, и читались
 * они ОТДЕЛЬНЫМ поздним чтением файла — то есть подписан мог быть не тот
 * экземпляр, который уже отработал: реестр грузится статическим импортом при
 * загрузке модуля. Переформатирование файла сдвигало подпись, не меняя
 * значения; а реестр решений владельца о координатах своей компоненты не имел
 * вовсе, и его подмена в манифесте не отражалась.
 *
 * Здесь считается канонический JSON переданного ЗНАЧЕНИЯ. Вызывающий обязан
 * передать тот самый объект, который отдал загрузчик, а не перечитанный файл.
 */
export function registryValueIdentity({ id, version, value, entries }) {
  assertNonEmptyString(id, `${REGISTRY_VALUE_SPEC}.id`)
  assertNonEmptyString(version, `${REGISTRY_VALUE_SPEC}(${id}).version`)
  if (value === null || typeof value !== 'object') {
    throw new TypeError(`${REGISTRY_VALUE_SPEC}(${id}): значение реестра обязано быть объектом, получено ${value === null ? 'null' : typeof value}`)
  }
  assertInteger(entries, `${REGISTRY_VALUE_SPEC}(${id}).entries`, 0)
  return {
    id,
    version,
    valueDigest: sha256Bytes(canonicalJsonBytes(value, `${REGISTRY_VALUE_SPEC}(${id})`)),
    entries,
  }
}

/** Исходы gate. */
export const GATE_PASS = 'PASS'
export const GATE_BLOCK = 'BLOCK'
export const GATE_NOT_ARMED = 'NOT_ARMED'

/**
 * Тождество набора кандидатов одного портала: SHA-256 канонического JSON
 * отсортированных по `sourceKey` кандидатов и отказов в ключе. Считается по
 * тому, что вернул адаптер, — ДО того как конвейер что-либо в кандидатах
 * изменит. Уникальность ключей проверяется здесь же: набор с повтором ключа
 * тождества не имеет.
 */
export function candidateSetIdentity({ candidates, unkeyed = [] }) {
  if (!Array.isArray(candidates)) throw new TypeError(`${CANDIDATE_SET_SPEC}: candidates обязан быть массивом`)
  if (!Array.isArray(unkeyed)) throw new TypeError(`${CANDIDATE_SET_SPEC}: unkeyed обязан быть массивом`)
  const seen = new Set()
  candidates.forEach((candidate, i) => {
    if (!isPlainObject(candidate)) throw new TypeError(`${CANDIDATE_SET_SPEC}: кандидат №${i + 1} не объект`)
    assertNonEmptyString(candidate.sourceKey, `${CANDIDATE_SET_SPEC}: кандидат №${i + 1}.sourceKey`)
    if (seen.has(candidate.sourceKey)) {
      throw new TypeError(`${CANDIDATE_SET_SPEC}: ключ источника «${candidate.sourceKey}» встречается более одного раза`)
    }
    seen.add(candidate.sourceKey)
  })
  const sorted = [...candidates].sort((a, b) => (a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0))
  const bytes = canonicalJsonBytes({ candidates: sorted, unkeyed }, CANDIDATE_SET_SPEC)
  return {
    spec: CANDIDATE_SET_SPEC,
    digest: sha256Bytes(bytes),
    candidates: candidates.length,
    unkeyed: unkeyed.length,
  }
}

/** Тождество файла: имя — для человека, digest и размер — для сравнения. */
export function fileIdentity(file, bytes) {
  assertNonEmptyString(file, 'fileIdentity.file')
  if (!(bytes instanceof Uint8Array)) throw new TypeError('fileIdentity: ожидаются байты файла')
  return { file, digest: sha256Bytes(bytes), bytes: bytes.length }
}

const manifestBodyBytes = (body) => canonicalJsonBytes(body, RUN_MANIFEST_SPEC)

/**
 * Собирает манифест. Все части — уже вычисленные значения; функция ничего
 * не читает. Возвращает глубоко замороженный объект с `manifestDigest`.
 */
export function buildRunManifest({
  startedAt, mode, code, intakeContract, registries, matcherPolicy, portals, base, names,
}) {
  const body = {
    contractVersion: RUN_MANIFEST_SPEC,
    startedAt,
    mode,
    code,
    intakeContract,
    registries,
    matcherPolicy,
    portals,
    base,
    names,
  }
  assertManifestBody(body)
  const manifest = {
    ...body,
    manifestDigest: digest(sha256Bytes(manifestBodyBytes(body)), DIGEST_ALGORITHM, RUN_MANIFEST_SPEC),
  }
  return deepFreeze(manifest)
}

/**
 * Проверка формы — строгая, fail-closed, по собственным ключам. Версия
 * читается через собственный data-descriptor: значение из прототипа или
 * getter версией не считается.
 */
function assertManifestBody(body) {
  const where = RUN_MANIFEST_SPEC
  if (!isPlainObject(body)) throw new TypeError(`${where}: манифест обязан быть простым объектом`)
  const versionDescriptor = Object.getOwnPropertyDescriptor(body, 'contractVersion')
  if (!versionDescriptor || !('value' in versionDescriptor)) {
    throw new TypeError(`${where}: contractVersion обязан быть собственным значением`)
  }
  if (versionDescriptor.value !== RUN_MANIFEST_SPEC) {
    throw new TypeError(`${where}: неизвестная версия манифеста ${JSON.stringify(versionDescriptor.value)}; принимается только ${RUN_MANIFEST_SPEC}`)
  }
  assertExactKeys(body, MANIFEST_KEYS.filter((k) => k !== 'manifestDigest'), where)
  assertCanonicalInstant(body.startedAt, `${where}.startedAt`)
  if (!RUN_MODES.includes(body.mode)) {
    throw new TypeError(`${where}.mode: ожидается один из ${RUN_MODES.join(', ')}, получено ${JSON.stringify(body.mode)}`)
  }
  /* ЧЕТЫРЕ РАЗНЫХ УТВЕРЖДЕНИЯ О КОДЕ, и ни одно не выводится из остальных:
     коммит (что объявлено), грязь (что дерево отличается от коммита), граф
     (байты того, что процесс способен загрузить) и замок зависимостей (версии
     кода вне дерева репозитория). */
  assertExactKeys(body.code, ['commit', 'dirty', 'graph', 'deps'], `${where}.code`)
  assertCodeIdentity({ commit: body.code.commit, dirty: body.code.dirty })
  assertExactKeys(body.code.graph, ['spec', 'digest', 'files'], `${where}.code.graph`)
  if (body.code.graph.spec !== CODE_GRAPH_SPEC) {
    throw new TypeError(`${where}.code.graph.spec: ожидается ${CODE_GRAPH_SPEC}`)
  }
  assertSha256Value(body.code.graph.digest, `${where}.code.graph.digest`)
  assertInteger(body.code.graph.files, `${where}.code.graph.files`, 1)
  assertExactKeys(body.code.deps, MANIFEST_FILE_KEYS, `${where}.code.deps`)
  assertFileIdentity(body.code.deps, `${where}.code.deps`)
  assertNonEmptyString(body.intakeContract, `${where}.intakeContract`)

  /* РЕЕСТРЫ — ПО ЗНАЧЕНИЮ, СПИСКОМ И В ПОРЯДКЕ СОРТИРОВКИ. Список открытый по
     составу и закрытый по форме: новый реестр входит записью, а не новым полем
     манифеста, — иначе каждый следующий реестр требовал бы новой версии
     контракта, и его просто не добавили бы. */
  if (!Array.isArray(body.registries) || !body.registries.length) {
    throw new TypeError(`${where}.registries: ожидается непустой массив реестров`)
  }
  const registryIds = new Set()
  body.registries.forEach((registry, i) => {
    const at = `${where}.registries[${i}]`
    assertExactKeys(registry, MANIFEST_REGISTRY_KEYS, at)
    assertNonEmptyString(registry.id, `${at}.id`)
    if (registryIds.has(registry.id)) throw new TypeError(`${at}: реестр «${registry.id}» повторяется`)
    registryIds.add(registry.id)
    assertNonEmptyString(registry.version, `${at}.version`)
    assertSha256Value(registry.valueDigest, `${at}.valueDigest`)
    assertInteger(registry.entries, `${at}.entries`, 0)
  })
  const sortedRegistryIds = [...registryIds].sort()
  body.registries.forEach((registry, i) => {
    if (registry.id !== sortedRegistryIds[i]) {
      throw new TypeError(`${where}.registries: реестры обязаны идти в отсортированном порядке — порядок входит в подпись`)
    }
  })
  assertExactKeys(body.matcherPolicy, ['version', 'digest', 'lexiconDigest'], `${where}.matcherPolicy`)
  assertNonEmptyString(body.matcherPolicy.version, `${where}.matcherPolicy.version`)
  assertSha256Value(body.matcherPolicy.digest, `${where}.matcherPolicy.digest`)
  assertSha256Value(body.matcherPolicy.lexiconDigest, `${where}.matcherPolicy.lexiconDigest`)

  if (!Array.isArray(body.portals) || !body.portals.length) {
    throw new TypeError(`${where}.portals: ожидается непустой массив`)
  }
  const ids = new Set()
  body.portals.forEach((portal, i) => {
    const at = `${where}.portals[${i}]`
    assertExactKeys(portal, MANIFEST_PORTAL_KEYS, at)
    assertNonEmptyString(portal.portalId, `${at}.portalId`)
    if (ids.has(portal.portalId)) throw new TypeError(`${at}: портал «${portal.portalId}» повторяется`)
    ids.add(portal.portalId)
    assertExactKeys(portal.adapter, ['id', 'version'], `${at}.adapter`)
    assertNonEmptyString(portal.adapter.id, `${at}.adapter.id`)
    if (portal.adapter.version !== null) assertNonEmptyString(portal.adapter.version, `${at}.adapter.version`)
    assertExactKeys(portal.input, MANIFEST_INPUT_KEYS, `${at}.input`)
    if (portal.input.rawPayload !== null) {
      assertExactKeys(portal.input.rawPayload, ['digest', 'bytes', 'spec'], `${at}.input.rawPayload`)
      assertSha256Value(portal.input.rawPayload.digest, `${at}.input.rawPayload.digest`)
      assertInteger(portal.input.rawPayload.bytes, `${at}.input.rawPayload.bytes`)
      if (portal.input.rawPayload.spec !== RAW_FILE_BYTES_SPEC) {
        throw new TypeError(`${at}.input.rawPayload.spec: ожидается ${RAW_FILE_BYTES_SPEC}`)
      }
    }
    assertExactKeys(portal.input.canonical, ['spec', 'digest', 'candidates', 'unkeyed'], `${at}.input.canonical`)
    if (portal.input.canonical.spec !== CANDIDATE_SET_SPEC) {
      throw new TypeError(`${at}.input.canonical.spec: ожидается ${CANDIDATE_SET_SPEC}`)
    }
    assertSha256Value(portal.input.canonical.digest, `${at}.input.canonical.digest`)
    assertInteger(portal.input.canonical.candidates, `${at}.input.canonical.candidates`)
    assertInteger(portal.input.canonical.unkeyed, `${at}.input.canonical.unkeyed`)
  })
  /* Порядок порталов входит в байты: он задан реестром, а не входом. */
  const sortedIds = [...ids].sort()
  body.portals.forEach((portal, i) => {
    if (portal.portalId !== sortedIds[i]) {
      throw new TypeError(`${where}.portals: порталы обязаны идти в отсортированном порядке — порядок входит в подпись`)
    }
  })

  assertExactKeys(body.base, ['existing', 'snapshot'], `${where}.base`)
  for (const kind of ['existing', 'snapshot']) {
    const entry = body.base[kind]
    if (entry === null) continue
    const at = `${where}.base.${kind}`
    assertExactKeys(entry, [...MANIFEST_FILE_KEYS, 'records', 'withSourceKey'], at)
    assertFileIdentity(entry, at)
    assertInteger(entry.records, `${at}.records`)
    assertInteger(entry.withSourceKey, `${at}.withSourceKey`)
  }
  if (body.names !== null) {
    assertExactKeys(body.names, MANIFEST_FILE_KEYS, `${where}.names`)
    assertFileIdentity(body.names, `${where}.names`)
  }
}

function assertFileIdentity(entry, where) {
  assertNonEmptyString(entry.file, `${where}.file`)
  assertSha256Value(entry.digest, `${where}.digest`)
  assertInteger(entry.bytes, `${where}.bytes`)
}

/**
 * Полная проверка готового манифеста, включая пересчёт digest. Принимает
 * разобранный JSON (например, из прежнего отчёта) и ничему в нём не верит.
 */
export function assertRunManifest(manifest) {
  const where = RUN_MANIFEST_SPEC
  if (!isPlainObject(manifest)) throw new TypeError(`${where}: манифест обязан быть простым объектом`)
  /* СЫРОЙ ВХОД — ДО ПРОЕКЦИИ. Деструктуризация ниже скопировала бы значение
     getter'а как обычное свойство, и проверка descriptor'а по копии ничего бы
     не доказала. Символьные, неперечисляемые и accessor-свойства — отказ. */
  assertStrictOwnKeys(manifest, where)
  const versionDescriptor = Object.getOwnPropertyDescriptor(manifest, 'contractVersion')
  if (!versionDescriptor || !('value' in versionDescriptor)) {
    throw new TypeError(`${where}: contractVersion обязан быть собственным значением`)
  }
  /* ВЕРСИЯ — ПЕРВОЙ, ДО СОСТАВА ПОЛЕЙ (10f-Q R2, находка аудита 3). Манифест
     чужой формы обязан быть отвергнут ПО ВЕРСИИ, а не по недостающему полю:
     иначе сообщение говорит «нет поля X» там, где правда — «это другой
     формат», и ровно так под `run-manifest/v1` уживались две формы. */
  if (versionDescriptor.value !== RUN_MANIFEST_SPEC) {
    throw new TypeError(`${where}: неизвестная версия манифеста ${JSON.stringify(versionDescriptor.value)}; принимается только ${RUN_MANIFEST_SPEC}`)
  }
  assertExactKeys(manifest, MANIFEST_KEYS, where)
  const { manifestDigest, ...body } = manifest
  assertManifestBody(body)
  assertDigestShape(manifestDigest, RUN_MANIFEST_SPEC, `${where}.manifestDigest`)
  const recomputed = sha256Bytes(manifestBodyBytes(body))
  if (manifestDigest.value !== recomputed) {
    throw new TypeError(`${where}.manifestDigest: не совпадает с содержимым манифеста — манифест изменён после подписи`)
  }
  return manifest
}

/**
 * Сравнение двух проверенных манифестов покомпонентно. Каждый компонент —
 * своя запись в `drift`; ни одна не маскирует другую. Режим и момент начала
 * НЕ сравниваются: эталон по определению другой прогон.
 */
export function compareRunManifests(current, reference) {
  const drift = []
  const note = (component, kind, previous, now) => drift.push({ component, kind, previous, current: now })

  if (current.intakeContract !== reference.intakeContract) {
    note('intakeContract', 'intakeContractDrift', reference.intakeContract, current.intakeContract)
  }
  /* Три независимых наблюдения о коде: коммит, чистота дерева и фактические
     байты цепочки. Совпадение коммита ничего не говорит о двух остальных. */
  if (current.code.commit !== reference.code.commit) {
    note('code', 'codeDrift', reference.code.commit, current.code.commit)
  }
  if (current.code.graph.digest !== reference.code.graph.digest) {
    note('code', 'codeGraphDrift',
      `${reference.code.graph.digest} (${reference.code.graph.files} файлов)`,
      `${current.code.graph.digest} (${current.code.graph.files} файлов)`)
  }
  if (current.code.dirty !== reference.code.dirty) {
    note('code', 'codeDirtyDrift', reference.code.dirty, current.code.dirty)
  }
  if (current.code.deps.digest !== reference.code.deps.digest) {
    note('code', 'codeDepsDrift', reference.code.deps.digest, current.code.deps.digest)
  }
  /* РЕЕСТРЫ. Состав сравнивается отдельно от содержимого: исчезнувший реестр —
     не «совпал», а другой прогон. Каждый оставшийся сравнивается по ЗНАЧЕНИЮ,
     и ни один не маскирует другой. */
  const currentRegistryIds = current.registries.map((r) => r.id)
  const referenceRegistryIds = reference.registries.map((r) => r.id)
  if (currentRegistryIds.join(',') !== referenceRegistryIds.join(',')) {
    note('registries', 'registrySetDrift', referenceRegistryIds, currentRegistryIds)
  } else {
    for (const registry of current.registries) {
      const before = reference.registries.find((r) => r.id === registry.id)
      if (registry.version !== before.version || registry.valueDigest !== before.valueDigest) {
        note('registries', 'registryDrift',
          `${registry.id}: ${before.version}@${before.valueDigest} (${before.entries} записей)`,
          `${registry.id}: ${registry.version}@${registry.valueDigest} (${registry.entries} записей)`)
      }
    }
  }
  if (current.matcherPolicy.version !== reference.matcherPolicy.version
    || current.matcherPolicy.digest !== reference.matcherPolicy.digest
    || current.matcherPolicy.lexiconDigest !== reference.matcherPolicy.lexiconDigest) {
    note('matcherPolicy', 'policyDrift',
      `${reference.matcherPolicy.version}@${reference.matcherPolicy.digest}`,
      `${current.matcherPolicy.version}@${current.matcherPolicy.digest}`)
  }

  const currentIds = current.portals.map((p) => p.portalId)
  const referenceIds = reference.portals.map((p) => p.portalId)
  if (currentIds.join(',') !== referenceIds.join(',')) {
    note('portals', 'portalSetDrift', referenceIds, currentIds)
  } else {
    for (const portal of current.portals) {
      const before = reference.portals.find((p) => p.portalId === portal.portalId)
      const at = portal.portalId
      /* ДРЕЙФ АДАПТЕРА НИЧЕГО НЕ ОТМЕНЯЕТ (10f-Q R2, находка аудита 4). Прежде
         здесь стоял `continue`, и смена версии адаптера прятала обе оси входа:
         контрпример с другой версией, другими сырыми байтами и другим
         каноническим набором возвращал ровно один `adapterDrift`
         (`tmp/10f-q-r2-repro-registries-version-adapter-OLD-2026-09-04.log`).
         Сырые байты источника сравнимы независимо от того, чем их разбирали;
         канонический набор при разных версиях канонизации несравним — но
         несравнимость обязана быть НАЗВАНА, а не подразумеваться. */
      const adapterChanged = portal.adapter.id !== before.adapter.id
        || portal.adapter.version !== before.adapter.version
      if (adapterChanged) {
        note('input', 'adapterDrift', `${at}: ${before.adapter.id}@${before.adapter.version}`, `${at}: ${portal.adapter.id}@${portal.adapter.version}`)
      }
      /* ДВЕ НЕЗАВИСИМЫЕ ОСИ (10f-Q R1, находка аудита 3). Сырые байты и
         канонический набор проверяются каждый сам по себе: совпадение сырого
         payload НЕ отменяет сравнения канонического — иначе правка адаптера или
         канонизации, меняющая набор кандидатов при тех же байтах источника,
         проходит незамеченной. И наоборот: совпавший канонический набор не
         отменяет проверки байтов. Ни одна ось не маскирует другую. */
      const rawNow = portal.input.rawPayload
      const rawBefore = before.input.rawPayload
      if (rawNow && rawBefore) {
        if (rawNow.digest !== rawBefore.digest) note('input', 'inputDrift', `${at}: ${rawBefore.digest}`, `${at}: ${rawNow.digest}`)
      } else if (rawNow || rawBefore) {
        /* Одна сторона сырой payload отдала, другая нет: тождество байтов входа
           доказать нечем — это отказ, а не молчание. */
        note('input', 'inputIncomparable', `${at}: rawPayload ${rawBefore ? 'есть' : 'нет'}`, `${at}: rawPayload ${rawNow ? 'есть' : 'нет'}`)
      }
      if (portal.adapter.version === null) {
        /* Канонический набор без версии канонизации сравнивать нельзя
           (ADR-0002 § 8): расхождение было бы несопоставимым измерением. */
        note('input', 'canonicalIncomparable', `${at}: адаптер без версии`, `${at}: адаптер без версии`)
      } else if (adapterChanged) {
        /* Разные версии канонизации — разные единицы измерения: совпадение
           digest'ов здесь ничего не значило бы, а расхождение не значило бы
           дрейфа входа. Отказ по имени, а не молчание. */
        note('input', 'canonicalIncomparable',
          `${at}: канонизация ${before.adapter.version}`, `${at}: канонизация ${portal.adapter.version}`)
      } else if (portal.input.canonical.digest !== before.input.canonical.digest) {
        note('input', 'canonicalDrift', `${at}: ${before.input.canonical.digest}`, `${at}: ${portal.input.canonical.digest}`)
      }
    }
  }

  for (const kind of ['existing', 'snapshot']) {
    const now = current.base[kind]
    const before = reference.base[kind]
    if (now === null && before === null) continue
    if (now === null || before === null || now.digest !== before.digest) {
      note('base', 'baseDrift', `${kind}: ${before?.digest ?? 'нет'}`, `${kind}: ${now?.digest ?? 'нет'}`)
    }
  }
  if (!(current.names === null && reference.names === null)) {
    if (current.names === null || reference.names === null || current.names.digest !== reference.names.digest) {
      note('names', 'namesDrift', reference.names?.digest ?? 'нет', current.names?.digest ?? 'нет')
    }
  }
  return { drift, checked: [...DRIFT_COMPONENTS] }
}

/**
 * Pre-write drift gate. Исполняется ДО store и до первой записи; результат —
 * значение, а не исключение: main записывает его в отчёт и решает, что делать.
 *
 *   write (живая база)  манифест и эталон обязательны; base.existing обязателен;
 *                        любой дрейф — BLOCK
 *   dry-write, snapshot  эталон есть — сверка как для write; нет — NOT_ARMED
 *                        (эффекта в живой базе у этих режимов нет, и именно
 *                        такой прогон и производит эталон для записи)
 *   read-only            записи нет, gate не применяется — NOT_ARMED
 *
 * `manifest` — манифест текущего прогона или null (ни один портал не дал
 * набора кандидатов). `reference` — разобранный эталонный отчёт (`--monitor`)
 * целиком либо null; `referenceError` — текст ошибки чтения эталона, если файл
 * запрошен, но не прочитан. Манифест эталона проверяется заново, включая digest.
 * Форма результата одна для всех исходов.
 */
export function preWriteGate({ manifest, mode, reference = null, referenceError = null }) {
  if (!RUN_MODES.includes(mode)) throw new TypeError(`preWriteGate: неизвестный режим ${JSON.stringify(mode)}`)
  const live = mode === 'write'
  const referenceRequested = reference !== null || referenceError !== null
  const result = (state, reason, message = null, extra = {}) => ({
    state, mode, reason, message, reference: null, drift: [], checked: [], ...extra,
  })
  if (mode === 'read-only') return result(GATE_NOT_ARMED, 'readOnly')
  if (referenceError !== null) {
    return result(GATE_BLOCK, 'referenceInvalid', `эталонный отчёт не читается или не разбирается: ${referenceError}`)
  }
  if (!live && !referenceRequested) return result(GATE_NOT_ARMED, 'referenceMissing')
  if (manifest === null) {
    return result(GATE_BLOCK, 'manifestUnavailable', 'ни один портал не дал набора кандидатов — манифест прогона не собран, сверять нечего')
  }
  assertRunManifest(manifest)
  if (manifest.mode !== mode) throw new TypeError(`preWriteGate: режим манифеста ${manifest.mode} не совпадает с режимом прогона ${mode}`)
  if (reference === null) {
    return result(GATE_BLOCK, 'referenceMissing', 'живая запись без эталонного прогона (--monitor <прежний отчёт>) не разрешена: сверять вход, базу и политику не с чем')
  }
  if (!isPlainObject(reference) || !('manifest' in reference)) {
    return result(GATE_BLOCK, 'referenceInvalid', 'эталонный отчёт не несёт манифеста прогона (run-manifest/v2): снят до его появления или это не отчёт коллектора')
  }
  let referenceManifest
  try {
    referenceManifest = assertRunManifest(reference.manifest)
  } catch (error) {
    return result(GATE_BLOCK, 'referenceInvalid', `манифест эталонного прогона не принят: ${error.message}`)
  }
  const ref = { manifestDigest: referenceManifest.manifestDigest.value, startedAt: referenceManifest.startedAt, mode: referenceManifest.mode }
  if (live && manifest.base.existing === null) {
    return result(GATE_BLOCK, 'baseIdentityMissing', 'живая запись без проверенного файла существующих POI (--existing) не разрешена: тождество базы не зафиксировано', { reference: ref })
  }
  const { drift, checked } = compareRunManifests(manifest, referenceManifest)
  if (drift.length) {
    return result(GATE_BLOCK, 'drift', `дрейф относительно эталона: ${drift.map((d) => d.kind).join(', ')}`, { reference: ref, drift, checked })
  }
  return result(GATE_PASS, null, null, { reference: ref, drift, checked })
}
