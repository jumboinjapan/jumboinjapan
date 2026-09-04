/**
 * Карточка схемной операции «четыре поля таксономии v2 в таблице POI».
 *
 * Карточка — замороженное описание ТОЧНО ОДНОЙ операции: какие поля, в какой
 * таблице (по каноническому ID), какими запросами, в каком порядке, какими
 * модулями. Её байты — идентичность операции: разрешение владельца ссылается
 * на SHA-256 файла карточки, исполнитель принимает только байты с этим
 * отпечатком, и любая правка карточки или исполняющего модуля делает
 * разрешение неприменимым.
 *
 * Область закрыта: ровно четыре поля, выведенные из loader'а реестра через
 * единственную связь `poi-taxonomy-airtable.ts`. Пятое поле, чужой тип,
 * чужая опция, чужая таблица, чужая база — отказ на проверке карточки, до
 * открытия журнала и до первого запроса.
 *
 * Граница проверяемого состояния (10f-P R3, находка 5) названа в карточке
 * явно: `scope.verifiedProperties` — что входит в авторизованное состояние и
 * проверяется независимо (таблица по ID и имени; у каждого поля — имя, тип и
 * МНОЖЕСТВО опций-кодов); `scope.unverifiedProperties` — что посылается, но
 * в постусловия не входит. `description` относится ко второму списку: это
 * человекочитаемая подпись, правимая в интерфейсе Airtable, и обещать её
 * «точное совпадение» было бы неправдой. Ни исполнитель, ни свидетель её не
 * сверяют, и ни один текст этого не обещает.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectedTaxonomyFieldSchema, TAXONOMY_FIELDS } from '../../src/lib/poi-taxonomy-airtable.ts'
import { taxonomyVersion } from '../../src/lib/poi-taxonomy.ts'
import { POI_TABLE_ID } from '../../src/lib/airtable-schema.ts'
import { sha256Bytes } from '../lib/byte-digest.mjs'
import { assertCanonicalInstant, canonicalJsonBytes, isPlainObject } from '../lib/canonical-contract.mjs'

export const TAXONOMY_SCHEMA_CARD_SPEC = 'poi-taxonomy-schema-card/v5'
export const TAXONOMY_SCHEMA_APPROVAL_SPEC = 'poi-taxonomy-schema-approval/v1'
/** База — каноническая константа проекта; env здесь не читается намеренно. */
export const CANONICAL_BASE_ID = 'apppwhjFN82N9zNqm'
export const CANONICAL_POI_TABLE_NAME = 'POI'
/** Origin Meta API — часть описания операции (общий источник данных), не код транспорта. */
export const AIRTABLE_ORIGIN = 'https://api.airtable.com'
export const META_TABLES_PATH = `/v0/meta/bases/${CANONICAL_BASE_ID}/tables`
export const META_FIELDS_PATH = `/v0/meta/bases/${CANONICAL_BASE_ID}/tables/${POI_TABLE_ID}/fields`

/**
 * Модули, способные участвовать в эффекте, — все, чей код исполняется на пути
 * от точки входа до POST, включая саму точку входа (10f-P R2, свойство 2).
 * Пути — от корня репозитория. Тот же список продублирован в bootstrap'е
 * `run-taxonomy-schema.mjs` (он обязан хешировать ДО импорта чего-либо);
 * тождество двух списков закреплено тестом.
 */
export const CHAIN_MODULES = Object.freeze([
  'scripts/poi-schema/run-taxonomy-schema.mjs',
  'scripts/poi-schema/taxonomy-schema-cli.mjs',
  'scripts/poi-schema/taxonomy-schema-card.mjs',
  'scripts/poi-schema/taxonomy-schema-state.mjs',
  'scripts/poi-schema/taxonomy-schema-journal.mjs',
  'scripts/poi-schema/taxonomy-schema-transport.mjs',
  'scripts/poi-schema/taxonomy-schema-execute.mjs',
  'scripts/poi-schema/taxonomy-schema-witness.mjs',
  'scripts/poi-schema/taxonomy-schema-gate.mjs',
  'scripts/lib/byte-digest.mjs',
  'scripts/lib/canonical-contract.mjs',
  'src/lib/poi-taxonomy-airtable.ts',
  'src/lib/poi-taxonomy.ts',
  'src/lib/airtable-schema.ts',
  'config/poi-taxonomy.v2.json',
])

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const FIELD_DESCRIPTIONS = Object.freeze({
  [TAXONOMY_FIELDS.type]: 'Код типа POI из реестра таксономии (config/poi-taxonomy.v2.json). Пишет ingestPoi; подписи — из реестра, не из этого поля.',
  [TAXONOMY_FIELDS.facets]: 'Коды фасетов из реестра таксономии. Ноль или больше.',
  [TAXONOMY_FIELDS.source]: 'Кто назначил тип: rule — правило, model — модель, human — человек.',
  [TAXONOMY_FIELDS.version]: 'Версия реестра таксономии, под которой записан тип (например, poi-taxonomy/v2).',
})

/** Тело запроса Meta API на создание поля — выводится из ожидаемой схемы. */
export function fieldRequestBodies() {
  return expectedTaxonomyFieldSchema().map((f) => ({
    name: f.name,
    type: f.type,
    description: FIELD_DESCRIPTIONS[f.name],
    ...(f.choices ? { options: { choices: f.choices.map((name) => ({ name })) } } : {}),
  }))
}

/** SHA-256 файлов цепочки по путям от корня репозитория. */
export function moduleDigests(repoRoot = REPO_ROOT) {
  const out = {}
  for (const rel of CHAIN_MODULES) out[rel] = sha256Bytes(readFileSync(path.join(repoRoot, rel)))
  return out
}

/**
 * Собирает карточку. `preparedAt` — канонический момент; `modules` — отпечатки
 * модулей на момент заморозки (по умолчанию читаются с диска).
 */
export function buildTaxonomySchemaCard({ preparedAt, modules = moduleDigests() }) {
  assertCanonicalInstant(preparedAt, 'карточка схемы: preparedAt')
  const fields = fieldRequestBodies().map((body, i) => ({
    order: i + 1,
    request: { method: 'POST', path: META_FIELDS_PATH, body },
  }))
  return {
    contractVersion: TAXONOMY_SCHEMA_CARD_SPEC,
    cardId: `taxonomy-schema-${taxonomyVersion.replace('/', '-')}-${preparedAt.slice(0, 10)}`,
    preparedAt,
    status: 'FROZEN_NOT_EXECUTED',
    note: 'Карточка исполнения, не запись. Ни один запрос не выполнен. Разрешение владельца ссылается на cardId и SHA-256 файла карточки; правка карточки или любого модуля цепочки делает его неприменимым.',
    base: { baseId: CANONICAL_BASE_ID, poiTableId: POI_TABLE_ID, poiTableName: CANONICAL_POI_TABLE_NAME },
    derivedFrom: { registry: 'config/poi-taxonomy.v2.json', registryVersion: taxonomyVersion, link: 'src/lib/poi-taxonomy-airtable.ts · expectedTaxonomyFieldSchema()' },
    scope: {
      operation: 'airtable.meta.createField',
      fieldCount: fields.length,
      fieldNames: fields.map((f) => f.request.body.name),
      forbidden: 'Любое поле, кроме перечисленных; изменение или удаление существующих полей; любые записи в строки; любые другие таблицы и базы; повтор и откат.',
      requiredTokenScope: 'schema.bases:write',
      verifiedProperties: [
        'таблица: id (канонический) и name',
        'поле: name',
        'поле: type',
        'поле: options.choices как МНОЖЕСТВО кодов реестра (лишняя опция — расхождение)',
      ],
      unverifiedProperties: [
        'поле: description — посылается при создании как первичная документация, но в авторизованное состояние НЕ входит: подпись правится в интерфейсе Airtable и на вердикт не влияет; «точное совпадение» поля целиком нигде не обещается',
      ],
    },
    preconditions: [
      'bootstrap хеширует ВСЕ модули цепочки (включая себя) и сверяет с карточкой ДО импорта любого из них',
      'read-only предполёт ДО создания журнала: карточка и модули, разрешение по SHA-256 байтов карточки и сроку, живая схема — таблица по каноническому ID и имени, все четыре поля отсутствуют',
      'журнал исполнения для этого отпечатка ещё не существует (эксклюзивное создание)',
      'непосредственно перед КАЖДЫМ POST — свежее чтение: применённый префикс существует ровно по одному разу и совпадает, текущее поле и весь суффикс отсутствуют',
    ],
    effectPolicy: {
      order: 'строго по order; остановка на первом расхождении',
      retry: 'никогда',
      rollback: 'никогда',
      deadline: 'КАЖДЫЙ полный обмен Meta API — соединение, заголовки и тело — под одним конечным сроком; истёкший GET недоступен, истёкший POST — неопределённость, разрешаемая только отдельным ограниченным чтением',
      malformedResponse: 'сырой ответ схемы валидируется целиком до использования вложенных значений; повреждённая форма — именованная причина schemaCorrupt, а не исключение из глубины',
      outcome: 'после ЛЮБОГО отправленного POST — 2xx, 4xx, обрыв — исход устанавливается ТОЛЬКО свежим чтением схемы; ответ провода записывается как факт отправки, не как исход',
      readUnavailable: 'если чтение после POST недоступно ПО ЛЮБОЙ причине (срок, провод, отказ, повреждённая форма), исход остаётся unknown: журнал закрывается unknown, требуется восстановление; повтора нет',
      finalReadUnavailable: 'если все четыре поля подтверждены поштучно, а заключительная сверка недоступна, журнал закрывается терминалом pendingFinalWitness (не «обычной остановкой»); окончательный вердикт даёт verdictFromJournal по неизменяемому журналу и новому живому свидетельству, без повтора POST и без отката',
      postEffect: 'после каждого эффекта — свежее чтение и проверка полного состояния четвёрки (префикс + 1)',
    },
    fields,
    postconditions: [
      'финальный gate: строгая грамматика журнала против точных байтов карточки и разрешения (четыре поля, порядок, намерение до каждого POST, исход по чтению) ∧ независимый свидетель по каноническому ID',
      'свидетель независим от исполнителя по коду чтения, формы и классификации: он читает схему сам, сам полностью проверяет форму сырого ответа и классифицирует по данным карточки, а не кодом исполнителя; согласованная ошибка классификации исполнителя вердикта не проходит',
      'свидетель считает вхождения (не Map/Set): каноническая таблица и каждое из четырёх полей существуют РОВНО по одному разу; дубль имени, ID или select-опции — неоднозначность и отказ; повреждённая форма ответа — именованный отрицательный вердикт, не исключение',
      'gate независимо требует у свидетеля ровно четыре уникальных fieldId и отсутствие неоднозначности: пять fieldId (лишнее идентичное поле) или неоднозначная схема успеха не дают',
      'любое исключение после входа в границу POST (включая отозванный Proxy, не-Error, бросающий геттер) исполнитель считает потенциально неоднозначным эффектом: безопасно описывает, делает свежее ограниченное чтение и устанавливает applied/notApplied/mismatch/unknown; исключение не покидает исполнителя, повтора и отката нет; защита есть и в транспорте, и в исполнителе',
      'любое брошенное значение на КАЖДОЙ границе readSchema и createField (включая СЫРОЙ отозванный Proxy, приходящий прямо на границу, которую потребляет исполнитель) описывается безопасно и не покидает исполнителя: если чтение после потенциального POST недоступно — исход unknown, recoveryRequired, журнал закрыт, без повтора; error.cause/error.timedOut/error.message читаются через безопасные обёртки, а не через ?. (10f-P R5, находка 1)',
      'полная каноническая проверка карточки (база, таблица, поля — из loader) выполняется ДО чтения credentials, ДО первого сетевого запроса и ДО построения маршрута свидетеля; baseId, tableId и ожидаемые поля не переопределяются карточкой, не прошедшей строгий контракт — свидетель строит URL и ищет таблицу по КОНСТАНТАМ, а gate требует у свидетеля каноническую таблицу (10f-P R5, находка 2)',
      'транспорт самостоятельно не выпускает неизвестное исключение: враждебный fetchImpl (в т.ч. отклоняющийся отозванным Proxy) даёт только { kind } или SchemaReadError, не сырой TypeError (10f-P R5, находка 3)',
      'диагностика остановки печатает sent.response (нормализованную форму ответа), а не sent.kind (10f-P R5, находка 4)',
      'проверяются только scope.verifiedProperties; description в постусловия не входит',
      'npm run check:poi без находок taxonomy_schema_missing / taxonomy_schema_drift',
      'writeRun: живое хранилище отдаёт схему, writer сверяет её (verifyTaxonomySchemaTables) — проходит',
    ],
    modules,
  }
}

/** Отпечаток байтов карточки: то, на что ссылается разрешение. */
export function cardDigestOf(bytes) {
  return sha256Bytes(bytes)
}

function fail(where, message) {
  throw new Error(`${where}: ${message}`)
}

/**
 * Проверка карточки — закрытая область и тождество с loader'ом. Модули
 * сверяются с диском, если передан `repoRoot`; отсутствие сверки модулей
 * допустимо только для проверки формы (тесты формы), исполнитель сверяет всегда.
 */
export function assertTaxonomySchemaCard(card, { repoRoot = null } = {}) {
  const where = 'карточка схемы'
  if (!isPlainObject(card)) fail(where, 'ожидается объект')
  if (card.contractVersion !== TAXONOMY_SCHEMA_CARD_SPEC) fail(where, `contractVersion ${JSON.stringify(card.contractVersion)}, ожидается ${TAXONOMY_SCHEMA_CARD_SPEC}`)
  if (card.status !== 'FROZEN_NOT_EXECUTED') fail(where, `status ${JSON.stringify(card.status)}: исполняется только замороженная карточка`)
  assertCanonicalInstant(card.preparedAt, `${where}: preparedAt`)
  if (!isPlainObject(card.base) || card.base.baseId !== CANONICAL_BASE_ID) fail(where, `база ${JSON.stringify(card.base?.baseId)} не каноническая ${CANONICAL_BASE_ID}`)
  if (card.base.poiTableId !== POI_TABLE_ID) fail(where, `таблица ${JSON.stringify(card.base.poiTableId)} не каноническая ${POI_TABLE_ID}`)
  if (card.base.poiTableName !== CANONICAL_POI_TABLE_NAME) fail(where, `имя таблицы ${JSON.stringify(card.base.poiTableName)}, ожидается ${CANONICAL_POI_TABLE_NAME}`)
  if (!isPlainObject(card.derivedFrom) || card.derivedFrom.registryVersion !== taxonomyVersion) {
    fail(where, `версия реестра ${JSON.stringify(card.derivedFrom?.registryVersion)} не совпадает с loader'ом ${taxonomyVersion}`)
  }
  const expected = fieldRequestBodies()
  if (!Array.isArray(card.fields) || card.fields.length !== expected.length) fail(where, `полей ${card.fields?.length ?? 'нет'}, ожидается ровно ${expected.length}`)
  if (!isPlainObject(card.scope) || card.scope.fieldCount !== expected.length) fail(where, 'scope.fieldCount не совпадает с числом полей')
  // Граница проверяемого состояния обязана быть названа явно (R3, находка 5).
  if (!Array.isArray(card.scope.verifiedProperties) || card.scope.verifiedProperties.length === 0) fail(where, 'scope.verifiedProperties обязателен: что входит в авторизованное состояние')
  if (!Array.isArray(card.scope.unverifiedProperties)) fail(where, 'scope.unverifiedProperties обязателен: что посылается, но в постусловия не входит')
  if (!card.scope.unverifiedProperties.some((line) => /description/.test(String(line)))) fail(where, 'scope.unverifiedProperties обязан назвать description явно')
  if (card.scope.verifiedProperties.some((line) => /description/.test(String(line)))) fail(where, 'description не может быть в verifiedProperties: он не сверяется ни исполнителем, ни свидетелем')
  card.fields.forEach((entry, i) => {
    const want = expected[i]
    if (!isPlainObject(entry) || entry.order !== i + 1) fail(where, `поле ${i + 1}: order нарушен`)
    const req = entry.request
    if (!isPlainObject(req) || req.method !== 'POST' || req.path !== META_FIELDS_PATH) fail(where, `поле ${i + 1}: запрос не POST ${META_FIELDS_PATH}`)
    const left = canonicalJsonBytes(req.body, 'field').toString('utf8')
    const right = canonicalJsonBytes(want, 'field').toString('utf8')
    if (left !== right) fail(where, `поле ${i + 1} «${req.body?.name}» не совпадает с ожидаемой схемой loader'а`)
  })
  if (JSON.stringify(card.scope.fieldNames) !== JSON.stringify(expected.map((f) => f.name))) fail(where, 'scope.fieldNames не совпадает с полями')
  if (!isPlainObject(card.modules)) fail(where, 'нет отпечатков модулей')
  const listed = Object.keys(card.modules).sort()
  if (JSON.stringify(listed) !== JSON.stringify([...CHAIN_MODULES].sort())) fail(where, `состав модулей ${listed.join(', ')} не равен цепочке ${CHAIN_MODULES.join(', ')}`)
  for (const rel of CHAIN_MODULES) {
    if (!/^sha256:[0-9a-f]{64}$/.test(String(card.modules[rel]))) fail(where, `отпечаток модуля ${rel} не sha256`)
  }
  if (repoRoot !== null) {
    const live = moduleDigests(repoRoot)
    for (const rel of CHAIN_MODULES) {
      if (live[rel] !== card.modules[rel]) fail(where, `модуль ${rel} на диске (${live[rel]}) не совпадает с отпечатком карточки (${card.modules[rel]}); карточка устарела`)
    }
  }
  return true
}

/**
 * Разрешение владельца — отдельный артефакт, привязанный к байтам карточки.
 * Проверяется форма и привязка; истинность решения удостоверяет владелец.
 */
export function assertTaxonomySchemaApproval(approval, { cardDigest, cardId, now }) {
  const where = 'разрешение на схемную операцию'
  if (!isPlainObject(approval)) fail(where, 'ожидается объект')
  const keys = Object.keys(approval).sort().join(',')
  if (keys !== 'approvedAt,approver,cardDigest,cardId,contractVersion,decisionRef,validUntil') fail(where, `набор полей ${keys} не соответствует контракту`)
  if (approval.contractVersion !== TAXONOMY_SCHEMA_APPROVAL_SPEC) fail(where, `contractVersion ${JSON.stringify(approval.contractVersion)}`)
  if (approval.cardDigest !== cardDigest) fail(where, `cardDigest ${approval.cardDigest} не совпадает с байтами карточки ${cardDigest}`)
  if (approval.cardId !== cardId) fail(where, `cardId ${JSON.stringify(approval.cardId)} не совпадает с карточкой ${cardId}`)
  for (const key of ['decisionRef', 'approver']) {
    if (typeof approval[key] !== 'string' || !approval[key].trim()) fail(where, `${key} обязателен`)
  }
  const approvedMs = assertCanonicalInstant(approval.approvedAt, `${where}: approvedAt`)
  const validMs = assertCanonicalInstant(approval.validUntil, `${where}: validUntil`)
  const nowMs = assertCanonicalInstant(now, `${where}: now`)
  if (validMs <= approvedMs) fail(where, 'validUntil должен быть позже approvedAt')
  if (nowMs < approvedMs) fail(where, 'разрешение выдано в будущем')
  if (nowMs > validMs) fail(where, `разрешение истекло ${approval.validUntil}`)
  return true
}
