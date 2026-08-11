/**
 * Loader реестра таксономии: импорт, неизменяемость, отсутствие копий.
 *
 * Потребитель № 1 по ADR-0001 §13. Проверяется ТОЛЬКО src/lib/poi-taxonomy.ts.
 * Ни Intake, ни Airtable, ни XLSX, ни классификатор здесь не участвуют — их
 * подключение идёт отдельными коммитами.
 *
 * Разделение с tests/poi-taxonomy.mjs: там проверяется сам реестр и две схемы,
 * здесь — что модуль отдаёт ровно его содержимое, ничего не досочиняя и не
 * позволяя себя испортить.
 */
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const REGISTRY_REL = 'config/poi-taxonomy.v1.json'
const LOADER_REL = 'src/lib/poi-taxonomy.ts'
const NEXT_PROBE_REL = 'tests/poi-taxonomy-loader.next.ts'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (Object.is(actual, expected)) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const eq = (label, actual, expected) => t(label, JSON.stringify(actual), JSON.stringify(expected))
const empty = (label, list) => t(label, list.length ? list.join('; ') : '—', '—')
const throws = (label, fn, expectedType = Error) => {
  try {
    fn()
    bad.push(`${label}: ждали исключение, вызов прошёл`)
  } catch (error) {
    if (error instanceof expectedType) ok++
    else bad.push(`${label}: ждали ${expectedType.name}, получили ${error?.constructor?.name}`)
  }
}

const finish = () => {
  if (bad.length) {
    console.error(`Loader таксономии: ${bad.length} провалов из ${ok + bad.length}`)
    for (const line of bad) console.error(`  \u2717 ${line}`)
    process.exit(1)
  }
  console.log(`Loader таксономии: ${ok} проверок пройдено`)
  process.exit(0)
}

const codes = (list) => list.map((item) => item.code)

const registryBytes = await readFile(path.join(ROOT, REGISTRY_REL))

// ── 1. Байты файла реестра ────────────────────────────────────────────────
/* Спецификация хеша — raw-file-bytes/v1: считается SHA-256 от точных байтов
   файла. Значит форматирование файла входит в контракт наравне с его
   содержимым: BOM, перевод строки Windows или лишняя пустая строка в конце
   изменят хеш, не изменив ни одного значения. Закрепляем здесь, до того как
   хеш куда-либо записан. */
t('реестр без BOM', registryBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false)
t('реестр без возврата каретки', registryBytes.includes(0x0d), false)
t('реестр заканчивается переводом строки', registryBytes.at(-1), 0x0a)
t('в конце реестра ровно один перевод строки', registryBytes.at(-2) === 0x0a, false)
t(
  'реестр — корректный UTF-8 без потерь',
  Buffer.compare(Buffer.from(registryBytes.toString('utf8'), 'utf8'), registryBytes),
  0,
)

/* BOM снимается только для разбора внутри теста: сам loader импортирует файл
   как модуль и на BOM споткнётся. Поэтому проверка выше сообщает о нём
   отдельной строкой, а импорт ниже обёрнут — иначе отчёт заменился бы
   стектрейсом разбора JSON. */
const registry = JSON.parse(registryBytes.toString('utf8').replace(/^\uFEFF/, ''))
const loaderSource = await readFile(path.join(ROOT, LOADER_REL), 'utf8')
const nextProbeSource = await readFile(path.join(ROOT, NEXT_PROBE_REL), 'utf8')

const clone = () => JSON.parse(JSON.stringify(registry))
const VOCAB = registry.routingVocabulary
const WILDCARD = VOCAB.wildcard
const SOURCES = VOCAB.classificationSources

// ── 2. Импорт из node ─────────────────────────────────────────────────────
/* Импорт по относительному пути, а не по алиасу @/: так модуль читает node.
   Атрибут импорта JSON обязателен в обоих рантаймах: без него node падает на
   ERR_IMPORT_ATTRIBUTE_MISSING, а сборка Next проходит — расхождение всплыло бы
   только в production. */
let tx = null
try {
  tx = await import(pathToFileURL(path.join(ROOT, LOADER_REL)).href)
  ok++
} catch (error) {
  bad.push(`импорт loader'а из node: ${error?.message}`)
  finish()
}

t('версия читается из реестра', tx.taxonomyVersion, registry.version)
t('примечание читается из реестра', tx.taxonomyNote, registry.note)
t('модуль импортирует ровно один JSON', (loaderSource.match(/\bfrom '[^']+\.json'/g) ?? []).length, 1)
t(
  'импортируется именно реестр',
  /from '\.\.\/\.\.\/config\/poi-taxonomy\.v1\.json' with \{ type: 'json' \}/.test(loaderSource),
  true,
)

// ── 3. Производные равны реестру ──────────────────────────────────────────

eq('коды видов сущностей', tx.entityKindCodes, codes(registry.entityKinds))
eq('коды типов POI', tx.poiPrimaryTypeCodes, codes(registry.poiPrimaryTypes))
eq('коды групп типов', tx.poiTypeGroupCodes, codes(registry.poiTypeGroups))
eq('коды фасетов', tx.facetCodes, codes(registry.facets))
eq('коды бейджей', tx.badgeCodes, codes(registry.badges))
eq('исходы', tx.dispositions, registry.dispositions)
eq('адреса каталогов', tx.catalogTargets, registry.catalogTargets)
eq('идентификаторы правил', tx.routingPolicy.map((r) => r.id), registry.routingPolicy.map((r) => r.id))
t('миграции легаси-категорий', tx.legacyCategoryMigrations.length, registry.legacyCategoryMigrations.length)

// ── 4. Языки объявлены, а не выведены ─────────────────────────────────────
/* Раньше язык по умолчанию был первым ключом первого объекта labels, то есть
   перестановка ru и en в JSON незаметно меняла поведение всех потребителей.
   Теперь оба значения объявлены полями реестра. */
eq('языки', tx.languages, registry.languages)
t('язык по умолчанию', tx.defaultLanguage, registry.defaultLanguage)

/* Проверка не на глаз, а опытом: собираем во временной папке копию loader'а
   рядом с изменённым реестром и импортируем её как отдельный модуль. Так видно
   поведение, а не текст исходника. */
const LABELLED = ['entityKinds', 'excludeReasons', 'poiTypeGroups', 'poiPrimaryTypes', 'facets', 'badges']
const sandbox = await mkdtemp(path.join(os.tmpdir(), 'poi-taxonomy-'))
const loadVariant = async (name, mutate) => {
  const dir = path.join(sandbox, name)
  await mkdir(path.join(dir, 'config'), { recursive: true })
  await mkdir(path.join(dir, 'src', 'lib'), { recursive: true })
  const variant = clone()
  mutate(variant)
  await writeFile(path.join(dir, REGISTRY_REL), JSON.stringify(variant, null, 2) + '\n')
  await copyFile(path.join(ROOT, LOADER_REL), path.join(dir, LOADER_REL))
  return import(pathToFileURL(path.join(dir, LOADER_REL)).href)
}

// Ключи подписей переставлены (en раньше ru), объявленный язык не тронут.
// Прежняя реализация брала первый ключ первого объекта — и молча переехала бы
// на английский, не изменив ни одного объявленного поля.
const swapped = await loadVariant('swapped-keys', (variant) => {
  for (const field of LABELLED) {
    for (const item of variant[field]) {
      item.labels = Object.fromEntries(Object.entries(item.labels).reverse())
    }
  }
})
t('перестановка ключей не меняет язык по умолчанию', swapped.defaultLanguage, registry.defaultLanguage)
eq('и не меняет объявленный порядок языков', swapped.languages, registry.languages)
t(
  'и не меняет язык собранных подписей',
  swapped.poiTypeOptions()[0].label,
  registry.poiPrimaryTypes[0].labels[registry.defaultLanguage],
)

// А объявленное поле — меняет. Иначе проверка выше проходила бы и на модуле,
// который язык по умолчанию просто зашил.
const otherLang = registry.languages.find((lang) => lang !== registry.defaultLanguage)
const switched = await loadVariant('other-default', (variant) => { variant.defaultLanguage = otherLang })
t('объявленный язык по умолчанию действительно применяется', switched.defaultLanguage, otherLang)
t(
  'и подписи собираются на нём',
  switched.poiTypeOptions()[0].label,
  registry.poiPrimaryTypes[0].labels[otherLang],
)

for (const lang of tx.languages) {
  eq(
    `подписи типов (${lang})`,
    tx.poiTypeOptions(lang).map((o) => [o.code, o.label]),
    registry.poiPrimaryTypes.map((type) => [type.code, type.labels[lang]]),
  )
  eq(
    `подписи фасетов (${lang})`,
    tx.facetOptions(lang).map((o) => [o.code, o.label]),
    registry.facets.map((item) => [item.code, item.labels[lang]]),
  )
  eq(
    `подписи бейджей (${lang})`,
    tx.badgeOptions(lang).map((o) => [o.code, o.label]),
    registry.badges.map((item) => [item.code, item.labels[lang]]),
  )
  eq(
    `подписи видов сущностей (${lang})`,
    tx.entityKindOptions(lang).map((o) => [o.code, o.label]),
    registry.entityKinds.map((item) => [item.code, item.labels[lang]]),
  )
}

eq(
  'группа и автоимпорт у каждого типа',
  tx.poiTypeOptions().map((o) => [o.code, o.group, o.autoImportAllowed]),
  registry.poiPrimaryTypes.map((type) => [type.code, type.group, type.autoImportAllowed]),
)

throws('подпись на незаявленном языке бросает', () => tx.poiTypeLabel(registry.poiPrimaryTypes[0].code, 'xx'))
throws('подпись у несуществующего кода бросает', () => tx.poiTypeLabel('нет-такого-кода'))

// ── 5. Словарь маршрутизации объявлен реестром ────────────────────────────

eq('словарь маршрутизации', tx.routingVocabulary, registry.routingVocabulary)
eq('источники классификации', tx.classificationSources, SOURCES)
eq(
  'состояния типа',
  [...tx.typeStates].sort(),
  [...new Set([VOCAB.typeStateKnown, VOCAB.typeStateUnknown, ...tx.policyTypeStates])].sort(),
)
t('служебного словаря в коде больше нет', 'CONTROL_VOCABULARY' in tx, false)

// ── 6. Неизменяемость ─────────────────────────────────────────────────────
/* Если заморозки нет, правка проходит и портит общий экземпляр для всех
   последующих проверок. Поэтому удавшуюся правку тут же откатываем: тест
   обязан сообщать «не заморожено», а не падать через двадцать строк с
   «Cannot read properties of undefined». */

const firstType = tx.poiPrimaryTypes[0]
const versionBefore = tx.taxonomy.version

const immutable = (label, mutate, undo) => {
  try {
    mutate()
    bad.push(`${label}: правка прошла — объект не заморожен`)
    if (undo) {
      try { undo() } catch { /* откат — лучшее усилие, отчёт уже записан */ }
    }
  } catch (error) {
    if (error instanceof TypeError) ok++
    else bad.push(`${label}: ждали TypeError, получили ${error?.constructor?.name}: ${error?.message}`)
  }
}

immutable('правка версии', () => { tx.taxonomy.version = 'подменено' }, () => { tx.taxonomy.version = versionBefore })
immutable('добавление типа', () => { tx.poiPrimaryTypes.push({ code: 'подменено' }) }, () => { tx.poiPrimaryTypes.pop() })
immutable('правка кода типа', () => { firstType.code = 'подменено' }, () => { firstType.code = registry.poiPrimaryTypes[0].code })
immutable(
  'правка подписи типа',
  () => { firstType.labels[tx.defaultLanguage] = 'подменено' },
  () => { firstType.labels[tx.defaultLanguage] = registry.poiPrimaryTypes[0].labels[tx.defaultLanguage] },
)
immutable('правка списка кодов', () => { tx.entityKindCodes.push('подменено') }, () => { tx.entityKindCodes.pop() })
immutable(
  'правка правила маршрутизации',
  () => { tx.routingPolicy[0].disposition = 'подменено' },
  () => { tx.routingPolicy[0].disposition = registry.routingPolicy[0].disposition },
)
immutable(
  'правка словаря маршрутизации',
  () => { tx.routingVocabulary.wildcard = 'подменено' },
  () => { tx.routingVocabulary.wildcard = WILDCARD },
)
immutable('правка списка языков', () => { tx.languages.push('подменено') }, () => { tx.languages.pop() })
immutable('добавление поля в реестр', () => { tx.taxonomy.подмена = 1 }, () => { delete tx.taxonomy.подмена })
immutable('удаление поля из реестра', () => { delete tx.taxonomy.version }, () => { tx.taxonomy.version = versionBefore })
immutable('правка собранных опций', () => { tx.poiTypeOptions()[0].label = 'подменено' })

t('версия после попыток правки', tx.taxonomy.version, versionBefore)
t('число типов после попыток правки', tx.poiPrimaryTypes.length, registry.poiPrimaryTypes.length)
t('код первого типа после попыток правки', firstType.code, registry.poiPrimaryTypes[0].code)
t('опции собираются заново', tx.poiTypeOptions() === tx.poiTypeOptions(), false)

// ── 7. Ни одной ручной копии ──────────────────────────────────────────────
/* Определение копии: строковый литерал в исходнике loader'а, совпадающий со
   строковым ЗНАЧЕНИЕМ из реестра. Ключи реестра не считаются — это имена
   полей, без них файл не прочитать. Сравнение точное, не по вхождению:
   иначе «en» ловилось бы в каждом английском слове.

   Исключений больше нет: служебные слова маршрутизации и набор языков
   объявлены в самом реестре, поэтому список разрешённых совпадений пуст. */

const registryStrings = new Set()
;(function walk(node) {
  if (typeof node === 'string') registryStrings.add(node)
  else if (Array.isArray(node)) node.forEach(walk)
  else if (node && typeof node === 'object') Object.values(node).forEach(walk)
})(registry)

const stripped = loaderSource
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const literals = []
for (const match of stripped.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
  literals.push(match[1] ?? match[2] ?? match[3] ?? '')
}
// Если регулярка когда-нибудь перестанет находить литералы, проверка ниже
// станет зелёной ни на чём. Порог намеренно грубый.
t('литералы в исходнике вообще находятся', literals.length > 20, true)

empty(
  'копии значений реестра в loader’е',
  [...new Set(literals)].filter((value) => registryStrings.has(value)),
)

// ── 8. Маршрутизация не зависит от порядка правил ─────────────────────────
/* Ожидание считается независимо: тест сам собирает ВСЕ подходящие правила по
   реестру и требует ровно одного. Совпадение с resolveRoute означает, что
   loader не изобрёл своей политики и не разрешает неоднозначность порядком
   строк в файле. */
const TYPE_CODES = new Set(codes(registry.poiPrimaryTypes))
const POLICY_STATES = new Set(
  registry.routingPolicy.map((r) => r.typeState).filter((s) => TYPE_CODES.has(s)),
)
const stateOf = (code) => {
  if (!code) return VOCAB.typeStateUnknown
  if (POLICY_STATES.has(code)) return code
  return TYPE_CODES.has(code) ? VOCAB.typeStateKnown : VOCAB.typeStateUnknown
}
const matchingRules = (entityKind, typeCode, source) => {
  const state = stateOf(typeCode)
  return registry.routingPolicy.filter(
    (r) =>
      r.entityKind === entityKind &&
      (r.typeState === WILDCARD || r.typeState === state) &&
      (r.classificationSource === WILDCARD || r.classificationSource === source),
  )
}

eq('политика упоминает ровно эти типы как состояния', tx.policyTypeStates, [...POLICY_STATES])

const knownType = registry.poiPrimaryTypes.find((type) => type.autoImportAllowed).code
const policyType = [...POLICY_STATES][0]
const typeSamples = [knownType, policyType, 'заведомо-несуществующий-тип', null]

let combos = 0
const routingMismatch = []
const ambiguous = []
for (const kind of codes(registry.entityKinds)) {
  for (const typeCode of typeSamples) {
    for (const source of SOURCES) {
      combos++
      const want = matchingRules(kind, typeCode, source)
      if (want.length !== 1) {
        ambiguous.push(`${kind}/${typeCode}/${source}: подходящих правил ${want.length}`)
        continue
      }
      let got
      try {
        got = tx.resolveRoute({ entityKind: kind, poiPrimaryType: typeCode, classificationSource: source })
      } catch (error) {
        routingMismatch.push(`${kind}/${typeCode}/${source}: бросил «${error.message}»`)
        continue
      }
      if (got.ruleId !== want[0].id) {
        routingMismatch.push(`${kind}/${typeCode}/${source}: правило ${got.ruleId} ≠ ${want[0].id}`)
      }
      if (got.disposition !== want[0].disposition) {
        routingMismatch.push(`${kind}/${typeCode}/${source}: исход ${got.disposition} ≠ ${want[0].disposition}`)
      }
      if (got.catalogTarget !== (want[0].catalogTarget ?? null)) {
        routingMismatch.push(`${kind}/${typeCode}/${source}: каталог ${got.catalogTarget} ≠ ${want[0].catalogTarget}`)
      }
      if (got.requiresNote !== (want[0].requiresNote === true)) {
        routingMismatch.push(`${kind}/${typeCode}/${source}: требование заметки разошлось`)
      }
      if (got.typeState !== stateOf(typeCode)) {
        routingMismatch.push(`${kind}/${typeCode}/${source}: состояние ${got.typeState} ≠ ${stateOf(typeCode)}`)
      }
    }
  }
}
t('перебор покрыл все сочетания', combos, registry.entityKinds.length * typeSamples.length * SOURCES.length)
empty('сочетания без ровно одного правила', ambiguous)
empty('расхождения маршрутизации', routingMismatch)

t('состояние резервного типа — он сам', tx.typeStateOf(policyType), policyType)
t('состояние обычного типа — обобщённое', tx.typeStateOf(knownType), VOCAB.typeStateKnown)
t('состояние чужого кода — обобщённое', tx.typeStateOf('нет-такого'), VOCAB.typeStateUnknown)
t('состояние пустого значения', tx.typeStateOf(null), VOCAB.typeStateUnknown)

throws('незаявленный вид сущности бросает', () =>
  tx.resolveRoute({ entityKind: 'нет-такого-вида', classificationSource: SOURCES[0] }))
throws('пустой вид сущности бросает', () =>
  tx.resolveRoute({ entityKind: '  ', classificationSource: SOURCES[0] }))
throws('пустой источник классификации бросает', () =>
  tx.resolveRoute({ entityKind: codes(registry.entityKinds)[0], classificationSource: '' }))
throws('незаявленный источник классификации бросает', () =>
  tx.resolveRoute({ entityKind: codes(registry.entityKinds)[0], classificationSource: 'нет-такого-источника' }))

// ── 9. Валидатор ──────────────────────────────────────────────────────────
/* Ключевое здесь — перебор сочетаний переехал в taxonomyProblems, поэтому
   пересекающееся правило ловится при загрузке модуля, а не только тестом.
   Пропущенный прогон тестов больше не пропускает неоднозначную политику. */

empty('настоящий реестр без претензий', tx.taxonomyProblems(clone()))
t('валидатор на чужом типе данных', tx.taxonomyProblems('строка').length > 0, true)
t('валидатор на null', tx.taxonomyProblems(null).length > 0, true)

const anyType = registry.poiPrimaryTypes[0].code
const someRule = registry.routingPolicy[0]

const broken = [
  ['версия не того вида', (r) => { r.version = 'v1' }],
  ['дублирующийся код типа', (r) => { r.poiPrimaryTypes.push({ ...r.poiPrimaryTypes[0] }) }],
  ['тип ссылается на несуществующую группу', (r) => { r.poiPrimaryTypes[0].group = 'нет-такой-группы' }],
  ['правило ссылается на несуществующий вид', (r) => { r.routingPolicy[0].entityKind = 'нет-такого-вида' }],
  ['правило с незаявленным исходом', (r) => { r.routingPolicy[0].disposition = 'нет-такого-исхода' }],
  ['правило с незаявленным каталогом', (r) => { r.routingPolicy[0].catalogTarget = 'нет-такого-каталога' }],
  ['правило с незаявленным источником', (r) => { r.routingPolicy[0].classificationSource = 'нет-такого-источника' }],
  ['состояние типа ни слово, ни код', (r) => { r.routingPolicy[0].typeState = 'нет-такого-состояния' }],
  ['вид сущности без единого правила', (r) => { r.entityKinds.push({ code: 'висяк', labels: { ...r.entityKinds[0].labels } }) }],
  ['подписи с другим набором языков', (r) => { delete r.facets[0].labels[r.languages[0]] }],
  ['пустая подпись', (r) => { r.badges[0].labels[r.languages[0]] = '  ' }],
  ['группа без типов', (r) => { r.poiTypeGroups.push({ code: 'пустая', labels: { ...r.poiTypeGroups[0].labels } }) }],
  ['миграция в несуществующий тип', (r) => { r.legacyCategoryMigrations[0].mapsTo = 'нет-такого-типа' }],
  ['поле не массив', (r) => { r.facets = {} }],
  ['нет словаря маршрутизации', (r) => { delete r.routingVocabulary }],
  ['пустое служебное слово', (r) => { r.routingVocabulary.wildcard = '' }],
  ['служебные слова совпали', (r) => { r.routingVocabulary.typeStateKnown = r.routingVocabulary.typeStateUnknown }],
  ['служебное слово совпало с кодом типа', (r) => { r.routingVocabulary.typeStateKnown = anyType }],
  ['источники содержат слово подстановки', (r) => { r.routingVocabulary.classificationSources.push(r.routingVocabulary.wildcard) }],
  ['пустой список источников', (r) => { r.routingVocabulary.classificationSources = [] }],
  ['язык по умолчанию не из списка', (r) => { r.defaultLanguage = 'zz' }],
  ['дубль в списке языков', (r) => { r.languages.push(r.languages[0]) }],
  ['подсказки на незаявленном языке', (r) => { r.poiPrimaryTypes[0].hints = { zz: ['что-то'] } }],
  [
    'пересекающееся правило',
    (r) => {
      r.routingPolicy.push({
        ...someRule,
        id: 'перекрытие',
        entityKind: 'tourist_poi',
        typeState: r.routingVocabulary.wildcard,
        classificationSource: r.routingVocabulary.wildcard,
      })
    },
  ],
  ['дыра в политике', (r) => { r.routingPolicy = r.routingPolicy.filter((rule) => rule.id !== 'poi_type_unknown') }],
]
for (const [label, corrupt] of broken) {
  const candidate = clone()
  corrupt(candidate)
  const problems = tx.taxonomyProblems(candidate)
  t(`валидатор ловит: ${label}`, problems.length > 0, true)
  throws(`assert бросает: ${label}`, () => tx.assertTaxonomyInvariants(candidate))
}

// Отдельно: сообщения двух новых проверок должны называть вещи своими именами,
// иначе диагностика при импорте окажется бесполезной.
const overlapped = clone()
overlapped.routingPolicy.push({
  ...someRule,
  id: 'перекрытие',
  entityKind: 'tourist_poi',
  typeState: overlapped.routingVocabulary.wildcard,
  classificationSource: overlapped.routingVocabulary.wildcard,
})
t(
  'сообщение о пересечении называет оба правила',
  tx.taxonomyProblems(overlapped).some((line) => line.includes('перекрытие') && line.includes('подходит сразу под')),
  true,
)

/* Недостижимое правило отдельным дефектом не конструируется, и это свойство
   модели, а не пробел в тесте: любое состояние типа, на которое ссылается
   правило, тем самым попадает в перебор, а пересечение засчитывается всем
   совпавшим правилам сразу. Проверка остаётся сторожем на случай изменения
   модели; что она жива, видно на правиле, уведённом к незаявленному виду
   сущности — там она срабатывает вместе с дырой в политике. */
const orphaned = clone()
orphaned.routingPolicy[0].entityKind = 'нет-такого-вида'
const orphanProblems = tx.taxonomyProblems(orphaned)
t(
  'правило у незаявленного вида признаётся недостижимым',
  orphanProblems.some((line) => line.includes(someRule.id) && line.includes('недостижимо')),
  true,
)
t(
  'и оставляет дыру в политике',
  orphanProblems.some((line) => line.includes('нет правила для')),
  true,
)

/* Валидатор обязан быть чистым: та же ссылка, изменённая между двумя
   вызовами, должна проверяться заново. Кэш по WeakMap этого не давал — я
   закэшировал коды типов и разрешённые источники на объекте-кандидате, и
   правка между вызовами оставалась невидимой: снятое разрешение продолжало
   действовать.

   Форма проверки — «сломать и починить ту же ссылку». Одного «стало хуже»
   мало: часть проверок строит множества на месте и на кэш не смотрит, поэтому
   испорченный кандидат даёт претензии в обоих случаях. А вот вернуться к
   чистому результату кандидат может, только если кэша нет. */

const evolving = clone()
empty('свежий кандидат без претензий', tx.taxonomyProblems(evolving))

const droppedSource = SOURCES[0]
evolving.routingVocabulary.classificationSources = ['owner']
const afterSource = tx.taxonomyProblems(evolving)
t('правка источников видна повторной проверке', afterSource.length > 0, true)
t(
  'и в претензии назван источник, потерявший объявление',
  afterSource.some((line) => line.includes(droppedSource)),
  true,
)
evolving.routingVocabulary.classificationSources = [...SOURCES]
empty('починка словаря на том же объекте снова даёт чистый результат', tx.taxonomyProblems(evolving))
/* Оговорка: эта пара — проверка чистоты вообще, а не ловушка на кэш.
   Разрешённые источники taxonomyProblems считает на месте, а кэш источников
   после того, как маршрутизация перестала быть публичной, снаружи не
   наблюдаем совсем. Его отсутствие держит текстовая проверка ниже. */

/* Порядок здесь важен: сначала ломаем, потом чиним. Если сделать наоборот,
   кэш успеет запомнить ПРАВИЛЬНОЕ значение и к концу опыта случайно совпадёт
   с истиной — проверка станет зелёной на кэшированном модуле. Так и вышло с
   первой редакцией этого теста. */
const healing = clone()
const droppedType = [...POLICY_STATES][0]
healing.poiPrimaryTypes = healing.poiPrimaryTypes.filter((type) => type.code !== droppedType)
const brokenTypes = tx.taxonomyProblems(healing)
t('удаление типа замечено', brokenTypes.length > 0, true)
t(
  'и в претензии назван исчезнувший тип',
  brokenTypes.some((line) => line.includes(droppedType)),
  true,
)
healing.poiPrimaryTypes = JSON.parse(JSON.stringify(registry.poiPrimaryTypes))
empty('возврат типа на место снова даёт чистый результат', tx.taxonomyProblems(healing))

/* Текстовая проверка остаётся сторожем сверх поведенческих: после того как
   маршрутизация перестала быть публичной, кэши источников и видов сущностей
   снаружи вообще не наблюдаемы — поведением их отсутствие не докажешь. */
t('кэшей по WeakMap в модуле не осталось', /WeakMap/.test(loaderSource), false)

// Перестановка правил не должна ни на что влиять.
const reversed = clone()
reversed.routingPolicy = [...reversed.routingPolicy].reverse()
empty('обратный порядок правил ничего не ломает', tx.taxonomyProblems(reversed))

/* Публичного обхода нет и быть не должно. Экспорт функции, принимавшей
   произвольный реестр, был дырой: подложить вместо канонической политики свою
   можно было одной строкой. Ветка про двусмысленность внутри осталась
   сторожем, но проверяется она не вызовом, а тем, что реестр с пересечением
   не импортируется — см. ниже. */
t('маршрутизация по произвольному реестру наружу не выведена', 'resolveRouteIn' in tx, false)
empty(
  'вообще ни одного экспорта, принимающего чужой реестр',
  Object.keys(tx).filter((name) => /^(resolve|route).*In$/.test(name)),
)

/* Тот самый опыт: в копии реестра у правила подменён каталог. Копия остаётся
   копией — маршрутизация работает только с загруженным замороженным реестром
   и подмены не видит. */
const tampered = clone()
const knownRule = tampered.routingPolicy.find((r) => r.typeState === VOCAB.typeStateKnown)
const foreignTarget = registry.catalogTargets.find((target) => target !== knownRule.catalogTarget)
knownRule.catalogTarget = foreignTarget
const straight = tx.resolveRoute({
  entityKind: knownRule.entityKind,
  poiPrimaryType: knownType,
  classificationSource: SOURCES[0],
})
t('подмена каталога в копии реестра ни на что не влияет', straight.catalogTarget,
  registry.routingPolicy.find((r) => r.id === knownRule.id).catalogTarget)
t('и подменённый каталог не просочился', straight.catalogTarget === foreignTarget, false)

/* И главное следствие пункта про перебор: реестр с пересекающимся правилом
   не просто отмечается валидатором — он вообще не импортируется. Импорт в
   production падает независимо от того, запускались тесты или нет. */
let overlapImported = false
try {
  await loadVariant('overlapping-registry', (variant) => {
    variant.routingPolicy.push({
      ...someRule,
      id: 'перекрытие',
      entityKind: 'tourist_poi',
      typeState: variant.routingVocabulary.wildcard,
      classificationSource: variant.routingVocabulary.wildcard,
    })
  })
  overlapImported = true
} catch (error) {
  t(
    'импорт реестра с пересечением падает с внятной причиной',
    error.message.includes('подходит сразу под'),
    true,
  )
}
t('реестр с пересечением не импортируется', overlapImported, false)

// ── 10. Импорт из TypeScript-контекста ────────────────────────────────────
/* Проба tests/poi-taxonomy-loader.next.ts импортирует loader по алиасу @/,
   который резолвят только tsconfig и сборка Next — node такой путь не знает.
   Доказательство там ровно двух вещей: файл компилируется и алиас
   разрешается. Совместимость сборщика Next она НЕ доказывает — это выяснится,
   когда loader впервые войдёт в граф Next у настоящего потребителя.
   Здесь проверяется только, что проба существует и не выродилась. */
t(
  'проба импортирует по алиасу',
  /from '@\/lib\/poi-taxonomy'/.test(nextProbeSource),
  true,
)
t(
  'проба не подменена относительным путём',
  /from '\.\.?\//.test(nextProbeSource),
  false,
)
t(
  'проба действительно использует значения',
  /resolveRoute|poiTypeOptions/.test(nextProbeSource),
  true,
)

await rm(sandbox, { recursive: true, force: true })

// ── Итог ──────────────────────────────────────────────────────────────────

finish()
