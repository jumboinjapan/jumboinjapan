/**
 * Граница транспорта, `poi-model-transport/v1`.
 *
 * Здесь подготовленный буфер уходит наружу и возвращается ответ. Сети в этом
 * модуле нет: ни `fetch`, ни `node:http`, ни `node:https`, ни SDK не
 * импортируются и импортироваться не могут — клиент приходит параметром.
 * Учётные данные тоже приходят функцией, вызываются ровно один раз перед
 * отправкой и никуда не сохраняются.
 *
 * Что здесь решается и чего здесь не решается. Решается: те ли байты уходят
 * (длина и отпечаток пересчитываются заново), сколько байтов принимать
 * (предел применяется ДО разбора), был ли ответ вообще (и тогда деньги
 * считаются потраченными), и что именно пришло в терминах закрытого списка
 * проблем. Не решается: годно ли предложение модели — это по-прежнему
 * `classifyModelResponse`, и второго судьи у него не появилось.
 *
 * Утечка закрыта не обещанием, а составом возвращаемого: наружу уходят
 * фиксированные тексты, `requestItemId`, отпечатки и размеры. Ни значения
 * учётных данных, ни заголовков, ни полного адреса, ни тела ответа в
 * результате, исключении и диагностике нет.
 *
 * Ответ Responses API разбирается по официальной документации: `output` —
 * массив элементов, текст лежит в элементе `message` внутри `content` как
 * `output_text`; отказ приходит элементом `refusal`; обрыв по пределу
 * выходных токенов даёт `status: "incomplete"` и `incomplete_details.reason`.
 */
import {
  assertExactKeys,
  assertExactly,
  assertNonEmptyString,
  deepFreeze,
  isPlainObject,
} from '../../lib/canonical-contract.mjs'
import { sha256Bytes } from '../../lib/byte-digest.mjs'
import {
  assertProblem,
  assertRequestItemId,
  assertStrictOptions,
  formatProblem,
} from './model-execution.mjs'
import { parseAndVerifyModelRequest } from './model-request.mjs'
import {
  assertEndpointForDescriptor,
  assertIdempotencyForDescriptor,
  assertOutboundIntegrity,
  resolveModelSerializer,
} from './model-serializers.mjs'
import {
  assertProviderProfileShape,
  providerProfileDigest,
} from './provider-profile.mjs'

export const MODEL_TRANSPORT_SPEC = 'poi-model-transport/v1'

/**
 * Результат транспорта ВТОРОЙ версии.
 *
 * `problems` отделён от `response` намеренно. Терминальный отказ самого
 * транспорта — «ответ длиннее предела», «HTTP 500», «в ответе нет текста» —
 * предложением модели не является, и подсовывать его классификатору значило
 * бы получить список претензий к схеме там, где схемы не было вовсе.
 * Заполнено ровно одно из двух полей.
 */
export const MODEL_TRANSPORT_RESULT_SPEC = 'poi-model-transport-result/v2'

export const TRANSPORT_RESULT_KEYS = Object.freeze([
  'requestItemId', 'charged', 'response', 'problems',
])

const TRANSPORT_INPUT_KEYS = Object.freeze([
  'request', 'profile', 'outbound', 'assertOwnedForEffect',
])
const WIRE_RESPONSE_KEYS = Object.freeze(['status', 'body'])

/** Значение заголовка учётных данных: схема и видимый ASCII без пробелов. */
const BEARER_VALUE = /^Bearer [\x21-\x7e]{1,4096}$/

/** Причины незавершённости, названные документацией. Прочее — `other`. */
const INCOMPLETE_REASONS = Object.freeze(['max_output_tokens', 'timeout'])

/**
 * Отказ транспорта БЕЗ чужого текста.
 *
 * Сообщение исходной ошибки сюда не попадает никогда: в нём бывает и адрес,
 * и заголовок, и тело ответа, а иногда и значение учётных данных. Наружу
 * уходит фиксированный текст, идентификатор элемента и отпечаток исходящих
 * байтов — этого достаточно, чтобы найти запись в журнале, и недостаточно,
 * чтобы что-нибудь раскрыть.
 */
export class ModelTransportError extends Error {
  constructor(stage, outbound) {
    super(
      `${MODEL_TRANSPORT_SPEC}: отказ на этапе «${stage}» для элемента ${outbound.requestItemId} `
      + `(исходящих ${outbound.outboundBytes} байт, ${outbound.outboundBytesDigest}). `
      + 'Текст исходной ошибки не воспроизводится: в нём бывают адрес, заголовки, тело ответа '
      + 'и учётные данные. Исходное исключение не сохраняется и в cause не выводится: '
      + 'публичный cause — тот же канал наружу, только через другое поле.',
    )
    this.name = 'ModelTransportError'
    this.stage = stage
    this.requestItemId = outbound.requestItemId
    this.outboundBytesDigest = outbound.outboundBytesDigest
    this.outboundBytes = outbound.outboundBytes
  }
}

/**
 * Почему здесь НЕТ разбора класса чужого исключения.
 *
 * Прежняя версия считала `TypeError` и `ReferenceError` признаком
 * программного дефекта и пропускала такое исключение наружу нетронутым. Класс
 * исключения выбирает тот, кто его бросает, а бросает его чужая функция:
 * резолвер учётных данных, упавший с `TypeError('ключ не найден: sk-…')`,
 * выносил секрет в текст, а поток, оборвавшийся `TypeError` уже ПОСЛЕ
 * полученного HTTP-статуса, подменял терминальный вердикт чужим сообщением.
 *
 * Поэтому правило простое: всё, что вылетело ИЗ ЧУЖОГО callback, очищается
 * независимо от класса. Собственные проверки формы по-прежнему бросают
 * `TypeError` — но они стоят ВНЕ `try`, окружающего чужой вызов, и потому под
 * очистку не попадают.
 */

function result({ requestItemId, charged, response, problems }) {
  const value = { requestItemId, charged, response, problems }
  assertExactKeys(value, TRANSPORT_RESULT_KEYS, `${MODEL_TRANSPORT_RESULT_SPEC}: результат`)
  assertRequestItemId(value.requestItemId, `${MODEL_TRANSPORT_RESULT_SPEC}.requestItemId`)
  /* `charged` — не поле выбора. Результат транспорта существует только
     после полученного HTTP-ответа; до ответа функция бросает исключение и
     результата не возвращает вовсе. Значение `false` здесь описывало бы
     состояние, которого у этого типа не бывает, и открывало бы дорогу
     «ответ есть, деньги целы». */
  assertExactly(value.charged, true, `${MODEL_TRANSPORT_RESULT_SPEC}.charged`)
  /* Заполнено ровно одно из двух: «и предложение, и претензии» читалось бы
     двумя способами сразу, «ни того, ни другого» — ни одним. */
  const hasResponse = value.response !== null
  const hasProblems = value.problems !== null
  if (hasResponse === hasProblems) {
    throw new TypeError(
      `${MODEL_TRANSPORT_RESULT_SPEC}: заполнено обязано быть ровно одно из response и problems`,
    )
  }
  if (hasProblems) {
    if (!Array.isArray(value.problems) || !value.problems.length) {
      throw new TypeError(`${MODEL_TRANSPORT_RESULT_SPEC}.problems: ожидается непустой массив`)
    }
    /* Каждый элемент проверяется своей границей, а не только пересчётом
       длины массива: непустой список чего попало — это не список проблем. */
    value.problems.forEach(
      (problem, index) => assertProblem(problem, `${MODEL_TRANSPORT_RESULT_SPEC}.problems[${index}]`),
    )
  }
  return deepFreeze(value)
}

/** Отказ транспорта с закрытым списком проблем. Деньги при этом потрачены. */
function refused(requestItemId, problems) {
  return result({ requestItemId, charged: true, response: null, problems })
}

/** Статус подтвердить не удалось: был ли ответ — неизвестно. */
const WIRE_UNCONFIRMED = Object.freeze({ confirmed: false, status: null, body: null, bodyOk: false })

/**
 * Разбор верхнего объекта ответа: СНАЧАЛА статус, потом всё остальное.
 *
 * Здесь три отдельные предосторожности, и каждая закрывает свой обход.
 *
 * Первая: значения берутся из ДЕСКРИПТОРА, а не чтением поля. `wire.status`
 * может быть getter'ом либо `get`-ловушкой `Proxy`, и обычное чтение
 * исполнило бы чужой код — а он бросает исключение с секретом в тексте.
 *
 * Вторая: вся рефлексия целиком внутри `try`. `Proxy` перехватывает и
 * `getPrototypeOf` (то есть `isPlainObject`), и `ownKeys`, и
 * `getOwnPropertyDescriptor`; ловушка, брошенная оттуда, раньше уходила
 * наружу нетронутой вместе с чужим текстом.
 *
 * Третья: порядок. Статус подтверждается ПЕРВЫМ и отдельно. Пока он не
 * подтверждён, любой дефект — неопределённость: был ли ответ, неизвестно.
 * Как только подтверждён — ответ был, деньги потрачены, и всякий дефект
 * формы или тела становится терминальным вердиктом. Прежняя версия
 * отвергала весь объект целиком из-за accessor'а у `body` и превращала
 * известное списание в «неизвестно».
 */
function inspectWire(wire) {
  let status = null
  const afterStatus = () => (status === null
    ? WIRE_UNCONFIRMED
    : { confirmed: true, status, body: null, bodyOk: false })
  try {
    if (!isPlainObject(wire)) return WIRE_UNCONFIRMED
    const statusDescriptor = Object.getOwnPropertyDescriptor(wire, 'status')
    if (statusDescriptor === undefined
      || !statusDescriptor.enumerable || !('value' in statusDescriptor)) {
      return WIRE_UNCONFIRMED
    }
    const value = statusDescriptor.value
    if (!Number.isSafeInteger(value) || value < 100 || value > 599) return WIRE_UNCONFIRMED
    status = value

    const keys = Reflect.ownKeys(wire)
    if (keys.length !== WIRE_RESPONSE_KEYS.length) return afterStatus()
    for (const key of keys) {
      if (typeof key !== 'string' || !WIRE_RESPONSE_KEYS.includes(key)) return afterStatus()
    }
    const bodyDescriptor = Object.getOwnPropertyDescriptor(wire, 'body')
    if (bodyDescriptor === undefined
      || !bodyDescriptor.enumerable || !('value' in bodyDescriptor)) {
      return afterStatus()
    }
    return { confirmed: true, status, body: bodyDescriptor.value, bodyOk: true }
  } catch {
    return afterStatus()
  }
}

/** Исходы чтения тела. Каждый — фиксированный текст без чужого содержимого. */
const BODY_TORN = Object.freeze({ kind: 'torn', bytes: null })
const BODY_NOT_BYTES = Object.freeze({ kind: 'notBytes', bytes: null })
const BODY_TOO_LARGE = Object.freeze({ kind: 'tooLarge', bytes: null })

/**
 * Чтение тела: ОДНА внешняя ленивая граница.
 *
 * Предел применяется на каждом куске и ДО всякого разбора: `JSON.parse` над
 * ответом неизвестной длины — это разрешение чужой стороне занять нашу
 * память.
 *
 * Всё остальное здесь — чужой ЛЕНИВЫЙ код, а не значения. Чтение
 * `Symbol.asyncIterator`, его вызов, чтение `iterator.next`, вызов `next`,
 * чтение `step.done` и `step.value` — шесть точек, в каждой из которых
 * исполняется getter или метод, написанный клиентом. Прежняя версия трогала
 * первые три ВНЕ `try`, и getter, бросивший `TypeError` с секретом в тексте,
 * выносил его наружу.
 *
 * Поэтому вся граница накрыта одним `try`, и HTTP-статус к этому моменту уже
 * подтверждён: значит ответ был, деньги потрачены, и любой отказ тела — это
 * негодный ответ, а не неопределённость. Класс исключения ничего не меняет.
 */
async function readBoundedAfterStatus(body, limit) {
  const chunks = []
  let total = 0
  let iterator = null
  /**
   * Отмена потока на раннем выходе — БЕЗ ОЖИДАНИЯ.
   *
   * Без `return()` генератор остаётся приостановленным, а у настоящего
   * HTTP-клиента за ним стоит незакрытое тело и живое соединение: предел,
   * после которого мы перестали читать, но не перестали держать, пределом не
   * является.
   *
   * Но и ЖДАТЬ ответа отмены нельзя. `return()` пишет чужая сторона, и она
   * вправе вернуть промис, который не завершится никогда, — тогда уже
   * известный терминальный вердикт («статус получен, предел превышен») повис
   * бы навсегда. Поэтому отмена запрашивается и отпускается: мы обязаны
   * попросить закрыть поток, но не обязаны дожидаться ответа.
   *
   * Возможный rejection гасится здесь же и синхронно. Брошенный без
   * обработчика, он всплыл бы как `unhandledRejection` уже после возврата
   * вердикта — то есть чужой код ронял бы процесс после того, как мы с ним
   * закончили.
   */
  const cancel = () => {
    try {
      const finish = iterator?.return
      if (typeof finish !== 'function') return
      const settled = finish.call(iterator)
      if (settled !== null && typeof settled === 'object' && typeof settled.then === 'function') {
        settled.then(() => {}, () => {})
      }
    } catch { /* синхронный отказ отмены вердикта не меняет */ }
  }
  try {
    if (body === null || typeof body !== 'object') return BODY_TORN
    const factory = body[Symbol.asyncIterator]
    if (typeof factory !== 'function') return BODY_TORN
    iterator = factory.call(body)
    if (iterator === null || typeof iterator !== 'object') return BODY_TORN
    for (;;) {
      const next = iterator.next
      if (typeof next !== 'function') { cancel(); return BODY_TORN }
      const step = await next.call(iterator)
      if (step === null || typeof step !== 'object') { cancel(); return BODY_TORN }
      if (step.done) break
      const chunk = step.value
      if (!(chunk instanceof Uint8Array)) { cancel(); return BODY_NOT_BYTES }
      total += chunk.length
      if (total > limit) { cancel(); return BODY_TOO_LARGE }
      chunks.push(Buffer.from(chunk))
    }
  } catch {
    cancel()
    return BODY_TORN
  }
  return { kind: 'ok', bytes: Buffer.concat(chunks, total) }
}

/**
 * Извлечение текстового результата из ответа Responses.
 *
 * Возвращается либо строка, либо закрытая проблема. Ни одного фрагмента
 * ответа в проблему не попадает: наружу уходят только фиксированные тексты и
 * причина незавершённости из списка, названного документацией.
 */
function extractOutputText(payload) {
  if (!isPlainObject(payload)) {
    return { text: null, problem: formatProblem('malformedResponse', 'ответ провайдера не объект') }
  }
  if (payload.status === 'incomplete') {
    const reason = payload.incomplete_details?.reason
    const named = INCOMPLETE_REASONS.includes(reason) ? reason : 'other'
    return {
      text: null,
      problem: formatProblem(
        'providerIncomplete', `провайдер вернул незавершённый ответ, причина ${named}`,
      ),
    }
  }
  if (!Array.isArray(payload.output)) {
    return {
      text: null,
      problem: formatProblem('malformedResponse', 'в ответе провайдера нет массива output'),
    }
  }
  let text = null
  for (const item of payload.output) {
    if (!isPlainObject(item) || item.type !== 'message' || !Array.isArray(item.content)) continue
    for (const part of item.content) {
      if (!isPlainObject(part)) continue
      if (part.type === 'refusal') {
        /* Текст отказа не воспроизводится: это порождённый моделью фрагмент
           неизвестной длины, а факт отказа выражается самим видом проблемы. */
        return {
          text: null,
          problem: formatProblem('providerRefusal', 'провайдер вернул отказ вместо результата'),
        }
      }
      if (part.type !== 'output_text') continue
      if (typeof part.text !== 'string') {
        return {
          text: null,
          problem: formatProblem('malformedResponse', 'output_text без строкового поля text'),
        }
      }
      if (text !== null) {
        /* Второй текстовый фрагмент — это выбор между двумя ответами, а
           выбирать здесь нечем и не по чему. */
        return {
          text: null,
          problem: formatProblem('malformedResponse', 'в ответе больше одного output_text'),
        }
      }
      text = part.text
    }
  }
  if (text === null) {
    return {
      text: null,
      problem: formatProblem('malformedResponse', 'в ответе провайдера нет output_text'),
    }
  }
  return { text, problem: null }
}

/**
 * Транспорт над инъецированным клиентом.
 *
 * Ни клиент, ни резолвер учётных данных не имеют умолчания: транспорта «по
 * умолчанию» не существует, и production-путь без явной инъекции до сети не
 * доходит. Никаких дополнительных параметров у резолвера нет — он получает
 * перепроверенный профиль и разрешённый дескриптор, и ничего сверх.
 */
export function createModelTransport(input) {
  /* Строгая форма, но БЕЗ канонизации: и клиент, и резолвер — функции, а
     подготовленные байты — Buffer. Канонизация отвергла бы их как «не
     сериализуется», то есть не пустила бы на границу ровно то, ради чего
     граница и существует. */
  assertStrictOptions(
    input, { required: ['wireClient', 'resolveCredentials'] }, `${MODEL_TRANSPORT_SPEC}: параметры`,
  )
  const { wireClient, resolveCredentials } = input
  if (typeof wireClient !== 'function') {
    throw new TypeError(`${MODEL_TRANSPORT_SPEC}.wireClient: ожидается функция, получено ${typeof wireClient}`)
  }
  if (typeof resolveCredentials !== 'function') {
    throw new TypeError(
      `${MODEL_TRANSPORT_SPEC}.resolveCredentials: ожидается функция, получено ${typeof resolveCredentials}`,
    )
  }

  return async function dispatch(call) {
    assertStrictOptions(call, { required: TRANSPORT_INPUT_KEYS }, `${MODEL_TRANSPORT_SPEC}: вызов`)
    /* Всё, что пришло, перепроверяется здесь заново. Обещание вызывающего
       «я уже проверил» доказательством не является, а отправка — эффект,
       который не отменяется. */
    const outbound = assertOutboundIntegrity(call.outbound, `${MODEL_TRANSPORT_SPEC}.outbound`)
    const request = parseAndVerifyModelRequest(call.request)
    assertExactly(
      request.item.requestItemId, outbound.requestItemId,
      `${MODEL_TRANSPORT_SPEC}: requestItemId запроса против подготовленных байтов`,
    )
    assertExactly(
      request.requestSpecDigest.value, outbound.requestSpecDigest,
      `${MODEL_TRANSPORT_SPEC}: requestSpecDigest запроса против подготовленных байтов`,
    )
    assertProviderProfileShape(call.profile)
    const profileDigest = providerProfileDigest(call.profile)
    assertExactly(
      profileDigest, outbound.providerProfileDigest,
      `${MODEL_TRANSPORT_SPEC}: providerProfileDigest профиля против подготовленных байтов`,
    )
    assertExactly(
      profileDigest, request.providerProfileDigest.value,
      `${MODEL_TRANSPORT_SPEC}: providerProfileDigest профиля против запроса`,
    )
    const { descriptor } = resolveModelSerializer(request.serializer.id, request.serializer.version)
    assertExactly(
      descriptor.descriptorDigest.value, outbound.serializerDescriptorDigest,
      `${MODEL_TRANSPORT_SPEC}: дескриптор сериализатора против подготовленных байтов`,
    )

    /* Адрес берётся у профиля ЦЕЛИКОМ. Пересборка из `origin` выбрасывала бы
       путь, входящий в `providerProfileDigest`. */
    const url = assertEndpointForDescriptor(call.profile, descriptor, MODEL_TRANSPORT_SPEC)
    assertIdempotencyForDescriptor(request, call.profile, descriptor, MODEL_TRANSPORT_SPEC)

    /* Полномочие на эффект приходит от НАСТОЯЩЕЙ ручки журнала: её выдаёт
       исполнитель, который сам же создал этот транспорт. Функции здесь
       достаточно — подставить её снаружи некому, потому что параметра
       `transport` в публичном входе исполнителя больше нет. */
    if (typeof call.assertOwnedForEffect !== 'function') {
      throw new TypeError(
        `${MODEL_TRANSPORT_SPEC}.assertOwnedForEffect: ожидается функция ручки журнала, `
        + `получено ${typeof call.assertOwnedForEffect}`,
      )
    }

    /* Учётные данные разрешаются ПОСЛЕДНИМИ и ровно один раз — прямо перед
       отправкой. Ни в переменную модуля, ни в результат, ни в отпечаток они
       не попадают, и хеша от них тоже нигде нет: хеш секрета — тоже
       производная секрета. */
    let credential
    let credentialFailed = false
    try {
      credential = await resolveCredentials({ profile: call.profile, descriptor })
    } catch {
      /* Класс чужого исключения ничего не доказывает: `TypeError` из
         резолвера — такой же чужой текст, как и любой другой, и в нём бывает
         значение ключа. Очищается всё. */
      credentialFailed = true
    }
    if (credentialFailed) throw new ModelTransportError('разрешение учётных данных', outbound)
    if (typeof credential !== 'string' || !BEARER_VALUE.test(credential)) {
      /* Само значение в текст не попадает — даже его длина: длина секрета
         тоже про секрет. Это НАША проверка формы, и стоит она вне `catch`. */
      throw new TypeError(
        `${MODEL_TRANSPORT_SPEC}: резолвер обязан вернуть значение заголовка вида `
        + `«${descriptor.credentialScheme} …» из видимых ASCII без пробелов`,
      )
    }

    /* ── Последнее окно перед эффектом ────────────────────────────────
       Между проверкой байтов наверху и этой точкой стоял `await` резолвера, а
       значит и целый оборот цикла событий. За него внешний держатель мог
       переписать буфер, а чужой процесс — перехватить исполнение новой
       эпохой. Поэтому обе проверки повторяются ЗДЕСЬ, вплотную к вызову:
       сначала владение (это единственный асинхронный шаг), затем целостность
       байтов, и сразу вызов. Ни одного `await` между ними нет и появиться не
       должно — каждый вернул бы то самое окно. */
    await call.assertOwnedForEffect()
    assertOutboundIntegrity(outbound, `${MODEL_TRANSPORT_SPEC}.outbound (перед отправкой)`)

    let wire
    let wireFailed = false
    try {
      wire = await wireClient({
        method: descriptor.method,
        url,
        headers: {
          'content-type': descriptor.contentType,
          [descriptor.credentialHeader]: credential,
        },
        body: outbound.bytes,
        timeoutMs: request.timeoutMs,
        maxResponseBytes: descriptor.maxResponseBytes,
      })
    } catch {
      wireFailed = true
    }
    if (wireFailed) {
      /* Ответа не было: получен ли запрос провайдером — неизвестно, и
         объявить деньги нетронутыми здесь нечем. Это единственный путь,
         который оставляет исполнение несведённым. Класс исключения провода
         на это не влияет. */
      throw new ModelTransportError('отправка запроса', outbound)
    }

    /* Разбор ответа: статус подтверждается первым и отдельно. Ни одно
       значение не читается чтением поля, вся рефлексия внутри `try`, и
       негодные значения наружу не воспроизводятся. */
    const inspected = inspectWire(wire)
    if (!inspected.confirmed) {
      /* Статуса нет: дошёл ли запрос — неизвестно, и объявлять деньги
         нетронутыми нечем. Это единственная ветка разбора ответа, которая
         оставляет исполнение несведённым. */
      throw new ModelTransportError('чтение статуса ответа', outbound)
    }
    const { status } = inspected

    /* Статус подтверждён — значит ответ был, и деньги считаются потраченными.
       Дальше решается только годность ответа, но не факт списания: 4xx и 5xx
       от неудачного 200 в этом смысле не отличаются, и ни один дефект формы
       или тела больше не превращается в неопределённость. */
    if (!inspected.bodyOk) {
      return refused(outbound.requestItemId, [formatProblem(
        'malformedResponse', 'форма ответа провода не соответствует контракту',
      )])
    }
    const read = await readBoundedAfterStatus(inspected.body, descriptor.maxResponseBytes)
    if (read.kind === 'tooLarge') {
      return refused(outbound.requestItemId, [formatProblem(
        'responseTooLarge',
        `ответ провайдера превысил предел ${descriptor.maxResponseBytes} байт и не разбирался`,
      )])
    }
    if (read.kind === 'notBytes') {
      return refused(outbound.requestItemId, [formatProblem(
        'malformedResponse', 'тело ответа провайдера отдало не байты',
      )])
    }
    if (read.kind === 'torn') {
      return refused(outbound.requestItemId, [formatProblem(
        'malformedResponse', 'чтение ответа провайдера оборвалось',
      )])
    }
    if (status < 200 || status > 299) {
      /* Тело ошибки не разбирается и не воспроизводится: в нём бывает и эхо
         запроса, и служебные подробности, а вердикт уже определён статусом. */
      return refused(outbound.requestItemId, [formatProblem(
        'httpStatus', `провайдер ответил HTTP-статусом ${status}`,
      )])
    }

    let payload
    try {
      payload = JSON.parse(read.bytes.toString('utf8'))
    } catch {
      return refused(outbound.requestItemId, [formatProblem(
        'malformedResponse',
        `тело ответа (${read.bytes.length} байт, ${sha256Bytes(read.bytes)}) не разбирается как JSON`,
      )])
    }
    const { text, problem } = extractOutputText(payload)
    if (problem !== null) return refused(outbound.requestItemId, [problem])

    let proposal
    try {
      proposal = JSON.parse(text)
    } catch {
      return refused(outbound.requestItemId, [formatProblem(
        'malformedResponse', 'output_text не разбирается как JSON',
      )])
    }
    /* Годность предложения здесь НЕ решается: транспорт довёз значение и на
       этом закончился. Судья остаётся один — `classifyModelResponse`. */
    return result({
      requestItemId: outbound.requestItemId, charged: true, response: proposal, problems: null,
    })
  }
}

/**
 * Проверка чужого результата транспорта.
 *
 * Вынесена наружу, потому что исполнитель обязан проверять то, что ему
 * вернули, той же границей, что и мы сами свой результат.
 */
export function assertTransportResult(raw, expectedRequestItemId) {
  if (!isPlainObject(raw)) {
    throw new TypeError(`${MODEL_TRANSPORT_RESULT_SPEC}: ожидается простой объект результата`)
  }
  assertExactKeys(raw, TRANSPORT_RESULT_KEYS, `${MODEL_TRANSPORT_RESULT_SPEC}: результат`)
  assertNonEmptyString(raw.requestItemId, `${MODEL_TRANSPORT_RESULT_SPEC}.requestItemId`)
  if (raw.requestItemId !== expectedRequestItemId) {
    throw new TypeError(
      `${MODEL_TRANSPORT_RESULT_SPEC}: ответ принадлежит ${raw.requestItemId}, ожидался `
      + `${expectedRequestItemId}; сопоставление по позиции запрещено`,
    )
  }
  return result(raw)
}
