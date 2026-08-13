/**
 * Контракт профиля модельного провайдера, `poi-model-provider-profile/v1`.
 *
 * Профиль — идентичность того, КОМУ и КУДА уйдёт оплаченный запрос: вендор,
 * модель с точной версией, адрес, версия API, механизм структурированного
 * вывода, версия сериализатора, объявленные возможности и отпечаток таблицы
 * цен. Всё это входит в подпись: смена любого из перечисленного меняет
 * стоимость или поведение прогона и обязана менять `providerProfileDigest`.
 *
 * Чего здесь нет и не будет. Секретов: ключей, токенов, значений заголовков
 * аутентификации — для них в контракте не предусмотрено поля, и положить их
 * некуда. Учётные данные берутся из окружения в момент запроса, в артефакт
 * не попадают и не хешируются. Нет и цен: их канонический источник —
 * будущий `poi-model-pricing/v1`, а профиль связан с таблицей только
 * отпечатком. Двух источников правды о деньгах не существует.
 *
 * Реестр `PROVIDER_PROFILES` пуст и заморожен. Функции добавления профиля
 * нет: реестр меняется правкой исходника, то есть коммитом владельца.
 * Пока он пуст, `resolveProviderProfile` отказывает на любой паре, и
 * production-путь до транспорта не доходит.
 */
import { sha256Bytes } from '../../lib/byte-digest.mjs'
import {
  assertExactKeys,
  assertExactly,
  assertDigestShape,
  assertNoLoneSurrogate,
  canonicalJsonBytes,
  deepFreeze,
  isPlainObject,
} from '../../lib/canonical-contract.mjs'

/** Версия контракта. Входит в хешируемые байты, а не только в подпись рядом. */
export const PROVIDER_PROFILE_SPEC = 'poi-model-provider-profile/v1'

/** Точный состав верхнего уровня. Двенадцать ключей, ни больше ни меньше. */
export const PROVIDER_PROFILE_KEYS = Object.freeze([
  'contractVersion', 'id', 'version', 'providerId', 'modelId', 'modelVersion',
  'endpoint', 'apiVersion', 'structuredOutput', 'serializer', 'capabilities',
  'pricingTableDigest',
])

/**
 * Механизм структурированного вывода у провайдера.
 *
 * `json-schema-strict` — провайдер сам отвергает ответ вне схемы;
 * `json-schema-lenient` — схема передана, но не принуждается;
 * `native-schema` — собственный механизм провайдера.
 *
 * На нашу сторону это не влияет: авторитетом остаётся `validateProposal`,
 * который ничего не чинит. Режим записан, чтобы различие между «провайдер
 * проверил» и «провайдер не проверял» было наблюдаемо, а не подразумевалось.
 */
export const STRUCTURED_OUTPUT_MODES = Object.freeze([
  'json-schema-strict', 'json-schema-lenient', 'native-schema',
])

/** Диалект схемы. Один: другой потребует новой версии контракта. */
export const SCHEMA_DIALECTS = Object.freeze(['json-schema-draft-2020-12'])

/** Область действия ключа идемпотентности. */
export const IDEMPOTENCY_SCOPES = Object.freeze(['request', 'batch'])

/**
 * Канонический реестр профилей.
 *
 * Глубокая заморозка, а не `Object.freeze`: она мелкая и оставила бы живыми
 * будущие вложенные профили. Пустой массив замораживается тем же вызовом,
 * что и непустой, поэтому правило не появится задним числом вместе с первым
 * элементом.
 */
export const PROVIDER_PROFILES = deepFreeze([])

/* ── Приватные константы формы ───────────────────────────────────────── */

/**
 * Спецификация таблицы цен.
 *
 * Временно живёт здесь: модуля `poi-model-pricing/v1` ещё нет. Когда он
 * появится (коммит с execution-cost), константа переезжает туда и
 * импортируется сюда — второго литерала быть не должно.
 */
const PRICING_TABLE_SPEC = 'poi-model-pricing/v1'

const STRUCTURED_OUTPUT_KEYS = Object.freeze(['mode', 'schemaDialect'])
const SERIALIZER_KEYS = Object.freeze(['id', 'version'])
const CAPABILITY_KEYS = Object.freeze(['idempotencyKey', 'statusEndpoint', 'batch'])
const IDEMPOTENCY_KEYS = Object.freeze(['supported', 'header', 'scope'])
const STATUS_ENDPOINT_KEYS = Object.freeze(['supported', 'billable', 'path'])
const BATCH_KEYS = Object.freeze(['supported', 'returnsRequestItemId'])

/** Идентификатор: строчный kebab, начинается с буквы или цифры. */
const KEBAB_ID = /^[a-z0-9][a-z0-9-]{1,63}$/
/** Версия: ровно три числа. Диапазонов и суффиксов нет. */
const EXACT_SEMVER = /^\d+\.\d+\.\d+$/
/**
 * Управляющие символы: C0, DEL и C1.
 *
 * C1 (`\u0080`–`\u009f`) включён намеренно: U+0085 NEL и U+009F APC
 * невидимы, но меняют байты и поведение разбора у принимающей стороны.
 * Диапазон без них пропустил бы строку, которая выглядит чистой.
 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/
/** Токен HTTP-заголовка по RFC 7230, уже приведённый к нижнему регистру. */
const HTTP_TOKEN_LOWER = /^[a-z0-9!#$%&'*+\-.^_`|~]+$/

/**
 * Незарезервированные ASCII по RFC 3986. Кодировать их запрещено: `%7E` и
 * `~` — одни и те же байты после раскодирования, но разные строки и разные
 * подписи.
 */
const UNRESERVED_ASCII = /^[A-Za-z0-9\-._~]$/

/**
 * Символы, допустимые в пути буквально: незарезервированные, sub-delims,
 * `:` `@` и разделитель сегментов. Всё остальное — включая пробел и любой
 * не-ASCII — обязано быть записано процентной тройкой, иначе у одних и тех
 * же байтов появляется второе написание.
 */
const PATH_LITERAL = /^[A-Za-z0-9\-._~!$&'()*+,;=:@/]$/

/**
 * Каноническое процентное кодирование пути. Одно правило на `endpoint` и на
 * `statusEndpoint.path`: оба участвуют в подписи, и оба обязаны иметь ровно
 * одно написание.
 *
 * `new URL()` этого не даёт: `%7e`, `%7E` и `~` она сохраняет как есть, и
 * три разных строки описывают один и тот же ресурс — а `providerProfileDigest`
 * у них получается разный.
 */
function assertCanonicalPercentEncoding(value, where, { structural = false } = {}) {
  /* Шаг 1 — лексика: тройки полные, в верхнем регистре, незарезервированные
     не закодированы, литеральные символы из разрешённого набора. Попутно
     собираются байты: разбирать строку второй раз незачем. */
  const bytes = []
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]
    if (char === '%') {
      const triplet = value.slice(i + 1, i + 3)
      if (!/^[0-9A-Fa-f]{2}$/.test(triplet)) {
        throw new TypeError(`${where}: «%» в позиции ${i} не начинает полную шестнадцатеричную пару`)
      }
      if (!/^[0-9A-F]{2}$/.test(triplet)) {
        throw new TypeError(
          `${where}: процентная тройка «%${triplet}» обязана быть в верхнем регистре`,
        )
      }
      const byte = parseInt(triplet, 16)
      if (byte < 0x80 && UNRESERVED_ASCII.test(String.fromCharCode(byte))) {
        throw new TypeError(
          `${where}: «%${triplet}» кодирует незарезервированный «${String.fromCharCode(byte)}» — `
          + 'его пишут буквально',
        )
      }
      bytes.push(byte)
      i += 2
      continue
    }
    if (!PATH_LITERAL.test(char)) {
      throw new TypeError(
        `${where}: символ в позиции ${i} обязан быть записан процентной тройкой, а не буквально`,
      )
    }
    bytes.push(char.charCodeAt(0))
  }

  /* Шаг 2 — что означают собранные байты.
     Одной лексики мало: `%00`, `%09`, `%7F`, `%C2%85` — синтаксически
     безупречные тройки, а декодируются в управляющие символы; `%FF` вообще
     не UTF-8. Проверять надо смысл, а не написание. */
  let decoded
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes))
  } catch {
    throw new TypeError(
      `${where}: процентные тройки не складываются в корректный UTF-8. Замены символом-заменителем `
      + 'здесь нет: она сделала бы из двух разных входов один.',
    )
  }
  if (CONTROL_CHARS.test(decoded)) {
    throw new TypeError(`${where}: процентная тройка кодирует управляющий символ`)
  }
  if (/\s/.test(decoded)) {
    throw new TypeError(`${where}: процентная тройка кодирует пробельный символ`)
  }

  /* Шаг 3 — структура пути на ДЕКОДИРОВАННОМ значении.
     `%2F%2F`, `%5C`, `%3F`, `%23` проходят все проверки выше и означают
     ровно то, что запрещено буквально. Запрет, снимаемый кодированием, —
     не запрет. Для `endpoint` шаг не нужен: query и fragment там отсекает
     разбор URL, а путь целиком сверяется с каноническим видом. */
  if (structural) assertPathStructure(decoded, `${where} (после раскодирования)`)
}

/**
 * Плавающие псевдонимы версий. Закрытый список: он может только вырасти, и
 * рост — правка контракта, а не догадка на месте.
 *
 * Причина запрета: подпись профиля обязана однозначно разрешаться в одну
 * модель. `latest` завтра означает другое, а digest остаётся прежним — то
 * есть подпись перестаёт отвечать на вопрос, ради которого считается.
 */
const FLOATING_ALIASES = Object.freeze(['latest', 'current', 'stable', 'newest'])
const WILDCARD_CHARS = Object.freeze(['*', '?'])

/**
 * Заголовки, которые нельзя назначить ключом идемпотентности.
 *
 * Первые четыре несут учётные данные и попали бы в подписанный дескриптор
 * запроса; остальные принадлежат самому транспорту, и подмена их прикладным
 * значением ломает разбор сообщения.
 */
const FORBIDDEN_HEADERS = Object.freeze([
  'authorization', 'proxy-authorization', 'cookie', 'set-cookie',
  'host', 'content-length', 'transfer-encoding', 'connection',
])

/* ── Приватные проверки ──────────────────────────────────────────────── */

/**
 * Строка, безопасная для подписи и для отправки.
 *
 * Окружающие пробелы запрещены, а не обрезаются: обрезка — молчаливая
 * нормализация, после которой два разных входа дают одни байты.
 */
function assertPlainString(value, where) {
  if (typeof value !== 'string' || !value.length) {
    throw new TypeError(`${where}: ожидается непустая строка, получено ${JSON.stringify(value)}`)
  }
  assertNoLoneSurrogate(value, where)
  if (CONTROL_CHARS.test(value)) {
    throw new TypeError(`${where}: управляющие символы не допускаются`)
  }
  if (value !== value.trim()) {
    throw new TypeError(`${where}: окружающие пробелы не обрезаются, а отвергаются — ${JSON.stringify(value)}`)
  }
}

/** Версия обязана разрешаться в одно значение сегодня и через год. */
function assertNotFloating(value, where) {
  const lowered = value.toLowerCase()
  const alias = FLOATING_ALIASES.find((name) => lowered.includes(name))
  if (alias) {
    throw new TypeError(
      `${where}: плавающий псевдоним «${alias}» запрещён — подпись профиля обязана разрешаться в одну версию`,
    )
  }
  const wildcard = WILDCARD_CHARS.find((char) => value.includes(char))
  if (wildcard) {
    throw new TypeError(`${where}: подстановочный знак «${wildcard}» запрещён`)
  }
}

function assertPinnedString(value, where) {
  assertPlainString(value, where)
  assertNotFloating(value, where)
}

function assertKebabId(value, where) {
  assertPlainString(value, where)
  if (!KEBAB_ID.test(value)) {
    throw new TypeError(`${where}: ожидается строчный идентификатор вида «example-provider», получено ${JSON.stringify(value)}`)
  }
}

function assertExactSemver(value, where) {
  assertPlainString(value, where)
  assertNotFloating(value, where)
  if (!EXACT_SEMVER.test(value)) {
    throw new TypeError(`${where}: ожидается точная версия вида 1.0.0, получено ${JSON.stringify(value)}`)
  }
}

function assertEnum(value, allowed, where) {
  assertPlainString(value, where)
  if (!allowed.includes(value)) {
    throw new TypeError(`${where}: ожидается одно из ${allowed.join(', ')}; получено ${JSON.stringify(value)}`)
  }
}

/**
 * Канонический абсолютный HTTPS-адрес.
 *
 * Ключевое правило — последнее: канонический вид, собранный обратно из
 * разобранного URL, обязан совпасть с исходной строкой. Оно закрывает всё,
 * что `URL` молча исправляет: регистр хоста, порт по умолчанию, точечные
 * сегменты, различия процентного кодирования. Без него две записи одного
 * адреса дали бы два разных digest при одном смысле — или, хуже, один digest
 * при разном.
 *
 * Допустимы ровно две формы: origin без пути и origin с путём без
 * завершающего слэша.
 */
function assertCanonicalHttpsEndpoint(value, where) {
  assertPlainString(value, where)
  let url
  try {
    url = new URL(value)
  } catch {
    throw new TypeError(`${where}: не разбирается как абсолютный URL — ${JSON.stringify(value)}`)
  }
  if (url.protocol !== 'https:') {
    throw new TypeError(`${where}: допустим только https, получено ${JSON.stringify(url.protocol)}`)
  }
  if (url.username || url.password) {
    throw new TypeError(`${where}: учётные данные в адресе запрещены`)
  }
  if (url.search) throw new TypeError(`${where}: строка запроса в адресе запрещена`)
  if (url.hash) throw new TypeError(`${where}: фрагмент в адресе запрещён`)
  /* DNS различает `example.com` и `example.com.` как запись, но обращается по
     ним в одно место. Два написания одного хоста дали бы две подписи. */
  if (url.hostname.endsWith('.')) {
    throw new TypeError(`${where}: имя хоста с завершающей точкой запрещено`)
  }
  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    throw new TypeError(`${where}: завершающий «/» у непустого пути запрещён`)
  }
  if (url.pathname !== '/') assertCanonicalPercentEncoding(url.pathname, `${where} (путь)`)
  const canonical = url.pathname === '/' ? url.origin : `${url.origin}${url.pathname}`
  if (canonical !== value) {
    throw new TypeError(
      `${where}: адрес не в каноническом виде. Ожидалось ${JSON.stringify(canonical)}, получено ${JSON.stringify(value)}. `
      + 'Приведение здесь не выполняется: молчаливая нормализация дала бы одну подпись двум разным записям.',
    )
  }
  return url
}

/**
 * Путь статусного эндпоинта.
 *
 * Разрешается относительно origin адреса и обязан оставить origin прежним.
 *
 * Последняя проверка НАМЕРЕННО избыточна и сейчас недостижима: всякий вход,
 * способный сменить origin, отвергается текстовыми правилами выше
 * (`//`, обратный слэш, точечные сегменты, управляющие символы). Мутация
 * «снять сверку origin» набор не роняет, и это сказано вслух, а не скрыто.
 * Класс, который она закрывает, — ослабление любого из текстовых правил в
 * будущем: тогда она останется единственной, кто заметит смену хоста.
 */
/**
 * Структурные запреты пути. Вынесены отдельно, потому что применяются
 * ДВАЖДЫ: к написанному пути и к его раскодированному значению. Запрет,
 * который снимается процентным кодированием, запретом не является.
 */
function assertPathStructure(value, where) {
  if (!value.startsWith('/')) {
    throw new TypeError(`${where}: путь обязан начинаться с «/», получено ${JSON.stringify(value)}`)
  }
  if (value.startsWith('//')) {
    throw new TypeError(`${where}: «//» в начале — протокольно-относительный адрес, а не путь`)
  }
  if (value.includes('//')) throw new TypeError(`${where}: пустой сегмент «//» запрещён`)
  if (value.includes('?')) throw new TypeError(`${where}: строка запроса в пути запрещена`)
  if (value.includes('#')) throw new TypeError(`${where}: фрагмент в пути запрещён`)
  if (value.includes('\\')) throw new TypeError(`${where}: обратный слэш в пути запрещён`)
  for (const segment of value.split('/')) {
    if (segment === '.' || segment === '..') {
      throw new TypeError(`${where}: точечный сегмент «${segment}» запрещён`)
    }
  }
}

function assertStatusPath(value, endpointUrl, where) {
  assertPlainString(value, where)
  assertPathStructure(value, where)
  if (/%2e/i.test(value)) {
    throw new TypeError(`${where}: процентно-кодированная точка запрещена — это скрытый точечный сегмент`)
  }
  assertCanonicalPercentEncoding(value, where, { structural: true })
  const resolved = new URL(value, endpointUrl.origin)
  if (resolved.origin !== endpointUrl.origin) {
    throw new TypeError(
      `${where}: разрешение относительно ${endpointUrl.origin} меняет origin на ${resolved.origin}`,
    )
  }
}

function assertIdempotencyHeader(value, where) {
  assertPlainString(value, where)
  if (!HTTP_TOKEN_LOWER.test(value)) {
    throw new TypeError(
      `${where}: ожидается токен заголовка в нижнем регистре, получено ${JSON.stringify(value)}`,
    )
  }
  if (FORBIDDEN_HEADERS.includes(value)) {
    throw new TypeError(
      `${where}: заголовок «${value}» нельзя использовать как ключ идемпотентности — `
      + 'он несёт учётные данные либо принадлежит самому транспорту',
    )
  }
}

/**
 * Связка «объявлено — заполнено».
 *
 * Возможность либо не объявлена, и тогда её параметры строго `null`, либо
 * объявлена, и тогда заполнены все. Промежуточного состояния нет: профиль,
 * где `supported: false` соседствует с заполненным заголовком, читается
 * двумя способами сразу.
 */
function assertSupportedCoupling(block, keys, where) {
  if (typeof block.supported !== 'boolean') {
    throw new TypeError(`${where}.supported: ожидается boolean, получено ${typeof block.supported}`)
  }
  if (block.supported === false) {
    for (const key of keys) assertExactly(block[key], null, `${where}.${key}`)
  }
  return block.supported
}

function assertStructuredOutput(value, where) {
  assertExactKeys(value, STRUCTURED_OUTPUT_KEYS, where)
  assertEnum(value.mode, STRUCTURED_OUTPUT_MODES, `${where}.mode`)
  assertEnum(value.schemaDialect, SCHEMA_DIALECTS, `${where}.schemaDialect`)
}

function assertSerializer(value, where) {
  assertExactKeys(value, SERIALIZER_KEYS, where)
  assertKebabId(value.id, `${where}.id`)
  assertExactSemver(value.version, `${where}.version`)
}

function assertCapabilities(value, endpointUrl, where) {
  assertExactKeys(value, CAPABILITY_KEYS, where)

  const idem = value.idempotencyKey
  assertExactKeys(idem, IDEMPOTENCY_KEYS, `${where}.idempotencyKey`)
  if (assertSupportedCoupling(idem, ['header', 'scope'], `${where}.idempotencyKey`)) {
    assertIdempotencyHeader(idem.header, `${where}.idempotencyKey.header`)
    assertEnum(idem.scope, IDEMPOTENCY_SCOPES, `${where}.idempotencyKey.scope`)
  }

  const status = value.statusEndpoint
  assertExactKeys(status, STATUS_ENDPOINT_KEYS, `${where}.statusEndpoint`)
  if (assertSupportedCoupling(status, ['billable', 'path'], `${where}.statusEndpoint`)) {
    if (typeof status.billable !== 'boolean') {
      throw new TypeError(`${where}.statusEndpoint.billable: ожидается boolean, получено ${typeof status.billable}`)
    }
    assertStatusPath(status.path, endpointUrl, `${where}.statusEndpoint.path`)
  }

  const batch = value.batch
  assertExactKeys(batch, BATCH_KEYS, `${where}.batch`)
  if (assertSupportedCoupling(batch, ['returnsRequestItemId'], `${where}.batch`)) {
    if (typeof batch.returnsRequestItemId !== 'boolean') {
      throw new TypeError(
        `${where}.batch.returnsRequestItemId: ожидается boolean, получено ${typeof batch.returnsRequestItemId}`,
      )
    }
  }
}

/* ── Публичная граница ───────────────────────────────────────────────── */

/**
 * Строгая проверка формы профиля.
 *
 * Символьные, неперечисляемые и accessor-свойства, чужие прототипы,
 * разрежённые массивы, одиночные суррогаты и лишние ключи отвергаются на
 * всей глубине: сначала канонизацией, затем поимённой сверкой состава.
 */
export function assertProviderProfileShape(profile) {
  if (!isPlainObject(profile)) {
    throw new TypeError(`${PROVIDER_PROFILE_SPEC}: профиль обязан быть простым объектом`)
  }
  /* Структурная строгость не переписывается здесь вторым списком правил:
     канонизация уже отвергает всё перечисленное на любой глубине. */
  canonicalJsonBytes(profile, PROVIDER_PROFILE_SPEC)

  assertExactKeys(profile, PROVIDER_PROFILE_KEYS, PROVIDER_PROFILE_SPEC)
  assertExactly(profile.contractVersion, PROVIDER_PROFILE_SPEC, 'contractVersion')
  assertKebabId(profile.id, 'id')
  assertExactSemver(profile.version, 'version')
  assertKebabId(profile.providerId, 'providerId')
  assertPinnedString(profile.modelId, 'modelId')
  assertPinnedString(profile.modelVersion, 'modelVersion')
  const endpointUrl = assertCanonicalHttpsEndpoint(profile.endpoint, 'endpoint')
  assertPinnedString(profile.apiVersion, 'apiVersion')
  assertStructuredOutput(profile.structuredOutput, 'structuredOutput')
  assertSerializer(profile.serializer, 'serializer')
  assertCapabilities(profile.capabilities, endpointUrl, 'capabilities')
  assertDigestShape(profile.pricingTableDigest, PRICING_TABLE_SPEC, 'pricingTableDigest')
}

/**
 * Отпечаток профиля целиком.
 *
 * Проверку формы вызывает сам: обещание вызывающего «я уже проверил»
 * доказательством не является, а хеш непроверенного объекта — подпись под
 * тем, чего никто не читал.
 *
 * Поток байтов: `UTF8(домен) || 0x0A || канонический JSON профиля`.
 * Хешируется весь профиль, включая serializer, capabilities и
 * pricingTableDigest.
 */
export function providerProfileDigest(profile) {
  assertProviderProfileShape(profile)
  return sha256Bytes(canonicalJsonBytes(profile, PROVIDER_PROFILE_SPEC))
}

/**
 * Разрешение профиля по каноническому реестру.
 *
 * Ровно два аргумента и ни одного канала подмены: ни `profiles`, ни
 * `options`, ни `registry`. Реестр здесь один, и он не параметр.
 *
 * Отсутствие и неоднозначность — отказ, а не `null`: «профиль не найден»,
 * молча превращённое в отсутствие значения, ниже по течению читается как
 * «профиля не требовалось».
 */
export function resolveProviderProfile(id, version) {
  if (arguments.length !== 2) {
    throw new TypeError(
      `resolveProviderProfile: ровно два аргумента — id и version; получено ${arguments.length}. `
      + 'Канала подстановки реестра нет и не предусмотрено.',
    )
  }
  assertKebabId(id, 'resolveProviderProfile.id')
  assertExactSemver(version, 'resolveProviderProfile.version')

  const found = PROVIDER_PROFILES.filter(
    (profile) => profile?.id === id && profile?.version === version,
  )
  if (!found.length) {
    throw new Error(
      `Профиль ${id}@${version} не объявлен: в каноническом реестре ${PROVIDER_PROFILES.length} записей.`
      + (PROVIDER_PROFILES.length ? '' : ' Пока реестр пуст, разрешённого провайдера не существует.'),
    )
  }
  if (found.length > 1) {
    throw new Error(`Профиль ${id}@${version} объявлен ${found.length} раза — реестр неоднозначен`)
  }
  /* Возвращается только строго проверенный профиль: реестр — исходный код,
     а исходный код тоже правят руками и тоже ошибаются. */
  assertProviderProfileShape(found[0])
  return found[0]
}
