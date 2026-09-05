#!/usr/bin/env node
/**
 * run-manifest/v2 и pre-write gate — чистый контракт (10f-Q, P08.1–P08.3).
 *
 *   node tests/poi-run-manifest.mjs
 *
 * Здесь проверяется сам модуль: детерминированность, строгая форма,
 * покомпонентный дрейф, таблица исходов gate. Производственная композиция
 * (main → gate → writeRun) — tests/poi-prewrite-gate.mjs.
 */
import {
  assertRunManifest, buildRunManifest, candidateSetIdentity, codeGraphIdentity, compareRunManifests,
  DRIFT_COMPONENTS, fileIdentity, GATE_BLOCK, GATE_NOT_ARMED, GATE_PASS, MANIFEST_KEYS, preWriteGate,
  registryValueIdentity, RUN_MANIFEST_SPEC, RUN_MODES,
} from '../scripts/poi-portals/lib/run-manifest.mjs'
import { RAW_FILE_BYTES_SPEC } from '../scripts/lib/byte-digest.mjs'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const has = (label, text, needle) => {
  if (typeof text === 'string' && text.includes(needle)) ok++
  else bad.push(`${label}: в «${String(text).slice(0, 220)}» нет «${needle}»`)
}
const boom = (fn) => { try { fn(); return '(без ошибки)' } catch (e) { return e.message } }

const SHA = (ch) => `sha256:${ch.repeat(64)}`
const bytesOf = (text) => Buffer.from(text, 'utf8')
const cand = (sourceKey, extra = {}) => ({ sourceKey, nameJa: `имя ${sourceKey}`, lat: 34.6, lon: 135.5, address: 'адрес', ...extra })
/** Граф кода из перечисленных файлов: содержимое, а не коммит. */
const graph = (files) => codeGraphIdentity(Object.entries(files).map(([path, text]) => ({ path, bytes: bytesOf(text) })))
const GRAPH_A = graph({ 'scripts/poi-portals/collect-pois.mjs': 'A', 'src/lib/poi-ingest.ts': 'B' })
const DEPS_A = fileIdentity('package-lock.json', bytesOf('{"lockfileVersion":3}'))
const CODE_A = { commit: '0e1a40536553d7e585e77c06d2036ed6865ae08d', dirty: false, graph: GRAPH_A, deps: DEPS_A }
/** Реестры — по ЗНАЧЕНИЮ, отсортированные по id. */
const registriesOf = (decisions, taxonomyValue) => [
  registryValueIdentity({ id: 'poi-coordinate-decisions', version: 'poi-coordinate-decisions/v1', value: decisions, entries: decisions.decisions.length }),
  registryValueIdentity({ id: 'poi-taxonomy', version: 'poi-taxonomy/v2', value: taxonomyValue, entries: 20 }),
]
const LEDGER_A = { version: 'poi-coordinate-decisions/v1', decisions: [] }
const TAXONOMY_A = { version: 'poi-taxonomy/v2', poiPrimaryTypes: ['historic_site'] }
const REGISTRIES_A = registriesOf(LEDGER_A, TAXONOMY_A)

/* ── 1. Тождество набора кандидатов ────────────────────────────────────── */
{
  const a = candidateSetIdentity({ candidates: [cand('p:1'), cand('p:2')], unkeyed: [] })
  const b = candidateSetIdentity({ candidates: [cand('p:2'), cand('p:1')], unkeyed: [] })
  t('порядок кандидатов не влияет на digest', a.digest, b.digest)
  t('digest — sha256', /^sha256:[0-9a-f]{64}$/.test(a.digest), true)
  t('счётчики честные', `${a.candidates}/${a.unkeyed}`, '2/0')
  const c = candidateSetIdentity({ candidates: [cand('p:1'), cand('p:2', { lat: 34.7 })], unkeyed: [] })
  t('изменение одного значения меняет digest', c.digest === a.digest, false)
  const d = candidateSetIdentity({ candidates: [cand('p:1'), cand('p:2')], unkeyed: [{ rowIndex: 3, refusal: 'sourceIdEmpty', sourceId: '', nameJa: 'x' }] })
  t('отказы в ключе входят в тождество', d.digest === a.digest, false)
  has('повтор ключа — отказ тождества', boom(() => candidateSetIdentity({ candidates: [cand('p:1'), cand('p:1')] })), 'встречается более одного раза')
  has('кандидат без ключа — отказ', boom(() => candidateSetIdentity({ candidates: [{ nameJa: 'x' }] })), 'sourceKey')
  has('undefined в кандидате — отказ, а не молчаливый пропуск', boom(() => candidateSetIdentity({ candidates: [cand('p:1', { note: undefined })] })), 'не сериализуется')
}

/* ── 2. Сборка манифеста: детерминизм и форма ──────────────────────────── */
const base = () => ({
  startedAt: '2026-09-04T00:00:00.000Z',
  mode: 'dry-write',
  code: CODE_A,
  intakeContract: 'poi-intake/v1',
  registries: REGISTRIES_A,
  matcherPolicy: { version: 'poi-matcher-policy/v3', digest: SHA('b'), lexiconDigest: SHA('c') },
  portals: [{
    portalId: 'bodik-osaka-tourism',
    adapter: { id: 'opendata-csv', version: 'opendata-csv/v2' },
    input: { rawPayload: { digest: SHA('d'), bytes: 1234, spec: RAW_FILE_BYTES_SPEC }, canonical: candidateSetIdentity({ candidates: [cand('bodik-osaka-tourism:1')] }) },
  }],
  base: { existing: { ...fileIdentity('existing.json', bytesOf('[]')), records: 1, withSourceKey: 1 }, snapshot: null },
  names: null,
})
{
  const m1 = buildRunManifest(base())
  const m2 = buildRunManifest(base())
  t('одинаковый вход — одинаковый digest', m1.manifestDigest.value, m2.manifestDigest.value)
  t('версия контракта', m1.contractVersion, RUN_MANIFEST_SPEC)
  t('верхний уровень — ровно объявленный набор', Object.keys(m1).sort().join(','), [...MANIFEST_KEYS].sort().join(','))
  t('манифест заморожен глубоко', Object.isFrozen(m1.portals[0].input), true)
  t('digest подписан спецификацией манифеста', m1.manifestDigest.spec, RUN_MANIFEST_SPEC)
  t('assertRunManifest принимает собранный', assertRunManifest(m1) === m1, true)
  /* Каждый компонент меняет digest — по одному. */
  const variants = {
    startedAt: { startedAt: '2026-09-04T00:00:01.000Z' },
    mode: { mode: 'write' },
    code: { code: { ...CODE_A, commit: '1'.repeat(40) } },
    codeGraph: { code: { ...CODE_A, graph: graph({ 'scripts/poi-portals/collect-pois.mjs': 'ИЗМЕНЁННЫЙ', 'src/lib/poi-ingest.ts': 'B' }) } },
    codeDirty: { code: { ...CODE_A, dirty: true } },
    codeDeps: { code: { ...CODE_A, deps: fileIdentity('package-lock.json', bytesOf('{"lockfileVersion":4}')) } },
    intakeContract: { intakeContract: 'poi-intake/v2' },
    registryTaxonomy: { registries: registriesOf(LEDGER_A, { ...TAXONOMY_A, poiPrimaryTypes: ['historic_site', 'museum'] }) },
    registryDecisions: { registries: registriesOf({ ...LEDGER_A, decisions: [{ sourceKey: 'p:1' }] }, TAXONOMY_A) },
    matcherPolicy: { matcherPolicy: { version: 'poi-matcher-policy/v3', digest: SHA('f'), lexiconDigest: SHA('c') } },
    lexicon: { matcherPolicy: { version: 'poi-matcher-policy/v3', digest: SHA('b'), lexiconDigest: SHA('0') } },
    names: { names: fileIdentity('names.json', bytesOf('{}')) },
    snapshot: { base: { existing: base().base.existing, snapshot: { ...fileIdentity('snap.json', bytesOf('[]')), records: 0, withSourceKey: 0 } } },
    existing: { base: { existing: { ...fileIdentity('existing.json', bytesOf('[{}]')), records: 1, withSourceKey: 1 }, snapshot: null } },
    input: { portals: [{ ...base().portals[0], input: { ...base().portals[0].input, rawPayload: { digest: SHA('9'), bytes: 1234, spec: RAW_FILE_BYTES_SPEC } } }] },
  }
  for (const [label, over] of Object.entries(variants)) {
    t(`digest меняется от компонента ${label}`, buildRunManifest({ ...base(), ...over }).manifestDigest.value === m1.manifestDigest.value, false)
  }
}

/* ── 3. Строгая форма: повреждённый, неполный, лишний, неизвестной версии ── */
{
  const good = buildRunManifest(base())
  const plain = JSON.parse(JSON.stringify(good))
  t('после JSON-круга принимается', assertRunManifest(plain).manifestDigest.value, good.manifestDigest.value)
  const corrupted = JSON.parse(JSON.stringify(good)); corrupted.matcherPolicy.digest = SHA('f')
  has('повреждённый (изменён после подписи) — отказ', boom(() => assertRunManifest(corrupted)), 'изменён после подписи')
  const incomplete = JSON.parse(JSON.stringify(good)); delete incomplete.base
  has('неполный — отказ с именем поля', boom(() => assertRunManifest(incomplete)), 'нет обязательных полей base')
  const extra = JSON.parse(JSON.stringify(good)); extra.note = 'лишнее'
  has('лишнее поле — отказ', boom(() => assertRunManifest(extra)), 'лишние поля note')
  const unknown = JSON.parse(JSON.stringify(good)); unknown.contractVersion = 'run-manifest/v9'
  has('неизвестная версия — отказ по закрытому списку', boom(() => assertRunManifest(unknown)), 'неизвестная версия манифеста "run-manifest/v9"')
  /* НЕСОВМЕСТИМАЯ ФОРМА ПОД ПРЕЖНЕЙ ВЕРСИЕЙ — находка аудита 3 (10f-Q R2).
     R1 добавил обязательный `code.tree`, не сдвинув селектор: манифест R0 и
     манифест R1 носили одну версию `run-manifest/v1` и были несовместимы.
     Теперь форма R1 отвергается ПО ВЕРСИИ, а не по отсутствующему полю. */
  const r1shaped = JSON.parse(JSON.stringify(good))
  r1shaped.contractVersion = 'run-manifest/v1'
  r1shaped.code = { commit: r1shaped.code.commit, dirty: false, tree: { spec: 'poi-code-tree/v1', digest: SHA('a'), files: 2 } }
  delete r1shaped.registries
  r1shaped.taxonomy = { version: 'poi-taxonomy/v2', digest: { value: SHA('a'), algorithm: 'sha256', spec: RAW_FILE_BYTES_SPEC } }
  has('манифест формы R1 отвергается по ВЕРСИИ, а не по полю', boom(() => assertRunManifest(r1shaped)), 'неизвестная версия манифеста "run-manifest/v1"')
  const proto = Object.create({ contractVersion: RUN_MANIFEST_SPEC }); Object.assign(proto, JSON.parse(JSON.stringify(good))); delete proto.contractVersion
  has('версия из прототипа — не версия (объект с прототипом отвергается целиком)', boom(() => assertRunManifest(proto)), 'простым объектом')
  const getter = JSON.parse(JSON.stringify(good)); delete getter.contractVersion
  Object.defineProperty(getter, 'contractVersion', { get: () => RUN_MANIFEST_SPEC, enumerable: true, configurable: true })
  has('версия через getter — не версия (accessor отвергается на сыром входе)', boom(() => assertRunManifest(getter)), 'accessor-свойство не сериализуется')
  const badMode = JSON.parse(JSON.stringify(good)); badMode.mode = 'live'
  has('неизвестный режим — отказ', boom(() => assertRunManifest(badMode)), 'mode')
  const badInstant = JSON.parse(JSON.stringify(good)); badInstant.startedAt = '2026-09-04'
  has('неканонический момент — отказ', boom(() => assertRunManifest(badInstant)), 'канонический момент')
  has('порталы неотсортированы — отказ', boom(() => buildRunManifest({ ...base(), portals: [
    { ...base().portals[0], portalId: 'z-portal' }, { ...base().portals[0], portalId: 'a-portal' }] })), 'отсортированном порядке')
  has('портал повторяется — отказ', boom(() => buildRunManifest({ ...base(), portals: [base().portals[0], base().portals[0]] })), 'повторяется')
  has('пустой список порталов — отказ', boom(() => buildRunManifest({ ...base(), portals: [] })), 'непустой массив')
  has('digest не sha256 — отказ', boom(() => buildRunManifest({ ...base(), matcherPolicy: { version: 'v', digest: 'abc', lexiconDigest: SHA('c') } })), 'sha256')
  has('код без dirty — отказ', boom(() => buildRunManifest({ ...base(), code: { commit: '1'.repeat(40), graph: GRAPH_A, deps: DEPS_A } })), 'нет обязательных полей dirty')
  has('код с неверным commit — отказ прежним контрактом',
    boom(() => buildRunManifest({ ...base(), code: { ...CODE_A, commit: 'abc' } })), 'codeIdentity.commit')
  has('код без графа — отказ', boom(() => buildRunManifest({ ...base(), code: { commit: '1'.repeat(40), dirty: false, deps: DEPS_A } })), 'нет обязательных полей graph')
  has('код без замка зависимостей — отказ', boom(() => buildRunManifest({ ...base(), code: { commit: '1'.repeat(40), dirty: false, graph: GRAPH_A } })), 'нет обязательных полей deps')
  has('граф кода без файлов — отказ', boom(() => codeGraphIdentity([])), 'непустой список')
  has('файл графа без байтов — отказ', boom(() => codeGraphIdentity([{ path: 'a.mjs' }])), 'без байтов')
  has('повтор пути в графе — отказ', boom(() => codeGraphIdentity([{ path: 'a.mjs', bytes: bytesOf('x') }, { path: 'a.mjs', bytes: bytesOf('y') }])), 'встречается более одного раза')
  t('порядок файлов в графе не влияет на digest',
    graph({ 'b.mjs': '2', 'a.mjs': '1' }).digest, graph({ 'a.mjs': '1', 'b.mjs': '2' }).digest)
  t('перемещение того же содержимого в другой файл меняет digest',
    graph({ 'a.mjs': '1', 'b.mjs': '2' }).digest === graph({ 'a.mjs': '2', 'b.mjs': '1' }).digest, false)
  t('лишний файл в графе меняет digest',
    graph({ 'a.mjs': '1' }).digest === graph({ 'a.mjs': '1', 'c.mjs': '' }).digest, false)
  /* Реестры — по ЗНАЧЕНИЮ (находка аудита 2). */
  has('реестр без значения — отказ', boom(() => registryValueIdentity({ id: 'x', version: 'v1', value: null, entries: 0 })), 'обязано быть объектом')
  has('реестр без версии — отказ', boom(() => registryValueIdentity({ id: 'x', value: {}, entries: 0 })), 'version')
  t('переформатирование не меняет тождество ЗНАЧЕНИЯ',
    registryValueIdentity({ id: 'x', version: 'v1', value: JSON.parse('{"b":2,"a":1}'), entries: 0 }).valueDigest,
    registryValueIdentity({ id: 'x', version: 'v1', value: JSON.parse('{"a":1,\n "b":2}'), entries: 0 }).valueDigest)
  t('правка ЗНАЧЕНИЯ тождество меняет',
    registryValueIdentity({ id: 'x', version: 'v1', value: { a: 1 }, entries: 0 }).valueDigest
      === registryValueIdentity({ id: 'x', version: 'v1', value: { a: 2 }, entries: 0 }).valueDigest, false)
  has('пустой список реестров — отказ', boom(() => buildRunManifest({ ...base(), registries: [] })), 'непустой массив реестров')
  has('реестры неотсортированы — отказ', boom(() => buildRunManifest({ ...base(), registries: [REGISTRIES_A[1], REGISTRIES_A[0]] })), 'отсортированном порядке')
  has('реестр повторяется — отказ', boom(() => buildRunManifest({ ...base(), registries: [REGISTRIES_A[0], REGISTRIES_A[0]] })), 'повторяется')
  has('манифест не объект — отказ', boom(() => assertRunManifest('x')), 'простым объектом')
  t('режимы — закрытый список из четырёх', RUN_MODES.join(','), 'read-only,dry-write,snapshot,write')
}

/* ── 4. Покомпонентный дрейф ───────────────────────────────────────────── */
{
  const ref = buildRunManifest(base())
  const same = compareRunManifests(buildRunManifest({ ...base(), mode: 'write', startedAt: '2026-09-05T00:00:00.000Z' }), ref)
  t('режим и момент начала не считаются дрейфом', same.drift.length, 0)
  t('проверенные компоненты названы', same.checked.join(','), DRIFT_COMPONENTS.join(','))
  const kinds = (over) => compareRunManifests(buildRunManifest({ ...base(), ...over }), ref).drift.map((d) => `${d.component}:${d.kind}`).join(',')
  t('дрейф входа', kinds({ portals: [{ ...base().portals[0], input: { ...base().portals[0].input, rawPayload: { digest: SHA('9'), bytes: 1, spec: RAW_FILE_BYTES_SPEC } } }] }), 'input:inputDrift')
  t('дрейф базы (existing)', kinds({ base: { existing: { ...fileIdentity('existing.json', bytesOf('[1]')), records: 1, withSourceKey: 1 }, snapshot: null } }), 'base:baseDrift')
  t('дрейф базы (снимок появился)', kinds({ base: { existing: base().base.existing, snapshot: { ...fileIdentity('s.json', bytesOf('[]')), records: 0, withSourceKey: 0 } } }), 'base:baseDrift')
  t('дрейф политики', kinds({ matcherPolicy: { version: 'poi-matcher-policy/v3', digest: SHA('f'), lexiconDigest: SHA('c') } }), 'matcherPolicy:policyDrift')
  t('дрейф словарей политики', kinds({ matcherPolicy: { version: 'poi-matcher-policy/v3', digest: SHA('b'), lexiconDigest: SHA('1') } }), 'matcherPolicy:policyDrift')
  /* РЕЕСТРЫ — ПО ЗНАЧЕНИЮ И КАЖДЫЙ ОТДЕЛЬНО (10f-Q R2, находка аудита 2).
     До R2 реестр решений владельца о координатах не имел компоненты вовсе. */
  t('дрейф таксономии', kinds({ registries: registriesOf(LEDGER_A, { ...TAXONOMY_A, version: 'poi-taxonomy/v3' }) }), 'registries:registryDrift')
  t('дрейф реестра решений о координатах',
    kinds({ registries: registriesOf({ ...LEDGER_A, decisions: [{ sourceKey: 'p:1' }] }, TAXONOMY_A) }), 'registries:registryDrift')
  t('исчезнувший реестр — не «совпал», а другой состав',
    kinds({ registries: [REGISTRIES_A[1]] }), 'registries:registrySetDrift')
  t('два реестра дрейфуют двумя записями, не одной',
    kinds({ registries: registriesOf({ ...LEDGER_A, decisions: [{ sourceKey: 'p:1' }] }, { ...TAXONOMY_A, version: 'poi-taxonomy/v3' }) }),
    'registries:registryDrift,registries:registryDrift')
  t('дрейф имён', kinds({ names: fileIdentity('names.json', bytesOf('{}')) }), 'names:namesDrift')
  /* Три независимых наблюдения о коде (10f-Q R1, находка аудита 2): коммит,
     фактические байты цепочки и чистота дерева. Изменённый production-код при
     ТОМ ЖЕ коммите обязан быть виден — прежде он проходил как «дрейфа нет». */
  t('дрейф кода: только коммит', kinds({ code: { ...CODE_A, commit: '1'.repeat(40) } }), 'code:codeDrift')
  t('дрейф кода: тот же коммит, изменённые байты цепочки',
    kinds({ code: { ...CODE_A, graph: graph({ 'scripts/poi-portals/collect-pois.mjs': 'ИЗМЕНЁННЫЙ', 'src/lib/poi-ingest.ts': 'B' }) } }),
    'code:codeGraphDrift')
  t('дрейф кода: тот же коммит и те же байты, но дерево объявлено грязным',
    kinds({ code: { ...CODE_A, dirty: true } }), 'code:codeDirtyDrift')
  t('дрейф кода: замок зависимостей — своя ось',
    kinds({ code: { ...CODE_A, deps: fileIdentity('package-lock.json', bytesOf('{"lockfileVersion":4}')) } }), 'code:codeDepsDrift')
  t('четыре оси кода не маскируют друг друга',
    kinds({ code: { commit: '2'.repeat(40), dirty: true, graph: graph({ 'x.mjs': 'X' }), deps: fileIdentity('package-lock.json', bytesOf('иное')) } }),
    'code:codeDrift,code:codeGraphDrift,code:codeDirtyDrift,code:codeDepsDrift')
  t('дрейф контракта приёма', kinds({ intakeContract: 'poi-intake/v2' }), 'intakeContract:intakeContractDrift')
  t('дрейф состава порталов', kinds({ portals: [{ ...base().portals[0], portalId: 'bodik-kyoto-tourism' }] }), 'portals:portalSetDrift')
  /* ДРЕЙФ АДАПТЕРА НИЧЕГО НЕ ОТМЕНЯЕТ (10f-Q R2, находка аудита 4). Прежде
     здесь стоял `continue`, и смена версии прятала обе оси входа: контрпример
     с другой версией, другими сырыми байтами и другим каноническим набором
     возвращал ровно один `adapterDrift`. Сырые байты сравнимы независимо от
     версии; канонический набор при разных версиях несравним — и это названо. */
  t('дрейф версии адаптера: сам дрейф и НАЗВАННАЯ несравнимость канонического набора',
    kinds({ portals: [{ ...base().portals[0], adapter: { id: 'opendata-csv', version: 'opendata-csv/v3' } }] }),
    'input:adapterDrift,input:canonicalIncomparable')
  t('смена версии адаптера НЕ прячет дрейф сырых байтов',
    kinds({ portals: [{
      ...base().portals[0],
      adapter: { id: 'opendata-csv', version: 'opendata-csv/v3' },
      input: { ...base().portals[0].input, rawPayload: { digest: SHA('9'), bytes: 7, spec: RAW_FILE_BYTES_SPEC } },
    }] }),
    'input:adapterDrift,input:inputDrift,input:canonicalIncomparable')
  t('два дрейфа — две записи, ни одна не маскирует другую',
    kinds({ intakeContract: 'poi-intake/v2', names: fileIdentity('n.json', bytesOf('{}')) }), 'intakeContract:intakeContractDrift,names:namesDrift')
  /* RAW И CANONICAL — ДВЕ НЕЗАВИСИМЫЕ ОСИ (10f-Q R1, находка аудита 3).
     Прежде совпавший сырой payload отменял сравнение канонического набора, и
     правка адаптера, меняющая кандидатов при тех же байтах источника, проходила
     как «дрейфа нет». */
  const withCanonical = (candidates) => ({ portals: [{ ...base().portals[0], input: { ...base().portals[0].input, canonical: candidateSetIdentity({ candidates }) } }] })
  t('одинаковый raw, другой canonical — canonicalDrift',
    kinds(withCanonical([cand('p:1', { nameJa: 'ДРУГОЕ' })])), 'input:canonicalDrift')
  t('другой raw, тот же canonical — inputDrift',
    kinds({ portals: [{ ...base().portals[0], input: { ...base().portals[0].input, rawPayload: { digest: SHA('9'), bytes: 1, spec: RAW_FILE_BYTES_SPEC } } }] }), 'input:inputDrift')
  t('разошлись обе оси — обе названы',
    kinds({ portals: [{ ...base().portals[0], input: { rawPayload: { digest: SHA('9'), bytes: 1, spec: RAW_FILE_BYTES_SPEC }, canonical: candidateSetIdentity({ candidates: [cand('p:2')] }) } }] }),
    'input:inputDrift,input:canonicalDrift')

  /* Несравнимость входа: сырой payload есть только у одной стороны; либо нет ни payload, ни версии адаптера. */
  const noRaw = (version) => ({ portals: [{ ...base().portals[0], adapter: { id: 'stub', version }, input: { ...base().portals[0].input, rawPayload: null } }] })
  t('payload только у эталона — несравнимо', kinds(noRaw('stub/v1')), 'input:adapterDrift,input:inputIncomparable,input:canonicalIncomparable')
  const refNoRaw = buildRunManifest({ ...base(), ...noRaw('stub/v1') })
  const cmp = (cur) => compareRunManifests(buildRunManifest({ ...base(), ...cur }), refNoRaw).drift.map((d) => d.kind).join(',')
  t('без payload, но с версией адаптера — канонический набор сравним, дрейфа нет', cmp(noRaw('stub/v1')), '')
  t('без payload и без версии адаптера — несравнимо', cmp({ portals: [{ ...base().portals[0], adapter: { id: 'stub', version: null }, input: { ...base().portals[0].input, rawPayload: null } }] }), 'adapterDrift,canonicalIncomparable')
  const refNoVersion = buildRunManifest({ ...base(), portals: [{ ...base().portals[0], adapter: { id: 'stub', version: null }, input: { ...base().portals[0].input, rawPayload: null } }] })
  /* Обе стороны без сырых байтов — оси raw просто нет; несравнимость raw
     объявляется тогда, когда payload есть у ОДНОЙ стороны. Ось canonical при
     этом остаётся и объявляется несравнимой сама. */
  t('обе стороны без payload и без версии адаптера — несравним канонический набор',
    compareRunManifests(refNoVersion, refNoVersion).drift.map((d) => d.kind).join(','), 'canonicalIncomparable')
  const refNoRawWithVersion = buildRunManifest({ ...base(), ...noRaw('stub/v1') })
  t('без payload, но с версией адаптера: canonical сравнивается и ловит расхождение',
    compareRunManifests(buildRunManifest({ ...base(), portals: [{ ...noRaw('stub/v1').portals[0], input: { rawPayload: null, canonical: candidateSetIdentity({ candidates: [cand('p:9')] }) } }] }), refNoRawWithVersion)
      .drift.map((d) => `${d.component}:${d.kind}`).join(','), 'input:canonicalDrift')
}

/* ── 5. Таблица исходов gate ───────────────────────────────────────────── */
{
  const manifestOf = (mode, over = {}) => buildRunManifest({ ...base(), mode, ...over })
  const report = (manifest) => ({ startedAt: manifest.startedAt, manifest })
  const g = (args) => { const r = preWriteGate(args); return `${r.state}:${r.reason}${r.drift.length ? ':' + r.drift.map((d) => d.kind).join('+') : ''}` }
  t('read-only — не применяется', g({ manifest: manifestOf('read-only'), mode: 'read-only' }), 'NOT_ARMED:readOnly')
  t('dry-write без эталона — не взведён', g({ manifest: manifestOf('dry-write'), mode: 'dry-write' }), 'NOT_ARMED:referenceMissing')
  t('snapshot без эталона — не взведён', g({ manifest: manifestOf('snapshot'), mode: 'snapshot' }), 'NOT_ARMED:referenceMissing')
  t('write без эталона — BLOCK', g({ manifest: manifestOf('write'), mode: 'write' }), 'BLOCK:referenceMissing')
  t('write без манифеста — BLOCK', g({ manifest: null, mode: 'write' }), 'BLOCK:manifestUnavailable')
  t('dry-write с эталоном, но без манифеста — BLOCK', g({ manifest: null, mode: 'dry-write', reference: report(manifestOf('dry-write')) }), 'BLOCK:manifestUnavailable')
  t('эталон не прочитан — BLOCK', g({ manifest: manifestOf('write'), mode: 'write', referenceError: 'ENOENT' }), 'BLOCK:referenceInvalid')
  t('эталон без манифеста (старый отчёт) — BLOCK', g({ manifest: manifestOf('write'), mode: 'write', reference: { startedAt: 'x', portals: [] } }), 'BLOCK:referenceInvalid')
  const corrupted = JSON.parse(JSON.stringify(manifestOf('dry-write'))); corrupted.registries[1].version = 'poi-taxonomy/v9'
  t('эталон повреждён — BLOCK', g({ manifest: manifestOf('write'), mode: 'write', reference: report(corrupted) }), 'BLOCK:referenceInvalid')
  const unknownVersion = JSON.parse(JSON.stringify(manifestOf('dry-write'))); unknownVersion.contractVersion = 'run-manifest/v0'
  t('эталон неизвестной версии — BLOCK', g({ manifest: manifestOf('write'), mode: 'write', reference: report(unknownVersion) }), 'BLOCK:referenceInvalid')
  t('write без тождества базы — BLOCK', g({ manifest: manifestOf('write', { base: { existing: null, snapshot: null } }), mode: 'write', reference: report(manifestOf('dry-write', { base: { existing: null, snapshot: null } })) }), 'BLOCK:baseIdentityMissing')
  t('write, эталон совпадает — PASS', g({ manifest: manifestOf('write'), mode: 'write', reference: report(manifestOf('dry-write')) }), 'PASS:null')
  t('dry-write, эталон совпадает — PASS', g({ manifest: manifestOf('dry-write'), mode: 'dry-write', reference: report(manifestOf('dry-write')) }), 'PASS:null')
  t('write, дрейф входа — BLOCK с именем', g({ manifest: manifestOf('write', { portals: [{ ...base().portals[0], input: { ...base().portals[0].input, rawPayload: { digest: SHA('9'), bytes: 1, spec: RAW_FILE_BYTES_SPEC } } }] }), mode: 'write', reference: report(manifestOf('dry-write')) }), 'BLOCK:drift:inputDrift')
  t('write, дрейф базы и политики — оба названы', g({ manifest: manifestOf('write', { base: { existing: { ...fileIdentity('e.json', bytesOf('[1]')), records: 1, withSourceKey: 1 }, snapshot: null }, matcherPolicy: { version: 'poi-matcher-policy/v3', digest: SHA('f'), lexiconDigest: SHA('c') } }), mode: 'write', reference: report(manifestOf('dry-write')) }), 'BLOCK:drift:policyDrift+baseDrift')
  const passed = preWriteGate({ manifest: manifestOf('write'), mode: 'write', reference: report(manifestOf('dry-write')) })
  t('PASS называет эталон digest\'ом', passed.reference.manifestDigest, manifestOf('dry-write').manifestDigest.value)
  t('форма результата одна для всех исходов', Object.keys(passed).sort().join(','), Object.keys(preWriteGate({ manifest: null, mode: 'write' })).sort().join(','))
  has('режим манифеста ≠ режим прогона — ошибка кода', boom(() => preWriteGate({ manifest: manifestOf('dry-write'), mode: 'write', reference: report(manifestOf('dry-write')) })), 'не совпадает с режимом прогона')
  has('неизвестный режим — ошибка', boom(() => preWriteGate({ manifest: null, mode: 'live' })), 'неизвестный режим')
  t('константы исходов', `${GATE_PASS}/${GATE_BLOCK}/${GATE_NOT_ARMED}`, 'PASS/BLOCK/NOT_ARMED')
}

if (bad.length) {
  console.error(`\n✗ провалено ${bad.length} из ${ok + bad.length}\n`)
  for (const line of bad) console.error(`  ${line}`)
  process.exitCode = 1
} else {
  console.log(`✓ манифест прогона и pre-write gate: ${ok} проверок пройдено`)
}
