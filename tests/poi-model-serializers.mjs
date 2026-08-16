/**
 * Канонический сериализатор и подготовка исходящих байтов — целиком офлайн.
 *
 * Настоящие production-builder плана, разрешения и запроса соединяются с
 * реестром сериализаторов. Сети, адреса, секрета и HTTP-клиента здесь нет:
 * подготовка ничего не отправляет и ничего не записывает.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildModelApproval } from '../scripts/poi-portals/lib/model-approval.mjs'
import { approvalFileName } from '../scripts/poi-portals/lib/approval-store.mjs'
import { createArtifactStore } from '../scripts/poi-portals/lib/execution-journal.mjs'
import { runExecutionPreflight } from '../scripts/poi-portals/lib/execution-preflight.mjs'
import {
  buildModelPlan,
  buildPortalPlanFragment,
  MODEL_INPUT_FIELDS,
} from '../scripts/poi-portals/lib/model-plan.mjs'
import {
  MODEL_PRICING_SPEC,
  pricingTableDigest,
} from '../scripts/poi-portals/lib/model-pricing.mjs'
import { PROVIDER_PROFILE_SPEC } from '../scripts/poi-portals/lib/provider-profile.mjs'
import { rerunPortalCandidates } from '../scripts/poi-portals/collect-pois.mjs'
import { buildModelRequest } from '../scripts/poi-portals/lib/model-request.mjs'
import {
  assertEndpointForDescriptor,
  assertImplementationBinding,
  assertOutboundIntegrity,
  IDEMPOTENCY_POLICIES,
  assertSerializerDescriptor,
  MODEL_SERIALIZER_SPEC,
  OUTBOUND_KEYS,
  prepareOutbound,
  resolveModelSerializer,
  SAMPLING_POLICIES,
  SERIALIZER_DESCRIPTOR_KEYS,
  SERIALIZER_DESCRIPTORS,
  SERIALIZER_METHODS,
  STORE_POLICIES,
} from '../scripts/poi-portals/lib/model-serializers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FX = path.join(HERE, 'fixtures', 'poi-model-plan')

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok += 1
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const boom = (fn) => { try { fn(); return '(без ошибки)' } catch (e) { return e.message } }
const clone = (value) => JSON.parse(JSON.stringify(value))

const awaiting = JSON.parse(await readFile(path.join(FX, 'candidates-awaiting.json'), 'utf8'))
const NOW = new Date('2026-08-13T00:00:00Z')
const CODE_IDENTITY = { commit: '0'.repeat(40), dirty: false }
const PORTAL_ID = 'p-serializer'

const ENTRY = {
  providerId: 'example-provider',
  modelId: 'example-model',
  modelVersion: '2026-08-01',
  inputMicrosPerMillionTokens: 3_000_000,
  outputMicrosPerMillionTokens: 15_000_000,
}
const pricingBody = {
  contractVersion: MODEL_PRICING_SPEC,
  pricingTableAsOf: '2026-08-01',
  currency: 'USD',
  entries: [ENTRY],
}
const PRICING = {
  ...pricingBody,
  pricingTableDigest: {
    value: pricingTableDigest({ ...pricingBody, pricingTableDigest: null }),
    algorithm: 'sha256',
    spec: MODEL_PRICING_SPEC,
  },
}
const PROFILE = Object.freeze({
  contractVersion: PROVIDER_PROFILE_SPEC,
  id: 'example-profile',
  version: '1.0.0',
  providerId: ENTRY.providerId,
  modelId: ENTRY.modelId,
  modelVersion: ENTRY.modelVersion,
  endpoint: 'https://api.example.com/v1/responses',
  apiVersion: '2026-08-01',
  structuredOutput: { mode: 'json-schema-strict', schemaDialect: 'json-schema-draft-2020-12' },
  serializer: { id: 'openai-responses', version: '1.0.0' },
  capabilities: {
    idempotencyKey: { supported: false, header: null, scope: null },
    statusEndpoint: { supported: false, billable: null, path: null },
    batch: { supported: false, returnsRequestItemId: null },
  },
  pricingTableDigest: clone(PRICING.pricingTableDigest),
})
const POLICY = Object.freeze({
  purpose: 'classification',
  allowedProviders: [PROFILE.id],
  fields: [...MODEL_INPUT_FIELDS],
  decisionRef: 'owner/2026-08-14',
  reviewedAt: '2026-08-01',
  validUntil: '2026-12-31',
})
const portalOf = () => ({
  id: PORTAL_ID, adapter: 'fake', regionKeys: [], modelProcessing: POLICY,
})
const ADAPTERS = Object.freeze({ fake: async () => ({ candidates: clone(awaiting), meta: {} }) })
const evaluated = await rerunPortalCandidates(portalOf(), { adapters: ADAPTERS })
const SCHEMA_OBJECT = { type: 'object', properties: { entityKind: { type: 'string' } } }

const AT = '2026-08-14T00:00:00.000Z'
const repoRoot = await mkdtemp(path.join(tmpdir(), 'poi-serializer-'))
const store = createArtifactStore({ repoRoot })

/** План, разрешение и запрос под заданный текст промпта. */
const requestFor = async (promptText, serial, profile = PROFILE) => {
  const plan = buildModelPlan({
    fragments: [buildPortalPlanFragment({
      portal: portalOf(), evaluated, now: NOW, providerProfile: profile,
    })],
    selectedPortalIds: [PORTAL_ID],
    meta: {
      planId: `plan-serializer-${serial}`,
      createdAt: '2026-08-13T00:00:00.000Z',
      deleteAfter: '2026-08-20T00:00:00.000Z',
      codeIdentity: CODE_IDENTITY,
      taxonomyVersion: 'poi-taxonomy/v2',
      taxonomyBytes: Buffer.from('{"version":"poi-taxonomy/v2"}\n', 'utf8'),
      taxonomySpec: 'raw-file-bytes/v1',
      promptText,
      schemaObject: SCHEMA_OBJECT,
      providerProfile: profile,
    },
  })
  const total = plan.portals[0].plannedItemCount
  const approval = buildModelApproval({
    plan: clone(plan),
    approvalId: `approval-serializer-${serial}`,
    createdAt: '2026-08-13T00:00:00.000Z',
    validUntil: '2026-08-20T00:00:00.000Z',
    decisionRef: 'owner/2026-08-14',
    approver: 'jumbo',
    limits: {
      maxCandidates: total,
      maxNetworkRequests: total,
      maxBatchJobs: 0,
      maxItemBytes: Math.max(...plan.portals[0].items.map((i) => i.classificationItemBytes)),
      maxInputTokens: 1000,
      maxOutputTokens: 200,
      maxTotalTokens: 2_000_000,
      maxCostMicros: 1_000_000_000,
      currency: 'USD',
      pricingTableDigest: clone(PRICING.pricingTableDigest),
      pricingTableAsOf: '2026-08-01',
      maxRetries: 0,
    },
  })
  await store.approvals.writeApprovalFile({ approval: clone(approval), plan: clone(plan) })
  const preflight = await runExecutionPreflight({
    approvalFileName: approvalFileName(approval),
    plan: clone(plan),
    profile: clone(profile),
    pricingTable: clone(PRICING),
    now: AT,
    store,
    adapters: ADAPTERS,
    resolvePortal: () => portalOf(),
    resolveCodeIdentity: () => ({ ...CODE_IDENTITY }),
    rerunPortal: (portal, options) => rerunPortalCandidates(portal, options),
  })
  if (!preflight.ok) throw new Error(`preflight отказал: ${JSON.stringify(preflight.gates ?? null)}`)
  const prepared = preflight.preparedItems[0]
  return buildModelRequest({
    plan: clone(plan),
    approval: clone(approval),
    profile: clone(profile),
    portalId: prepared.portalId,
    requestItemId: prepared.requestItemId,
    classificationItem: clone(prepared.classificationItem),
    promptText,
    schemaObject: clone(SCHEMA_OBJECT),
  })
}

/* ── Реестр и разрешение ──────────────────────────────────────────────── */

t('в каноническом реестре ровно один сериализатор', SERIALIZER_DESCRIPTORS.length, 1)
t('реестр заморожен', Object.isFrozen(SERIALIZER_DESCRIPTORS), true)
t('и заморожен глубоко', Object.isFrozen(SERIALIZER_DESCRIPTORS[0].implementationDigest), true)

const { descriptor, serialize } = resolveModelSerializer('openai-responses', '1.0.0')
t('состав дескриптора точный',
  Object.keys(descriptor).sort().join(','), [...SERIALIZER_DESCRIPTOR_KEYS].sort().join(','))
t('домен дескриптора', descriptor.contractVersion, MODEL_SERIALIZER_SPEC)
t('метод', descriptor.method, 'POST')
t('суффикс пути', descriptor.endpointPathSuffix, '/v1/responses')
t('тип содержимого', descriptor.contentType, 'application/json')
t('заголовок учётных данных назван', descriptor.credentialHeader, 'authorization')
t('и его схема названа', descriptor.credentialScheme, 'Bearer')
t('режим структурированного вывода', descriptor.structuredOutputMode, 'json-schema-strict')
t('диалект схемы', descriptor.schemaDialect, 'json-schema-draft-2020-12')
t('предел исходящих объявлен', Number.isSafeInteger(descriptor.maxOutboundBytes), true)
t('предел принимаемых объявлен', Number.isSafeInteger(descriptor.maxResponseBytes), true)
t('политика сэмплирования — не отправлять', descriptor.samplingPolicy, 'omitted')
t('список политик сэмплирования закрыт одним значением', SAMPLING_POLICIES.join(','), 'omitted')
t('политика хранения — никогда', descriptor.storePolicy, 'never')
t('список политик хранения закрыт одним значением', STORE_POLICIES.join(','), 'never')
t('список методов закрыт одним значением', SERIALIZER_METHODS.join(','), 'POST')

t('политика идемпотентности fail-closed', descriptor.idempotencyPolicy, 'unsupported')
t('и список политик закрыт одним значением', IDEMPOTENCY_POLICIES.join(','), 'unsupported')
t('дескриптор не объявляет самостоятельного адреса', 'path' in descriptor, false)
t('и не объявляет хоста', JSON.stringify(descriptor).includes('http'), false)

t('секрета в дескрипторе нет',
  JSON.stringify(descriptor).toLowerCase().includes('sk-'), false)
t('и поля со значением ключа тоже нет',
  Object.keys(descriptor).some((key) => /token|secret|key$/i.test(key)), false)

/* Связка «дескриптор — реализация» проверяется ПРЯМО: подложная пара, где
   к настоящему дескриптору приставлена чужая функция, обязана быть
   отвергнута. Через реестр такую пару не подсунуть, поэтому граница вынесена
   отдельно и вызывается здесь напрямую. */
t('подложная пара дескриптора и реализации отвергается',
  /implementationDigest реализации/.test(boom(() => assertImplementationBinding(
    { descriptor, serialize: (request_) => ({ подделка: request_ }) }, 'подлог',
  ))), true)
t('и настоящая пара принимается',
  boom(() => assertImplementationBinding({ descriptor, serialize }, 'настоящая')),
  '(без ошибки)')
t('и пара без реализации тоже отвергается',
  boom(() => assertImplementationBinding({ descriptor, serialize: null }, 'пусто'))
    !== '(без ошибки)', true)

t('отпечаток дескриптора пересчитывается',
  boom(() => assertSerializerDescriptor(clone(descriptor))), '(без ошибки)')
const tampered = clone(descriptor)
tampered.endpointPathSuffix = '/v1/other'
t('подмена поля дескриптора отвергается',
  /descriptorDigest не сходится/.test(boom(() => assertSerializerDescriptor(tampered))), true)
const tamperedImpl = clone(descriptor)
tamperedImpl.implementationDigest.value = `sha256:${'0'.repeat(64)}`
t('подмена отпечатка реализации отвергается',
  /descriptorDigest не сходится/.test(boom(() => assertSerializerDescriptor(tamperedImpl))), true)

t('неизвестная пара — отказ, а не null',
  /не объявлен/.test(boom(() => resolveModelSerializer('other-serializer', '1.0.0'))), true)
t('чужая версия — отказ',
  /не объявлен/.test(boom(() => resolveModelSerializer('openai-responses', '9.9.9'))), true)
t('канала подстановки реестра нет',
  /ровно два аргумента/.test(boom(
    () => resolveModelSerializer('openai-responses', '1.0.0', [{ descriptor, serialize }]),
  )), true)
t('и одного аргумента мало',
  /ровно два аргумента/.test(boom(() => resolveModelSerializer('openai-responses'))), true)
t('плавающая версия не разрешается',
  boom(() => resolveModelSerializer('openai-responses', 'latest')) !== '(без ошибки)', true)

const serializerSource = await readFile(
  path.join(HERE, '..', 'scripts', 'poi-portals', 'lib', 'model-serializers.mjs'), 'utf8',
)
t('сериализатор не импортирует сеть',
  /from ['"]node:https?['"]|\bfetch\s*\(/.test(serializerSource), false)
t('функции добавления записи в реестр нет',
  /export function (register|add)[A-Za-z]*Serializer/.test(serializerSource), false)
t('второй записи в реестре нет',
  (serializerSource.match(/\bserialize:\s/g) ?? []).length, 1)
t('и подменить реализацию параметром нечем',
  /function prepareOutbound\(input\)/.test(serializerSource), true)

/* ── Подготовка исходящих байтов ──────────────────────────────────────── */

const PROMPT_TEXT = 'фиксированный промпт сериализатора'
const request = await requestFor(PROMPT_TEXT, 'main')
const outbound = prepareOutbound({ request: clone(request), profile: clone(PROFILE) })
t('состав результата подготовки точный',
  Object.keys(outbound).sort().join(','), [...OUTBOUND_KEYS].sort().join(','))
t('результат заморожен', Object.isFrozen(outbound), true)
t('идентификатор элемента перенесён без изменений',
  outbound.requestItemId, request.item.requestItemId)
t('намерение названо отпечатком',
  outbound.requestSpecDigest, request.requestSpecDigest.value)
t('сериализатор назван отпечатком дескриптора',
  outbound.serializerDescriptorDigest, descriptor.descriptorDigest.value)
t('профиль назван отпечатком', outbound.providerProfileDigest, request.providerProfileDigest.value)
t('длина считается с буфера', outbound.outboundBytes, outbound.bytes.length)

const body = JSON.parse(outbound.bytes.toString('utf8'))
t('модель взята из проверенного профиля', body.model, PROFILE.modelId)
t('вход — массив элементов', Array.isArray(body.input), true)
t('и в нём один элемент-сообщение', body.input.length, 1)
t('роль названа', body.input[0].role, 'user')
t('тип элемента назван', body.input[0].type, 'message')
t('содержимое — массив частей', Array.isArray(body.input[0].content), true)
t('и обе части текстовые',
  body.input[0].content.map((part) => part.type).join(','), 'input_text,input_text')
t('первая часть — промпт', body.input[0].content[0].text, PROMPT_TEXT)
t('вторая часть — канонический элемент кандидата',
  JSON.parse(body.input[0].content[1].text) !== null, true)
t('структурированный вывод задан через text.format', body.text.format.type, 'json_schema')
t('имя схемы задано', body.text.format.name, descriptor.schemaName)
t('схема — та же, что покрыта отпечатком плана',
  JSON.stringify(body.text.format.schema.properties),
  JSON.stringify(SCHEMA_OBJECT.properties))
t('и в ней ровно те же ключи',
  Object.keys(body.text.format.schema).sort().join(','), 'properties,type')
t('строгость схемы включена', body.text.format.strict, true)
t('предел выходных токенов стоит на верхнем уровне',
  body.max_output_tokens, request.maxOutputTokens)
/* Ответы Responses API хранятся ПО УМОЛЧАНИЮ. Молчание в теле означало бы
   согласие на хранение, поэтому отключение обязано быть явным. */
t('хранение ответа отключено явно', body.store, false)
t('и это именно false, а не отсутствие ключа', 'store' in body, true)
t('параметров сэмплирования в теле нет', 'temperature' in body || 'top_p' in body, false)
t('потоковый режим не запрашивается', 'stream' in body, false)
t('число генераций не запрашивается', 'n' in body, false)
t('заголовков и учётных данных в теле нет',
  Object.keys(body).some((key) => /^(authorization|api[-_]?key|token|secret)$/i.test(key)), false)
t('и адреса в теле тоже нет',
  outbound.bytes.toString('utf8').includes(PROFILE.endpoint), false)

/* Собственная копия: два вызова дают РАЗНЫЕ буферы, и правка одного не
   видна другому. */
const copyProbe = prepareOutbound({ request: clone(request), profile: clone(PROFILE) })
copyProbe.bytes[0] = 0x20
t('байты — собственная копия, а не общий буфер', outbound.bytes[0], 0x7b)
/* И копия лежит в СОБСТВЕННОМ ArrayBuffer. Подмассив обрамлённого вида и
   обычный пуловый Buffer этим свойством не обладают: у обоих `buffer` —
   чужая или общая память, доступная всякому, кто её держит. */
t('исходящие байты не делят ArrayBuffer ни с чем', outbound.bytes.byteOffset, 0)
t('и его длина равна их длине', outbound.bytes.buffer.byteLength, outbound.bytes.length)
t('целостность подготовленного проверяется',
  boom(() => assertOutboundIntegrity(outbound, 'проверка')), '(без ошибки)')
const mutated = { ...outbound, bytes: Buffer.from(outbound.bytes) }
mutated.bytes[0] = mutated.bytes[0] === 0x7b ? 0x20 : 0x7b
t('правка байтов после подготовки видна на границе транспорта',
  /отпечаток против outboundBytesDigest/.test(
    boom(() => assertOutboundIntegrity(mutated, 'проверка')),
  ), true)
const shortened = { ...outbound, bytes: outbound.bytes.subarray(0, outbound.bytes.length - 1) }
t('усечение байтов после подготовки тоже видно',
  /длина против outboundBytes/.test(boom(() => assertOutboundIntegrity(shortened, 'проверка'))),
  true)

t('дескриптор параметром не принимается',
  /лишние поля/.test(boom(() => prepareOutbound({ request: clone(request), profile: clone(PROFILE), descriptor }))), true)
t('реализация параметром не принимается',
  boom(() => prepareOutbound({ request: clone(request), profile: clone(PROFILE), serialize })) !== '(без ошибки)', true)
const spoiledRequest = clone(request)
spoiledRequest.maxOutputTokens += 1
t('подготовка перепроверяет запрос заново',
  /requestSpecDigest/.test(boom(() => prepareOutbound({ request: spoiledRequest, profile: clone(PROFILE) }))), true)

/* Запрос, чьи исходящие байты не помещаются в предел, обязан отказать ДО
   всякого журнала: платный эффект не открывается ради заведомо негодного. */
const hugePrompt = `огромный промпт ${'я'.repeat(descriptor.maxOutboundBytes)}`
const hugeRequest = await requestFor(hugePrompt, 'huge')
t('превышение предела исходящих — отказ',
  /исходящих байт .* при пределе/.test(boom(() => prepareOutbound({ request: hugeRequest, profile: clone(PROFILE) }))), true)
t('и отказ говорит, что журнал не открывается',
  /журнал не открывается/.test(boom(() => prepareOutbound({ request: hugeRequest, profile: clone(PROFILE) }))), true)

/* ── Подписанный адрес используется целиком ───────────────────────────── */

/* Путь профиля входит в `providerProfileDigest`. Пересборка адреса из
   `origin` плюс путь дескриптора выбрасывала бы его молча: профиль арендатора
   `/tenant` получал бы запрос по корневому адресу. */
const tenantProfile = { ...clone(PROFILE), endpoint: 'https://api.example.com/tenant/v1/responses' }
t('адрес берётся у профиля целиком',
  assertEndpointForDescriptor(tenantProfile, descriptor, 'адрес'),
  'https://api.example.com/tenant/v1/responses')
t('и корневой адрес тоже берётся как есть',
  assertEndpointForDescriptor(clone(PROFILE), descriptor, 'адрес'),
  'https://api.example.com/v1/responses')
const wrongPath = { ...clone(PROFILE), endpoint: 'https://api.example.com/v1/chat' }
t('адрес, не оканчивающийся суффиксом дескриптора, отвергается',
  /не оканчивается суффиксом/.test(
    boom(() => assertEndpointForDescriptor(wrongPath, descriptor, 'адрес')),
  ), true)
const originOnly = { ...clone(PROFILE), endpoint: 'https://api.example.com' }
t('и адрес без пути тоже отвергается — суффикс обязателен',
  /не оканчивается суффиксом/.test(
    boom(() => assertEndpointForDescriptor(originOnly, descriptor, 'адрес')),
  ), true)
const wrongPathRequest = await requestFor(PROMPT_TEXT, 'wrong-path', wrongPath)
/* Запрос собран по ТОМУ ЖЕ профилю, поэтому отпечатки сходятся и до сверки
   адреса дело действительно доходит. */
t('подготовка по профилю с чужим путём отказывает до журнала',
  /не оканчивается суффиксом/.test(boom(() => prepareOutbound({
    request: wrongPathRequest, profile: wrongPath,
  }))), true)
t('и чужой профиль при верном адресе отвергается отпечатком',
  /providerProfileDigest профиля против запроса/.test(boom(() => prepareOutbound({
    request: clone(request), profile: tenantProfile,
  }))), true)

/* ── Идемпотентность: fail-closed ─────────────────────────────────────── */

/* Профиль, объявивший поддержку, дал бы запросу ненулевой ключ — а
   сериализатор заголовка не отправляет. Официальной документации на такой
   заголовок у `/v1/responses` нет, и догадка о чужом протоколе за деньги
   владельца не делается: отказ до открытия журнала. */
const idemProfile = clone(PROFILE)
idemProfile.capabilities.idempotencyKey = {
  supported: true, header: 'idempotency-key', scope: 'request',
}
const idemRequest = await requestFor(PROMPT_TEXT, 'idem', idemProfile)
t('запрос по такому профилю несёт ненулевой ключ',
  idemRequest.retryPolicy.idempotencyKey, idemRequest.item.requestItemId)
t('и подготовка отказывает до открытия журнала',
  /заголовка не отправляет/.test(boom(() => prepareOutbound({
    request: idemRequest, profile: idemProfile,
  }))), true)
t('а проверенный профиль несёт ключ null', request.retryPolicy.idempotencyKey, null)

/* Детерминированность: одна и та же спецификация даёт одни и те же байты. */
const again = prepareOutbound({ request: clone(request), profile: clone(PROFILE) })
t('подготовка детерминирована по байтам',
  again.bytes.compare(outbound.bytes), 0)
t('и по отпечатку', again.outboundBytesDigest, outbound.outboundBytesDigest)

await rm(repoRoot, { recursive: true, force: true })

console.log(bad.length
  ? `✗ провалено ${bad.length}:\n  ${bad.join('\n  ')}`
  : `✓ сериализатор модельного запроса: ${ok} проверок пройдено`)
process.exitCode = bad.length ? 1 : 0
