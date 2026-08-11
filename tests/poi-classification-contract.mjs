/**
 * Контракт классификации портального конвейера: потребитель № 2a.
 *
 * Проверяется граница «предложение → происхождение → маршрут»: что модель
 * предлагает и только предлагает, что происхождение проставляет вызывающий
 * код, и что маршрут вычисляет исключительно реестр.
 *
 * Production Intake, Airtable и XLSX здесь не участвуют.
 */
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const rel = (p) => path.join(ROOT, p)

const LOADER = 'src/lib/poi-taxonomy.ts'
const CONTRACT = 'scripts/poi-portals/lib/classification-contract.mjs'
const SCORING = 'scripts/poi-portals/lib/scoring.mjs'
const ENRICH = 'scripts/poi-portals/lib/enrich.mjs'
const BRIDGE = 'scripts/poi-portals/lib/legacy-airtable-category-bridge.mjs'
const COLLECT = 'scripts/poi-portals/collect-pois.mjs'
const STORE = 'scripts/poi-portals/lib/airtable-store.mjs'
const BASELINE = 'tmp/dry-osaka-pre-taxonomy-e4bc27d.json'
const BASELINE_DIGEST = 'sha256:abb8afb31fa1ed7347d5bfbabfa1931605ea033efe1aa93682c640bd5f4f82db'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (Object.is(actual, expected)) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const eq = (label, a, b) => t(label, JSON.stringify(a), JSON.stringify(b))
const empty = (label, list) => t(label, list.length ? list.join('; ') : '—', '—')
const throws = (label, fn) => {
  try { fn(); bad.push(`${label}: ждали исключение, вызов прошёл`) } catch { ok++ }
}
const finish = () => {
  if (bad.length) {
    console.error(`Контракт классификации: ${bad.length} провалов из ${ok + bad.length}`)
    for (const line of bad) console.error(`  ✗ ${line}`)
    process.exit(1)
  }
  console.log(`Контракт классификации: ${ok} проверок пройдено`)
  process.exit(0)
}

const registry = JSON.parse(await readFile(rel('config/poi-taxonomy.v2.json'), 'utf8'))
const classificationSchema = JSON.parse(await readFile(rel('config/poi-classification.schema.json'), 'utf8'))
const src = Object.fromEntries(await Promise.all(
  [CONTRACT, SCORING, ENRICH, BRIDGE, COLLECT, STORE].map(async (p) => [p, await readFile(rel(p), 'utf8')]),
))

const contract = await import(pathToFileURL(rel(CONTRACT)).href)
const scoring = await import(pathToFileURL(rel(SCORING)).href)
const enrich = await import(pathToFileURL(rel(ENRICH)).href)
const bridge = await import(pathToFileURL(rel(BRIDGE)).href)

const SOURCES = registry.routingVocabulary.classificationSources
const TYPE_CODES = registry.poiPrimaryTypes.map((x) => x.code)
const KIND_CODES = registry.entityKinds.map((x) => x.code)
const FACET_CODES = registry.facets.map((x) => x.code)
const KNOWN_TYPE = registry.poiPrimaryTypes.find((x) => x.autoImportAllowed).code
const FALLBACK = registry.routingPolicy.map((r) => r.typeState).find((s) => TYPE_CODES.includes(s))

const proposal = (over = {}) => ({
  entityKind: 'tourist_poi', poiPrimaryType: KNOWN_TYPE, facets: [],
  confidence: 0.9, reasons: ['тест'], nameRu: 'Тест', ...over,
})

// ── 1. Происхождение назначает вызывающий код ─────────────────────────────

t('источник rule объявлен реестром', SOURCES.includes(contract.SOURCE_RULE), true)
t('источник model объявлен реестром', SOURCES.includes(contract.SOURCE_MODEL), true)
t('в модуле названы ровно два источника', contract.DECLARED_SOURCE_NAMES.length, 2)

const asRule = contract.classify({ proposal: proposal(), classificationSource: contract.SOURCE_RULE })
const asModel = contract.classify({ proposal: proposal(), classificationSource: contract.SOURCE_MODEL })
t('правило помечается как rule', asRule.classificationSource, contract.SOURCE_RULE)
t('модель помечается как model', asModel.classificationSource, contract.SOURCE_MODEL)
t('обычный тип из правила идёт в каталог', asRule.catalogTarget, 'poi')
throws('незаявленный источник отвергается', () =>
  contract.classify({ proposal: proposal(), classificationSource: 'owner' }))
throws('предложение с происхождением внутри отвергается', () =>
  contract.classify({ proposal: proposal({ classificationSource: 'human' }), classificationSource: 'model' }))

// Резервный тип: машина обосновать его не может — обе машины получают остановку.
for (const source of [contract.SOURCE_RULE, contract.SOURCE_MODEL]) {
  const r = contract.classify({ proposal: proposal({ poiPrimaryType: FALLBACK }), classificationSource: source })
  t(`резервный тип от ${source} — остановка`, r.intakeDisposition, 'needs_review')
  t(`и каталога нет (${source})`, r.catalogTarget, null)
}

// ── 2. Модель предлагает и только предлагает ──────────────────────────────

const schema = contract.buildProposalSchema()
eq('схема предложения требует ровно эти поля', [...schema.required].sort(), [...contract.PROPOSAL_FIELDS].sort())
t('схема предложения закрыта для лишних полей', schema.additionalProperties, false)
empty(
  'в схеме предложения нет полей маршрута и происхождения',
  contract.FORBIDDEN_PROPOSAL_FIELDS.filter((f) => f in schema.properties),
)
eq('enum видов сущности — из реестра', [...schema.properties.entityKind.enum], KIND_CODES)
eq('enum типов — из реестра', [...schema.properties.poiPrimaryType.anyOf[0].enum], TYPE_CODES)
eq('enum признаков — из реестра', [...schema.properties.facets.items.enum], FACET_CODES)

for (const field of contract.FORBIDDEN_PROPOSAL_FIELDS) {
  const v = contract.validateProposal({ ...proposal(), [field]: 'что-нибудь' })
  t(`модель не может вернуть ${field}`, v.ok, false)
  t(`и претензия называет поле ${field}`, v.problems.some((p) => p.includes(field)), true)
}

// Неизвестные коды останавливаются ДО маршрутизации.
for (const [label, over] of [
  ['вид сущности', { entityKind: 'нет-такого-вида' }],
  ['тип объекта', { poiPrimaryType: 'нет-такого-типа' }],
  ['признак', { facets: ['нет-такого-признака'] }],
]) {
  const v = contract.validateProposal(proposal(over))
  t(`неизвестный ${label} отклоняется`, v.ok, false)
  t(`и предложение не собрано (${label})`, v.proposal, null)
}
t('корректное предложение принимается', contract.validateProposal(proposal()).ok, true)
t('пустой тип — допустимое предложение', contract.validateProposal(proposal({ poiPrimaryType: null })).ok, true)
t('уверенность вне диапазона отклоняется', contract.validateProposal(proposal({ confidence: 2 })).ok, false)
t('неизвестное поле отклоняется', contract.validateProposal({ ...proposal(), лишнее: 1 }).ok, false)

// ── 3. Промпт — все и только коды реестра ─────────────────────────────────

const prompt = contract.buildClassifySystemPrompt()
empty('в промпте есть все коды типов', TYPE_CODES.filter((c) => !prompt.includes(c)))
empty('в промпте есть все коды видов', KIND_CODES.filter((c) => !prompt.includes(c)))
empty('в промпте есть все коды признаков', FACET_CODES.filter((c) => !prompt.includes(c)))
const lang = registry.defaultLanguage
empty(
  'в промпте есть все подписи типов',
  registry.poiPrimaryTypes.filter((x) => !prompt.includes(x.labels[lang])).map((x) => x.code),
)
// «Только» — обратная сторона: ни одного кода, которого в реестре нет.
const declared = new Set([...TYPE_CODES, ...KIND_CODES, ...FACET_CODES,
  ...registry.poiTypeGroups.map((g) => g.code), ...registry.dispositions, ...registry.catalogTargets,
  ...registry.excludeReasons.map((x) => x.code), ...registry.badges.map((x) => x.code),
  ...SOURCES, ...contract.PROPOSAL_FIELDS, ...contract.FORBIDDEN_PROPOSAL_FIELDS])
const snakeInPrompt = [...new Set(prompt.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? [])]
empty('в промпте нет кодов вне реестра', snakeInPrompt.filter((c) => !declared.has(c)))
t('промпт не предлагает модели решать допуск', /isTourPoi/.test(prompt), false)

/* enrich.mjs больше ничего не строит сам: обе константы каскада — ровно то,
   что отдаёт контракт. Разойтись промпту и схеме теперь не с чем. */
t('промпт каскада — это промпт контракта', enrich.CLASSIFY_SYSTEM_PROMPT, prompt)
eq('схема каскада — это схема контракта', enrich.CLASSIFY_SCHEMA, schema)
t('в схеме каскада нет решения о допуске', 'isTourPoi' in enrich.CLASSIFY_SCHEMA.properties, false)
t('в схеме каскада нет русских категорий', 'categoriesRu' in enrich.CLASSIFY_SCHEMA.properties, false)

// ── 4. Правила: коды из реестра, происхождение rule ───────────────────────

empty('виды сущности из правил объявлены', scoring.RULE_ENTITY_KINDS.filter((c) => !KIND_CODES.includes(c)))
empty('типы из правил объявлены', scoring.RULE_POI_TYPES.filter((c) => !TYPE_CODES.includes(c)))

const byRule = (nameJa) => scoring.classifyCandidateByRules({ nameJa, sourceKey: `t:${nameJa}` })
const RULE_CASES = [
  ['伏見稲荷大社', 'shinto_shrine', 'route'],
  ['法善寺', 'buddhist_temple', 'route'],
  ['天神橋筋商店街', 'shopping_street', 'route'],
  ['黒門市場', 'market', 'route'],
  ['大阪城', 'castle_fortification', 'route'],
  ['海遊館テスト水族館', 'zoo_aquarium', 'route'],
  ['新大阪駅', null, 'exclude'],
  ['はしうど旅館', null, 'route'],
]
for (const [name, type, disposition] of RULE_CASES) {
  const r = byRule(name)
  t(`правило: ${name} → тип`, r?.poiPrimaryType ?? null, type)
  t(`правило: ${name} → исход`, r?.intakeDisposition ?? null, disposition)
  t(`правило: ${name} → происхождение`, r?.classificationSource ?? null, contract.SOURCE_RULE)
}
const AMBIGUOUS = ['有馬温泉', '通天閣タワー', '心斎橋筋ストリート', '大阪城跡', 'スパワールド', '鴨川川床', '天守櫓']
for (const name of AMBIGUOUS) {
  const r = byRule(name)
  t(`неоднозначное «${name}» уходит к человеку`, r?.intakeDisposition ?? null, 'needs_review')
  t(`и типа ему не назначено (${name})`, r?.poiPrimaryType ?? null, null)
}

// ── 5. Состав корзин не изменился ─────────────────────────────────────────
/* Замороженная копия старых шаблонов: не для классификации, а для сравнения.
   Пороги зависят от ФАКТА совпадения, поэтому если множество совпадений то же
   самое, корзины остались прежними. */
const LEGACY_PATTERNS = [
  /(神社|大社|神宮|稲荷|八幡宮|天満宮)/, /(寺院|[^\s]寺|大仏|観音堂|不動尊|門跡)/,
  /(美術館|ギャラリー)/, /(博物館|資料館|記念館|文学館|科学館|水族館|動物園)/,
  /(展望台|展望所|タワー|展望)/, /(庭園|公園|植物園|花園|緑地)/, /(温泉|湯本|外湯|足湯)/,
  /(城跡|城址|古墳|遺跡|史跡|旧跡|廃寺|街道|一里塚)/, /(城|御殿|櫓)/, /(旅館|温泉宿)/,
  /(商店街|市場|ストリート|通り)/, /(遊園地|テーマパーク|ランド)/, /(スパ|サウナ)/,
  /(駅|ターミナル|港|空港)/, /(渓谷|滝|海岸|岬|湖|山頂|峠|川床)/,
]
const legacyMatched = (name) => LEGACY_PATTERNS.some((p) => p.test(name))
const CORPUS = [
  ...'神社 大社 神宮 稲荷 八幡宮 天満宮 寺院 金閣寺 大仏 観音堂 不動尊 門跡 美術館 ギャラリー 博物館 資料館 記念館 文学館 科学館 水族館 動物園 展望台 展望所 タワー 展望 庭園 公園 植物園 花園 緑地 温泉 湯本 外湯 足湯 城跡 城址 古墳 遺跡 史跡 旧跡 廃寺 街道 一里塚 城 御殿 櫓 旅館 温泉宿 商店街 市場 ストリート 通り 遊園地 テーマパーク ランド スパ サウナ 駅 ターミナル 港 空港 渓谷 滝 海岸 岬 湖 山頂 峠 川床'.split(' '),
  '伏見稲荷大社', '黒門市場', '天神橋筋商店街', '大阪城', '海遊館', 'コクミンドラッグ心斎橋筋１丁目店',
  '和泉シティプラザ', 'ABCまつり', 'OMO7大阪 by 星野リゾート', '滝見小路', '大阪木津卸売市場', '',
]
empty(
  'множество разобранных правилами записей не изменилось',
  CORPUS.filter((name) => Boolean(scoring.classifyByRules({ nameJa: name })) !== legacyMatched(name)),
)
t('корпус непустой', CORPUS.length > 60, true)

// ── 6. Старых списков в классификаторе не осталось ────────────────────────

const LEGACY_LABELS = Object.freeze([
  'Синтоистское святилище', 'Буддийский храм', 'Архитектурный объект', 'Музей',
  'Арт-пространство / Галерея', 'Смотровая площадка', 'Ландшафтный сад / Парк',
  'Достопримечательность', 'Историческое место', 'Ресторан', 'Японский отель',
  'Парк развлечений', 'Шоппинг', 'Термальный Источник', 'СПА', 'Городской район',
  'Транспортный узел',
])
for (const [label, file] of [['scoring.mjs', SCORING], ['enrich.mjs', ENRICH], ['контракт', CONTRACT]]) {
  empty(`старых русских категорий в ${label} нет`, LEGACY_LABELS.filter((x) => src[file].includes(x)))
}
t('resolveCategory больше не экспортируется', 'resolveCategory' in scoring, false)
t('CATEGORY_RULES в scoring.mjs нет', /CATEGORY_RULES/.test(src[SCORING]), false)
/* Часть старых ярлыков дословно совпадает с подписями реестра — «Музей»
   остался «Музеем». Проверять нужно те, которых в реестре НЕТ: именно они
   были собственным списком промпта. */
const registryLabels = new Set([
  ...registry.poiPrimaryTypes, ...registry.entityKinds, ...registry.facets,
  ...registry.badges, ...registry.poiTypeGroups, ...registry.excludeReasons,
].flatMap((x) => Object.values(x.labels)))
const RETIRED_LABELS = LEGACY_LABELS.filter((x) => !registryLabels.has(x))
t('вышедших из употребления ярлыков набралось', RETIRED_LABELS.length > 0, true)
/* Сравнивать по вхождению нельзя: подпись фасета «Есть СПА» содержит старый
   ярлык «СПА» как подстроку, не будучи им. Значение имеет то, что промпт
   ПРЕДЛАГАЕТ выбрать, а предлагает он строками вида «- код — подпись». */
const offered = [...prompt.matchAll(/^- (\S+) — (.+)$/gm)].map((m) => ({ code: m[1], label: m[2] }))
t('промпт вообще что-то предлагает', offered.length >= TYPE_CODES.length, true)
empty('промпт не предлагает вышедших из употребления ярлыков',
  offered.filter((o) => RETIRED_LABELS.includes(o.label)).map((o) => o.label))
empty('каждая предложенная подпись — из реестра',
  offered.filter((o) => !registryLabels.has(o.label)).map((o) => `${o.code} — ${o.label}`))
empty('каждый предложенный код — из реестра',
  offered.filter((o) => !declared.has(o.code)).map((o) => o.code))

// ── 7. Мост совместимости ─────────────────────────────────────────────────

const importers = [CONTRACT, SCORING, ENRICH, COLLECT, STORE, LOADER]
  .filter((f) => /legacy-airtable-category-bridge/.test(src[f] ?? ''))
eq('мост импортирует ровно один файл', importers, [COLLECT])
// Мост ни от чего не зависит: ни одного импорта, значит ни реестра, ни
// маршрутизации внутри него быть не может физически.
empty('мост ничего не импортирует', src[BRIDGE].match(/^\s*import\s/gm) ?? [])
t('мост знает условие своего удаления', /УСЛОВИЕ УДАЛЕНИЯ/.test(src[BRIDGE]), true)
t('точный перевод возвращается', bridge.legacyAirtableCategory('shinto_shrine').value, 'Синтоистское святилище')
t('неоднозначный перевод не угадывается', bridge.legacyAirtableCategory('market').value, null)
t('и объясняет причину', typeof bridge.legacyAirtableCategory('market').reason, 'string')
t('незнакомый код не угадывается', bridge.legacyAirtableCategory('появился_позже').value, null)
t('пустой тип не угадывается', bridge.legacyAirtableCategory(null).value, null)
empty(
  'каждый точный перевод существует в старой карте Airtable',
  bridge.REPRESENTABLE_CODES
    .map((code) => bridge.legacyAirtableCategory(code).value)
    .filter((value) => !src[STORE].includes(`'${value}'`) && !src[STORE].includes(`${value}:`)),
)
empty(
  'каждый код реестра у моста либо переводится, либо объяснён',
  TYPE_CODES.filter((code) => !bridge.REPRESENTABLE_CODES.includes(code)
    && !(code in bridge.UNREPRESENTABLE_CODES)),
)
t('путь записи останавливается явно', /Запись остановлена до обращения к базе/.test(src[COLLECT]), true)
t('остановка стоит до создания store', src[COLLECT].indexOf('Запись остановлена до обращения к базе')
  < src[COLLECT].indexOf('createAirtablePoiStore({'), true)

// ── 8. Dry-run не пишет ───────────────────────────────────────────────────

t('store создаётся ровно в одном месте', (src[COLLECT].match(/createAirtablePoiStore\(/g) ?? []).length, 1)
t('ingestPoiBatch вызывается ровно в одном месте', (src[COLLECT].match(/ingestPoiBatch\(/g) ?? []).length, 1)
t('оба вызова внутри writeRun', src[COLLECT].indexOf('export async function writeRun')
  < src[COLLECT].indexOf('createAirtablePoiStore({'), true)
t('сборка отчёта не создаёт store и не пишет',
  /createAirtablePoiStore\(|ingestPoiBatch\(/.test(
    src[COLLECT].slice(0, src[COLLECT].indexOf('export async function writeRun'))),
  false)
empty(
  'классификатор не знает ни про Airtable, ни про сеть',
  [CONTRACT, SCORING, ENRICH].filter((f) => /airtable|fetch\(|https?:\/\//i.test(src[f])),
)

// ── 9. Baseline остаётся доступным ────────────────────────────────────────

/* Baseline лежит в tmp/ и в репозиторий не входит: на машине без него набор
   обязан пройти, а не притвориться сломанным. Но если файл есть — он обязан
   быть тем самым, иначе сравнение «до/после» сравнивает не то. */
let baselineBytes = null
try { baselineBytes = await readFile(rel(BASELINE)) } catch { /* нет — пропускаем */ }
if (!baselineBytes) {
  ok++
  console.log('- baseline dry-run не найден в tmp/, сверка корзин пропущена')
}
if (baselineBytes) {
  const { createHash } = await import('node:crypto')
  t('baseline не тронут', 'sha256:' + createHash('sha256').update(baselineBytes).digest('hex'), BASELINE_DIGEST)
  const base = JSON.parse(baselineBytes.toString('utf8'))
  const totals = base.portals?.[0]?.totals ?? {}
  for (const key of ['fetched', 'import', 'review', 'reject', 'outsideRegion', 'cityUnresolved', 'importDeduped']) {
    t(`в baseline есть корзина ${key}`, typeof totals[key], 'number')
  }
}

// ── 10. Полная схема и реестр согласованы ─────────────────────────────────

eq(
  'enum источника в полной схеме совпадает с реестром',
  [...classificationSchema.properties.classificationSource.enum].sort(),
  [...SOURCES].sort(),
)

// ── 11. Минимальная версия Node ───────────────────────────────────────────
/* Классификатор берёт словари из канонического loader'а, а loader — это .ts,
   импортируемый из .mjs. Держится это на встроенном снятии типов, включённом
   по умолчанию с Node 22.18. Заявить меньшую границу значит пообещать работу
   там, где импорт упадёт. Запасного пути нет намеренно: второй читатель
   реестра — это второй реестр. */
const NODE_MIN_FOR_TYPE_STRIPPING = [22, 18]
const pkg = JSON.parse(await readFile(rel('package.json'), 'utf8'))
const declaredNode = /(\d+)\.(\d+)/.exec(pkg.engines?.node ?? '')
t('минимальная версия Node объявлена', Boolean(declaredNode), true)
if (declaredNode) {
  const [major, minor] = [Number(declaredNode[1]), Number(declaredNode[2])]
  t(
    `объявлено ${pkg.engines.node}, нужно не ниже ${NODE_MIN_FOR_TYPE_STRIPPING.join('.')}`,
    major > NODE_MIN_FOR_TYPE_STRIPPING[0]
      || (major === NODE_MIN_FOR_TYPE_STRIPPING[0] && minor >= NODE_MIN_FOR_TYPE_STRIPPING[1]),
    true,
  )
}
const lock = JSON.parse(await readFile(rel('package-lock.json'), 'utf8'))
t('lock-файл объявляет ту же границу', lock.packages?.['']?.engines?.node, pkg.engines?.node)
empty(
  'запасных путей чтения реестра не заведено',
  [CONTRACT, SCORING, ENRICH].filter((f) => /tsx|poi-taxonomy\.v\d\.json/.test(src[f])),
)
t('контракт читает канонический loader',
  /from '\.\.\/\.\.\/\.\.\/src\/lib\/poi-taxonomy\.ts'/.test(src[CONTRACT]), true)

// ── 12. Перестановка реестра не меняет смысл ──────────────────────────────
/* Копия loader'а, контракта и правил рядом с перетасованным реестром:
   порядок типов, видов, признаков и правил другой, решение обязано совпасть. */
const sandbox = await mkdtemp(path.join(os.tmpdir(), 'poi-classify-'))
const dir = path.join(sandbox, 'shuffled')
await mkdir(path.join(dir, 'config'), { recursive: true })
await mkdir(path.join(dir, 'src', 'lib'), { recursive: true })
await mkdir(path.join(dir, 'scripts', 'poi-portals', 'lib'), { recursive: true })
const shuffled = JSON.parse(JSON.stringify(registry))
for (const field of ['entityKinds', 'poiPrimaryTypes', 'facets', 'badges', 'poiTypeGroups', 'routingPolicy']) {
  shuffled[field] = [...shuffled[field]].reverse()
}
await writeFile(path.join(dir, 'config/poi-taxonomy.v2.json'), JSON.stringify(shuffled, null, 2) + '\n')
await copyFile(rel(LOADER), path.join(dir, LOADER))
for (const f of [CONTRACT, SCORING]) await copyFile(rel(f), path.join(dir, f))
let shuffledScoring = null
try {
  shuffledScoring = await import(pathToFileURL(path.join(dir, SCORING)).href)
} catch (error) {
  bad.push(`перетасованный реестр не загрузился: ${error?.message}`)
}
if (shuffledScoring) {
  const compare = (r) => (r ? [r.entityKind, r.poiPrimaryType, r.intakeDisposition, r.catalogTarget, r.classificationSource] : null)
  empty(
    'перестановка реестра не меняет решение',
    [...RULE_CASES.map(([n]) => n), ...AMBIGUOUS].filter((name) =>
      JSON.stringify(compare(shuffledScoring.classifyCandidateByRules({ nameJa: name })))
      !== JSON.stringify(compare(byRule(name)))),
  )
}
await rm(sandbox, { recursive: true, force: true })

finish()
