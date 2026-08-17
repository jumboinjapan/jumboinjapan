/**
 * Канонические сериализаторы одного модельного запроса, `poi-model-serializer/v1`.
 *
 * Здесь провайдер-нейтральное намерение `poi-model-request/v1` превращается
 * в ОДИН подготовленный буфер: метод, путь, тип содержимого, имя и схема
 * заголовка учётных данных, предел исходящих и предел принимаемых байтов.
 * Секрета здесь нет и быть не может: дескриптор называет ИМЯ заголовка и его
 * схему, а значение приходит в момент отправки от инъецированного резолвера
 * и в артефакт не попадает.
 *
 * Реестр канонический и глубоко заморожен. Функции добавления записи нет:
 * реестр меняется правкой исходника, то есть коммитом владельца. Параметра
 * `registry`, `descriptor` или `serialize` ни у одной публичной границы нет —
 * подменить сериализатор вызывающему нечем, и test-only записи не
 * предусмотрено.
 *
 * Идентичность сериализатора — не только его поля. В хешируемую часть
 * дескриптора входит `implementationDigest`: отпечаток ИСХОДНОГО ТЕКСТА
 * функции, которая собирает тело. Правка тела меняет отпечаток, а значит и
 * `descriptorDigest`, записанный в журнал рядом с исходящими байтами.
 * Дескриптор, совпавший по полям при другом теле, невозможен.
 *
 * Оба значения — SHA-256-отпечатки, а не криптографические подписи: они не
 * аутентифицируют ни автора, ни отправителя и подделку заинтересованной
 * стороной не закрывают. Они дают идентичность, и только её.
 *
 * Wire-формат OpenAI Responses сверен с официальной документацией:
 * `input` — массив элементов-сообщений с `role` и `content`; Structured
 * Outputs задаются `text.format` с `type: "json_schema"`, `name`, `schema`,
 * `strict`; `max_output_tokens` — поле верхнего уровня; ответы хранятся по
 * умолчанию, и отключает хранение `store: false`.
 */
import {
  assertExactKeys,
  assertExactly,
  assertInteger,
  canonicalJsonBytes,
  deepFreeze,
  digest,
} from '../../lib/canonical-contract.mjs'
import { DIGEST_ALGORITHM, sha256Bytes } from '../../lib/byte-digest.mjs'
import { CLASSIFICATION_ITEM_SPEC } from './model-plan.mjs'
import { assertStrictInput } from './model-execution.mjs'
import { parseAndVerifyModelRequest } from './model-request.mjs'
import {
  assertProviderProfileShape,
  profileContractSpec,
  providerProfileDigest,
  PROVIDER_PROFILE_SPEC,
  PROVIDER_PROFILE_V2_SPEC,
} from './provider-profile.mjs'

/** Домен сериализатора. Входит В БАЙТЫ отпечатка, а не лежит рядом со значением. */
export const MODEL_SERIALIZER_SPEC = 'poi-model-serializer/v1'

/**
 * Домен сериализатора с явной политикой рассуждения.
 *
 * Почему новая версия КОНТРАКТА, а не новая запись в прежнем. Состав
 * дескриптора проверяется `assertExactKeys` для всех записей разом. Добавить
 * `reasoningPolicy` в общий список значило бы добавить ключ и существующему
 * дескриптору `openai-responses@1.0.0` — а значит изменить его
 * `descriptorDigest`. Прежние журналы ссылаются на этот отпечаток, и правка
 * сделала бы их нечитаемыми. Версия контракта разводит составы, и байты v1
 * остаются прежними до последнего.
 */
export const MODEL_SERIALIZER_V2_SPEC = 'poi-model-serializer/v2'

/** Обе версии домена. Список закрыт: третья — правка контракта. */
export const MODEL_SERIALIZER_SPECS = Object.freeze([
  MODEL_SERIALIZER_SPEC, MODEL_SERIALIZER_V2_SPEC,
])

/** Точный состав дескриптора v1. Восемнадцать ключей, ни больше ни меньше. */
export const SERIALIZER_DESCRIPTOR_KEYS = Object.freeze([
  'contractVersion', 'id', 'version', 'method', 'endpointPathSuffix', 'contentType',
  'credentialHeader', 'credentialScheme', 'structuredOutputMode', 'schemaDialect',
  'schemaName', 'samplingPolicy', 'storePolicy', 'idempotencyPolicy',
  'maxOutboundBytes', 'maxResponseBytes', 'implementationDigest', 'descriptorDigest',
])

/** Состав v2: те же восемнадцать плюс две политики. Двадцать. */
export const SERIALIZER_DESCRIPTOR_V2_KEYS = Object.freeze([
  'contractVersion', 'id', 'version', 'method', 'endpointPathSuffix', 'contentType',
  'credentialHeader', 'credentialScheme', 'structuredOutputMode', 'schemaDialect',
  'schemaName', 'samplingPolicy', 'storePolicy', 'idempotencyPolicy',
  'reasoningPolicy', 'toolPolicy',
  'maxOutboundBytes', 'maxResponseBytes', 'implementationDigest', 'descriptorDigest',
])

/**
 * Политика рассуждения.
 *
 * Умолчание провайдера для этой модели — `medium`. Значит запрос БЕЗ поля
 * `reasoning` покупает medium-рассуждение, ничего об этом не объявляя:
 * молчание в теле — не «без рассуждения», а «на усмотрение провайдера за
 * деньги владельца». Поэтому поле обязательно, а не необязательно.
 *
 * Список закрыт двумя значениями, которые проект намерен использовать:
 * `none` для классификации и структурного извлечения, `low` — кандидат для
 * будущего исследования фактов. `medium`, `high`, `xhigh` и `max` не
 * объявлены: ветка, которую нельзя выбрать данными, обходом не становится, а
 * объявленная и неиспользуемая — становится.
 */
export const REASONING_POLICIES = Object.freeze(['none', 'low'])

/**
 * Политика инструментов провайдера.
 *
 * Значение одно — `none`. Web search у провайдера оплачивается отдельно:
 * фиксированная цена за тысячу вызовов ПЛЮС содержимое поиска по ставкам
 * модели. Предела числа вызовов в одном запросе официальная документация не
 * называет, а текущая модель стоимости считает только токены. Пока это так,
 * верхней границы расхода на запрос с инструментами не существует — не
 * «велика», а не существует. Второй ветки здесь нет намеренно.
 */
export const TOOL_POLICIES = Object.freeze(['none'])

/**
 * Политика ключа идемпотентности.
 *
 * Значение одно — `unsupported`. Официальной документации на заголовок
 * идемпотентности у `/v1/responses` нет, а отправить выдуманный заголовок в
 * оплаченный запрос — это догадка о чужом протоколе за деньги владельца.
 * Fail-closed: профиль обязан объявлять возможность НЕподдержанной, а запрос —
 * нести `idempotencyKey: null`. Реализовать заголовок можно будет только
 * вместе с официальным подтверждением, и это будет правка исходника.
 */
export const IDEMPOTENCY_POLICIES = Object.freeze(['unsupported'])

/** Часть, покрытая отпечатком, — всё, кроме самого отпечатка. */
export const SERIALIZER_DESCRIPTOR_COVERED_KEYS = Object.freeze(
  SERIALIZER_DESCRIPTOR_KEYS.filter((key) => key !== 'descriptorDigest'),
)

/** То же для v2. Выводится из состава, а не переписывается вторым списком. */
export const SERIALIZER_DESCRIPTOR_V2_COVERED_KEYS = Object.freeze(
  SERIALIZER_DESCRIPTOR_V2_KEYS.filter((key) => key !== 'descriptorDigest'),
)

/** Состав дескриптора по версии контракта. Одна таблица на весь модуль. */
const DESCRIPTOR_KEYS_BY_SPEC = Object.freeze({
  [MODEL_SERIALIZER_SPEC]: SERIALIZER_DESCRIPTOR_KEYS,
  [MODEL_SERIALIZER_V2_SPEC]: SERIALIZER_DESCRIPTOR_V2_KEYS,
})
const COVERED_KEYS_BY_SPEC = Object.freeze({
  [MODEL_SERIALIZER_SPEC]: SERIALIZER_DESCRIPTOR_COVERED_KEYS,
  [MODEL_SERIALIZER_V2_SPEC]: SERIALIZER_DESCRIPTOR_V2_COVERED_KEYS,
})

/**
 * Какая версия профиля с какой версией сериализатора.
 *
 * Соответствие однозначное и записано таблицей, а не цепочкой условий.
 * Профиль v2 с сериализатором v1 отправил бы запрос без `reasoning`, при
 * этом объявляя честную идентичность модели, — то есть выглядел бы
 * исправленным, оставаясь прежним.
 */
const SERIALIZER_SPEC_BY_PROFILE_SPEC = Object.freeze({
  [PROVIDER_PROFILE_SPEC]: MODEL_SERIALIZER_SPEC,
  [PROVIDER_PROFILE_V2_SPEC]: MODEL_SERIALIZER_V2_SPEC,
})

/** Методы. Список закрыт одним значением: другой потребует правки исходника. */
export const SERIALIZER_METHODS = Object.freeze(['POST'])

/**
 * Политика параметров сэмплирования.
 *
 * Значение одно — `omitted`. Официальная документация говорит, что поддержка
 * `temperature` и `top_p` зависит от модели, а профиль провайдера класса
 * модели не объявляет. Отправить их «на всякий случай» значило бы включить в
 * оплаченный запрос поле, про которое неизвестно, примет его адресат или
 * отвергнет. Второй ветки здесь нет намеренно: ветка, которую нельзя выбрать
 * данными, обходом не становится.
 */
export const SAMPLING_POLICIES = Object.freeze(['omitted'])

/**
 * Политика хранения ответа у провайдера.
 *
 * Значение одно — `never`. Ответы Responses API хранятся ПО УМОЛЧАНИЮ, и
 * отключает хранение только явное `store: false` в теле. Умолчание здесь не
 * используется: молчание в теле означало бы согласие на хранение.
 */
export const STORE_POLICIES = Object.freeze(['never'])

const KEBAB_ID = /^[a-z0-9][a-z0-9-]{1,63}$/
const EXACT_SEMVER = /^\d+\.\d+\.\d+$/
const HTTP_TOKEN_LOWER = /^[a-z0-9!#$%&'*+\-.^_`|~]+$/
const SCHEMA_NAME = /^[A-Za-z0-9_-]{1,64}$/
const PATH_SUFFIX_SHAPE = /^\/[A-Za-z0-9\-._~/]{1,128}$/

/**
 * Байты тела БЕЗ доменного префикса.
 *
 * Канонический кодировщик в проекте один, и второго здесь не заводится:
 * префикс домена отрезается от его результата, а факт отреза проверяется.
 * Своя реализация сортировки ключей разошлась бы с общей молча.
 */
function canonicalBodyBytes(body, where) {
  const framed = canonicalJsonBytes(body, MODEL_SERIALIZER_SPEC)
  const prefix = Buffer.from(`${MODEL_SERIALIZER_SPEC}\n`, 'utf8')
  if (framed.subarray(0, prefix.length).compare(prefix) !== 0) {
    throw new TypeError(`${where}: канонический кодировщик не поставил ожидаемый доменный префикс`)
  }
  /* Собственная копия в СОБСТВЕННОМ ArrayBuffer.
     Подмассив разделял бы память с обрамлённым видом. Обычный `Buffer.from`
     мелкого размера тоже не годится: он берёт память из общего пула, и тогда
     `bytes.buffer` — восьмикилобайтный пул, разделяемый с чужими буферами.
     `allocUnsafeSlow` пула не использует, поэтому `byteOffset` равен нулю, а
     `buffer.byteLength` — ровно длине наших байтов; это свойство и проверяется. */
  const bytes = Buffer.allocUnsafeSlow(framed.length - prefix.length)
  framed.copy(bytes, 0, prefix.length)
  return bytes
}

/**
 * Тело запроса OpenAI Responses.
 *
 * Функция чистая и ничего не читает из окружения. Её ИСХОДНЫЙ ТЕКСТ входит в
 * `implementationDigest` дескриптора, поэтому всякая правка ниже меняет
 * отпечаток, попадающий в журнал.
 */
function serializeOpenAiResponses(request, descriptor) {
  const itemBytes = canonicalBodyBytes(request.item.value, `${CLASSIFICATION_ITEM_SPEC}: элемент`)
  const body = {
    model: request.provider.modelId,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: request.prompt.text },
          { type: 'input_text', text: itemBytes.toString('utf8') },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: descriptor.schemaName,
        schema: request.responseSchema.value,
        strict: true,
      },
    },
    max_output_tokens: request.maxOutputTokens,
    store: false,
  }
  /* Самопроверка тела, а не комментарий о нём. `store: false` отключает
     хранение ответа у провайдера; его пропажа из литерала выше — молчаливое
     согласие на хранение, и остановить её обязан отказ, а не рецензент. */
  assertExactly(body.store, false, `${MODEL_SERIALIZER_SPEC}: body.store`)
  assertExactly(body.text.format.strict, true, `${MODEL_SERIALIZER_SPEC}: body.text.format.strict`)
  assertExactly(
    body.text.format.type, 'json_schema', `${MODEL_SERIALIZER_SPEC}: body.text.format.type`,
  )
  if (descriptor.samplingPolicy !== 'omitted') {
    throw new TypeError(
      `${MODEL_SERIALIZER_SPEC}: политика сэмплирования ${JSON.stringify(descriptor.samplingPolicy)} `
      + 'этим сериализатором не реализована',
    )
  }
  for (const forbidden of ['temperature', 'top_p', 'stream', 'n']) {
    if (forbidden in body) {
      throw new TypeError(`${MODEL_SERIALIZER_SPEC}: поле ${forbidden} в теле не предусмотрено`)
    }
  }
  return body
}

/**
 * Тело запроса второй версии: то же самое плюс явное `reasoning`.
 *
 * Функция написана ЦЕЛИКОМ, а не обёрткой над первой версией. Причина в том,
 * ради чего вообще существует `implementationDigest`: он — отпечаток
 * ИСХОДНОГО ТЕКСТА той функции, что собирает тело. Обёртка покрыла бы своим
 * отпечатком только себя, и правка первой версии молча меняла бы то, что
 * отправляет вторая, не трогая ни одного её отпечатка. Двадцать строк
 * повторённого проводного формата — цена за то, что каждая версия отвечает
 * за свои байты сама.
 */
function serializeOpenAiResponsesV2(request, descriptor) {
  const itemBytes = canonicalBodyBytes(request.item.value, `${CLASSIFICATION_ITEM_SPEC}: элемент`)
  const body = {
    model: request.provider.modelId,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: request.prompt.text },
          { type: 'input_text', text: itemBytes.toString('utf8') },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: descriptor.schemaName,
        schema: request.responseSchema.value,
        strict: true,
      },
    },
    reasoning: { effort: descriptor.reasoningPolicy },
    max_output_tokens: request.maxOutputTokens,
    store: false,
  }
  /* Самопроверки тела, а не комментарии о нём. Пропажа любой из этих строк
     из литерала выше — молчаливое согласие на умолчание провайдера, и
     остановить её обязан отказ, а не рецензент. */
  assertExactly(body.store, false, `${MODEL_SERIALIZER_V2_SPEC}: body.store`)
  assertExactly(body.text.format.strict, true, `${MODEL_SERIALIZER_V2_SPEC}: body.text.format.strict`)
  assertExactly(
    body.text.format.type, 'json_schema', `${MODEL_SERIALIZER_V2_SPEC}: body.text.format.type`,
  )
  assertExactly(
    body.reasoning?.effort, descriptor.reasoningPolicy,
    `${MODEL_SERIALIZER_V2_SPEC}: body.reasoning.effort`,
  )
  if (!REASONING_POLICIES.includes(descriptor.reasoningPolicy)) {
    throw new TypeError(
      `${MODEL_SERIALIZER_V2_SPEC}: политика рассуждения ${JSON.stringify(descriptor.reasoningPolicy)} `
      + 'этим сериализатором не реализована',
    )
  }
  if (descriptor.samplingPolicy !== 'omitted') {
    throw new TypeError(
      `${MODEL_SERIALIZER_V2_SPEC}: политика сэмплирования ${JSON.stringify(descriptor.samplingPolicy)} `
      + 'этим сериализатором не реализована',
    )
  }
  /* Инструменты провайдера оплачиваются отдельно и предела вызовов не имеют.
     Пока стоимость считается только по токенам, любое из этих полей делает
     верхнюю границу расхода несуществующей. */
  if (descriptor.toolPolicy !== 'none') {
    throw new TypeError(
      `${MODEL_SERIALIZER_V2_SPEC}: политика инструментов ${JSON.stringify(descriptor.toolPolicy)} `
      + 'этим сериализатором не реализована',
    )
  }
  for (const forbidden of ['temperature', 'top_p', 'stream', 'n', 'tools', 'tool_choice', 'max_tool_calls']) {
    if (forbidden in body) {
      throw new TypeError(`${MODEL_SERIALIZER_V2_SPEC}: поле ${forbidden} в теле не предусмотрено`)
    }
  }
  return body
}

/** Отпечаток дескриптора: домен входит в байты вместе с покрытой им частью. */
function descriptorDigestOf(unsigned, spec) {
  return sha256Bytes(canonicalJsonBytes(unsigned, spec))
}

/**
 * Отпечаток РЕАЛИЗАЦИИ. Исходный текст функции — часть идентичности
 * сериализатора наравне с его полями.
 */
function implementationDigestOf(fn, where) {
  const source = Function.prototype.toString.call(fn)
  if (typeof source !== 'string' || !source.length || source.includes('[native code]')) {
    throw new TypeError(`${where}: исходный текст реализации недоступен`)
  }
  return sha256Bytes(Buffer.from(`${MODEL_SERIALIZER_SPEC}\n${source}`, 'utf8'))
}

/**
 * Связка дескриптора с ЕГО реализацией.
 *
 * Отдельная именованная граница, а не строчка внутри разрешения: пару
 * «дескриптор + функция» надо уметь проверить саму по себе, и тест обязан
 * иметь возможность подсунуть сюда подложную пару.
 */
export function assertImplementationBinding(entry, where) {
  const actual = implementationDigestOf(entry?.serialize, where)
  assertExactly(
    actual, entry?.descriptor?.implementationDigest?.value,
    `${where}: implementationDigest реализации`,
  )
  return entry
}

function buildDescriptor(fields, serialize, spec) {
  if (!MODEL_SERIALIZER_SPECS.includes(spec)) {
    throw new TypeError(`buildDescriptor: неизвестная версия контракта ${JSON.stringify(spec)}`)
  }
  const unsigned = {
    contractVersion: spec,
    ...fields,
    implementationDigest: digest(
      implementationDigestOf(serialize, `${spec}: ${fields.id}`), DIGEST_ALGORITHM, spec,
    ),
  }
  const descriptor = {
    ...unsigned,
    descriptorDigest: digest(descriptorDigestOf(unsigned, spec), DIGEST_ALGORITHM, spec),
  }
  assertSerializerDescriptor(descriptor)
  return descriptor
}

/** Строгая проверка формы дескриптора вместе с пересчётом обоих отпечатков. */
export function assertSerializerDescriptor(descriptor) {
  /* Строгость формы — до чтения `contractVersion`, по той же причине, что и
     в контракте профиля: accessor-свойство прочиталось бы как значение и
     выбрало бы состав, под который дескриптор не объявляли. */
  canonicalJsonBytes(descriptor, MODEL_SERIALIZER_SPEC)
  const spec = descriptor?.contractVersion
  if (!MODEL_SERIALIZER_SPECS.includes(spec)) {
    throw new TypeError(
      `contractVersion: ожидается одно из ${MODEL_SERIALIZER_SPECS.join(', ')}; `
      + `получено ${JSON.stringify(spec)}`,
    )
  }
  assertExactKeys(descriptor, DESCRIPTOR_KEYS_BY_SPEC[spec], spec)
  if (spec === MODEL_SERIALIZER_V2_SPEC) {
    if (!REASONING_POLICIES.includes(descriptor.reasoningPolicy)) {
      throw new TypeError(
        `reasoningPolicy: ожидается одно из ${REASONING_POLICIES.join(', ')}; `
        + `получено ${JSON.stringify(descriptor.reasoningPolicy)}`,
      )
    }
    if (!TOOL_POLICIES.includes(descriptor.toolPolicy)) {
      throw new TypeError(
        `toolPolicy: ожидается одно из ${TOOL_POLICIES.join(', ')}; `
        + `получено ${JSON.stringify(descriptor.toolPolicy)}`,
      )
    }
  }
  if (!KEBAB_ID.test(descriptor.id)) {
    throw new TypeError(`id: ожидается строчный идентификатор, получено ${JSON.stringify(descriptor.id)}`)
  }
  if (!EXACT_SEMVER.test(descriptor.version)) {
    throw new TypeError(`version: ожидается точная версия 1.0.0, получено ${JSON.stringify(descriptor.version)}`)
  }
  if (!SERIALIZER_METHODS.includes(descriptor.method)) {
    throw new TypeError(`method: ожидается одно из ${SERIALIZER_METHODS.join(', ')}`)
  }
  if (!PATH_SUFFIX_SHAPE.test(descriptor.endpointPathSuffix)) {
    throw new TypeError(
      `endpointPathSuffix: ожидается суффикс пути вида /v1/responses, получено `
      + `${JSON.stringify(descriptor.endpointPathSuffix)}`,
    )
  }
  assertExactly(descriptor.contentType, 'application/json', 'contentType')
  if (!HTTP_TOKEN_LOWER.test(descriptor.credentialHeader)) {
    throw new TypeError('credentialHeader: ожидается токен заголовка в нижнем регистре')
  }
  assertExactly(descriptor.credentialScheme, 'Bearer', 'credentialScheme')
  assertExactly(descriptor.structuredOutputMode, 'json-schema-strict', 'structuredOutputMode')
  assertExactly(descriptor.schemaDialect, 'json-schema-draft-2020-12', 'schemaDialect')
  if (!SCHEMA_NAME.test(descriptor.schemaName)) {
    throw new TypeError(`schemaName: ожидается [A-Za-z0-9_-], получено ${JSON.stringify(descriptor.schemaName)}`)
  }
  if (!SAMPLING_POLICIES.includes(descriptor.samplingPolicy)) {
    throw new TypeError(`samplingPolicy: ожидается одно из ${SAMPLING_POLICIES.join(', ')}`)
  }
  if (!STORE_POLICIES.includes(descriptor.storePolicy)) {
    throw new TypeError(`storePolicy: ожидается одно из ${STORE_POLICIES.join(', ')}`)
  }
  if (!IDEMPOTENCY_POLICIES.includes(descriptor.idempotencyPolicy)) {
    throw new TypeError(`idempotencyPolicy: ожидается одно из ${IDEMPOTENCY_POLICIES.join(', ')}`)
  }
  assertInteger(descriptor.maxOutboundBytes, 'maxOutboundBytes', 1)
  assertInteger(descriptor.maxResponseBytes, 'maxResponseBytes', 1)
  const unsigned = {}
  for (const key of COVERED_KEYS_BY_SPEC[spec]) unsigned[key] = descriptor[key]
  const recomputed = descriptorDigestOf(unsigned, spec)
  if (recomputed !== descriptor.descriptorDigest?.value) {
    throw new TypeError(
      `descriptorDigest не сходится: в дескрипторе ${descriptor.descriptorDigest?.value}, `
      + `пересчёт даёт ${recomputed}`,
    )
  }
  return descriptor
}

/**
 * Канонический реестр.
 *
 * Ровно один сериализатор. Пара «дескриптор + реализация» неразделима:
 * отпечаток дескриптора покрывает исходный текст своей реализации, и собрать
 * запись, где одно от другого оторвано, здесь нечем.
 */
const SERIALIZERS = deepFreeze([
  {
    descriptor: buildDescriptor({
      id: 'openai-responses',
      version: '1.0.0',
      method: 'POST',
      endpointPathSuffix: '/v1/responses',
      contentType: 'application/json',
      credentialHeader: 'authorization',
      credentialScheme: 'Bearer',
      structuredOutputMode: 'json-schema-strict',
      schemaDialect: 'json-schema-draft-2020-12',
      schemaName: 'poi_classification_proposal',
      samplingPolicy: 'omitted',
      storePolicy: 'never',
      idempotencyPolicy: 'unsupported',
      maxOutboundBytes: 262144,
      maxResponseBytes: 1048576,
    }, serializeOpenAiResponses, MODEL_SERIALIZER_SPEC),
    serialize: serializeOpenAiResponses,
  },
  {
    /* Вторая версия. От первой отличается ровно двумя объявлениями —
       политикой рассуждения и политикой инструментов — и одним полем в теле.
       Первая запись выше не тронута: её байты, её отпечатки и её журналы
       остаются прежними. */
    descriptor: buildDescriptor({
      id: 'openai-responses',
      version: '2.0.0',
      method: 'POST',
      endpointPathSuffix: '/v1/responses',
      contentType: 'application/json',
      credentialHeader: 'authorization',
      credentialScheme: 'Bearer',
      structuredOutputMode: 'json-schema-strict',
      schemaDialect: 'json-schema-draft-2020-12',
      schemaName: 'poi_classification_proposal',
      samplingPolicy: 'omitted',
      storePolicy: 'never',
      idempotencyPolicy: 'unsupported',
      reasoningPolicy: 'none',
      toolPolicy: 'none',
      maxOutboundBytes: 262144,
      maxResponseBytes: 1048576,
    }, serializeOpenAiResponsesV2, MODEL_SERIALIZER_V2_SPEC),
    serialize: serializeOpenAiResponsesV2,
  },
])

/** Дескрипторы реестра — только данные, без реализаций. */
export const SERIALIZER_DESCRIPTORS = deepFreeze(
  SERIALIZERS.map((entry) => entry.descriptor),
)

/**
 * Разрешение сериализатора по каноническому реестру.
 *
 * Ровно два аргумента и ни одного канала подмены: ни `serializers`, ни
 * `registry`, ни `descriptor`. Отсутствие и неоднозначность — отказ, а не
 * `null`: «сериализатор не найден», молча ставшее отсутствием значения, ниже
 * по течению читается как «сериализатор не требовался».
 */
export function resolveModelSerializer(id, version) {
  if (arguments.length !== 2) {
    throw new TypeError(
      `resolveModelSerializer: ровно два аргумента — id и version; получено ${arguments.length}. `
      + 'Канала подстановки реестра нет и не предусмотрено.',
    )
  }
  if (typeof id !== 'string' || !KEBAB_ID.test(id)) {
    throw new TypeError(`resolveModelSerializer.id: ожидается строчный идентификатор, получено ${JSON.stringify(id)}`)
  }
  if (typeof version !== 'string' || !EXACT_SEMVER.test(version)) {
    throw new TypeError(`resolveModelSerializer.version: ожидается точная версия, получено ${JSON.stringify(version)}`)
  }
  const found = SERIALIZERS.filter(
    (entry) => entry.descriptor.id === id && entry.descriptor.version === version,
  )
  if (!found.length) {
    throw new Error(
      `Сериализатор ${id}@${version} не объявлен: в каноническом реестре ${SERIALIZERS.length} записей.`,
    )
  }
  if (found.length > 1) {
    throw new Error(`Сериализатор ${id}@${version} объявлен ${found.length} раза — реестр неоднозначен`)
  }
  /* Возвращается только строго проверенный дескриптор: реестр — исходный
     код, а исходный код тоже правят руками и тоже ошибаются. */
  assertSerializerDescriptor(found[0].descriptor)
  /* Сверка реализации с её отпечатком здесь НАМЕРЕННО избыточна и в текущем
     дереве недостижима: `implementationDigest` считается при загрузке модуля
     с настоящего исходного текста той же функции, реестр заморожен глубоко, а
     канала подстановки записи наружу не выведено. Мутация «убрать эту сверку»
     набор не роняет, и это сказано вслух, а не скрыто. Класс, который она
     закрывает, — появление в будущем любого пути, где пара «дескриптор плюс
     функция» собирается не при загрузке: тогда она останется единственной, кто
     заметит расхождение. Сама связка проверяется прямо — тестом над
     `assertImplementationBinding` с подложной парой. */
  assertImplementationBinding(found[0], `${MODEL_SERIALIZER_SPEC}: ${id}@${version}`)
  return found[0]
}

/** Точный состав результата подготовки. */
export const OUTBOUND_KEYS = Object.freeze([
  'requestItemId', 'requestSpecDigest', 'providerProfileDigest', 'serializerDescriptorDigest',
  'outboundBytes', 'outboundBytesDigest', 'bytes',
])

/**
 * Один проверенный запрос — один подготовленный буфер.
 *
 * Порядок закреплён: сериализация один раз, СОБСТВЕННАЯ копия байтов,
 * отпечаток и длина считаются С КОПИИ, и только потом сравниваются с
 * `maxOutboundBytes`. Всё это до открытия журнала: подготовка ничего не
 * записывает и ничего не отправляет.
 *
 * Дескриптор не параметр. Он разрешается по `serializer` ИЗ ПРОВЕРЕННОГО
 * ЗАПРОСА, а сам запрос перепроверяется здесь заново: обещание вызывающего
 * «я уже проверил» доказательством не является.
 */
export function prepareOutbound(input) {
  assertStrictInput(input, ['request', 'profile'], `${MODEL_SERIALIZER_SPEC}: параметры подготовки`)
  const request = parseAndVerifyModelRequest(input.request)
  assertProviderProfileShape(input.profile)
  assertExactly(
    providerProfileDigest(input.profile), request.providerProfileDigest.value,
    `${MODEL_SERIALIZER_SPEC}: providerProfileDigest профиля против запроса`,
  )
  const { descriptor, serialize } = resolveModelSerializer(
    request.serializer.id, request.serializer.version,
  )
  /* Адрес и идемпотентность проверяются ЗДЕСЬ, до открытия журнала: обе
     ошибки делают запрос неотправляемым, и разрешение на них тратить нельзя. */
  assertSerializerGeneration(input.profile, descriptor, MODEL_SERIALIZER_SPEC)
  assertEndpointForDescriptor(input.profile, descriptor, MODEL_SERIALIZER_SPEC)
  assertIdempotencyForDescriptor(request, input.profile, descriptor, MODEL_SERIALIZER_SPEC)
  assertExactly(
    request.structuredOutput.mode, descriptor.structuredOutputMode,
    `${MODEL_SERIALIZER_SPEC}: structuredOutput.mode против дескриптора`,
  )
  assertExactly(
    request.structuredOutput.schemaDialect, descriptor.schemaDialect,
    `${MODEL_SERIALIZER_SPEC}: structuredOutput.schemaDialect против дескриптора`,
  )
  const body = serialize(request, descriptor)
  const bytes = canonicalBodyBytes(body, `${MODEL_SERIALIZER_SPEC}: тело`)
  const outboundBytes = bytes.length
  const outboundBytesDigest = sha256Bytes(bytes)
  if (outboundBytes > descriptor.maxOutboundBytes) {
    throw new Error(
      `${MODEL_SERIALIZER_SPEC}: исходящих байт ${outboundBytes} при пределе `
      + `${descriptor.maxOutboundBytes} — запрос не отправляется и журнал не открывается`,
    )
  }
  return Object.freeze({
    requestItemId: request.item.requestItemId,
    requestSpecDigest: request.requestSpecDigest.value,
    providerProfileDigest: request.providerProfileDigest.value,
    serializerDescriptorDigest: descriptor.descriptorDigest.value,
    outboundBytes,
    outboundBytesDigest,
    bytes,
  })
}

/**
 * Версия сериализатора обязана соответствовать версии профиля.
 *
 * Проверяется здесь, потому что здесь оба объекта впервые оказываются в
 * одних руках: контракт профиля не знает о реестре сериализаторов, а
 * контракт сериализатора — о реестре профилей, и импортировать друг друга им
 * нечем без кольца.
 *
 * Что закрывает. Профиль v2 честно объявляет наблюдаемый алиас и срок, но
 * называет сериализатор `openai-responses@1.0.0` — и запрос уходит без
 * `reasoning`, то есть с умолчанием `medium` за деньги владельца. Снаружи
 * профиль при этом выглядит исправленным.
 */
export function assertSerializerGeneration(profile, descriptor, where) {
  const profileSpec = profileContractSpec(profile)
  const expected = SERIALIZER_SPEC_BY_PROFILE_SPEC[profileSpec]
  if (descriptor.contractVersion !== expected) {
    throw new Error(
      `${where}: профиль по ${profileSpec} обязан называть сериализатор по ${expected}, `
      + `а назван ${descriptor.id}@${descriptor.version} по ${descriptor.contractVersion}`,
    )
  }
  return descriptor
}

/**
 * Проверенный адрес запроса.
 *
 * Берётся РОВНО `profile.endpoint` — он входит в `providerProfileDigest`, и
 * пересобрать его из `origin` плюс путь дескриптора значило бы выбросить
 * часть адреса, покрытого отпечатком профиля. Профиль с адресом
 * `https://api.example.com/tenant/v1/responses` обязан получить запрос по
 * этому адресу, а не по `https://api.example.com/v1/responses`.
 *
 * Дескриптор объявляет не адрес, а СУФФИКС пути, и проверенный endpoint
 * обязан им оканчиваться. Нормализации здесь нет: канонический вид адреса
 * уже установлен контрактом профиля, а второе приведение дало бы двум
 * записям один адрес.
 */
export function assertEndpointForDescriptor(profile, descriptor, where) {
  const url = new URL(profile.endpoint)
  if (!url.pathname.endsWith(descriptor.endpointPathSuffix)) {
    throw new Error(
      `${where}: путь адреса профиля ${JSON.stringify(url.pathname)} не оканчивается суффиксом `
      + `${JSON.stringify(descriptor.endpointPathSuffix)}, объявленным сериализатором `
      + `${descriptor.id}@${descriptor.version}`,
    )
  }
  return profile.endpoint
}

/**
 * Ключ идемпотентности при политике `unsupported`.
 *
 * Проверяется ДО открытия журнала и обе половины сразу: и объявленная
 * возможность профиля, и то, что действительно лежит в запросе. Профиль,
 * объявивший поддержку, дал бы запросу ненулевой ключ, а сериализатор
 * заголовка не отправляет — и запрос ушёл бы без обещанной ему
 * идемпотентности, о чём никто бы не узнал.
 */
export function assertIdempotencyForDescriptor(request, profile, descriptor, where) {
  if (descriptor.idempotencyPolicy !== 'unsupported') {
    throw new TypeError(
      `${where}: политика идемпотентности ${JSON.stringify(descriptor.idempotencyPolicy)} `
      + 'этим сериализатором не реализована',
    )
  }
  if (profile.capabilities.idempotencyKey.supported !== false) {
    throw new Error(
      `${where}: профиль объявляет поддержку ключа идемпотентности, а сериализатор `
      + `${descriptor.id}@${descriptor.version} заголовка не отправляет. Официальной `
      + 'документации на такой заголовок у этого адреса нет, и догадка о чужом протоколе '
      + 'за деньги владельца здесь не делается.',
    )
  }
  assertExactly(
    request.retryPolicy.idempotencyKey, null,
    `${where}: retryPolicy.idempotencyKey при политике unsupported`,
  )
}

/**
 * Повторная сверка подготовленного буфера НА ГРАНИЦЕ ТРАНСПОРТА.
 *
 * Между подготовкой и отправкой лежат две записи журнала и fsync. Буфер за
 * это время мог быть подменён или дописан: `Buffer` изменяем, и заморозить
 * его содержимое нечем. Поэтому длина и отпечаток пересчитываются здесь
 * заново, а не принимаются на слово у самих себя.
 */
export function assertOutboundIntegrity(outbound, where) {
  assertExactKeys(outbound, OUTBOUND_KEYS, where)
  if (!Buffer.isBuffer(outbound.bytes)) {
    throw new TypeError(`${where}.bytes: ожидается Buffer, получено ${typeof outbound.bytes}`)
  }
  assertExactly(outbound.bytes.length, outbound.outboundBytes, `${where}.bytes: длина против outboundBytes`)
  assertExactly(
    sha256Bytes(outbound.bytes), outbound.outboundBytesDigest,
    `${where}.bytes: отпечаток против outboundBytesDigest`,
  )
  return outbound
}
