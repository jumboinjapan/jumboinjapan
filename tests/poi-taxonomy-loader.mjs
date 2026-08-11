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
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const LOADER_REL = 'src/lib/poi-taxonomy.ts'
const NEXT_PROBE_REL = 'tests/poi-taxonomy-loader.next.ts'

const registry = JSON.parse(await readFile(path.join(ROOT, 'config/poi-taxonomy.v1.json'), 'utf8'))
const loaderSource = await readFile(path.join(ROOT, LOADER_REL), 'utf8')
const nextProbeSource = await readFile(path.join(ROOT, NEXT_PROBE_REL), 'utf8')

/* Импорт по относительному пути, а не по алиасу @/: так модуль читает node.
   Алиасный путь проверяется отдельно — тестом на tests/poi-taxonomy-loader.next.ts
   и командой npm run typecheck. */
const tx = await import(pathToFileURL(path.join(ROOT, LOADER_REL)).href)

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

const codes = (list) => list.map((item) => item.code)
const clone = () => JSON.parse(JSON.stringify(registry))

// ── 1. Импорт из node ─────────────────────────────────────────────────────
// Атрибут импорта JSON обязателен в обоих рантаймах: без него node падает на
// ERR_IMPORT_ATTRIBUTE_MISSING, а сборка Next проходит — расхождение всплыло бы
// только в production. Сам факт успешного импорта выше это и проверяет.

t('версия читается из реестра', tx.taxonomyVersion, registry.version)
t('примечание читается из реестра', tx.taxonomyNote, registry.note)
t('модуль импортирует ровно один JSON', (loaderSource.match(/\bfrom '[^']+\.json'/g) ?? []).length, 1)
t(
  'импортируется именно реестр',
  /from '\.\.\/\.\.\/config\/poi-taxonomy\.v1\.json' with \{ type: 'json' \}/.test(loaderSource),
  true,
)

// ── 2. Производные равны реестру ──────────────────────────────────────────

eq('коды видов сущностей', tx.entityKindCodes, codes(registry.entityKinds))
eq('коды типов POI', tx.poiPrimaryTypeCodes, codes(registry.poiPrimaryTypes))
eq('коды групп типов', tx.poiTypeGroupCodes, codes(registry.poiTypeGroups))
eq('коды фасетов', tx.facetCodes, codes(registry.facets))
eq('коды бейджей', tx.badgeCodes, codes(registry.badges))
eq('исходы', tx.dispositions, registry.dispositions)
eq('адреса каталогов', tx.catalogTargets, registry.catalogTargets)
eq('идентификаторы правил', tx.routingPolicy.map((r) => r.id), registry.routingPolicy.map((r) => r.id))
eq('языки', tx.languages, Object.keys(registry.entityKinds[0].labels))
t('язык по умолчанию', tx.defaultLanguage, Object.keys(registry.entityKinds[0].labels)[0])
t('миграции легаси-категорий', tx.legacyCategoryMigrations.length, registry.legacyCategoryMigrations.length)

// Подписи: сверяются посимвольно и для каждого языка. Именно этот блок
// поймает «почти такой же» перевод, если кто-то заведёт его в потребителе.
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

// Группа и признак автоимпорта едут вместе с типом, а не отдельным списком.
eq(
  'группа и автоимпорт у каждого типа',
  tx.poiTypeOptions().map((o) => [o.code, o.group, o.autoImportAllowed]),
  registry.poiPrimaryTypes.map((type) => [type.code, type.group, type.autoImportAllowed]),
)

throws('подпись на незаявленном языке бросает', () => tx.poiTypeLabel(registry.poiPrimaryTypes[0].code, 'xx'))
throws('подпись у несуществующего кода бросает', () => tx.poiTypeLabel('нет-такого-кода'))

// ── 3. Неизменяемость ─────────────────────────────────────────────────────
// ESM всегда строгий, поэтому запись во frozen бросает TypeError, а не молча
// проходит. Проверяются все уровни: корень, массив, элемент, вложенные подписи
// и свежесобранный список опций.

const firstType = tx.poiPrimaryTypes[0]
const versionBefore = tx.taxonomy.version

/* Если заморозки нет, правка проходит и портит общий экземпляр для всех
   последующих проверок. Поэтому удавшуюся правку тут же откатываем: тест
   обязан сообщать «не заморожено», а не падать через двадцать строк с
   «Cannot read properties of undefined». */
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
immutable('добавление поля в реестр', () => { tx.taxonomy.подмена = 1 }, () => { delete tx.taxonomy.подмена })
immutable('удаление поля из реестра', () => { delete tx.taxonomy.version }, () => { tx.taxonomy.version = versionBefore })
immutable('правка собранных опций', () => { tx.poiTypeOptions()[0].label = 'подменено' })

t('версия после попыток правки', tx.taxonomy.version, versionBefore)
t('число типов после попыток правки', tx.poiPrimaryTypes.length, registry.poiPrimaryTypes.length)
t('код первого типа после попыток правки', firstType.code, registry.poiPrimaryTypes[0].code)

// Свежий вызов отдаёт новый объект, а не тот же самый: иначе правка одного
// потребителя доехала бы до другого через общий кэш.
t('опции собираются заново', tx.poiTypeOptions() === tx.poiTypeOptions(), false)

// ── 4. Ни одной ручной копии ──────────────────────────────────────────────
/* Определение копии: строковый литерал в исходнике loader'а, совпадающий со
   строковым ЗНАЧЕНИЕМ из реестра. Ключи реестра не считаются — это имена
   полей, без них файл не прочитать. Сравнение точное, не по вхождению:
   иначе «en» ловилось бы в каждом английском слове.

   Оговорка, которую видно и её видно намеренно: слово «unknown» служит и
   управляющим состоянием, и кодом вида сущности. Поэтому разрешение на него
   формально прикрывает и второе значение. Сузить нельзя, пока реестр не
   объявит состояния списком; если объявит — CONTROL_VOCABULARY уедет туда. */
const CONTROL_ALLOWED = new Set(tx.CONTROL_VOCABULARY)
t('служебный словарь ровно из трёх слов', tx.CONTROL_VOCABULARY.length, 3)

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
  [...new Set(literals)].filter((value) => registryStrings.has(value) && !CONTROL_ALLOWED.has(value)),
)
empty(
  'служебные слова, которых нет в реестре',
  tx.CONTROL_VOCABULARY.filter((word) => !registryStrings.has(word)),
)

// ── 5. Маршрутизация ──────────────────────────────────────────────────────
/* Ожидание считается независимо: тест сам ищет первое подходящее правило по
   реестру. Совпадение с resolveRoute означает, что loader не изобрёл своей
   политики и не переставил приоритеты. */
const TYPE_CODES = new Set(codes(registry.poiPrimaryTypes))
const POLICY_STATES = new Set(
  registry.routingPolicy.map((r) => r.typeState).filter((s) => TYPE_CODES.has(s)),
)
const stateOf = (code) => {
  if (!code) return 'unknown'
  if (POLICY_STATES.has(code)) return code
  return TYPE_CODES.has(code) ? 'known' : 'unknown'
}
const expectedRule = (entityKind, typeCode, source) => {
  const state = stateOf(typeCode)
  return registry.routingPolicy.find(
    (r) =>
      r.entityKind === entityKind &&
      (r.typeState === 'any' || r.typeState === state) &&
      (r.classificationSource === 'any' || r.classificationSource === source),
  )
}

eq('политика упоминает ровно эти типы как состояния', tx.policyTypeStates, [...POLICY_STATES])

const knownType = registry.poiPrimaryTypes.find((type) => type.autoImportAllowed).code
const policyType = [...POLICY_STATES][0]
const typeSamples = [knownType, policyType, 'заведомо-несуществующий-тип', null]
const sources = [...new Set(registry.routingPolicy.map((r) => r.classificationSource))].filter(
  (s) => s !== 'any',
)
if (!sources.length) sources.push('model')

let combos = 0
const routingMismatch = []
for (const kind of codes(registry.entityKinds)) {
  for (const typeCode of typeSamples) {
    for (const source of sources) {
      combos++
      const want = expectedRule(kind, typeCode, source)
      if (!want) {
        routingMismatch.push(`${kind}/${typeCode}/${source}: в реестре нет правила`)
        continue
      }
      let got
      try {
        got = tx.resolveRoute({ entityKind: kind, poiPrimaryType: typeCode, classificationSource: source })
      } catch (error) {
        routingMismatch.push(`${kind}/${typeCode}/${source}: бросил «${error.message}»`)
        continue
      }
      if (got.ruleId !== want.id) {
        routingMismatch.push(`${kind}/${typeCode}/${source}: правило ${got.ruleId} ≠ ${want.id}`)
      }
      if (got.disposition !== want.disposition) {
        routingMismatch.push(`${kind}/${typeCode}/${source}: исход ${got.disposition} ≠ ${want.disposition}`)
      }
      if (got.catalogTarget !== (want.catalogTarget ?? null)) {
        routingMismatch.push(`${kind}/${typeCode}/${source}: каталог ${got.catalogTarget} ≠ ${want.catalogTarget}`)
      }
      if (got.requiresNote !== (want.requiresNote === true)) {
        routingMismatch.push(`${kind}/${typeCode}/${source}: требование заметки разошлось`)
      }
      if (got.typeState !== stateOf(typeCode)) {
        routingMismatch.push(`${kind}/${typeCode}/${source}: состояние ${got.typeState} ≠ ${stateOf(typeCode)}`)
      }
    }
  }
}
t('перебор покрыл все сочетания', combos, registry.entityKinds.length * typeSamples.length * sources.length)
empty('расхождения маршрутизации', routingMismatch)

// Резервный тип не должен считаться обычным известным: иначе правило про него
// становится недостижимым. Проверяется отдельно, без опоры на перебор выше.
t('состояние резервного типа — он сам', tx.typeStateOf(policyType), policyType)
t('состояние обычного типа — обобщённое', tx.typeStateOf(knownType), 'known')
t('состояние чужого кода — обобщённое', tx.typeStateOf('нет-такого'), 'unknown')
t('состояние пустого значения', tx.typeStateOf(null), 'unknown')

throws('незаявленный вид сущности бросает', () =>
  tx.resolveRoute({ entityKind: 'нет-такого-вида', classificationSource: sources[0] }))
throws('пустой вид сущности бросает', () =>
  tx.resolveRoute({ entityKind: '  ', classificationSource: sources[0] }))
throws('пустой источник классификации бросает', () =>
  tx.resolveRoute({ entityKind: codes(registry.entityKinds)[0], classificationSource: '' }))

// ── 6. Валидатор ──────────────────────────────────────────────────────────

empty('настоящий реестр без претензий', tx.taxonomyProblems(clone()))
t('валидатор на чужом типе данных', tx.taxonomyProblems('строка').length > 0, true)
t('валидатор на null', tx.taxonomyProblems(null).length > 0, true)

const broken = [
  ['версия не того вида', (r) => { r.version = 'v1' }],
  ['дублирующийся код типа', (r) => { r.poiPrimaryTypes.push({ ...r.poiPrimaryTypes[0] }) }],
  ['тип ссылается на несуществующую группу', (r) => { r.poiPrimaryTypes[0].group = 'нет-такой-группы' }],
  ['правило ссылается на несуществующий вид', (r) => { r.routingPolicy[0].entityKind = 'нет-такого-вида' }],
  ['правило с незаявленным исходом', (r) => { r.routingPolicy[0].disposition = 'нет-такого-исхода' }],
  ['правило с незаявленным каталогом', (r) => { r.routingPolicy[0].catalogTarget = 'нет-такого-каталога' }],
  ['состояние типа ни слово, ни код', (r) => { r.routingPolicy[0].typeState = 'нет-такого-состояния' }],
  ['вид сущности без единого правила', (r) => { r.entityKinds.push({ code: 'висяк', labels: { ...r.entityKinds[0].labels } }) }],
  ['подписи с другим набором языков', (r) => { delete r.facets[0].labels[Object.keys(r.facets[0].labels)[0]] }],
  ['пустая подпись', (r) => { r.badges[0].labels[Object.keys(r.badges[0].labels)[0]] = '  ' }],
  ['группа без типов', (r) => { r.poiTypeGroups.push({ code: 'пустая', labels: { ...r.poiTypeGroups[0].labels } }) }],
  ['миграция в несуществующий тип', (r) => { r.legacyCategoryMigrations[0].mapsTo = 'нет-такого-типа' }],
  ['поле не массив', (r) => { r.facets = {} }],
]
for (const [label, corrupt] of broken) {
  const candidate = clone()
  corrupt(candidate)
  const problems = tx.taxonomyProblems(candidate)
  t(`валидатор ловит: ${label}`, problems.length > 0, true)
  throws(`assert бросает: ${label}`, () => tx.assertTaxonomyInvariants(candidate))
}

// ── 7. Импорт из TypeScript/Next-контекста ────────────────────────────────
/* Проба tests/poi-taxonomy-loader.next.ts импортирует loader по алиасу @/,
   который резолвит только tsconfig и сборка Next — node такой путь не знает.
   Доказательство там компиляционное (npm run typecheck), поэтому здесь
   проверяется, что проба существует и не выродилась в относительный импорт. */
t(
  'проба Next импортирует по алиасу',
  /from '@\/lib\/poi-taxonomy'/.test(nextProbeSource),
  true,
)
t(
  'проба Next не подменена относительным путём',
  /from '\.\.?\//.test(nextProbeSource),
  false,
)
t(
  'проба Next действительно использует значения',
  /resolveRoute|poiTypeOptions/.test(nextProbeSource),
  true,
)

// ── Итог ──────────────────────────────────────────────────────────────────

if (bad.length) {
  console.error(`Loader таксономии: ${bad.length} провалов из ${ok + bad.length}`)
  for (const line of bad) console.error(`  ✗ ${line}`)
  process.exit(1)
}
console.log(`Loader таксономии: ${ok} проверок пройдено`)
