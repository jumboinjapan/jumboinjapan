/**
 * ПРОВОД И УЧЁТНЫЕ ДАННЫЕ — production-адаптеры модельного исполнения.
 *
 * Отдельный модуль, а не часть транспорта, и это принципиально. Транспорт
 * (`model-transport.mjs`) обязан оставаться без своего HTTP-клиента: набор
 * недостижимости проверяет это прямо, и проверка не декоративная — клиент
 * внутри транспорта означал бы, что путь до денег есть у любого, кто соберёт
 * транспорт. Здесь клиент есть, но модуль ничего не решает: он не выбирает
 * адрес, не собирает тело, не судит об ответе. Ему передают готовое.
 *
 * Два адаптера, и оба узкие:
 *
 *   `createProductionWireClient` — одно HTTP-обращение с одним сроком на ВСЮ
 *   операцию (соединение, заголовки, тело) и потолком байтов ответа;
 *   `createCredentialsResolver` — чтение секрета из окружения ровно в момент
 *   отправки.
 *
 * НИЗКОУРОВНЕВЫЕ ЗАВИСИМОСТИ ИНЪЕЦИРУЮТСЯ. Наборы подменяют `request` и `env`
 * — то есть сокет и окружение, — а не исполнитель, не preflight и не
 * транспорт. Подмена верхнего слоя проверяла бы композицию, которой в
 * production нет.
 */
import { request as httpsRequest } from 'node:https'

/**
 * Настоящий низкоуровневый запрос — ИМЕНОВАННЫМ экспортом, а не умолчанием.
 *
 * Умолчания у провода нет намеренно, и это то же правило, что у транспорта:
 * «клиента по умолчанию не существует». Оркестратор подставляет эту функцию
 * явно, набор — свою. Скрытого пути в сеть не остаётся: собрать провод, не
 * назвав, чем он ходит, нельзя.
 */
export const PRODUCTION_HTTPS_REQUEST = httpsRequest

/** Ключ окружения на провайдера. Закрытая таблица: чужой провайдер — отказ. */
export const CREDENTIAL_ENV_BY_PROVIDER = Object.freeze({
  /* ОТДЕЛЬНАЯ переменная, а не общий `OPENAI_API_KEY`. Тот ключ живёт для
     исследования места в черновиках POI (`src/lib/poi-intake.ts`) и задан у
     владельца постоянно. Если бы платный исполнитель читал его же, наличие
     давно настроенной переменной само по себе открывало бы модельный прогон:
     настройка, сделанная для другого, стала бы разрешением на этот. */
  openai: 'POI_MODEL_EXECUTION_OPENAI_API_KEY',
})

/** Видимый ASCII без пробелов — то же множество, что требует транспорт. */
const SECRET_SHAPE = /^[\x21-\x7e]{1,4096}$/

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Собственное строковое data-свойство или `null`. Прототип не читается. */
function ownString(value, key) {
  if (!isPlainObject(value)) return null
  const slot = Object.getOwnPropertyDescriptor(value, key)
  if (!slot || !('value' in slot)) return null
  return typeof slot.value === 'string' ? slot.value : null
}

function assertExactKeys(value, keys, where) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${where}: ожидается объект, получено ${value === null ? 'null' : typeof value}`)
  }
  const own = Reflect.ownKeys(value)
  const extra = own.filter((key) => typeof key !== 'string' || !keys.includes(key))
  const missing = keys.filter((key) => !own.includes(key))
  if (extra.length || missing.length) {
    const parts = []
    if (missing.length) parts.push(`нет обязательных полей ${missing.join(', ')}`)
    if (extra.length) parts.push(`лишние поля ${extra.map(String).join(', ')}`)
    throw new TypeError(`${where}: ${parts.join('; ')}`)
  }
}

const CREDENTIAL_CALL_KEYS = Object.freeze(['profile', 'descriptor'])

/**
 * Резолвер учётных данных.
 *
 * СЕКРЕТ НЕ ПОКИДАЕТ ЭТУ ФУНКЦИЮ НИЧЕМ, КРОМЕ ВОЗВРАЩАЕМОГО ЗАГОЛОВКА. Ни
 * текст ошибки, ни его длина, ни отпечаток: длина секрета — тоже сведение о
 * секрете, а хеш — производная от него. Сообщения называют ТОЛЬКО имя
 * переменной, которое и так стоит в `.env.example`.
 *
 * Значение читается в момент вызова, а вызывает его транспорт последним
 * действием перед отправкой. Модульной переменной с секретом здесь нет:
 * прочитанное однажды пережило бы отказ ворот.
 */
export function createCredentialsResolver(input = {}) {
  assertExactKeys(input, ['env'], 'createCredentialsResolver: параметры')
  const { env } = input
  if (!isPlainObject(env)) {
    throw new TypeError('createCredentialsResolver.env: ожидается объект окружения')
  }
  return async function resolveCredentials(call) {
    assertExactKeys(call, CREDENTIAL_CALL_KEYS, 'resolveCredentials: вызов')
    const providerId = ownString(call.profile, 'providerId')
    if (providerId === null) {
      throw new TypeError('resolveCredentials: у профиля нет собственного строкового providerId')
    }
    const scheme = ownString(call.descriptor, 'credentialScheme')
    if (scheme === null) {
      throw new TypeError('resolveCredentials: у дескриптора нет собственной строковой credentialScheme')
    }
    /* Имя переменной берётся по СОБСТВЕННОМУ ключу закрытой таблицы:
       обращение по произвольной строке достало бы унаследованное. */
    const variable = Object.prototype.hasOwnProperty.call(CREDENTIAL_ENV_BY_PROVIDER, providerId)
      ? CREDENTIAL_ENV_BY_PROVIDER[providerId]
      : null
    if (variable === null) {
      throw new Error(
        `resolveCredentials: для провайдера «${providerId}» переменная окружения не объявлена. `
        + 'Имя не выводится по шаблону: неизвестный провайдер — отказ, а не догадка.',
      )
    }
    const raw = ownString(env, variable)
    if (raw === null || raw.trim() === '') {
      throw new Error(
        `resolveCredentials: переменная ${variable} не задана. Незаданная переменная закрывает `
        + 'платный путь, а не открывает его.',
      )
    }
    const secret = raw.trim()
    if (!SECRET_SHAPE.test(secret)) {
      /* Ни значения, ни длины: сообщение одинаково для любого негодного ключа. */
      throw new Error(`resolveCredentials: значение ${variable} не годится как значение заголовка`)
    }
    return `${scheme} ${secret}`
  }
}

const WIRE_CALL_KEYS = Object.freeze([
  'method', 'url', 'headers', 'body', 'timeoutMs', 'maxResponseBytes',
])

/** Фиксированные тексты отказа провода. Чужого содержимого в них нет. */
export const WIRE_FAILURES = Object.freeze({
  deadline: 'провод: срок ожидания операции истёк',
  socket: 'провод: обращение не состоялось',
  tooLarge: 'провод: тело ответа превысило объявленный предел',
})

/**
 * HTTP-обращение с ОДНИМ сроком на всю операцию.
 *
 * Срок покрывает соединение, заголовки И ЧТЕНИЕ ТЕЛА одним таймером: ответ,
 * у которого пришёл статус и не пришло тело, — не «быстрый ответ», а
 * незавершённая операция, и `timeout` сокета её не закрывает. Таймер снимается
 * в `finally` итератора тела, то есть после последнего байта или после обрыва.
 *
 * Потолок байтов применяется здесь ВТОРЫМ рубежом. Первый — в транспорте, он
 * считает те же байты и обрывает чтение раньше; этот нужен на случай, когда
 * предел транспорта окажется мягче, и чтобы соединение закрывалось нами, а не
 * оставалось висеть после отказа.
 *
 * Возвращается объект РОВНО с двумя ключами — `status` и `body`: транспорт
 * проверяет состав ключей и лишнее поле читает как повреждённую форму.
 */
export function createProductionWireClient(input = {}) {
  assertExactKeys(input, ['request'], 'createProductionWireClient: параметры')
  const { request } = input
  if (typeof request !== 'function') {
    throw new TypeError('createProductionWireClient.request: ожидается функция запроса')
  }

  return async function wireClient(call) {
    assertExactKeys(call, WIRE_CALL_KEYS, 'wireClient: вызов')
    const { method, url, headers, body, timeoutMs, maxResponseBytes } = call
    if (typeof method !== 'string' || method === '') throw new TypeError('wireClient.method: ожидается строка')
    if (typeof url !== 'string' || url === '') throw new TypeError('wireClient.url: ожидается строка')
    if (!isPlainObject(headers)) throw new TypeError('wireClient.headers: ожидается объект')
    if (!(body instanceof Uint8Array)) throw new TypeError('wireClient.body: ожидаются байты')
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError('wireClient.timeoutMs: ожидается положительное целое')
    }
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
      throw new TypeError('wireClient.maxResponseBytes: ожидается положительное целое')
    }

    /* Общее состояние срока: его видят и промис заголовков, и итератор тела.
       `expired` — ФЛАГ, а `deadline` — ОЖИДАЕМОЕ СОБЫТИЕ, и нужны оба.
       Флага мало: чтение, которое не отдаёт следующий кусок, до проверки флага
       не доходит вовсе, и срок, закрывающий соединение, не закрывает ожидание.
       Поэтому каждое чтение тела гонится с этим промисом. */
    const clock = { timer: null, expired: false, req: null, res: null, fire: null }
    const deadline = new Promise((_, reject) => { clock.fire = reject })
    /* Отказ появится только если таймер сработает; до тех пор промис никем не
       ожидается, и повиснуть без обработчика ему негде. */
    deadline.catch(() => {})
    const stop = () => {
      clock.expired = true
      try { clock.res?.destroy() } catch { /* закрытие уже закрытого не меняет исход */ }
      try { clock.req?.destroy() } catch { /* то же самое */ }
      clock.fire(new Error(WIRE_FAILURES.deadline))
    }
    clock.timer = setTimeout(stop, timeoutMs)

    /* Закрытие без объявления срока истёкшим: нужно и на успешном выходе. */
    const stopQuietly = () => {
      try { clock.res?.destroy() } catch { /* закрытие уже закрытого ничего не меняет */ }
      try { clock.req?.destroy() } catch { /* то же самое */ }
    }

    /* ОЖИДАНИЕ ЗАГОЛОВКОВ — ПОД ТЕМ ЖЕ СРОКОМ, ЧТО И ТЕЛО.
       Прежняя редакция ждала ответа обычным промисом и рассчитывала, что срок
       закроет соединение, а закрытое соединение испустит `error`. Аудит
       предъявил вход, на котором этого не происходит: клиент принимает запрос,
       не зовёт обработчик ответа, а его `destroy()` ничего не испускает —
       вызов висел вечно. Сроку нельзя зависеть от того, что чужая сторона
       вежливо сообщит о своём закрытии: он гонится с ожиданием напрямую.
       Разрешение и отказ идут через один `done`, поэтому двойного завершения
       не бывает, а `deadline` уже имеет обработчик отказа (см. выше) и
       unhandled rejection не даёт. */
    let response
    try {
      response = await Promise.race([
        new Promise((resolve, reject) => {
          let settled = false
          const done = (fn, value) => { if (!settled) { settled = true; fn(value) } }
          let req
          try {
            req = request(url, { method, headers }, (res) => {
              /* ПОЗДНИЙ ОТВЕТ ПОСЛЕ ИСТЁКШЕГО СРОКА НИЧЕГО НЕ МЕНЯЕТ.
                 Вердикт уже вынесен, и «успели после срока» — не успех: ответ,
                 пришедший позже, вовремя не пришёл. Его надо закрыть, а не
                 разбирать: незакрытый ответ держит соединение до конца
                 процесса. `done` не пускает второе завершение, но полагаться
                 на это одно нельзя — держатель остался бы висеть. */
              if (clock.expired) {
                try { res.destroy() } catch { /* закрытие закрытого ничего не меняет */ }
                return
              }
              clock.res = res
              done(resolve, res)
            })
          } catch {
            done(reject, new Error(WIRE_FAILURES.socket))
            return
          }
          clock.req = req
          req.on('error', () => done(reject, new Error(
            clock.expired ? WIRE_FAILURES.deadline : WIRE_FAILURES.socket,
          )))
          try {
            req.end(body)
          } catch {
            done(reject, new Error(WIRE_FAILURES.socket))
          }
        }),
        deadline,
      ])
    } catch (error) {
      clearTimeout(clock.timer)
      /* Соединение закрывается нами: истёкший срок означает «исход неизвестен»,
         и держать открытым то, чего мы больше не ждём, нельзя. */
      stopQuietly()
      throw error
    }

    const status = response.statusCode
    if (!Number.isSafeInteger(status) || status < 100 || status > 599) {
      clearTimeout(clock.timer)
      stop()
      throw new Error(WIRE_FAILURES.socket)
    }

    /* Тело — ленивый поток под тем же сроком и под потолком байтов. Читает его
       транспорт; здесь только границы. */
    async function* bounded() {
      let total = 0
      const iterator = response[Symbol.asyncIterator]()
      try {
        for (;;) {
          /* Гонка со сроком, а не проверка флага после чтения: чтение, которое
             никогда не вернётся, иначе не закончилось бы никогда. */
          const step = await Promise.race([iterator.next(), deadline])
          if (step.done) break
          const chunk = step.value
          total += chunk.length
          if (total > maxResponseBytes) throw new Error(WIRE_FAILURES.tooLarge)
          yield chunk
        }
        if (clock.expired) throw new Error(WIRE_FAILURES.deadline)
      } finally {
        clearTimeout(clock.timer)
        /* Соединение закрывается НАМИ на любом выходе: предел, после которого
           мы перестали читать, но не перестали держать, пределом не является.
           Ответа отмены не ждём — его пишет чужая сторона. */
        stopQuietly()
      }
    }

    return { status, body: bounded() }
  }
}
