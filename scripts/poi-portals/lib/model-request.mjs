/**
 * Provider-neutral спецификация одного модельного запроса.
 *
 * Это намерение, а не HTTP: здесь нет endpoint, заголовков, секрета,
 * сериализованных outbound-байтов и SDK. Конкретный транспорт появится
 * отдельным коммитом и будет обязан превратить ЭТУ проверенную спецификацию
 * в один подготовленный буфер. `outboundBytesDigest` этому домену не
 * принадлежит.
 *
 * v1 синхронна: один requestItemId, один item, один ответ. Идентификатор не
 * выводится здесь заново — builder принимает его из проверенной выборки и
 * только доказывает, что такая тройка есть в production-selection плана.
 */
import {
  assertDigestShape,
  assertExactKeys,
  assertExactly,
  assertInteger,
  assertNonEmptyString,
  canonicalJsonBytes,
  deepFreeze,
  digest,
} from '../../lib/canonical-contract.mjs'
import { DIGEST_ALGORITHM, sha256Bytes } from '../../lib/byte-digest.mjs'
import { MODEL_APPROVAL_SPEC, parseAndVerifyApproval } from './model-approval.mjs'
import {
  buildPlanSelection,
  canonicalItemBytes,
  candidateInputDigest,
  CLASSIFICATION_ITEM_SPEC,
  classificationItemBytes,
  MODEL_PROMPT_SPEC,
  MODEL_PLAN_V2_CONTRACT_VERSION,
  MODEL_SCHEMA_SPEC,
} from './model-plan.mjs'
import {
  assertProviderProfileShape,
  providerProfileDigest,
  assertProfileDigestShape,
  profileContractSpec,
  profileModelVersion,
  SCHEMA_DIALECTS,
  STRUCTURED_OUTPUT_MODES,
} from './provider-profile.mjs'
import { assertRequestItemId, assertStrictInput } from './model-execution.mjs'

export const MODEL_REQUEST_SPEC = 'poi-model-request/v1'
export const MODEL_REQUEST_TIMEOUT_MS = 60_000

export const MODEL_REQUEST_KEYS = Object.freeze([
  'contractVersion', 'planId', 'planDigest', 'approvalDigest', 'providerProfileDigest',
  'provider', 'prompt', 'responseSchema', 'structuredOutput', 'serializer',
  'sampling', 'maxOutputTokens', 'timeoutMs', 'retryPolicy', 'item', 'requestSpecDigest',
])

export const MODEL_REQUEST_SIGNED_KEYS = Object.freeze(
  MODEL_REQUEST_KEYS.filter((key) => key !== 'requestSpecDigest'),
)

const REQUEST_BUILD_KEYS = Object.freeze([
  'plan', 'approval', 'profile', 'portalId', 'requestItemId',
  'classificationItem', 'promptText', 'schemaObject',
])
const PROVIDER_KEYS = Object.freeze([
  'profileId', 'profileVersion', 'providerId', 'modelId', 'modelVersion', 'apiVersion',
])
const PROMPT_KEYS = Object.freeze(['digest', 'text'])
const SCHEMA_KEYS = Object.freeze(['digest', 'value'])
const STRUCTURED_OUTPUT_KEYS = Object.freeze(['mode', 'schemaDialect'])
const SERIALIZER_KEYS = Object.freeze(['id', 'version'])
const SAMPLING_KEYS = Object.freeze(['temperature', 'topP', 'seed'])
const RETRY_POLICY_KEYS = Object.freeze(['maxRetries', 'idempotencyKey'])
const ITEM_KEYS = Object.freeze([
  'requestItemId', 'candidateInputDigest', 'classificationItemBytes', 'value',
])

function signedPart(request) {
  const out = {}
  for (const key of MODEL_REQUEST_SIGNED_KEYS) out[key] = request[key]
  return out
}

function computeRequestSpecDigest(request) {
  return sha256Bytes(canonicalJsonBytes(signedPart(request), MODEL_REQUEST_SPEC))
}

/** Подпись provider-neutral намерения: домен плюс канонический JSON. */
export function requestSpecDigest(request) {
  assertStrictInput(request, MODEL_REQUEST_KEYS, `${MODEL_REQUEST_SPEC}: запрос`)
  return computeRequestSpecDigest(request)
}

function assertProvider(provider, where) {
  assertExactKeys(provider, PROVIDER_KEYS, where)
  for (const key of PROVIDER_KEYS) assertNonEmptyString(provider[key], `${where}.${key}`)
}

function assertPrompt(prompt, where) {
  assertExactKeys(prompt, PROMPT_KEYS, where)
  assertDigestShape(prompt.digest, MODEL_PROMPT_SPEC, `${where}.digest`)
  assertNonEmptyString(prompt.text, `${where}.text`)
  const bytes = Buffer.from(`${MODEL_PROMPT_SPEC}\n${prompt.text}`, 'utf8')
  assertExactly(sha256Bytes(bytes), prompt.digest.value, `${where}.digest.value`)
}

function assertResponseSchema(schema, where) {
  assertExactKeys(schema, SCHEMA_KEYS, where)
  assertDigestShape(schema.digest, MODEL_SCHEMA_SPEC, `${where}.digest`)
  const bytes = canonicalJsonBytes(schema.value, MODEL_SCHEMA_SPEC)
  assertExactly(sha256Bytes(bytes), schema.digest.value, `${where}.digest.value`)
}

function assertStructuredOutput(value, where) {
  assertExactKeys(value, STRUCTURED_OUTPUT_KEYS, where)
  if (!STRUCTURED_OUTPUT_MODES.includes(value.mode)) {
    throw new TypeError(`${where}.mode: неизвестный режим ${JSON.stringify(value.mode)}`)
  }
  if (!SCHEMA_DIALECTS.includes(value.schemaDialect)) {
    throw new TypeError(`${where}.schemaDialect: неизвестный диалект ${JSON.stringify(value.schemaDialect)}`)
  }
}

function assertSerializer(value, where) {
  assertExactKeys(value, SERIALIZER_KEYS, where)
  assertNonEmptyString(value.id, `${where}.id`)
  assertNonEmptyString(value.version, `${where}.version`)
}

function assertSampling(value, where) {
  assertExactKeys(value, SAMPLING_KEYS, where)
  assertExactly(value.temperature, 0, `${where}.temperature`)
  assertExactly(value.topP, 1, `${where}.topP`)
  assertExactly(value.seed, null, `${where}.seed`)
}

function assertRetryPolicy(value, requestItemId, where) {
  assertExactKeys(value, RETRY_POLICY_KEYS, where)
  assertInteger(value.maxRetries, `${where}.maxRetries`)
  assertExactly(value.maxRetries, 0, `${where}.maxRetries`)
  if (value.idempotencyKey !== null && value.idempotencyKey !== requestItemId) {
    throw new TypeError(`${where}.idempotencyKey: допустим только requestItemId либо null`)
  }
}

function assertItem(item, where) {
  assertExactKeys(item, ITEM_KEYS, where)
  assertRequestItemId(item.requestItemId, `${where}.requestItemId`)
  assertDigestShape(item.candidateInputDigest, CLASSIFICATION_ITEM_SPEC, `${where}.candidateInputDigest`)
  const actualDigest = candidateInputDigest(item.value)
  assertExactly(actualDigest, item.candidateInputDigest.value, `${where}.candidateInputDigest.value`)
  assertInteger(item.classificationItemBytes, `${where}.classificationItemBytes`, 1)
  assertExactly(
    classificationItemBytes(item.value), item.classificationItemBytes,
    `${where}.classificationItemBytes`,
  )
}

/** Единственная проверка сохранённой/переданной спецификации запроса. */
export function parseAndVerifyModelRequest(raw) {
  assertStrictInput(raw, MODEL_REQUEST_KEYS, `${MODEL_REQUEST_SPEC}: запрос`)
  assertExactly(raw.contractVersion, MODEL_REQUEST_SPEC, 'contractVersion')
  assertNonEmptyString(raw.planId, 'planId')
  assertDigestShape(raw.planDigest, MODEL_PLAN_V2_CONTRACT_VERSION, 'planDigest')
  assertDigestShape(raw.approvalDigest, MODEL_APPROVAL_SPEC, 'approvalDigest')
  assertProfileDigestShape(raw.providerProfileDigest, 'providerProfileDigest')
  assertProvider(raw.provider, 'provider')
  assertPrompt(raw.prompt, 'prompt')
  assertResponseSchema(raw.responseSchema, 'responseSchema')
  assertStructuredOutput(raw.structuredOutput, 'structuredOutput')
  assertSerializer(raw.serializer, 'serializer')
  assertSampling(raw.sampling, 'sampling')
  assertInteger(raw.maxOutputTokens, 'maxOutputTokens', 1)
  assertInteger(raw.timeoutMs, 'timeoutMs', 1)
  assertExactly(raw.timeoutMs, MODEL_REQUEST_TIMEOUT_MS, 'timeoutMs')
  assertItem(raw.item, 'item')
  assertRetryPolicy(raw.retryPolicy, raw.item.requestItemId, 'retryPolicy')
  assertDigestShape(raw.requestSpecDigest, MODEL_REQUEST_SPEC, 'requestSpecDigest')
  assertExactly(requestSpecDigest(raw), raw.requestSpecDigest.value, 'requestSpecDigest.value')
  return deepFreeze(structuredClone(raw))
}

/**
 * Builder от authority-входов. Он не выдаёт разрешение и не выбирает
 * провайдера: approval, план и профиль проверяются и связываются заново.
 */
export function buildModelRequest(input) {
  assertStrictInput(input, REQUEST_BUILD_KEYS, `${MODEL_REQUEST_SPEC}: параметры сборки`)
  const {
    plan, approval, profile, portalId, requestItemId, classificationItem, promptText, schemaObject,
  } = input
  const { approval: verifiedApproval, plan: verifiedPlan } = parseAndVerifyApproval({ approval, plan })
  assertProviderProfileShape(profile)
  const profileDigest = digest(
    providerProfileDigest(profile), DIGEST_ALGORITHM, profileContractSpec(profile),
  )
  assertExactly(
    profileDigest.value, verifiedApproval.providerProfileDigest.value,
    'providerProfileDigest против approval',
  )
  assertExactly(profile.id, verifiedPlan.providerProfile.id, 'provider.id против plan')
  assertExactly(profile.version, verifiedPlan.providerProfile.version, 'provider.version против plan')

  const itemDigest = candidateInputDigest(classificationItem)
  const selected = buildPlanSelection(verifiedPlan).entries.find(
    (entry) => entry.portalId === portalId
      && entry.requestItemId === requestItemId
      && entry.candidateInputDigest === itemDigest,
  )
  if (!selected) {
    throw new TypeError(
      `${MODEL_REQUEST_SPEC}: requestItemId не найден в проверенной выборке плана `
      + `для portalId=${JSON.stringify(portalId)} и candidateInputDigest=${itemDigest}`,
    )
  }

  const promptBytes = Buffer.from(`${MODEL_PROMPT_SPEC}\n${promptText}`, 'utf8')
  assertExactly(sha256Bytes(promptBytes), verifiedPlan.promptDigest.value, 'promptDigest против plan')
  assertExactly(promptBytes.length, verifiedPlan.promptBytes, 'promptBytes против plan')
  const schemaBytes = canonicalJsonBytes(schemaObject, MODEL_SCHEMA_SPEC)
  assertExactly(sha256Bytes(schemaBytes), verifiedPlan.schemaDigest.value, 'schemaDigest против plan')
  assertExactly(schemaBytes.length, verifiedPlan.schemaBytes, 'schemaBytes против plan')

  const request = {
    contractVersion: MODEL_REQUEST_SPEC,
    planId: verifiedPlan.planId,
    planDigest: { ...verifiedPlan.planDigest },
    approvalDigest: { ...verifiedApproval.approvalDigest },
    providerProfileDigest: profileDigest,
    provider: {
      profileId: profile.id,
      profileVersion: profile.version,
      providerId: profile.providerId,
      modelId: profile.modelId,
      modelVersion: profileModelVersion(profile),
      apiVersion: profile.apiVersion,
    },
    prompt: { digest: { ...verifiedPlan.promptDigest }, text: promptText },
    responseSchema: { digest: { ...verifiedPlan.schemaDigest }, value: schemaObject },
    structuredOutput: { ...profile.structuredOutput },
    serializer: { ...profile.serializer },
    sampling: { temperature: 0, topP: 1, seed: null },
    maxOutputTokens: verifiedApproval.limits.maxOutputTokens,
    timeoutMs: MODEL_REQUEST_TIMEOUT_MS,
    retryPolicy: {
      maxRetries: verifiedApproval.limits.maxRetries,
      idempotencyKey: profile.capabilities.idempotencyKey.supported ? requestItemId : null,
    },
    item: {
      requestItemId,
      candidateInputDigest: {
        value: itemDigest,
        algorithm: DIGEST_ALGORITHM,
        spec: CLASSIFICATION_ITEM_SPEC,
      },
      classificationItemBytes: canonicalItemBytes(classificationItem).length,
      value: classificationItem,
    },
  }
  request.requestSpecDigest = digest(
    computeRequestSpecDigest(request),
    DIGEST_ALGORITHM,
    MODEL_REQUEST_SPEC,
  )
  return parseAndVerifyModelRequest(request)
}
