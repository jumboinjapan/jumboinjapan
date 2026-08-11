/**
 * Реестр таксономии POI: форма, ссылочная целостность и инварианты.
 *
 * Проверяется ТОЛЬКО реестр и две схемы. К Intake, Airtable и классификатору
 * ничего не подключено — это первый коммит из семи по ADR-0001 §13.
 *
 * Разделение обязанностей: JSON Schema ловит форму (лишние поля, шаблоны
 * кодов, обязательные сочетания), тесты ниже — то, что схемой выразить
 * нельзя: уникальность кодов, существование ссылок, пересечение подсказок.
 */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const load = async (p) => JSON.parse(await readFile(path.join(ROOT, p), 'utf8'))

const registry = await load('config/poi-taxonomy.v1.json')
const registrySchema = await load('config/poi-taxonomy.schema.json')
const classificationSchema = await load('config/poi-classification.schema.json')

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const empty = (label, list) => t(label, list.length ? list.join('; ') : '—', '—')

// ── Схемы: валидатор обязателен, а не «по возможности» ───────────────────
/* ajv 8 читает черновик 2020-12. Берётся ТОЛЬКО объявленная зависимость:
   запасной импорт из ajv-formats/node_modules убран намеренно. Пока он был,
   объявленный ajv@^8 мог никогда не установиться, а package.json и lock-файл
   расходились бы молча — то есть npm ci на чистом клоне вёл бы себя иначе,
   чем локальный прогон. Нет зависимости — проверка ПАДАЕТ. */
const require_ = createRequire(path.join(ROOT, 'package.json'))
let Ajv2020 = null
let ajvProblem = ''
try {
  const mod = require_('ajv/dist/2020')
  Ajv2020 = mod.default ?? mod
} catch (error) {
  ajvProblem = `не найден ajv с поддержкой 2020-12 (${error.code ?? error.message}). `
    + 'Выполните npm install: ajv@^8 объявлен в devDependencies.'
}
t('валидатор схем доступен', ajvProblem || 'да', 'да')

if (Ajv2020) {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  const validateRegistry = ajv.compile(registrySchema)
  t('реестр проходит свою схему',
    validateRegistry(registry) ? '—' : ajv.errorsText(validateRegistry.errors), '—')

  const validateClassification = ajv.compile(classificationSchema)
  const base = { sourceKey: 'p:1', classificationSource: 'model' }
  const good = [
    ['POI с типом', { ...base, entityKind: 'tourist_poi', intakeDisposition: 'route', catalogTarget: 'poi', poiPrimaryType: 'museum' }],
    ['отель без типа POI', { ...base, entityKind: 'accommodation', intakeDisposition: 'route', catalogTarget: 'hotel', poiPrimaryType: null }],
    ['отказ с причиной', { ...base, entityKind: 'transport_infrastructure', intakeDisposition: 'exclude', catalogTarget: null, poiPrimaryType: null, excludeReason: 'infrastructure_not_catalogued' }],
    ['остановка', { ...base, entityKind: 'unknown', intakeDisposition: 'needs_review', catalogTarget: null, poiPrimaryType: null }],
    ['резервный тип от человека с заметкой', { ...base, classificationSource: 'human', entityKind: 'tourist_poi', intakeDisposition: 'route', catalogTarget: 'poi', poiPrimaryType: 'other_tourist_poi', note: 'рыболовный пирс' }],
    /* Остановка СОХРАНЯЕТ предложенный тип: человеку он нужен отправной
       точкой разбора. Записи в базу при этом не происходит — за это отвечает
       intakeDisposition, а не пустое поле типа. */
    ['остановка с предложенным типом', { ...base, entityKind: 'tourist_poi', intakeDisposition: 'needs_review', catalogTarget: null, poiPrimaryType: 'other_tourist_poi' }],
    ['остановка с обычным предложенным типом', { ...base, entityKind: 'tourist_poi', intakeDisposition: 'needs_review', catalogTarget: null, poiPrimaryType: 'museum' }],
    ['остановка с подсказками для человека', { ...base, entityKind: 'unknown', intakeDisposition: 'needs_review', catalogTarget: null, poiPrimaryType: null, reasons: ['адрес не разобран'], badgeCandidates: ['iconic_view'] }],
  ]
  for (const [label, doc] of good) {
    t(`валидна: ${label}`, validateClassification(doc) ? '—' : ajv.errorsText(validateClassification.errors), '—')
  }

  const badDocs = [
    ['POI без типа', { ...base, entityKind: 'tourist_poi', intakeDisposition: 'route', catalogTarget: 'poi', poiPrimaryType: null }],
    ['отель с типом POI', { ...base, entityKind: 'accommodation', intakeDisposition: 'route', catalogTarget: 'hotel', poiPrimaryType: 'museum' }],
    ['отказ без причины', { ...base, entityKind: 'retail_shop', intakeDisposition: 'exclude', catalogTarget: null, poiPrimaryType: null }],
    ['отказ с каталогом', { ...base, entityKind: 'retail_shop', intakeDisposition: 'exclude', catalogTarget: 'poi', poiPrimaryType: null, excludeReason: 'not_a_destination' }],
    ['остановка с каталогом', { ...base, entityKind: 'unknown', intakeDisposition: 'needs_review', catalogTarget: 'poi', poiPrimaryType: 'museum' }],
    ['маршрут без каталога', { ...base, entityKind: 'tourist_poi', intakeDisposition: 'route', catalogTarget: null, poiPrimaryType: 'museum' }],
    ['резервный тип от модели с маршрутом', { ...base, entityKind: 'tourist_poi', intakeDisposition: 'route', catalogTarget: 'poi', poiPrimaryType: 'other_tourist_poi' }],
    ['резервный тип от человека без заметки', { ...base, classificationSource: 'human', entityKind: 'tourist_poi', intakeDisposition: 'route', catalogTarget: 'poi', poiPrimaryType: 'other_tourist_poi' }],
    ['лишнее поле', { ...base, entityKind: 'tourist_poi', intakeDisposition: 'route', catalogTarget: 'poi', poiPrimaryType: 'museum', badges: ['iconic_view'] }],
    ['код не по шаблону', { ...base, entityKind: 'Tourist POI', intakeDisposition: 'needs_review', catalogTarget: null, poiPrimaryType: null }],
  ]
  for (const [label, doc] of badDocs) {
    t(`отклонена: ${label}`, validateClassification(doc), false)
  }
}

// ── Уникальность и форма кодов ──────────────────────────────────────────
const CODE = /^[a-z][a-z0-9_]*$/
const dicts = {
  entityKinds: registry.entityKinds,
  excludeReasons: registry.excludeReasons,
  poiTypeGroups: registry.poiTypeGroups,
  poiPrimaryTypes: registry.poiPrimaryTypes,
  facets: registry.facets,
  badges: registry.badges,
}
for (const [name, items] of Object.entries(dicts)) {
  const codes = items.map((i) => i.code)
  t(`${name}: коды уникальны`, new Set(codes).size, codes.length)
  empty(`${name}: коды по шаблону`, codes.filter((c) => !CODE.test(c)))
  empty(`${name}: подписи непусты`,
    items.filter((i) => !i.labels?.ru?.trim() || !i.labels?.en?.trim()).map((i) => i.code))
}
const ruleIds = registry.routingPolicy.map((r) => r.id)
t('правила маршрута: id уникальны', new Set(ruleIds).size, ruleIds.length)

// ── Ссылочная целостность ───────────────────────────────────────────────
const groupCodes = new Set(registry.poiTypeGroups.map((g) => g.code))
const typeCodes = new Set(registry.poiPrimaryTypes.map((t2) => t2.code))
const kindCodes = new Set(registry.entityKinds.map((k) => k.code))
const reasonCodes = new Set(registry.excludeReasons.map((r) => r.code))
const targets = new Set(registry.catalogTargets)

empty('у каждого типа существующая группа',
  registry.poiPrimaryTypes.filter((x) => !groupCodes.has(x.group)).map((x) => x.code))
empty('в правилах существующий вид сущности',
  registry.routingPolicy.filter((r) => !kindCodes.has(r.entityKind)).map((r) => r.id))
empty('в правилах существующая причина отказа',
  registry.routingPolicy.filter((r) => r.excludeReason && !reasonCodes.has(r.excludeReason)).map((r) => r.id))
empty('в правилах допустимый каталог',
  registry.routingPolicy.filter((r) => r.catalogTarget !== null && !targets.has(r.catalogTarget)).map((r) => r.id))
empty('каждый вид сущности покрыт правилом',
  [...kindCodes].filter((k) => !registry.routingPolicy.some((r) => r.entityKind === k)))

// ── Ветвление для tourist_poi зависит от типа ───────────────────────────
/* Без этого «tourist_poi» уезжал бы в POI и с неопределённым типом, и с
   резервным — то есть ровно в тех случаях, ради которых заводилась ручная
   проверка. Ветвление детерминированное: агент его не меняет. */
const poiRules = registry.routingPolicy.filter((r) => r.entityKind === 'tourist_poi')
const rule = (state, by) => poiRules.find((r) => r.typeState === state && (r.classificationSource === by || r.classificationSource === 'any'))
t('тип известен — маршрут в POI', rule('known', 'model')?.disposition, 'route')
t('и каталог именно poi', rule('known', 'model')?.catalogTarget, 'poi')
t('тип не определён — остановка', rule('unknown', 'model')?.disposition, 'needs_review')
t('и каталога нет', rule('unknown', 'model')?.catalogTarget, null)
t('резервный тип от модели — остановка', rule('other_tourist_poi', 'model')?.disposition, 'needs_review')
t('резервный тип от человека — маршрут', rule('other_tourist_poi', 'human')?.disposition, 'route')
t('и обязательна заметка', rule('other_tourist_poi', 'human')?.requiresNote, true)

// ── Исчерпывающая таблица комбинаций ────────────────────────────────────
/* Прежняя проверка порядка была ложной: условие `A < B || B >= 0` истинно
   при любом существующем B и не проверяло ничего. Вместо одной позиции —
   полный перебор: каждая допустимая комбинация обязана совпасть РОВНО с
   одним правилом. Так ловятся все три беды сразу: пробел (комбинация без
   правила), пересечение (два правила на одну комбинацию) и недостижимое
   правило (не выбирается ни одной комбинацией). */
const TYPE_STATES = ['known', 'unknown', 'other_tourist_poi']
const SOURCES = ['model', 'human']
const matches = (r, kind, state, source) =>
  r.entityKind === kind
  && (r.typeState === 'any' || r.typeState === state)
  && (r.classificationSource === 'any' || r.classificationSource === source)

const gaps = []
const overlaps = []
const usedRules = new Set()
for (const kind of kindCodes) {
  for (const state of TYPE_STATES) {
    for (const source of SOURCES) {
      const hits = registry.routingPolicy.filter((r) => matches(r, kind, state, source))
      const combo = `${kind}/${state}/${source}`
      if (hits.length === 0) gaps.push(combo)
      else if (hits.length > 1) overlaps.push(`${combo} → ${hits.map((h) => h.id).join(' и ')}`)
      else usedRules.add(hits[0].id)
    }
  }
}
t('комбинаций проверено', kindCodes.size * TYPE_STATES.length * SOURCES.length, 54)
empty('нет комбинаций без правила', gaps)
empty('нет комбинаций с двумя правилами', overlaps)
empty('нет недостижимых правил',
  registry.routingPolicy.filter((r) => !usedRules.has(r.id)).map((r) => r.id))

/* Вычисление typeState — часть контракта, а не деталь реализации.
   other_tourist_poi проверяется РАНЬШЕ обычного known: он тоже код из
   реестра, и наивная проверка «код известен → known» отправила бы резервный
   тип прямиком в POI, обойдя остановку. Это ссылочная реализация: когда
   появится читатель реестра, он обязан вести себя так же. */
const typeStateOf = (code) => {
  if (code === 'other_tourist_poi') return 'other_tourist_poi'
  if (code && typeCodes.has(code)) return 'known'
  return 'unknown'
}
t('резервный тип не считается известным', typeStateOf('other_tourist_poi'), 'other_tourist_poi')
t('обычный тип известен', typeStateOf('museum'), 'known')
t('пустой тип не определён', typeStateOf(null), 'unknown')
t('чужой код не определён', typeStateOf('spa_resort'), 'unknown')
t('резервный тип действительно есть в реестре', typeCodes.has('other_tourist_poi'), true)

// Наивный порядок отправил бы резервный тип в POI — фиксируем разницу.
const naiveState = (code) => (code && typeCodes.has(code) ? 'known' : 'unknown')
t('наивная проверка ошиблась бы', naiveState('other_tourist_poi'), 'known')
const naiveRule = registry.routingPolicy.find((r) => matches(r, 'tourist_poi', naiveState('other_tourist_poi'), 'model'))
const rightRule = registry.routingPolicy.find((r) => matches(r, 'tourist_poi', typeStateOf('other_tourist_poi'), 'model'))
t('и дала бы маршрут вместо остановки', naiveRule?.disposition, 'route')
t('а верная даёт остановку', rightRule?.disposition, 'needs_review')

empty('правила с typeState any не для tourist_poi',
  registry.routingPolicy.filter((r) => r.entityKind === 'tourist_poi' && r.typeState === 'any').map((r) => r.id))

// ── Резервный тип не участвует в автоимпорте ────────────────────────────
const other = registry.poiPrimaryTypes.find((x) => x.code === 'other_tourist_poi')
t('резервный тип существует', Boolean(other), true)
t('и автоимпорт с ним запрещён', other?.autoImportAllowed, false)
t('и у него есть пояснение', Boolean(other?.note?.trim()), true)
empty('остальные типы автоимпорт допускают',
  registry.poiPrimaryTypes.filter((x) => x.code !== 'other_tourist_poi' && x.autoImportAllowed !== true).map((x) => x.code))

// ── Подсказки не пересекаются ───────────────────────────────────────────
/* Подсказки уходят в промпт. Одна и та же фраза у двух типов — это смещение
   классификатора, а не полезная информация: «храм» по-русски применяют и к
   синтоистскому святилищу, поэтому такой термин живёт на уровне ГРУППЫ и
   тип внутри неё не назначает. */
const seen = new Map()
const clashes = []
for (const type of registry.poiPrimaryTypes) {
  for (const list of Object.values(type.hints ?? {})) {
    for (const phrase of list) {
      const key = phrase.trim().toLowerCase()
      if (seen.has(key)) clashes.push(`«${phrase}» у ${seen.get(key)} и ${type.code}`)
      else seen.set(key, type.code)
    }
  }
}
empty('подсказка не повторяется у двух типов', clashes)

const groupHints = new Set()
for (const group of registry.poiTypeGroups) {
  for (const list of Object.values(group.ambiguousHints ?? {})) {
    for (const phrase of list) groupHints.add(phrase.trim().toLowerCase())
  }
}
empty('подсказка типа не совпадает с неоднозначной подсказкой группы',
  [...seen.keys()].filter((k) => groupHints.has(k)).map((k) => `«${k}»`))
t('неоднозначное «храм» живёт на уровне группы', groupHints.has('храм'), true)
t('и не привязано к буддийскому храму',
  Boolean(registry.poiPrimaryTypes.find((x) => x.code === 'buddhist_temple')?.hints?.ru?.includes('храм')), false)
empty('у группы с неоднозначными подсказками есть пояснение',
  registry.poiTypeGroups.filter((g) => g.ambiguousHints && !g.ambiguousHintNote?.trim()).map((g) => g.code))

// ── Миграция старых значений ────────────────────────────────────────────
const autos = registry.legacyCategoryMigrations.filter((m) => m.mode === 'auto')
const manuals = registry.legacyCategoryMigrations.filter((m) => m.mode === 'manual')
empty('автоматическая миграция ссылается на существующий тип',
  autos.filter((m) => !m.mapsTo || !typeCodes.has(m.mapsTo)).map((m) => m.value))
empty('ручная миграция кода не назначает', manuals.filter((m) => m.mapsTo !== null).map((m) => m.value))
empty('у ручной миграции названа причина', manuals.filter((m) => !m.reason?.trim()).map((m) => m.value))
const values = registry.legacyCategoryMigrations.map((m) => m.value)
t('старые значения не повторяются', new Set(values).size, values.length)

/* Переименование подписи — не миграция значения. Если старое значение
   совпадает с действующей подписью, это renaming, и его место в labelHistory:
   иначе одна запись означала бы сразу «был другой тип» и «звался иначе». */
const currentLabels = new Set(registry.poiPrimaryTypes.map((x) => x.labels.ru))
empty('миграции не содержат переименований подписей',
  values.filter((v) => currentLabels.has(v)))
t('labelHistory существует отдельным списком', Array.isArray(registry.labelHistory), true)
empty('labelHistory ссылается на существующие коды',
  (registry.labelHistory ?? []).filter((h) => !typeCodes.has(h.code)).map((h) => h.code))

// ── Бейджи ──────────────────────────────────────────────────────────────
empty('бейдж присваивает редактор или названное правило',
  registry.badges.filter((b) => b.assignedBy !== 'editor' && !(b.assignedBy === 'publication_rule' && b.rule)).map((b) => b.code))
empty('код бейджа не совпадает с типом POI', registry.badges.filter((b) => typeCodes.has(b.code)).map((b) => b.code))
const facetCodes = new Set(registry.facets.map((f) => f.code))
empty('код бейджа не совпадает с facet', registry.badges.filter((b) => facetCodes.has(b.code)).map((b) => b.code))
t('«Знаковый вид» есть среди бейджей',
  registry.badges.some((b) => b.labels.ru === 'Знаковый вид'), true)
t('и его нет среди типов POI',
  registry.poiPrimaryTypes.some((x) => x.labels.ru === 'Знаковый вид'), false)

// ── Facets не подменяют структурированные поля ──────────────────────────
/* Первая редакция ADR завела free_entry, seasonal_bloom и indoor. У каждого
   есть своё поле: билетная политика, Season Window, доступность. Facet,
   дублирующий поле, создаёт второе место, где одно и то же расходится. */
empty('facets не дублируют существующие поля',
  ['free_entry', 'seasonal_bloom', 'indoor', 'ticket_price', 'season_window']
    .filter((c) => facetCodes.has(c)))

console.log(bad.length ? `✗ провалено ${bad.length}:\n  ` + bad.join('\n  ') : `✓ таксономия POI: ${ok} проверок пройдено`)
process.exitCode = bad.length ? 1 : 0
