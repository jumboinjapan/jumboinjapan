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
 * `poi-model-pricing`, а профиль связан с таблицей только отпечатком. Двух
 * источников правды о деньгах не существует.
 *
 * Реестр `PROVIDER_PROFILES` заморожен и содержит одну запись — решение
 * владельца от 16 августа 2026. Функции добавления профиля нет: реестр
 * меняется правкой исходника, то есть коммитом владельца.
 *
 * Непустой реестр сам по себе платного пути не открывает. Профиль обязан быть
 * НАЗВАН источником в его `modelProcessing`, разрешение владельца обязано
 * существовать отдельным подписанным файлом, а исполнителя обязан кто-то
 * позвать. Ни одно из трёх на сегодня не выполнено, и проверяет это
 * `tests/poi-model-reachability.mjs`.
 */
import { DIGEST_ALGORITHM, sha256Bytes } from '../../lib/byte-digest.mjs'
/* Форму отпечатка таблицы цен проверяет сам pricing-контракт: он знает свои
   версии, а второй список версий здесь расходился бы с ним молча. */
import { assertPricingDigestShape, MODEL_PRICING_V2_SPEC } from './model-pricing.mjs'
import {
  assertExactKeys,
  assertExactly,
  assertDigestShape,
  assertNoLoneSurrogate,
  calendarExpiryMs,
  calendarPlusDays,
  canonicalJsonBytes,
  deepFreeze,
  isPlainObject,
  isStrictCalendarDate,
} from '../../lib/canonical-contract.mjs'

/** Версия контракта. Входит в хешируемые байты, а не только в подпись рядом. */
export const PROVIDER_PROFILE_SPEC = 'poi-model-provider-profile/v1'

/**
 * Версия контракта, различающая snapshot и наблюдаемый алиас.
 *
 * Зачем понадобилась. В v1 версия модели — строка, про которую проверено
 * только то, что она не содержит слов `latest`, `current`, `stable` и
 * `newest`. Строка `gpt-5.6-luna` эту проверку проходит, и профиль выглядит
 * закреплённым. Он не закреплён: датированного снимка у этой модели в
 * официальном каталоге нет, и провайдер вправе пересобрать веса под тем же
 * именем, ничего никому не сообщив. Проверка, которая молчит, читается как
 * доказательство — а доказательства не было.
 *
 * В v2 это перестаёт быть умолчанием. Профиль ОБЯЗАН назвать, чем является
 * его идентификатор, и если это наблюдаемый алиас — назвать дату наблюдения
 * каталога и срок, после которого наблюдение считается устаревшим.
 */
export const PROVIDER_PROFILE_V2_SPEC = 'poi-model-provider-profile/v2'

/** Обе версии домена. Список закрыт: третья — правка контракта. */
export const PROVIDER_PROFILE_SPECS = Object.freeze([
  PROVIDER_PROFILE_SPEC, PROVIDER_PROFILE_V2_SPEC,
])

/** Точный состав верхнего уровня v1. Двенадцать ключей, ни больше ни меньше. */
export const PROVIDER_PROFILE_KEYS = Object.freeze([
  'contractVersion', 'id', 'version', 'providerId', 'modelId', 'modelVersion',
  'endpoint', 'apiVersion', 'structuredOutput', 'serializer', 'capabilities',
  'pricingTableDigest',
])

/**
 * Состав v2. Тоже двенадцать: `modelVersion` заменён блоком `modelIdentity`.
 *
 * Замена, а не добавление. Оставить рядом голую строку версии значило бы
 * оставить поле, которое читают вместо блока, — и весь смысл блока пропал бы
 * в первом же месте, где кто-то взял привычное имя.
 */
export const PROVIDER_PROFILE_V2_KEYS = Object.freeze([
  'contractVersion', 'id', 'version', 'providerId', 'modelId', 'modelIdentity',
  'endpoint', 'apiVersion', 'structuredOutput', 'serializer', 'capabilities',
  'pricingTableDigest',
])

/** Точный состав блока идентичности модели. */
export const MODEL_IDENTITY_KEYS = Object.freeze([
  'kind', 'modelVersion', 'catalogObservedAt', 'validUntil', 'revisionPolicy',
])

/**
 * Чем является идентификатор модели.
 *
 * `dated-snapshot` — датированный снимок: имя разрешается в одни и те же
 * веса сегодня и через год, потому что дата — часть имени.
 *
 * `observed-alias` — имя без снимка: сегодня оно наблюдалось в каталоге
 * провайдера и указывало на конкретную модель, но провайдер не обязывался
 * оставить его неизменным. Это не плавающий псевдоним вроде `latest`:
 * плавающий меняет смысл по определению, наблюдаемый — может измениться.
 * Разница между «обязательно изменится» и «может измениться» в контракте
 * называется, а не подразумевается.
 */
export const MODEL_IDENTITY_KINDS = Object.freeze(['dated-snapshot', 'observed-alias'])

/**
 * Политика пересмотра — отдельным полем, хотя однозначно следует из вида.
 *
 * Именно поэтому и отдельным: связка двух объявлений ПРОВЕРЯЕТСЯ, а
 * выведенное значение проверить не с чем. Профиль, где вид и политика
 * разошлись, — профиль, который заполняли не думая, и его надо отвергнуть, а
 * не починить.
 */
export const MODEL_REVISION_POLICIES = Object.freeze([
  'immutable', 'provider-may-revise-without-notice',
])

/**
 * Срок годности наблюдения каталога — тридцать календарных суток.
 *
 * Решение владельца. Наблюдение — не свойство модели, а факт о прошлом:
 * «шестнадцатого августа в каталоге было так». Через тридцать суток этот
 * факт перестаёт быть основанием тратить деньги, и профиль обязан
 * заблокировать план до повторной сверки и нового коммита владельца.
 */
export const OBSERVED_ALIAS_VALIDITY_DAYS = 30

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
export const PROVIDER_PROFILES = deepFreeze([
  {
    contractVersion: PROVIDER_PROFILE_V2_SPEC,
    id: 'openai-responses-luna',
    version: '1.0.0',
    providerId: 'openai',
    modelId: 'gpt-5.6-luna',
    /* Датированного снимка у этой модели в официальном каталоге нет. Профиль
       говорит это прямо, а не умалчивает: вид, дата наблюдения, срок и
       политика пересмотра — четыре объявления вместо одной строки, про
       которую раньше было известно только то, что в ней нет слова «latest». */
    modelIdentity: {
      kind: 'observed-alias',
      modelVersion: 'gpt-5.6-luna',
      catalogObservedAt: '2026-08-17',
      validUntil: '2026-09-16',
      revisionPolicy: 'provider-may-revise-without-notice',
    },
    endpoint: 'https://api.openai.com/v1/responses',
    apiVersion: 'v1',
    structuredOutput: { mode: 'json-schema-strict', schemaDialect: 'json-schema-draft-2020-12' },
    /* Сериализатор второй версии, а не первой: только он выражает
       `reasoning.effort` явно. Первая версия оставлена нетронутой и
       продолжает читать прежние журналы. */
    serializer: { id: 'openai-responses', version: '2.0.0' },
    capabilities: {
      /* Официальной документации на заголовок идемпотентности у
         `/v1/responses` нет. Объявить возможность, которой нет в протоколе,
         значило бы отправить выдуманный заголовок в оплаченный запрос. */
      idempotencyKey: { supported: false, header: null, scope: null },
      statusEndpoint: { supported: false, billable: null, path: null },
      /* Партии в этом этапе не используются: один кандидат — один запрос. */
      batch: { supported: false, returnsRequestItemId: null },
    },
    pricingTableDigest: {
      value: 'sha256:90bf1694c3b85ecb248420e26129c910aa09285194597228b95effcde6015f5b',
      algorithm: DIGEST_ALGORITHM,
      spec: MODEL_PRICING_V2_SPEC,
    },
  },
])

/* ── Приватные константы формы ───────────────────────────────────────── */


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

/**
 * Лексическая гигиена НАБЛЮДАЕМОГО идентификатора.
 *
 * Набор проверок тот же, что у `assertPinnedString`, а имя другое — и это
 * не косметика. Разница не в том, что проверяется, а в том, что проверка
 * доказывает. Здесь она отвергает заведомо плавающее имя и не утверждает
 * ничего сверх этого. Закреплённость доказывают вид `dated-snapshot` и дата
 * внутри самого идентификатора, а не отсутствие слова «latest».
 *
 * Раньше `assertPinnedString` вызывался и для такого имени. Он его
 * пропускал, и профиль читался как закреплённый, хотя закрепления не было.
 */
function assertObservedIdentifier(value, where) {
  assertPlainString(value, where)
  assertNotFloating(value, where)
}

/** Дата ГГГГ-ММ-ДД, существующая в календаре. */
function assertCalendarDate(value, where) {
  if (!isStrictCalendarDate(value)) {
    throw new TypeError(
      `${where}: ожидается существующая календарная дата ГГГГ-ММ-ДД, получено ${JSON.stringify(value)}`,
    )
  }
}

/** Дата внутри идентификатора снимка: `…-2026-08-16` и подобное. */
const DATE_INSIDE_ID = /(?:^|[^0-9])(\d{4}-\d{2}-\d{2})(?:[^0-9]|$)/

/**
 * Блок идентичности модели.
 *
 * Две взаимоисключающие ветки, и в каждой ВСЕ поля обязательны — либо
 * заполнены, либо строго `null`. Промежуточного состояния нет: профиль, где
 * у снимка стоит дата наблюдения, читается двумя способами сразу.
 */
function assertModelIdentity(identity, modelId, where) {
  assertExactKeys(identity, MODEL_IDENTITY_KEYS, where)
  assertEnum(identity.kind, MODEL_IDENTITY_KINDS, `${where}.kind`)
  assertEnum(identity.revisionPolicy, MODEL_REVISION_POLICIES, `${where}.revisionPolicy`)

  if (identity.kind === 'dated-snapshot') {
    /* Связка вида и политики проверяется, а не выводится: разошедшиеся
       объявления — признак того, что профиль заполняли не читая. */
    assertExactly(identity.revisionPolicy, 'immutable', `${where}.revisionPolicy`)
    assertPinnedString(identity.modelVersion, `${where}.modelVersion`)
    const found = DATE_INSIDE_ID.exec(identity.modelVersion)
    if (!found || !isStrictCalendarDate(found[1])) {
      throw new TypeError(
        `${where}.modelVersion: вид «dated-snapshot» обязывает нести дату снимка в самом `
        + `идентификаторе, получено ${JSON.stringify(identity.modelVersion)}. `
        + 'Снимок без даты — это алиас, названный снимком.',
      )
    }
    assertExactly(identity.catalogObservedAt, null, `${where}.catalogObservedAt`)
    assertExactly(identity.validUntil, null, `${where}.validUntil`)
    return
  }

  assertExactly(
    identity.revisionPolicy, 'provider-may-revise-without-notice', `${where}.revisionPolicy`,
  )
  assertObservedIdentifier(identity.modelVersion, `${where}.modelVersion`)
  /* У наблюдаемого алиаса версии не существует ОТДЕЛЬНО от имени. Разрешить
     здесь произвольную строку значило бы разрешить выдумать версию — и по
     этой выдумке потом искалась бы строка цены. */
  if (identity.modelVersion !== modelId) {
    throw new TypeError(
      `${where}.modelVersion: у наблюдаемого алиаса версии нет отдельно от имени; `
      + `ожидалось ${JSON.stringify(modelId)}, получено ${JSON.stringify(identity.modelVersion)}`,
    )
  }
  assertCalendarDate(identity.catalogObservedAt, `${where}.catalogObservedAt`)
  assertCalendarDate(identity.validUntil, `${where}.validUntil`)
  const due = calendarPlusDays(identity.catalogObservedAt, OBSERVED_ALIAS_VALIDITY_DAYS)
  if (identity.validUntil !== due) {
    throw new TypeError(
      `${where}.validUntil: срок наблюдения — ровно ${OBSERVED_ALIAS_VALIDITY_DAYS} суток от `
      + `${identity.catalogObservedAt}, то есть ${due}; в профиле ${identity.validUntil}. `
      + 'Срок задаётся решением владельца, а не автором профиля.',
    )
  }
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
     канонизация уже отвергает всё перечисленное на любой глубине.
     Она же идёт ДО чтения `contractVersion`: accessor-свойство прочиталось бы
     как обычное значение и выбрало бы версию, под которой его не объявляли.
     Байты этого прохода отбрасываются — нужен только отказ. */
  canonicalJsonBytes(profile, PROVIDER_PROFILE_SPEC)
  const spec = profileContractSpec(profile)
  const v2 = spec === PROVIDER_PROFILE_V2_SPEC

  assertExactKeys(profile, v2 ? PROVIDER_PROFILE_V2_KEYS : PROVIDER_PROFILE_KEYS, spec)
  assertKebabId(profile.id, 'id')
  assertExactSemver(profile.version, 'version')
  assertKebabId(profile.providerId, 'providerId')
  assertPinnedString(profile.modelId, 'modelId')
  if (v2) assertModelIdentity(profile.modelIdentity, profile.modelId, 'modelIdentity')
  /* v1 не различает снимок и алиас: строка проходит лексику и объявляется
     закреплённой. Здесь это оставлено КАК ЕСТЬ намеренно — v1 сохраняется,
     чтобы читать прежние артефакты, а не чтобы строить по нему новые планы.
     Запрет на новый план даёт `assertProfileIdentityFresh`. */
  else assertPinnedString(profile.modelVersion, 'modelVersion')
  const endpointUrl = assertCanonicalHttpsEndpoint(profile.endpoint, 'endpoint')
  assertPinnedString(profile.apiVersion, 'apiVersion')
  assertStructuredOutput(profile.structuredOutput, 'structuredOutput')
  assertSerializer(profile.serializer, 'serializer')
  assertCapabilities(profile.capabilities, endpointUrl, 'capabilities')
  /* Версию таблицы цен по отпечатку не узнать, поэтому здесь допускаются оба
     домена, а к КОНКРЕТНОЙ таблице профиль привязывает сверка значений в
     `assertPricingBinding`. */
  assertPricingDigestShape(profile.pricingTableDigest, 'pricingTableDigest')
}

/**
 * Версия модели для поиска строки цены.
 *
 * У v1 это поле верхнего уровня, у v2 — поле блока идентичности. Один
 * доступ на весь проект: два места, читающие версию по-своему, разошлись бы
 * молча — и разошлись бы на строке цены, то есть на деньгах. Обращение к
 * `profile.modelVersion` напрямую у профиля v2 даёт `undefined`, и поиск
 * цены превратился бы в поиск по несуществующему ключу.
 */
export function profileModelVersion(profile) {
  const spec = profileContractSpec(profile)
  return spec === PROVIDER_PROFILE_V2_SPEC
    ? profile.modelIdentity?.modelVersion
    : profile.modelVersion
}

/**
 * Версия контракта профиля. Единственное место, где строка сверяется со
 * списком: вторая такая сверка разошлась бы с первой молча.
 */
export function profileContractSpec(profile) {
  if (!isPlainObject(profile)) {
    throw new TypeError(`${PROVIDER_PROFILE_SPEC}: профиль обязан быть простым объектом`)
  }
  const spec = profile.contractVersion
  if (!PROVIDER_PROFILE_SPECS.includes(spec)) {
    throw new TypeError(
      `contractVersion: ожидается одно из ${PROVIDER_PROFILE_SPECS.join(', ')}; `
      + `получено ${JSON.stringify(spec)}`,
    )
  }
  return spec
}

/**
 * Форма отпечатка профиля у потребителя, который самого профиля не видит.
 *
 * Артефакт несёт отпечаток, а не профиль, и версию контракта по отпечатку не
 * восстановить. Допускаются оба домена; какой именно профиль имелся в виду,
 * доказывает совпадение значения, а не ярлык рядом с ним.
 */
export function assertProfileDigestShape(value, where) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${where}: отпечаток профиля обязан быть простым объектом`)
  }
  assertExactKeys(value, ['value', 'algorithm', 'spec'], where)
  if (!PROVIDER_PROFILE_SPECS.includes(value.spec)) {
    throw new TypeError(
      `${where}.spec: ожидается одно из ${PROVIDER_PROFILE_SPECS.join(', ')}; `
      + `получено ${JSON.stringify(value.spec)}`,
    )
  }
  assertDigestShape(value, value.spec, where)
}

/** Отказ по идентичности модели. Машинный код, а не разбор текста. */
export class ProfileIdentityError extends Error {
  constructor(code, message) {
    super(message)
    if (!PROFILE_IDENTITY_CODE_VALUES.includes(code)) {
      throw new TypeError(
        `ProfileIdentityError: код ${JSON.stringify(code)} не из закрытого списка `
        + `${PROFILE_IDENTITY_CODE_VALUES.join(', ')}`,
      )
    }
    this.name = 'ProfileIdentityError'
    this.code = code
  }
}

/** Коды отказа. Список закрыт исполняемо, а не фразой в комментарии. */
export const PROFILE_IDENTITY_CODES = Object.freeze({
  expired: 'profileIdentityExpired',
  unversioned: 'profileIdentityUnversioned',
})
const PROFILE_IDENTITY_CODE_VALUES = Object.freeze(Object.values(PROFILE_IDENTITY_CODES))

/**
 * Годность профиля для НОВОГО плана.
 *
 * Два отказа, оба fail-closed.
 *
 * Профиль v1 отвергается целиком. Он не объявляет, снимок у него или алиас, и
 * потому не может доказать ни того ни другого. Парсер v1 сохранён — им
 * читают прежние артефакты, где профиль уже зафиксирован и переспрашивать
 * поздно. Строить по нему новый оплачиваемый план — другое дело: там выбор
 * ещё есть, и делать его молча нельзя.
 *
 * Наблюдение каталога отвергается по истечении срока. Наблюдение — факт о
 * прошлом, а не свойство модели: «в этот день в каталоге было так». Через
 * тридцать суток оно перестаёт быть основанием тратить деньги, и разблокирует
 * его повторная сверка с новым коммитом владельца, а не наступление
 * следующего дня.
 *
 * Момент истечения — начало следующих суток по Asia/Tokyo, тем же расчётом,
 * которым истекает срок policy источника. Расчёт в проекте один.
 */
export function assertProfileIdentityFresh(profile, { now } = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('assertProfileIdentityFresh: now обязателен и должен быть корректной датой')
  }
  assertProviderProfileShape(profile)
  if (profileContractSpec(profile) !== PROVIDER_PROFILE_V2_SPEC) {
    throw new ProfileIdentityError(
      PROFILE_IDENTITY_CODES.unversioned,
      `профиль ${profile.id}@${profile.version} объявлен по ${profile.contractVersion}: `
      + 'эта версия не различает датированный снимок и наблюдаемый алиас, поэтому доказать '
      + `неизменяемость модели ей нечем. Новый план требует ${PROVIDER_PROFILE_V2_SPEC}.`,
    )
  }
  const identity = profile.modelIdentity
  if (identity.kind === 'dated-snapshot') return
  if (now.getTime() >= calendarExpiryMs(identity.validUntil)) {
    throw new ProfileIdentityError(
      PROFILE_IDENTITY_CODES.expired,
      `наблюдение каталога от ${identity.catalogObservedAt} действовало по ${identity.validUntil} `
      + `включительно и истекло. Модель ${profile.modelId} — наблюдаемый алиас без датированного `
      + 'снимка: провайдер вправе пересобрать её под тем же именем. Требуется повторная сверка '
      + 'каталога и новый коммит владельца.',
    )
  }
}

/**
 * Отпечаток профиля целиком.
 *
 * Проверку формы вызывает сам: обещание вызывающего «я уже проверил»
 * доказательством не является, а хеш непроверенного объекта — подпись под
 * тем, чего никто не читал.
 *
 * Поток байтов: `UTF8(домен) || 0x0A || канонический JSON профиля`.
 * Хешируется весь профиль, включая serializer, capabilities,
 * pricingTableDigest и — у v2 — весь блок `modelIdentity`. Отсюда прямое
 * следствие, ради которого блок и введён: правка даты наблюдения каталога
 * или вида идентификатора меняет отпечаток профиля, а значит и подпись плана.
 * Продлить срок молча нечем.
 *
 * Домен — собственная версия профиля, а не константа v1. Отпечатки прежних
 * профилей от этого не меняются: у них `contractVersion` и есть v1.
 */
export function providerProfileDigest(profile) {
  assertProviderProfileShape(profile)
  return sha256Bytes(canonicalJsonBytes(profile, profileContractSpec(profile)))
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
      `Профиль ${id}@${version} не объявлен: в каноническом реестре ${PROVIDER_PROFILES.length} `
      + `${PROVIDER_PROFILES.length === 1 ? 'запись' : 'записей'}, и эта не из них.`
      + (PROVIDER_PROFILES.length ? '' : ' Реестр пуст: разрешённого провайдера не существует.'),
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
