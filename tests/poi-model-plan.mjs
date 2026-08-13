/**
 * Потребитель № 2b, первый изолированный коммит: локальный план модельной
 * классификации.
 *
 * Что проверяется здесь и нигде больше: план строится, ничего не вызывая, —
 * ни провайдера, ни store, ни ingest; глобальный преflight останавливает
 * прогон ДО первого адаптера; digest содержательной части устойчив к
 * порядку свойств и чувствителен к каждому отправляемому полю; артефакт не
 * содержит ни одного значения полей кандидата.
 *
 * Чего здесь нет намеренно: сети, credentials, стоимости в деньгах и любых
 * обращений к Airtable. Их нет и в самом режиме.
 */
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ALL_SOURCES } from '../scripts/poi-portals/registry.mjs'
import { main } from '../scripts/poi-portals/collect-pois.mjs'
import { assertExclusiveJsonTarget, writeJsonReport } from '../scripts/lib/report-writer.mjs'
import { evaluatePoiCandidate } from '../scripts/poi-portals/lib/scoring.mjs'
import { estimateCascadeCost } from '../scripts/poi-portals/lib/enrich.mjs'
import { sha256Bytes } from '../scripts/lib/byte-digest.mjs'
import {
  assertCodeIdentity,
  assertIdentity,
  assertPolicyShape,
  AWAITING_TERMINAL,
  buildClassificationItem,
  buildModelPlan,
  buildPortalPlanFragment,
  canonicalItemBytes,
  canonicalJsonBytes,
  candidateInputDigest,
  classificationItemBytes,
  estimateItemTokens,
  evaluatePolicy,
  MODEL_INPUT_FIELDS,
  PROVIDER_PROFILES,
} from '../scripts/poi-portals/lib/model-plan.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const FX = path.join(HERE, 'fixtures', 'poi-model-plan')
const pathToFile = (rel) => pathToFileURL(path.join(ROOT, rel)).href

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const boom = (fn) => { try { fn(); return '(без ошибки)' } catch (e) { return e.message } }
const boomAsync = async (fn) => { try { await fn(); return '(без ошибки)' } catch (e) { return e.message } }

const fixture = async (name) => JSON.parse(await readFile(path.join(FX, name), 'utf8'))
const NOW = new Date('2026-08-13T00:00:00Z')
const CODE_IDENTITY = { commit: '0000000000000000000000000000000000000000', dirty: false }
const DENY = (await fixture('policy-valid-deny.json')).policy

const evaluate = (list) => list.map((candidate) => ({ candidate, verdict: evaluatePoiCandidate(candidate, { bbox: null }) }))
const portalWith = (policy, id = 'fixture-portal') => ({ id, modelProcessing: policy })

/* ── 1. Classification item: три состояния ─────────────────────────────── */

const tri = await fixture('candidates-tri-state.json')
const digests = ['absent', 'nulled', 'empty'].map((key) => candidateInputDigest(buildClassificationItem(tri[key])))
t('A, N и пустая строка различимы', new Set(digests).size, 3)
t('состояния читаются как данные',
  buildClassificationItem(tri.absent).entries.map((e) => e.state).join(''), 'SAA')
t('запись есть для каждого поля контракта',
  buildClassificationItem(tri.absent).entries.length, MODEL_INPUT_FIELDS.length)
t('порядок записей — порядок контракта',
  buildClassificationItem(tri.nulled).entries.map((e) => e.field).join(','), MODEL_INPUT_FIELDS.join(','))
t('undefined отвергается как неотличимый от отсутствия',
  /неотличимо от отсутствия/.test(boom(() => buildClassificationItem({ nameJa: undefined }))), true)
t('нестроковое значение отвергается',
  /допустимы строка и null/.test(boom(() => buildClassificationItem({ nameJa: 42 }))), true)

const ordered = { nameJa: 'あ', nameKana: 'イ', descriptionJa: 'う' }
const shuffled = { descriptionJa: 'う', nameKana: 'イ', nameJa: 'あ' }
t('порядок свойств объекта на digest не влияет',
  candidateInputDigest(buildClassificationItem(ordered)),
  candidateInputDigest(buildClassificationItem(shuffled)))

for (const field of MODEL_INPUT_FIELDS) {
  const changed = { ...ordered, [field]: `${ordered[field]}х` }
  t(`изменение «${field}» меняет digest`,
    candidateInputDigest(buildClassificationItem(changed)) === candidateInputDigest(buildClassificationItem(ordered)),
    false)
}

/* ── 2. Байты и токены ────────────────────────────────────────────────── */

const astral = (await fixture('candidates-astral.json')).candidate
const astralItem = buildClassificationItem(astral)
t('classificationItemBytes — длина канонического представления',
  classificationItemBytes(astralItem), canonicalItemBytes(astralItem).length)
t('символ вне BMP считается четырьмя байтами UTF-8',
  canonicalItemBytes(astralItem).includes(Buffer.from('𠮟', 'utf8')), true)
t('оценка токенов считает кодовые единицы UTF-16, а не байты',
  estimateItemTokens(astralItem), Math.ceil('𠮟'.length * 1.05))
t('item.fields сверяется с контрактом',
  /item.fields обязан совпадать/.test(boom(() => canonicalItemBytes({
    version: 'poi-classification-item/v1', fields: ['nameKana', 'nameJa', 'descriptionJa'],
    entries: buildClassificationItem(ordered).entries,
  }))), true)
t('символьные ключи отвергаются, а не теряются',
  /символьные ключи/.test(boom(() => canonicalJsonBytes({ a: 1, [Symbol('s')]: 2 }, 'd'))), true)
t('полный hex-hash принимается', boom(() => assertCodeIdentity({ commit: 'a'.repeat(40), dirty: false })), '(без ошибки)')
t('сокращённый hash отвергается', /полным hex-hash/.test(boom(() => assertCodeIdentity({ commit: 'abc1234', dirty: false }))), true)
t('нешестнадцатеричный hash отвергается', /полным hex-hash/.test(boom(() => assertCodeIdentity({ commit: 'z'.repeat(40), dirty: false }))), true)
t('нелогический dirty отвергается', /dirty/.test(boom(() => assertCodeIdentity({ commit: 'a'.repeat(40), dirty: 'нет' }))), true)
t('лишнее поле в codeIdentity отвергается',
  /ровно commit и dirty/.test(boom(() => assertCodeIdentity({ commit: 'a'.repeat(40), dirty: false, extra: 1 }))), true)
t('недостающее поле в codeIdentity отвергается',
  /ровно commit и dirty/.test(boom(() => assertCodeIdentity({ commit: 'a'.repeat(40) }))), true)
t('скрытое поле в codeIdentity отвергается',
  /неперечисляемое собственное свойство/.test(boom(() => {
    const identity = { commit: 'a'.repeat(40), dirty: false }
    Object.defineProperty(identity, 'granted', { value: true, enumerable: false })
    return assertCodeIdentity(identity)
  })), true)
t('accessor в codeIdentity отвергается',
  /accessor-свойство/.test(boom(() => assertCodeIdentity({ commit: 'a'.repeat(40), get dirty() { return false } }))), true)
t('символьный ключ в codeIdentity отвергается',
  /символьные ключи/.test(boom(() => assertCodeIdentity({ commit: 'a'.repeat(40), dirty: false, [Symbol('s')]: 1 }))), true)
t('непростой объект в codeIdentity отвергается',
  /простым объектом/.test(boom(() => assertCodeIdentity(new Date()))), true)
t('одиночный суррогат отвергается, а не заменяется',
  /суррогат/.test(boom(() => canonicalItemBytes(buildClassificationItem({ nameJa: '\uD800' })))), true)

/* ── 3. Канонический JSON ─────────────────────────────────────────────── */

t('ключи сортируются рекурсивно',
  canonicalJsonBytes({ b: { d: 1, c: 2 }, a: 3 }, 'd').toString('utf8'), 'd\n{"a":3,"b":{"c":2,"d":1}}')
t('порядок массива сохраняется',
  canonicalJsonBytes({ a: [3, 1, 2] }, 'd').toString('utf8'), 'd\n{"a":[3,1,2]}')
t('версия домена входит в байты', canonicalJsonBytes({}, 'poi-x/v1').toString('utf8').startsWith('poi-x/v1\n'), true)
t('домен меняет digest',
  sha256Bytes(canonicalJsonBytes({}, 'a')) === sha256Bytes(canonicalJsonBytes({}, 'b')), false)
for (const [label, value] of [
  ['undefined', { a: undefined }], ['функция', { a: () => 1 }], ['symbol', { a: Symbol('s') }],
  ['bigint', { a: 1n }], ['NaN', { a: NaN }], ['Infinity', { a: Infinity }], ['Date', { a: new Date() }],
]) {
  t(`канонический JSON отвергает ${label}`, boom(() => canonicalJsonBytes(value, 'd')) !== '(без ошибки)', true)
}
const cyclic = { a: 1 }
cyclic.self = cyclic
t('канонический JSON отвергает цикл', /циклическая ссылка/.test(boom(() => canonicalJsonBytes(cyclic, 'd'))), true)
t('-0 выводится как 0', canonicalJsonBytes({ a: -0 }, 'd').toString('utf8'), 'd\n{"a":0}')

/* Строгая канонизация: всё, что JSON.stringify потерял бы или подменил,
   здесь отказ. Контрпримеры парные — «пустое» против «якобы пустого». */
t('[] сериализуется', canonicalJsonBytes({ a: [] }, 'd').toString('utf8'), 'd\n{"a":[]}')
t('new Array(1) отвергается как разрежённый',
  /разрежённый массив/.test(boom(() => canonicalJsonBytes({ a: new Array(1) }, 'd'))), true)
t('{} сериализуется', canonicalJsonBytes({}, 'd').toString('utf8'), 'd\n{}')
t('объект с неперечисляемым собственным полем отвергается',
  /неперечисляемое собственное свойство/.test(boom(() => {
    const hidden = {}
    Object.defineProperty(hidden, 'secret', { value: 1, enumerable: false })
    return canonicalJsonBytes(hidden, 'd')
  })), true)
t('accessor-свойство отвергается',
  /accessor-свойство/.test(boom(() => canonicalJsonBytes({ get x() { return 1 } }, 'd'))), true)
t('посторонний ключ массива отвергается',
  /посторонний ключ массива/.test(boom(() => {
    const arr = [1]
    arr.extra = 2
    return canonicalJsonBytes({ a: arr }, 'd')
  })), true)
t('неперечисляемый элемент массива отвергается',
  /неперечисляемый элемент/.test(boom(() => {
    const arr = [1]
    Object.defineProperty(arr, 0, { value: 1, enumerable: false })
    return canonicalJsonBytes({ a: arr }, 'd')
  })), true)
t('[1] сериализуется', canonicalJsonBytes({ a: [1] }, 'd').toString('utf8'), 'd\n{"a":[1]}')
for (const key of ['00', '-0', '1e0', '+1', ' 1']) {
  t(`числоподобный ключ массива «${key}» отвергается`,
    /неканонический или посторонний ключ массива/.test(boom(() => {
      const arr = [1]
      arr[key] = 2
      return canonicalJsonBytes({ a: arr }, 'd')
    })), true)
}

/* ── 4. Тождество множеств ────────────────────────────────────────────── */

t('контрпример [A,B] против [A,A,B] падает',
  /повторы в спланированном/.test(boom(() => assertIdentity(['A', 'B'], ['A', 'A', 'B'], 'ключ'))), true)
t('повтор слева падает', /повторы в выбранном/.test(boom(() => assertIdentity(['A', 'A'], ['A'], 'ключ'))), true)
t('разные длины падают', /выбрано 2, спланировано 1/.test(boom(() => assertIdentity(['A', 'B'], ['C'], 'ключ'))), true)
t('расхождение элементов падает', /расходятся/.test(boom(() => assertIdentity(['A', 'B'], ['A', 'C'], 'ключ'))), true)
t('перестановка проходит', boom(() => assertIdentity(['A', 'B'], ['B', 'A'], 'ключ')), '(без ошибки)')

/* ── 5. Форма и содержание policy ─────────────────────────────────────── */

const SOURCE_WITHOUT_POLICY = (await fixture('policy-missing.json')).source
const POLICY_EXTRA = (await fixture('policy-extra-field.json')).policy
const POLICY_UNKNOWN_PROVIDER = (await fixture('policy-unknown-provider.json')).policy
const POLICY_DUPLICATE_FIELDS = (await fixture('policy-duplicate-fields.json')).policy

t('валидная deny-policy принимается формой', boom(() => assertPolicyShape(portalWith(DENY))), '(без ошибки)')
t('отсутствие policy отвергается',
  /нет modelProcessing/.test(boom(() => assertPolicyShape(SOURCE_WITHOUT_POLICY))), true)
t('лишнее поле отвергается',
  /лишние поля note/.test(boom(() => assertPolicyShape(portalWith(POLICY_EXTRA)))), true)
t('неизвестный код провайдера отвергается',
  /allowedProviders содержит необъявленные/.test(boom(() => assertPolicyShape(portalWith(POLICY_UNKNOWN_PROVIDER)))), true)
t('повтор в fields отвергается',
  /fields содержит повторы/.test(boom(() => assertPolicyShape(portalWith(POLICY_DUPLICATE_FIELDS)))), true)
for (const [label, make, pattern] of [
  ['символьным полем', () => ({ ...DENY, [Symbol('s')]: 1 }), /символьные ключи/],
  ['неперечисляемым полем', () => {
    const policy = { ...DENY }
    Object.defineProperty(policy, 'granted', { value: true, enumerable: false })
    return policy
  }, /неперечисляемое собственное свойство/],
  ['accessor-полем', () => {
    const policy = { ...DENY }
    Object.defineProperty(policy, 'granted', { get: () => true, enumerable: true })
    return policy
  }, /accessor-свойство/],
]) {
  t(`policy с ${label} отвергается`, pattern.test(boom(() => assertPolicyShape(portalWith(make())))), true)
}
t('policy.fields = new Array(1) отвергается как разрежённый',
  /разрежённый массив/.test(boom(() => assertPolicyShape(portalWith({ ...DENY, fields: new Array(1) })))), true)
t('посторонний ключ в policy.allowedProviders отвергается',
  /неканонический или посторонний ключ массива/.test(boom(() => {
    const providers = []
    providers.extra = 'вендор'
    return assertPolicyShape(portalWith({ ...DENY, allowedProviders: providers }))
  })), true)
t('чужое поле в fields отвергается',
  /fields содержит необъявленные/.test(boom(() => assertPolicyShape(portalWith({ ...DENY, fields: ['address'] })))), true)
t('несуществующая дата отвергается',
  /существующая дата/.test(boom(() => assertPolicyShape(portalWith({ ...DENY, reviewedAt: '2026-02-30' })))), true)
t('пустой decisionRef отвергается',
  /decisionRef/.test(boom(() => assertPolicyShape(portalWith({ ...DENY, decisionRef: '' })))), true)

const expiring = (await fixture('policy-expired.json')).policy
t('истёкшая policy валидна по форме', boom(() => assertPolicyShape(portalWith(expiring))), '(без ошибки)')
const verdictAt = (policy, iso) => evaluatePolicy(policy, { now: new Date(iso), requiredFields: MODEL_INPUT_FIELDS })
t('в день срока, 23:59 по Токио — ещё не истекла',
  verdictAt(expiring, '2026-08-20T14:59:59Z').reasons.includes('expired'), false)
t('на следующие сутки, 00:00 по Токио — истекла',
  verdictAt(expiring, '2026-08-20T15:00:00Z').reasons.includes('expired'), true)
t('now обязателен', /now обязателен/.test(boom(() => evaluatePolicy(DENY, { requiredFields: [] }))), true)
t('requiredFields обязателен', /requiredFields обязателен/.test(boom(() => evaluatePolicy(DENY, { now: NOW }))), true)

/* Частичный грант обязан называть недостающие поля поимённо: «полей не
   разрешено» после выдачи одного поля осталось бы верным и бесполезным. */
const partial = { ...DENY, fields: ['nameJa'] }
const partialReasons = verdictAt(partial, '2026-08-13T00:00:00Z').reasons
t('частичный грант называет nameKana', partialReasons.includes('missingAllowedFields:nameKana'), true)
t('частичный грант называет descriptionJa', partialReasons.includes('missingAllowedFields:descriptionJa'), true)
t('разрешённое поле в причинах не значится', partialReasons.includes('missingAllowedFields:nameJa'), false)
t('частичный грант всё ещё запрещает', verdictAt(partial, '2026-08-13T00:00:00Z').state, 'denied')

let denyCount = 0
for (const source of ALL_SOURCES) {
  assertPolicyShape(source)
  if (evaluatePolicy(source.modelProcessing, { now: NOW, requiredFields: MODEL_INPUT_FIELDS }).state === 'denied') denyCount += 1
}
t('у всех источников реестра валидная запрещающая policy', denyCount, ALL_SOURCES.length)
t('источников в реестре двенадцать', ALL_SOURCES.length, 12)
t('policy у источников — разные объекты',
  ALL_SOURCES[0].modelProcessing === ALL_SOURCES[1].modelProcessing, false)

/* ── 6. PROVIDER_PROFILES не мутируется ───────────────────────────────── */

t('PROVIDER_PROFILES заморожен', Object.isFrozen(PROVIDER_PROFILES), true)
t('PROVIDER_PROFILES не Map', PROVIDER_PROFILES instanceof Map, false)
t('push отвергается', boom(() => PROVIDER_PROFILES.push('x')) !== '(без ошибки)', true)
t('присваивание по индексу отвергается', boom(() => { PROVIDER_PROFILES[0] = 'x' }) !== '(без ошибки)', true)
t('после попыток список пуст', PROVIDER_PROFILES.length, 0)

/* ── 7. Отбор очереди и фрагмент плана ────────────────────────────────── */

const mixed = evaluate(await fixture('candidates-mixed-outcomes.json'))
const fragment = buildPortalPlanFragment({ portal: portalWith(DENY), evaluated: mixed, now: NOW })
t('отобрана ровно очередь awaitingClassification',
  fragment.items.map((i) => i.sourceKey).join(','), 'mixed:awaiting-1,mixed:awaiting-2')
t('qualityRejected в план не попал', fragment.items.some((i) => i.sourceKey === 'mixed:quality-rejected'), false)
t('разобранное правилом в план не попало', fragment.items.some((i) => i.sourceKey === 'mixed:rule-classified'), false)
t('plannedItemCount равен числу items', fragment.plannedItemCount, fragment.items.length)
t('исполнение запрещено', fragment.executionPermitted, false)
t('план заблокирован policy', fragment.blockedByPolicy, true)
t('число сетевых запросов неизвестно', fragment.networkRequestCount, null)
t('число batch job неизвестно', fragment.batchJobCount, null)
t('оплачиваемые токены неизвестны', fragment.billableTokens, null)
t('денежная верхняя граница отсутствует', fragment.estimatedCostUpperBound, null)
t('оценка токенов помечена приблизительной', fragment.tokenEstimate.approximate, true)
t('спланированные поля — контракт', fragment.plannedFieldNames.join(','), MODEL_INPUT_FIELDS.join(','))
t('разрешённые policy поля пусты', fragment.policyAllowedFieldNames.length, 0)

const noKey = [{ candidate: { nameJa: 'а' }, verdict: { terminal: AWAITING_TERMINAL } }]
t('кандидат без sourceKey роняет план',
  /нет sourceKey/.test(boom(() => buildPortalPlanFragment({ portal: portalWith(DENY), evaluated: noKey, now: NOW }))), true)
const dupKey = [
  { candidate: { sourceKey: 'd:1', nameJa: 'а' }, verdict: { terminal: AWAITING_TERMINAL } },
  { candidate: { sourceKey: 'd:1', nameJa: 'б' }, verdict: { terminal: AWAITING_TERMINAL } },
]
/* Прогноз каскада шире очереди и стоимостью запроса не является:
   estimateCascadeCost считает всё, что «не reject и не разобрано правилом»,
   а очередь — только awaitingClassification. Кандидат со слабым качеством и
   баллом ниже порога импорта попадает в первый набор и не попадает во
   второй. */
const cascade = estimateCascadeCost(mixed)
t('прогноз каскада шире плана', cascade.stage1.records > fragment.plannedItemCount, true)
t('слабый кандидат учтён прогнозом',
  mixed.some((e) => e.candidate.sourceKey === 'mixed:weak-but-counted' && e.verdict.qualityVerdict !== 'reject'), true)
t('и в план не попал', fragment.items.some((i) => i.sourceKey === 'mixed:weak-but-counted'), false)

t('повтор sourceKey роняет план',
  /sourceKey повторяется/.test(boom(() => buildPortalPlanFragment({ portal: portalWith(DENY), evaluated: dupKey, now: NOW }))), true)

/* ── 8. Детерминизм плана ─────────────────────────────────────────────── */

const awaiting = await fixture('candidates-awaiting.json')
const meta = {
  planId: 'plan-fixed', createdAt: '2026-08-13T00:00:00.000Z', deleteAfter: '2026-08-20T00:00:00.000Z',
  codeIdentity: CODE_IDENTITY, taxonomyVersion: 'poi-taxonomy/v2',
  taxonomyBytes: Buffer.from('{"version":"poi-taxonomy/v2"}\n', 'utf8'), taxonomySpec: 'raw-file-bytes/v1',
  promptText: 'фиксированный промпт', schemaObject: { type: 'object', properties: { entityKind: { type: 'string' } } },
}
const planFrom = (list, extraMeta = {}) => buildModelPlan({
  fragments: [buildPortalPlanFragment({ portal: portalWith(DENY, 'p-a'), evaluated: evaluate(list), now: NOW })],
  selectedPortalIds: ['p-a'],
  meta: { ...meta, ...extraMeta },
})
const planA = planFrom(awaiting)
const planB = planFrom([...awaiting].reverse())
t('перестановка кандидатов не меняет planDigest', planA.planDigest.value, planB.planDigest.value)
t('items отсортированы по sourceKey',
  planA.portals[0].items.map((i) => i.sourceKey).join(','),
  [...planA.portals[0].items.map((i) => i.sourceKey)].sort().join(','))
t('planId не входит в planDigest', planFrom(awaiting, { planId: 'plan-other' }).planDigest.value, planA.planDigest.value)
t('createdAt не входит в planDigest',
  planFrom(awaiting, { createdAt: '2030-01-01T00:00:00.000Z' }).planDigest.value, planA.planDigest.value)
t('deleteAfter не входит в planDigest',
  planFrom(awaiting, { deleteAfter: '2030-01-01T00:00:00.000Z' }).planDigest.value, planA.planDigest.value)
t('идентичность кода входит в planDigest',
  planFrom(awaiting, { codeIdentity: { commit: 'a'.repeat(40), dirty: false } }).planDigest.value === planA.planDigest.value,
  false)
t('promptDigest входит в planDigest',
  planFrom(awaiting, { promptText: 'другой' }).planDigest.value === planA.planDigest.value, false)
t('schemaDigest входит в planDigest',
  planFrom(awaiting, { schemaObject: { type: 'string' } }).planDigest.value === planA.planDigest.value, false)
t('promptBytes — длина хешируемого потока промпта',
  planA.promptBytes, Buffer.from(`poi-model-prompt/v1\n${meta.promptText}`, 'utf8').length)
t('schemaBytes — длина канонического JSON схемы',
  planA.schemaBytes, canonicalJsonBytes(meta.schemaObject, 'poi-model-schema/v1').length)
t('promptBytes входит в planDigest',
  planFrom(awaiting, { promptText: `${meta.promptText} ` }).planDigest.value === planA.planDigest.value, false)
t('провайдер не выбран', planA.providerProfile, null)
t('исполнение запрещено на уровне плана', planA.executionPermitted, false)
t('planId не совпадает с Intake Run ID по форме', /^plan-/.test(planA.planId), true)

const twoPortals = buildModelPlan({
  fragments: [
    buildPortalPlanFragment({ portal: portalWith(DENY, 'p-z'), evaluated: evaluate(awaiting), now: NOW }),
    buildPortalPlanFragment({ portal: portalWith(DENY, 'p-a'), evaluated: [], now: NOW }),
  ],
  selectedPortalIds: ['p-z', 'p-a'],
  meta,
})
t('порталы отсортированы по portalId', twoPortals.portals.map((p) => p.portalId).join(','), 'p-a,p-z')
t('расхождение portalId роняет план',
  /portalId/.test(boom(() => buildModelPlan({ fragments: twoPortals.portals, selectedPortalIds: ['p-a'], meta }))), true)

const otherPolicy = { ...DENY, purpose: 'classification', decisionRef: 'owner/x' }
t('правка policy меняет policyDigest',
  buildPortalPlanFragment({ portal: portalWith(otherPolicy, 'p-a'), evaluated: evaluate(awaiting), now: NOW })
    .policyDigest.value === planA.portals[0].policyDigest.value,
  false)

/* buildClassificationItem — единственный источник тела. Обход, собирающий
   поля напрямую, отобразил бы null в пустую строку: состояние N стало бы S,
   и digest разошёлся бы. */
const byKey = new Map(awaiting.map((candidate) => [candidate.sourceKey, candidate]))
t('digest каждого item собран ровно контрактной функцией',
  planA.portals[0].items.every((item) =>
    item.candidateInputDigest.value === candidateInputDigest(buildClassificationItem(byKey.get(item.sourceKey)))),
  true)
t('в наборе есть кандидат с null-полем — иначе обход был бы неотличим',
  awaiting.some((candidate) => candidate.nameKana === null), true)
t('null-поле даёт состояние N, а не пустую строку',
  buildClassificationItem(byKey.get('bodik-osaka-tourism:c-004')).entries[1].state, 'N')

const pinned = await fixture('expected-plan-digest.json')
t('planDigest совпал с зафиксированным', planA.planDigest.value, pinned.planDigest)

/* ── 9. Артефакт не несёт содержательных значений ─────────────────────── */

const SENTINEL = 'ЗНАЧЕНИЕ-ИСТОЧНИКА-НЕ-ДОЛЖНО-ПОПАСТЬ-В-ПЛАН'
const sentinelCandidates = awaiting.map((candidate, i) => ({
  ...candidate,
  nameJa: `${SENTINEL}-имя-${i}`,
  nameKana: `${SENTINEL}-кана-${i}`,
  descriptionJa: `${candidate.descriptionJa}${SENTINEL}-описание-${i}`,
  address: `${SENTINEL}-адрес-${i}`,
}))
const sentinelPlan = planFrom(sentinelCandidates)
t('ни одно значение источника не попало в артефакт',
  JSON.stringify(sentinelPlan).includes(SENTINEL), false)
t('ключ источника в артефакте есть — решение владельца от 13.08.2026',
  sentinelPlan.portals[0].items[0].sourceKey.startsWith('bodik-osaka-tourism:'), true)
t('верхний уровень плана — ровно объявленный набор',
  Object.keys(sentinelPlan).sort().join(','),
  ['codeIdentity', 'contractVersion', 'createdAt', 'deleteAfter', 'executionPermitted', 'planDigest', 'planId',
    'portals', 'promptBytes', 'promptDigest', 'providerProfile', 'schemaBytes', 'schemaDigest', 'taxonomyDigest',
    'taxonomyVersion'].join(','))
t('запись item — ровно объявленный набор',
  Object.keys(sentinelPlan.portals[0].items[0]).sort().join(','),
  ['candidateInputDigest', 'classificationItemBytes', 'sourceKey', 'tokenEstimate'].join(','))
t('у каждого digest указаны алгоритм и спецификация',
  [sentinelPlan.planDigest, sentinelPlan.promptDigest, sentinelPlan.schemaDigest, sentinelPlan.taxonomyDigest,
    sentinelPlan.portals[0].policyDigest, sentinelPlan.portals[0].items[0].candidateInputDigest]
    .every((d) => d.algorithm === 'sha256' && typeof d.spec === 'string' && d.value.startsWith('sha256:')),
  true)

/* ── 10. Оркестратор: режимы, P0, отсутствие сети ─────────────────────── */

/* Запись отчёта подменяется узкой зависимостью: тест не пишет на диск и
   поэтому повторяем. Прогон, оставляющий файл, со второго раза натыкается на
   уже существующий — так этот набор и падал при независимой проверке. */
const runMain = async (argv, extraDeps = {}, candidates = awaiting) => {
  const calls = { adapter: 0, persist: 0 }
  const persisted = []
  const adapters = {
    'opendata-csv': async () => { calls.adapter += 1; return { candidates, meta: { rows: candidates.length } } },
  }
  const persistReport = async (outPath, report, options) => {
    calls.persist += 1
    persisted.push({ outPath, report, mode: options?.mode })
  }
  const realLog = console.log
  let printed = ''
  console.log = (value) => { printed = value }
  try {
    await main(['node', 'collect-pois.mjs', ...argv], {
      adapters, persistReport, now: NOW, resolveCodeIdentity: () => CODE_IDENTITY, ...extraDeps,
    })
    return { calls, persisted, report: JSON.parse(printed), full: persisted.at(-1)?.report ?? null }
  } finally {
    console.log = realLog
  }
}

const plain = await runMain(['--portal', 'bodik-osaka-tourism'])
t('без флага адаптер вызван', plain.calls.adapter, 1)
t('без флага плана в отчёте нет', 'modelPlan' in plain.report, false)
t('без флага верхний уровень отчёта прежний',
  Object.keys(plain.report).sort().join(','), 'dryRun,portals,startedAt')

const plainAgain = await runMain(['--portal', 'bodik-osaka-tourism'])
const strip = (report) => JSON.stringify(report, (key, value) => (key === 'durationMs' ? 0 : value))
t('без флага прогон детерминирован при фиксированных часах', strip(plain.report), strip(plainAgain.report))

const OUT = path.join('tmp', 'poi-model-plans', 'test-plan.json')
const planned = await runMain(['--portal', 'bodik-osaka-tourism', '--model-plan', '--out', OUT])
t('в плановом режиме адаптер вызван', planned.calls.adapter, 1)
t('план попал в отчёт единственным местом', typeof planned.report.modelPlan, 'object')
t('копии плана внутри portals[] нет', 'modelPlan' in planned.report.portals[0], false)
t('план несёт planDigest', planned.report.modelPlan.planDigest.value.startsWith('sha256:'), true)
t('план несёт срок удаления', planned.report.modelPlan.deleteAfter, '2026-08-20T00:00:00.000Z')
t('отчёт записан ровно один раз', planned.calls.persist, 1)
t('записан по указанному пути', planned.persisted[0].outPath, OUT)
t('план пишется эксклюзивно', planned.persisted[0].mode, 'exclusive')
t('без --out запись не вызывается', plain.calls.persist, 0)
const plainOut = await runMain(['--portal', 'bodik-osaka-tourism', '--out', path.join('tmp', 'reports', 'plain.json')])
t('обычный прогон пишет с перезаписью, как и раньше', plainOut.persisted[0].mode, 'overwrite')
t('обычному --out каталог не навязывается', plainOut.calls.persist, 1)

/* Каталог путём отчёта быть не может: --out обязан называть файл. */
const dirCalls = { adapter: 0 }
const dirOut = await boomAsync(() => main(
  ['node', 'x', '--portal', 'bodik-osaka-tourism', '--model-plan', '--out', path.join('tmp', 'poi-model-plans')],
  {
    adapters: { 'opendata-csv': async () => { dirCalls.adapter += 1; return { candidates: [], meta: {} } } },
    persistReport: async () => {}, now: NOW, resolveCodeIdentity: () => CODE_IDENTITY,
  }))
/* Каталог не проходит уже по расширению: у «tmp/poi-model-plans» его нет.
   Важно, что отказ случается до адаптера, а не какой именно из четырёх. */
t('--out, равный самому каталогу, отвергается',
  /обязан иметь расширение ровно|обязан быть файлом внутри/.test(dirOut), true)
t('и отвергается до адаптера', dirCalls.adapter, 0)

/* Девять исходов: по одному кандидату на каждый. В план обязан попасть
   ровно awaitingClassification и ничего кроме. */
const nine = await fixture('candidates-nine-outcomes.json')
const nineRun = await runMain(['--portal', 'bodik-osaka-tourism', '--model-plan', '--out', OUT], {}, nine)
const tally = nineRun.full.portals[0].finalTally
t('покрыты все девять исходов', Object.values(tally).filter((value) => value === 0).length, 0)
t('исходов в раскладке девять', Object.keys(tally).length, 9)
t('сумма раскладки равна числу кандидатов',
  Object.values(tally).reduce((sum, value) => sum + value, 0), nine.length)
t('в план попал ровно awaitingClassification',
  nineRun.full.modelPlan.portals[0].items.map((item) => item.sourceKey).join(','),
  'bodik-osaka-tourism:awaiting')

for (const [flag, extra] of [['--write', []], ['--dry-write', []], ['--base-snapshot', ['nowhere.json']]]) {
  const message = await boomAsync(() => runMain(['--portal', 'bodik-osaka-tourism', '--model-plan', flag, ...extra]))
  t(`--model-plan несовместим с ${flag}`, new RegExp(`несовместим с ${flag}`).test(message), true)
}
const noAdapterCalls = { adapter: 0 }
const conflict = await boomAsync(() => main(['node', 'x', '--portal', 'bodik-osaka-tourism', '--model-plan', '--write'], {
  adapters: { 'opendata-csv': async () => { noAdapterCalls.adapter += 1; return { candidates: [], meta: {} } } },
  now: NOW,
  resolveCodeIdentity: () => CODE_IDENTITY,
}))
t('несовместимые флаги падают до адаптера', noAdapterCalls.adapter, 0)
t('и сообщение называет конфликт', /несовместим/.test(conflict), true)

t('--model-plan требует --out',
  /требует --out/.test(await boomAsync(() => runMain(['--portal', 'bodik-osaka-tourism', '--model-plan']))), true)
t('--out вне tmp/poi-model-plans/ отвергается',
  /обязан быть файлом внутри/.test(await boomAsync(() => runMain(['--portal', 'bodik-osaka-tourism', '--model-plan', '--out', 'tmp/x.json']))), true)

/* Граница выходного файла проверяется до адаптера целиком: каталог,
   расширение и занятость пути — три причины одной функции. */
const targetCalls = { adapter: 0, persist: 0 }
const targetRun = async (out) => boomAsync(() => main(
  ['node', 'x', '--portal', 'bodik-osaka-tourism', '--model-plan', '--out', out],
  {
    adapters: { 'opendata-csv': async () => { targetCalls.adapter += 1; return { candidates: [], meta: {} } } },
    persistReport: async () => { targetCalls.persist += 1 },
    now: NOW,
    resolveCodeIdentity: () => CODE_IDENTITY,
  },
))
t('чужое расширение отвергается',
  /обязан иметь расширение ровно/.test(await targetRun(path.join('tmp', 'poi-model-plans', 'plan.bin'))), true)
t('файл без расширения отвергается',
  /обязан иметь расширение ровно/.test(await targetRun(path.join('tmp', 'poi-model-plans', 'plan'))), true)
t('файл, названный просто «.json», отвергается',
  /обязан иметь расширение ровно/.test(await targetRun(path.join('tmp', 'poi-model-plans', '.json'))), true)
t('.JSON в верхнем регистре отвергается',
  /обязан иметь расширение ровно/.test(await targetRun(path.join('tmp', 'poi-model-plans', 'plan.JSON'))), true)
t('.Json отвергается',
  /обязан иметь расширение ровно/.test(await targetRun(path.join('tmp', 'poi-model-plans', 'plan.Json'))), true)
t('ни один отказ границы не дошёл до адаптера', targetCalls.adapter, 0)
t('и до writer', targetCalls.persist, 0)
t('грязное отслеживаемое дерево останавливает режим до адаптера',
  /до прогона отслеживаемое рабочее дерево изменено/.test(await boomAsync(() => runMain(
    ['--portal', 'bodik-osaka-tourism', '--model-plan', '--out', OUT],
    { resolveCodeIdentity: () => ({ commit: 'b'.repeat(40), dirty: true }) }))),
  true)
const dirtyEarly = { adapter: 0 }
await boomAsync(() => main(['node', 'x', '--portal', 'bodik-osaka-tourism', '--model-plan', '--out', OUT], {
  adapters: { 'opendata-csv': async () => { dirtyEarly.adapter += 1; return { candidates: [], meta: {} } } },
  persistReport: async () => {}, now: NOW,
  resolveCodeIdentity: () => ({ commit: 'b'.repeat(40), dirty: true }),
}))
t('и до адаптера дело не дошло', dirtyEarly.adapter, 0)
t('битая форма идентичности отвергается',
  /полным hex-hash/.test(await boomAsync(() => runMain(
    ['--portal', 'bodik-osaka-tourism', '--model-plan', '--out', OUT],
    { resolveCodeIdentity: () => ({ commit: 'короткий', dirty: false }) }))),
  true)

/* Идентичность кода перечитывается после порталов и до подписи: между
   первой проверкой и сохранением идёт выгрузка, и состояние может уехать. */
for (const [label, second, pattern] of [
  ['дерево испачкалось во время выгрузки', { commit: CODE_IDENTITY.commit, dirty: true }, /после прогона/],
  ['коммит сменился во время выгрузки', { commit: 'e'.repeat(40), dirty: false }, /идентичность кода изменилась/],
]) {
  let dirtied = false
  const calls = { adapter: 0, persist: 0 }
  const message = await boomAsync(() => main(
    ['node', 'x', '--portal', 'bodik-osaka-tourism', '--model-plan', '--out', OUT],
    {
      adapters: {
        'opendata-csv': async () => {
          calls.adapter += 1
          dirtied = true // состояние меняется ВНУТРИ адаптера
          return { candidates: awaiting, meta: { rows: awaiting.length } }
        },
      },
      persistReport: async () => { calls.persist += 1 },
      now: NOW,
      resolveCodeIdentity: () => (dirtied ? second : CODE_IDENTITY),
    },
  ))
  t(`${label} — режим падает`, pattern.test(message), true)
  t(`${label} — адаптер отработал`, calls.adapter, 1)
  t(`${label} — план не сохранён`, calls.persist, 0)
}

/* Настоящий production-writer, оба режима. Пишем в системный временный
   каталог: он вне репозитория и удаляется. */
const realDir = await mkdtemp(path.join(tmpdir(), 'poi-plan-'))
try {
  const exclusivePath = path.join(realDir, 'plan.json')
  await writeJsonReport(exclusivePath, { probe: 'первая' }, { mode: 'exclusive' })
  t('exclusive создаёт файл', JSON.parse(await readFile(exclusivePath, 'utf8')).probe, 'первая')
  const again = await boomAsync(() => writeJsonReport(exclusivePath, { probe: 'вторая' }, { mode: 'exclusive' }))
  t('exclusive отвергает повтор пути', /уже существует/.test(again), true)
  t('и содержимое прежнее', JSON.parse(await readFile(exclusivePath, 'utf8')).probe, 'первая')

  const overwritePath = path.join(realDir, 'report.json')
  await writeJsonReport(overwritePath, { probe: 'первая' }, { mode: 'overwrite' })
  await writeJsonReport(overwritePath, { probe: 'вторая' }, { mode: 'overwrite' })
  t('overwrite перезаписывает, как и раньше',
    JSON.parse(await readFile(overwritePath, 'utf8')).probe, 'вторая')

  t('режим записи обязателен',
    /режим записи обязателен/.test(await boomAsync(() => writeJsonReport(path.join(realDir, 'x.json'), {}, {}))), true)
  t('неизвестный режим отвергается',
    /режим записи обязателен/.test(
      await boomAsync(() => writeJsonReport(path.join(realDir, 'y.json'), {}, { mode: 'append' }))), true)

  const nested = path.join(realDir, 'sub', 'deep', 'report.json')
  await writeJsonReport(nested, { ok: true }, { mode: 'exclusive' })
  t('недостающие каталоги создаются', JSON.parse(await readFile(nested, 'utf8')).ok, true)

  /* Граница на настоящей файловой системе: занятый путь ловится ДО работы,
     а не финальным wx. Смонтированный каталог репозитория удалять нельзя,
     поэтому проверка идёт во временном каталоге — на той же функции, что
     вызывает P0. */
  t('свободный .json внутри каталога проходит',
    boom(() => assertExclusiveJsonTarget(path.join(realDir, 'free.json'), { insideDir: realDir })), '(без ошибки)')
  t('занятый путь отвергается как файл',
    /уже существует \(файл\)/.test(boom(() => assertExclusiveJsonTarget(exclusivePath, { insideDir: realDir }))), true)
  const occupiedDir = path.join(realDir, 'occupied.json')
  await mkdir(occupiedDir, { recursive: true })
  t('каталог с именем *.json отвергается как каталог',
    /уже существует \(каталог\)/.test(boom(() => assertExclusiveJsonTarget(occupiedDir, { insideDir: realDir }))), true)
  t('расширение проверяется и здесь',
    /расширение ровно/.test(boom(() => assertExclusiveJsonTarget(path.join(realDir, 'plan.bin'), { insideDir: realDir }))), true)
  t('.JSON отвергается на настоящей ФС',
    /расширение ровно/.test(boom(() => assertExclusiveJsonTarget(path.join(realDir, 'plan.JSON'), { insideDir: realDir }))), true)
  t('путь вне каталога отвергается',
    /обязан быть файлом внутри/.test(boom(() => assertExclusiveJsonTarget(path.join(tmpdir(), 'чужой.json'), { insideDir: realDir }))), true)

  /* Физическая граница: лексическая проверка обходится ссылкой, поэтому
     проверяется каждый существующий компонент пути. */
  const inside = path.join(realDir, 'plans')
  const outside = path.join(realDir, 'outside')
  await mkdir(inside, { recursive: true })
  await mkdir(outside, { recursive: true })
  await symlink(outside, path.join(inside, 'link'), 'dir')
  const escaped = path.join(inside, 'link', 'escaped.json')
  t('путь через символьную ссылку отвергается',
    /символьная ссылка в пути отчёта/.test(boom(() => assertExclusiveJsonTarget(escaped, { insideDir: inside }))), true)
  const escapeAttempt = await boomAsync(() => {
    assertExclusiveJsonTarget(escaped, { insideDir: inside })
    return writeJsonReport(escaped, { probe: 'утечка' }, { mode: 'exclusive' })
  })
  t('и попытка записи по нему не состоялась', /символьная ссылка/.test(escapeAttempt), true)
  t('снаружи каталога ничего не появилось', (await readdir(outside)).length, 0)

  await symlink(path.join(outside, 'never.json'), path.join(inside, 'dangling.json'))
  t('висячая ссылка на целевом пути считается занятой',
    /уже существует \(символьная ссылка\)/.test(
      boom(() => assertExclusiveJsonTarget(path.join(inside, 'dangling.json'), { insideDir: inside }))), true)
  t('обычный свободный .json внутри проходит',
    boom(() => assertExclusiveJsonTarget(path.join(inside, 'plain.json'), { insideDir: inside })), '(без ошибки)')
  t('несуществующий каталог плана — не ошибка: его создаст запись',
    boom(() => assertExclusiveJsonTarget(
      path.join(realDir, 'ещё-нет', 'plan.json'), { insideDir: path.join(realDir, 'ещё-нет') })), '(без ошибки)')

  /* Сам каталог отчётов тоже не может быть ссылкой: канонизация корня
     разрешила бы обход целиком — запись ушла бы наружу, а уборка внутрь
     ссылки не заходит. */
  const linkedRoot = path.join(realDir, 'linked-plans')
  const linkedOutside = path.join(realDir, 'linked-outside')
  await mkdir(linkedOutside, { recursive: true })
  await symlink(linkedOutside, linkedRoot, 'dir')
  const viaLinkedRoot = path.join(linkedRoot, 'plan.json')
  t('каталог отчётов — символьная ссылка: отказ',
    /каталог отчётов сам является символьной ссылкой/.test(
      boom(() => assertExclusiveJsonTarget(viaLinkedRoot, { insideDir: linkedRoot }))), true)
  const linkedRootAttempt = await boomAsync(() => {
    assertExclusiveJsonTarget(viaLinkedRoot, { insideDir: linkedRoot })
    return writeJsonReport(viaLinkedRoot, { probe: 'утечка через корень' }, { mode: 'exclusive' })
  })
  t('и writer по нему не вызывался', /каталог отчётов сам является/.test(linkedRootAttempt), true)
  t('за корневой ссылкой ничего не появилось', (await readdir(linkedOutside)).length, 0)
  const fileAsRoot = path.join(realDir, 'не-каталог')
  await writeFile(fileAsRoot, '{}', 'utf8')
  t('каталог отчётов — обычный файл: отказ',
    /не является каталогом/.test(
      boom(() => assertExclusiveJsonTarget(path.join(fileAsRoot, 'plan.json'), { insideDir: fileAsRoot }))), true)
  await writeFile(path.join(inside, 'plain.json'), '{}', 'utf8')
  t('он же после создания уже занят',
    /уже существует \(файл\)/.test(boom(() => assertExclusiveJsonTarget(path.join(inside, 'plain.json'), { insideDir: inside }))), true)
} finally {
  await rm(realDir, { recursive: true, force: true })
}

/* Провайдера не вызывает: глобальный fetch подменён на бросок, адаптер
   фиктивный и сети не требует, план при этом строится. */
const realFetch = globalThis.fetch
globalThis.fetch = () => { throw new Error('сеть в этом режиме запрещена') }
let withoutNetwork
try {
  withoutNetwork = await runMain(['--portal', 'bodik-osaka-tourism', '--model-plan', '--out', OUT])
} finally {
  globalThis.fetch = realFetch
}
t('план строится при запрещённой сети', withoutNetwork.report.modelPlan.portals[0].plannedItemCount, awaiting.length)

t('прогноз каскада остался отдельной диагностикой',
  typeof planned.report.portals[0].aiCost.totalUsd, 'number')
t('в плане денежной величины нет', planned.report.modelPlan.portals[0].estimatedCostUpperBound, null)

/* ── 11. Глобальность P0 — отдельным процессом ────────────────────────── */

const CHILD_PRELUDE = `
import { activePortals } from ${JSON.stringify(pathToFile('scripts/poi-portals/registry.mjs'))}
import { main } from ${JSON.stringify(pathToFile('scripts/poi-portals/collect-pois.mjs'))}
let calls = 0
const adapters = { 'opendata-csv': async () => { calls += 1; return { candidates: [], meta: {} } } }
const deps = {
  adapters,
  persistReport: async () => {},
  now: new Date('2026-08-13T00:00:00Z'),
  resolveCodeIdentity: () => ({ commit: '0'.repeat(40), dirty: false }),
}
const selected = activePortals().filter((p) => adapters[p.adapter])
if (selected.length !== 2) { console.log('SELECTED=' + selected.length); process.exit(3) }
const run = async (argv) => { try { await main(['node', 'x', ...argv], deps); return 0 } catch { return 1 } }
`
const inChild = (body) => execFileSync(process.execPath, ['--input-type=module', '--eval', CHILD_PRELUDE + body], {
  cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
})

/* Реестр правится в памяти отдельного процесса: подменять его через deps
   нельзя, публичного пути для этого нет и появляться он не должен. */
const brokenSelected = inChild(`
selected[1].modelProcessing.purpose = 'что-то другое'
const threw = await run(['--all', '--model-plan', '--out', 'tmp/poi-model-plans/child.json'])
console.log('CALLS=' + calls + ' THREW=' + threw + ' BROKEN=' + selected[1].id)
`)
t('битая policy второго ВЫБРАННОГО портала не дала вызвать ни один адаптер', /CALLS=0 /.test(brokenSelected), true)
t('и режим упал', /THREW=1/.test(brokenSelected), true)
t('испорчен именно второй выбранный портал', /BROKEN=bodik-kyoto-tourism/.test(brokenSelected), true)

/* Обратная сторона: битая policy портала, до которого прогон не доходит,
   не должна ронять ни обычный прогон, ни план по другому порталу. */
const brokenUnselected = inChild(`
selected[1].modelProcessing.purpose = 'что-то другое'
const plain = await run(['--portal', selected[0].id])
const planned = await run(['--portal', selected[0].id, '--model-plan', '--out', 'tmp/poi-model-plans/child.json'])
console.log('PLAIN=' + plain + ' PLANNED=' + planned + ' CALLS=' + calls)
`)
t('битая policy невыбранного портала не ломает обычный прогон', /PLAIN=0 /.test(brokenUnselected), true)
t('и не ломает план по другому порталу', /PLANNED=0 /.test(brokenUnselected), true)
t('оба прогона дошли до адаптера', /CALLS=2/.test(brokenUnselected), true)

/* Строгий контракт ключей policy обязан срабатывать в рантайме, а не только
   в юнит-тесте: неперечисляемое поле у выбранного портала роняет прогон до
   первого адаптера. */
const strictPolicy = inChild(`
Object.defineProperty(selected[0].modelProcessing, 'granted', { value: true, enumerable: false })
const threw = await run(['--portal', selected[0].id, '--model-plan', '--out', 'tmp/poi-model-plans/child.json'])
console.log('CALLS=' + calls + ' THREW=' + threw)
`)
t('policy с неперечисляемым полем роняет прогон', /THREW=1/.test(strictPolicy), true)
t('и адаптер не вызывался', /CALLS=0 /.test(strictPolicy), true)

/* Разрежённый и «загрязнённый» массив внутри policy — тоже отказ в рантайме
   и тоже до первого адаптера: дыра в списке разрешённых полей означала бы
   «разрешено неизвестно что». */
const sparsePolicy = inChild(`
selected[0].modelProcessing.fields = new Array(1)
const threw = await run(['--portal', selected[0].id, '--model-plan', '--out', 'tmp/poi-model-plans/child.json'])
console.log('CALLS=' + calls + ' THREW=' + threw)
`)
t('policy.fields = new Array(1) роняет прогон', /THREW=1/.test(sparsePolicy), true)
t('и адаптер не вызывался', /CALLS=0 /.test(sparsePolicy), true)

const strayKeyPolicy = inChild(`
selected[0].modelProcessing.allowedProviders['00'] = 'вендор'
const threw = await run(['--portal', selected[0].id, '--model-plan', '--out', 'tmp/poi-model-plans/child.json'])
console.log('CALLS=' + calls + ' THREW=' + threw)
`)
t('посторонний ключ массива policy роняет прогон', /THREW=1/.test(strayKeyPolicy), true)
t('и адаптер не вызывался', /CALLS=0 /.test(strayKeyPolicy), true)

const hiddenIdentity = inChild(`
const identity = { commit: '0'.repeat(40), dirty: false }
Object.defineProperty(identity, 'granted', { value: true, enumerable: false })
deps.resolveCodeIdentity = () => identity
const threw = await run(['--portal', selected[0].id, '--model-plan', '--out', 'tmp/poi-model-plans/child.json'])
console.log('CALLS=' + calls + ' THREW=' + threw)
`)
t('скрытое поле codeIdentity роняет прогон', /THREW=1/.test(hiddenIdentity), true)
t('и адаптер не вызывался', /CALLS=0 /.test(hiddenIdentity), true)


console.log(bad.length ? `✗ провалено ${bad.length}:\n  ` + bad.join('\n  ') : `✓ план модельной классификации: ${ok} проверок пройдено`)
process.exitCode = bad.length ? 1 : 0
