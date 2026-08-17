/**
 * Контракт профиля модельного провайдера, v1 и v2.
 *
 * Что проверяется здесь и нигде больше: строгая форма профиля на всей
 * глубине, безопасность транспортных полей, связки «объявлено — заполнено»,
 * подпись профиля и канонический разрешатель.
 *
 * Чего здесь нет намеренно: сети, денег и любого артефакта прогона.
 * `VALID` — ФИКСТУРА ФОРМЫ v1, а не объявленный профиль: она доказывает, что
 * парсер прежней версии сохранён и продолжает читать прежние артефакты.
 * «Форма верна» и «профилем можно платить» — разные утверждения, и второе
 * фикстурой не делается: для нового плана v1 отвергается отдельной границей.
 *
 * В реестре с коммита 10a одна запись — владельческий профиль `gpt-5.6-luna`.
 * Проверяется поэтому не пустота реестра, а его ТОЧНЫЙ состав.
 */
import { PROVIDER_PROFILES as VIA_MODEL_PLAN } from '../scripts/poi-portals/lib/model-plan.mjs'
import * as PROFILE_MODULE from '../scripts/poi-portals/lib/provider-profile.mjs'
import { canonicalJsonBytes } from '../scripts/lib/canonical-contract.mjs'
import {
  assertProfileIdentityFresh,
  assertProviderProfileShape,
  IDEMPOTENCY_SCOPES,
  MODEL_IDENTITY_KEYS,
  MODEL_IDENTITY_KINDS,
  MODEL_REVISION_POLICIES,
  OBSERVED_ALIAS_VALIDITY_DAYS,
  PROFILE_IDENTITY_CODES,
  profileContractSpec,
  profileModelVersion,
  providerProfileDigest,
  PROVIDER_PROFILE_KEYS,
  PROVIDER_PROFILE_SPEC,
  PROVIDER_PROFILE_SPECS,
  PROVIDER_PROFILE_V2_KEYS,
  PROVIDER_PROFILE_V2_SPEC,
  PROVIDER_PROFILES,
  resolveProviderProfile,
  SCHEMA_DIALECTS,
  STRUCTURED_OUTPUT_MODES,
} from '../scripts/poi-portals/lib/provider-profile.mjs'
import { PRICING_TABLES } from '../scripts/poi-portals/lib/model-pricing.mjs'
import { SERIALIZER_DESCRIPTORS } from '../scripts/poi-portals/lib/model-serializers.mjs'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const boom = (fn) => { try { fn(); return '(без ошибки)' } catch (e) { return e.message } }

/* Валидный профиль держится внутри набора: внешний файл-фикстура выглядел бы
   как объявленный профиль, а объявленных профилей в этом коммите нет. */
const VALID = Object.freeze({
  contractVersion: 'poi-model-provider-profile/v1',
  id: 'example-profile',
  version: '1.0.0',
  providerId: 'example-provider',
  modelId: 'example-model',
  modelVersion: '2026-08-01',
  endpoint: 'https://api.example.com/v1/messages',
  apiVersion: '2026-08-01',
  structuredOutput: { mode: 'json-schema-strict', schemaDialect: 'json-schema-draft-2020-12' },
  serializer: { id: 'node-json', version: '1.0.0' },
  capabilities: {
    idempotencyKey: { supported: true, header: 'idempotency-key', scope: 'request' },
    statusEndpoint: { supported: true, billable: false, path: '/v1/messages/status' },
    batch: { supported: false, returnsRequestItemId: null },
  },
  pricingTableDigest: {
    value: `sha256:${'0'.repeat(64)}`, algorithm: 'sha256', spec: 'poi-model-pricing/v1',
  },
})

const clone = () => JSON.parse(JSON.stringify(VALID))
const at = (obj, path) => path.split('.').slice(0, -1).reduce((cur, key) => cur[key], obj)
const leaf = (path) => path.split('.').at(-1)
const setAt = (obj, path, value) => { at(obj, path)[leaf(path)] = value }
const dropAt = (obj, path) => { delete at(obj, path)[leaf(path)] }

const CONTROL_CHAR = Object.freeze({
  CTRL_0001: '\u0001',
  CTRL_007F: '\u007f',
  CTRL_0085: '\u0085',
  CTRL_009F: '\u009f',
})

const rejects = (label, mutate, pattern) => {
  const copy = clone()
  mutate(copy)
  const message = boom(() => assertProviderProfileShape(copy))
  t(label, pattern.test(message), true)
  if (!pattern.test(message)) bad.push(`  ↑ сообщение было: ${message}`)
}

/* ── 1. Валидный профиль и подпись ─────────────────────────────────────── */

t('валидный профиль проходит форму', boom(() => assertProviderProfileShape(clone())), '(без ошибки)')
const BASE_DIGEST = providerProfileDigest(clone())
t('подпись — sha256 и 64 строчных hex', /^sha256:[0-9a-f]{64}$/.test(BASE_DIGEST), true)
t('подпись детерминирована', providerProfileDigest(clone()), BASE_DIGEST)
t('перестановка ключей подпись не меняет', providerProfileDigest({
  pricingTableDigest: clone().pricingTableDigest,
  capabilities: clone().capabilities,
  serializer: clone().serializer,
  structuredOutput: clone().structuredOutput,
  apiVersion: VALID.apiVersion,
  endpoint: VALID.endpoint,
  modelVersion: VALID.modelVersion,
  modelId: VALID.modelId,
  providerId: VALID.providerId,
  version: VALID.version,
  id: VALID.id,
  contractVersion: VALID.contractVersion,
}), BASE_DIGEST)
/* Закреплённый ответ. Без него ошибочная смена домена, пропажа 0x0A или хеш
   одного лишь канонического JSON остались бы зелёными: форма, детерминизм и
   чувствительность к полям у всех трёх вариантов те же. */
const KNOWN_DIGEST = 'sha256:23d91f13933c21dffd660782e103f7748e82be2835f1ad56247470801ef3cad1'
t('подпись совпадает с закреплённым ответом', providerProfileDigest(clone()), KNOWN_DIGEST)

const STREAM = canonicalJsonBytes(clone(), PROVIDER_PROFILE_SPEC)
const DOMAIN_BYTES = Buffer.from(PROVIDER_PROFILE_SPEC, 'utf8')
t('поток начинается ровно доменом',
  STREAM.subarray(0, DOMAIN_BYTES.length).equals(DOMAIN_BYTES), true)
t('сразу за доменом ровно один 0x0A', STREAM[DOMAIN_BYTES.length], 0x0a)
t('дальше идёт канонический JSON', String.fromCharCode(STREAM[DOMAIN_BYTES.length + 1]), '{')
t('длина потока — домен, перевод строки и JSON',
  STREAM.length > DOMAIN_BYTES.length + 1, true)

t('spec экспортирован тем же значением, что в профиле', PROVIDER_PROFILE_SPEC, VALID.contractVersion)
t('верхний уровень — ровно двенадцать ключей', PROVIDER_PROFILE_KEYS.length, 12)
t('фикстура содержит ровно объявленный состав',
  Object.keys(VALID).sort().join(','), [...PROVIDER_PROFILE_KEYS].sort().join(','))

/* `providerProfileDigest` обязан проверять сам: обещание вызывающего
   «я уже проверил» доказательством не является. */
const defective = clone()
delete defective.endpoint
t('digest сам отвергает дефектный профиль',
  /нет обязательных полей endpoint/.test(boom(() => providerProfileDigest(defective))), true)
t('digest отвергает и не-объект',
  /простым объектом/.test(boom(() => providerProfileDigest(null))), true)

/* ── 2. Удаление каждого ключа на каждом уровне ────────────────────────── */

const NESTED_LEVELS = [
  ['structuredOutput', Object.keys(VALID.structuredOutput)],
  ['serializer', Object.keys(VALID.serializer)],
  ['capabilities', Object.keys(VALID.capabilities)],
  ['capabilities.idempotencyKey', Object.keys(VALID.capabilities.idempotencyKey)],
  ['capabilities.statusEndpoint', Object.keys(VALID.capabilities.statusEndpoint)],
  ['capabilities.batch', Object.keys(VALID.capabilities.batch)],
  ['pricingTableDigest', Object.keys(VALID.pricingTableDigest)],
]

for (const key of PROVIDER_PROFILE_KEYS) {
  rejects(`без верхнего ключа ${key} профиль отвергается`, (p) => { delete p[key] },
    /нет обязательных полей|ожидается простой объект|ожидается одно из/)
}
for (const [prefix, keys] of NESTED_LEVELS) {
  for (const key of keys) {
    rejects(`без ключа ${prefix}.${key} профиль отвергается`, (p) => dropAt(p, `${prefix}.${key}`),
      /нет обязательных полей/)
  }
  rejects(`лишний ключ в ${prefix} отвергается`, (p) => setAt(p, `${prefix}.granted`, true), /лишние поля/)
}
rejects('лишний ключ верхнего уровня отвергается', (p) => { p.granted = true }, /лишние поля/)
rejects('поле для секрета не предусмотрено', (p) => { p.apiKey = 'sk-xxx' }, /лишние поля/)
rejects('заголовок авторизации отдельным полем тоже не предусмотрен',
  (p) => { p.authorization = 'Bearer x' }, /лишние поля/)

/* ── 3. Символьные, неперечисляемые и accessor-свойства ────────────────── */

const LEVELS = ['', 'structuredOutput', 'serializer', 'capabilities',
  'capabilities.idempotencyKey', 'capabilities.statusEndpoint', 'capabilities.batch',
  'pricingTableDigest']
const target = (p, prefix) => (prefix ? prefix.split('.').reduce((cur, key) => cur[key], p) : p)

for (const prefix of LEVELS) {
  const name = prefix || '(верхний уровень)'
  rejects(`символьный ключ в ${name}`, (p) => { target(p, prefix)[Symbol('s')] = 1 },
    /символьные ключи/)
  rejects(`неперечисляемое поле в ${name}`,
    (p) => Object.defineProperty(target(p, prefix), 'granted', { value: 1, enumerable: false }),
    /неперечисляемое собственное свойство/)
  rejects(`accessor-поле в ${name}`,
    (p) => Object.defineProperty(target(p, prefix), 'granted', { get: () => 1, enumerable: true }),
    /accessor-свойство/)
}
rejects('чужой прототип отвергается',
  (p) => { p.serializer = Object.assign(Object.create({ evil: 1 }), VALID.serializer) },
  /только простые объекты/)
rejects('массив вместо объекта отвергается', (p) => { p.serializer = [] }, /ожидается простой объект/)

/* ── 4. Связки «объявлено — заполнено» ─────────────────────────────────── */

const COUPLINGS = [
  ['capabilities.idempotencyKey', ['header', 'scope'], { header: 'idempotency-key', scope: 'request' }],
  ['capabilities.statusEndpoint', ['billable', 'path'], { billable: false, path: '/v1/messages/status' }],
  ['capabilities.batch', ['returnsRequestItemId'], { returnsRequestItemId: true }],
]
for (const [prefix, keys, filled] of COUPLINGS) {
  rejects(`${prefix}: supported не boolean`, (p) => setAt(p, `${prefix}.supported`, 'yes'),
    /supported: ожидается boolean/)
  for (const key of keys) {
    rejects(`${prefix}: при supported=false поле ${key} обязано быть null`, (p) => {
      setAt(p, `${prefix}.supported`, false)
      for (const other of keys) setAt(p, `${prefix}.${other}`, null)
      setAt(p, `${prefix}.${key}`, filled[key])
    }, new RegExp(`${key}: ожидается null`))
    rejects(`${prefix}: при supported=true поле ${key} не может быть null`, (p) => {
      setAt(p, `${prefix}.supported`, true)
      for (const other of keys) setAt(p, `${prefix}.${other}`, filled[other])
      setAt(p, `${prefix}.${key}`, null)
    }, new RegExp(key))
  }
  t(`${prefix}: полностью снятая возможность проходит`, boom(() => {
    const p = clone()
    setAt(p, `${prefix}.supported`, false)
    for (const key of keys) setAt(p, `${prefix}.${key}`, null)
    return assertProviderProfileShape(p)
  }), '(без ошибки)')
}
t('объявленный batch проходит', boom(() => {
  const p = clone()
  p.capabilities.batch = { supported: true, returnsRequestItemId: true }
  return assertProviderProfileShape(p)
}), '(без ошибки)')
rejects('batch: returnsRequestItemId не boolean при supported=true',
  (p) => { p.capabilities.batch = { supported: true, returnsRequestItemId: 'да' } },
  /returnsRequestItemId: ожидается boolean/)
rejects('statusEndpoint: billable не boolean при supported=true',
  (p) => { p.capabilities.statusEndpoint.billable = 'нет' }, /billable: ожидается boolean/)

/* ── 5. Опасный endpoint ───────────────────────────────────────────────── */

const ENDPOINTS = [
  ['http вместо https', 'http://api.example.com/v1', /допустим только https/],
  ['учётные данные в адресе', 'https://user:pass@api.example.com/v1', /учётные данные/],
  ['строка запроса', 'https://api.example.com/v1?key=secret', /строка запроса/],
  ['фрагмент', 'https://api.example.com/v1#x', /фрагмент/],
  ['завершающий слэш', 'https://api.example.com/v1/', /завершающий/],
  ['порт по умолчанию', 'https://api.example.com:443/v1', /каноническом виде/],
  ['верхний регистр хоста', 'https://API.example.com/v1', /каноническом виде/],
  ['точечный сегмент', 'https://api.example.com/v1/../v2', /каноническом виде/],
  ['относительный адрес', '/v1/messages', /не разбирается как абсолютный URL/],
  ['пробел вокруг', ' https://api.example.com/v1', /окружающие пробелы/],
  ['перевод строки внутри', 'https://api.example.com/v1\nx', /управляющие символы/],
  ['строчная процентная тройка', 'https://api.example.com/v1/%7e', /в верхнем регистре/],
  ['строчная тройка UTF-8', 'https://api.example.com/v1/%c3%bc', /в верхнем регистре/],
  ['кодированный незарезервированный ~', 'https://api.example.com/v1/%7E', /незарезервированный/],
  ['кодированная буква A', 'https://api.example.com/v1/%41', /незарезервированный/],
  ['кодированный дефис', 'https://api.example.com/v1/%2D', /незарезервированный/],
  ['незавершённая тройка', 'https://api.example.com/v1/%2', /полную шестнадцатеричную пару/],
  ['не-hex после процента', 'https://api.example.com/v1/%zz', /полную шестнадцатеричную пару/],
  ['сырой Unicode в пути', 'https://api.example.com/v1/\u00fc', /каноническом виде/],
  ['пробел в пути', 'https://api.example.com/v1/a b', /пробельный символ/],
  ['кодированный пробел %20', 'https://api.example.com/v1/a%20b', /пробельный символ/],
  ['кодированный NUL %00', 'https://api.example.com/v1/%00', /управляющий символ/],
  ['кодированная табуляция %09', 'https://api.example.com/v1/%09', /управляющий символ/],
  ['кодированный DEL %7F', 'https://api.example.com/v1/%7F', /управляющий символ/],
  ['кодированный NEL %C2%85', 'https://api.example.com/v1/%C2%85', /управляющий символ/],
  ['невалидный UTF-8 %FF', 'https://api.example.com/v1/%FF', /корректный UTF-8/],
  ['оборванная UTF-8 последовательность %C3', 'https://api.example.com/v1/%C3', /корректный UTF-8/],
  ['избыточное кодирование %C0%AF', 'https://api.example.com/v1/%C0%AF', /корректный UTF-8/],
  ['хост с завершающей точкой', 'https://api.example.com./v1', /завершающей точкой/],
]
for (const [label, value, pattern] of ENDPOINTS) {
  rejects(`endpoint: ${label}`, (p) => { p.endpoint = value }, pattern)
}
t('origin без пути допустим', boom(() => {
  const p = clone()
  p.endpoint = 'https://api.example.com'
  p.capabilities.statusEndpoint.path = '/status'
  return assertProviderProfileShape(p)
}), '(без ошибки)')
rejects('origin с завершающим слэшем отвергается',
  (p) => { p.endpoint = 'https://api.example.com/' }, /каноническом виде/)

/* ── 6. Опасный status path ────────────────────────────────────────────── */

const PATHS = [
  ['без ведущего слэша', 'v1/status', /обязан начинаться/],
  ['протокольно-относительный', '//evil.example/status', /протокольно-относительный/],
  ['пустой сегмент', '/v1//status', /пустой сегмент/],
  ['строка запроса', '/v1/status?x=1', /строка запроса/],
  ['фрагмент', '/v1/status#x', /фрагмент/],
  ['обратный слэш', '/v1\\status', /обратный слэш/],
  ['точечный сегмент', '/v1/../status', /точечный сегмент/],
  ['текущий каталог', '/v1/./status', /точечный сегмент/],
  ['процентно-кодированная точка', '/v1/%2e%2e/status', /процентно-кодированная точка/],
  ['процентная точка в верхнем регистре', '/v1/%2E%2E/status', /процентно-кодированная точка/],
  ['строчная процентная тройка', '/v1/%7e/status', /в верхнем регистре/],
  ['кодированный незарезервированный ~', '/v1/%7E/status', /незарезервированный/],
  ['кодированная буква A', '/v1/%41/status', /незарезервированный/],
  ['незавершённая тройка', '/v1/%2/status', /полную шестнадцатеричную пару/],
  ['не-hex после процента', '/v1/%zz/status', /полную шестнадцатеричную пару/],
  ['сырой Unicode', '/v1/\u00fc/status', /процентной тройкой/],
  ['пробел', '/v1/a b/status', /процентной тройкой/],
  ['кодированный пробел %20', '/v1/a%20b/status', /пробельный символ/],
  ['кодированный NUL %00', '/v1/%00/status', /управляющий символ/],
  ['кодированная табуляция %09', '/v1/%09/status', /управляющий символ/],
  ['кодированный DEL %7F', '/v1/%7F/status', /управляющий символ/],
  ['кодированный NEL %C2%85', '/v1/%C2%85/status', /управляющий символ/],
  ['невалидный UTF-8 %FF', '/v1/%FF/status', /корректный UTF-8/],
  ['оборванная последовательность %C3', '/v1/%C3/status', /корректный UTF-8/],
  ['избыточное кодирование %C0%AF', '/v1/%C0%AF/status', /корректный UTF-8/],
  ['кодированный обратный слэш %5C', '/v1/%5C/status', /обратный слэш/],
  ['кодированные два слэша %2F%2F', '/v1/%2F%2F/status', /пустой сегмент/],
  ['кодированный вопрос %3F', '/v1/%3F/status', /строка запроса/],
  ['кодированная решётка %23', '/v1/%23/status', /фрагмент/],
]
for (const [label, value, pattern] of PATHS) {
  rejects(`status path: ${label}`, (p) => { p.capabilities.statusEndpoint.path = value }, pattern)
}

/* Положительное направление той же проверки: путь разрешается относительно
   origin и origin не меняет. Строка при этом исполняется — мутация «снять
   сверку origin» набор не роняет (недостижима при текстовых правилах выше),
   и это зафиксировано в отчёте, а не скрыто. */
t('status path разрешается внутри origin адреса', boom(() => {
  const p = clone()
  p.endpoint = 'https://api.example.com'
  p.capabilities.statusEndpoint.path = '/v1/messages/status'
  return assertProviderProfileShape(p)
}), '(без ошибки)')

/* Канонический UTF-8 остаётся допустимым: запрещено не кодирование как
   таковое, а неканоническое написание и опасный смысл раскодированного. */
t('канонический UTF-8 в endpoint принимается', boom(() => {
  const p = clone()
  p.endpoint = 'https://api.example.com/v1/%C3%BC'
  return assertProviderProfileShape(p)
}), '(без ошибки)')
t('канонический UTF-8 в status path принимается', boom(() => {
  const p = clone()
  p.capabilities.statusEndpoint.path = '/v1/%C3%BC/status'
  return assertProviderProfileShape(p)
}), '(без ошибки)')
t('зарезервированный символ тройкой принимается', boom(() => {
  const p = clone()
  p.capabilities.statusEndpoint.path = '/v1/%3A/status'
  return assertProviderProfileShape(p)
}), '(без ошибки)')

/* ── 7. Опасный заголовок идемпотентности ──────────────────────────────── */

for (const header of ['authorization', 'proxy-authorization', 'cookie', 'set-cookie',
  'host', 'content-length', 'transfer-encoding', 'connection']) {
  rejects(`заголовок «${header}» запрещён`,
    (p) => { p.capabilities.idempotencyKey.header = header }, /нельзя использовать как ключ/)
}
rejects('заголовок в верхнем регистре отвергается',
  (p) => { p.capabilities.idempotencyKey.header = 'Idempotency-Key' }, /в нижнем регистре/)
rejects('заголовок с пробелом отвергается',
  (p) => { p.capabilities.idempotencyKey.header = 'idempotency key' }, /в нижнем регистре/)
rejects('заголовок с двоеточием отвергается',
  (p) => { p.capabilities.idempotencyKey.header = 'idempotency:key' }, /в нижнем регистре/)

/* ── 8. Плавающие версии, wildcard, пробелы, управляющие символы ───────── */

const PINNED_FIELDS = ['modelId', 'modelVersion', 'apiVersion']
for (const field of PINNED_FIELDS) {
  for (const alias of ['latest', 'Latest', 'model-latest', 'current', 'stable', 'newest']) {
    rejects(`${field}: плавающий псевдоним «${alias}»`, (p) => { p[field] = alias }, /плавающий псевдоним/)
  }
  for (const wildcard of ['model-*', 'model-?']) {
    rejects(`${field}: подстановочный знак «${wildcard}»`, (p) => { p[field] = wildcard }, /подстановочный знак/)
  }
  rejects(`${field}: окружающие пробелы`, (p) => { p[field] = ' value ' }, /окружающие пробелы/)
  rejects(`${field}: управляющий символ`, (p) => { p[field] = 'val\u0001ue' }, /управляющие символы/)
  rejects(`${field}: пустая строка`, (p) => { p[field] = '' }, /непустая строка/)
  rejects(`${field}: не строка`, (p) => { p[field] = 42 }, /непустая строка/)
}
/* C0, DEL и C1 — один общий guard. U+0085 и U+009F невидимы, но меняют байты
   и поведение разбора у принимающей стороны, поэтому проверяются в каждом
   семействе свободных строк, где этот guard применяется. */
const CONTROL_FAMILIES = [
  ['modelId', (p, v) => { p.modelId = `model${v}` }],
  ['modelVersion', (p, v) => { p.modelVersion = `2026-08-01${v}` }],
  ['apiVersion', (p, v) => { p.apiVersion = `2026-08-01${v}` }],
  ['id', (p, v) => { p.id = `example${v}` }],
  ['version', (p, v) => { p.version = `1.0.0${v}` }],
  ['providerId', (p, v) => { p.providerId = `example${v}` }],
  ['endpoint', (p, v) => { p.endpoint = `https://api.example.com/v1${v}` }],
  ['serializer.id', (p, v) => { p.serializer.id = `node-json${v}` }],
  ['serializer.version', (p, v) => { p.serializer.version = `1.0.0${v}` }],
  ['structuredOutput.mode', (p, v) => { p.structuredOutput.mode = `json-schema-strict${v}` }],
  ['idempotencyKey.header', (p, v) => { p.capabilities.idempotencyKey.header = `idempotency-key${v}` }],
  ['statusEndpoint.path', (p, v) => { p.capabilities.statusEndpoint.path = `/v1/status${v}` }],
]
const CONTROL_SAMPLES = [
  ['C0 U+0001', 'CTRL_0001'],
  ['DEL U+007F', 'CTRL_007F'],
  ['C1 U+0085 NEL', 'CTRL_0085'],
  ['C1 U+009F APC', 'CTRL_009F'],
]
/* `pricingTableDigest.value` в этот список не входит намеренно: он не
   свободная строка и общий guard к нему не применяется — его форму задаёт
   `assertDigestShape` собственным выражением, и управляющий символ он
   отвергает по своей причине, а не по этой. */
for (const [family, set] of CONTROL_FAMILIES) {
  for (const [label, code] of CONTROL_SAMPLES) {
    rejects(`${family}: ${label}`, (p) => set(p, CONTROL_CHAR[code]), /управляющие символы/)
  }
}

rejects('одиночный суррогат отвергается', (p) => { p.modelId = 'a\ud800b' }, /одиночный старший суррогат/)
rejects('version: диапазон запрещён', (p) => { p.version = '^1.0.0' }, /точная версия/)
rejects('version: две цифры запрещены', (p) => { p.version = '1.0' }, /точная версия/)
rejects('version: суффикс запрещён', (p) => { p.version = '1.0.0-beta' }, /точная версия/)
rejects('id: верхний регистр запрещён', (p) => { p.id = 'Example' }, /строчный идентификатор/)
rejects('id: подчёркивание запрещено', (p) => { p.id = 'example_profile' }, /строчный идентификатор/)
rejects('providerId: пустой запрещён', (p) => { p.providerId = '' }, /непустая строка/)
rejects('serializer.version: плавающая запрещена', (p) => { p.serializer.version = 'latest' },
  /плавающий псевдоним/)

/* ── 9. Перечисления и digest таблицы цен ──────────────────────────────── */

t('режимов структурированного вывода ровно три', STRUCTURED_OUTPUT_MODES.length, 3)
t('диалект схемы один', SCHEMA_DIALECTS.length, 1)
t('областей идемпотентности две', IDEMPOTENCY_SCOPES.length, 2)
for (const list of [STRUCTURED_OUTPUT_MODES, SCHEMA_DIALECTS, IDEMPOTENCY_SCOPES, PROVIDER_PROFILE_KEYS]) {
  t(`перечисление ${list[0]} заморожено`, Object.isFrozen(list), true)
}
for (const mode of STRUCTURED_OUTPUT_MODES) {
  t(`режим ${mode} принимается`, boom(() => {
    const p = clone()
    p.structuredOutput.mode = mode
    return assertProviderProfileShape(p)
  }), '(без ошибки)')
}
rejects('неизвестный режим вывода', (p) => { p.structuredOutput.mode = 'freeform' }, /ожидается одно из/)
rejects('неизвестный диалект схемы', (p) => { p.structuredOutput.schemaDialect = 'draft-07' },
  /ожидается одно из/)
rejects('неизвестная область идемпотентности',
  (p) => { p.capabilities.idempotencyKey.scope = 'session' }, /ожидается одно из/)
rejects('чужая спецификация таблицы цен',
  (p) => { p.pricingTableDigest.spec = 'poi-model-plan/v1' }, /spec/)
rejects('чужой алгоритм таблицы цен',
  (p) => { p.pricingTableDigest.algorithm = 'sha1' }, /algorithm/)
rejects('усечённое значение digest таблицы цен',
  (p) => { p.pricingTableDigest.value = 'sha256:abc' }, /64 строчных hex/)
rejects('значение digest в верхнем регистре',
  (p) => { p.pricingTableDigest.value = `sha256:${'A'.repeat(64)}` }, /64 строчных hex/)
t('цены в профиль не входят', 'pricingTableAsOf' in VALID || 'currency' in VALID, false)

/* ── 10. Подпись меняется от каждого подписанного leaf ─────────────────── */

const LEAVES = [
  ['id', 'other-profile'],
  ['version', '2.0.0'],
  ['providerId', 'other-provider'],
  ['modelId', 'other-model'],
  ['modelVersion', '2026-09-01'],
  ['endpoint', 'https://api.example.com/v2/messages'],
  ['apiVersion', '2026-09-01'],
  ['structuredOutput.mode', 'native-schema'],
  ['serializer.id', 'other-serializer'],
  ['serializer.version', '2.0.0'],
  ['capabilities.idempotencyKey.header', 'x-request-id'],
  ['capabilities.idempotencyKey.scope', 'batch'],
  ['capabilities.statusEndpoint.billable', true],
  ['capabilities.statusEndpoint.path', '/v1/other/status'],
  ['pricingTableDigest.value', `sha256:${'1'.repeat(64)}`],
]
for (const [path, alt] of LEAVES) {
  const copy = clone()
  setAt(copy, path, alt)
  t(`подпись меняется при правке ${path}`, providerProfileDigest(copy) === BASE_DIGEST, false)
}
/* Механическое покрытие: обход ВСЕХ leaf'ов профиля, а не выбранного
   поднабора. Утверждение сильнее «подпись меняется»: ни один leaf нельзя
   изменить так, чтобы профиль остался валидным И подпись не изменилась.
   Для leaf'ов с закрытым множеством значений (версия контракта, диалект,
   алгоритм и spec digest) правка обязана быть отвергнута — это тоже
   «незаметно не пройдёт». */
const leafPaths = (value, prefix = []) => (
  value !== null && typeof value === 'object'
    ? Object.keys(value).flatMap((key) => leafPaths(value[key], [...prefix, key]))
    : [prefix.join('.')]
)
const ALL_LEAVES = leafPaths(VALID)
t('обход нашёл все leaf профиля', ALL_LEAVES.length, 23)

const twist = (value) => {
  if (typeof value === 'boolean') return !value
  if (value === null) return true
  if (typeof value === 'string') return `${value}-изменено`
  return `${String(value)}-изменено`
}
let silent = []
for (const path of ALL_LEAVES) {
  const copy = clone()
  const current = path.split('.').reduce((cur, key) => cur[key], copy)
  setAt(copy, path, twist(current))
  let digest = null
  try { digest = providerProfileDigest(copy) } catch { digest = null }
  if (digest !== null && digest === BASE_DIGEST) silent.push(path)
}
t('ни один leaf нельзя изменить незаметно для подписи', silent.join(','), '')

const batchOn = clone()
batchOn.capabilities.batch = { supported: true, returnsRequestItemId: true }
t('подпись меняется при объявлении batch', providerProfileDigest(batchOn) === BASE_DIGEST, false)
const idemOff = clone()
idemOff.capabilities.idempotencyKey = { supported: false, header: null, scope: null }
t('подпись меняется при снятии идемпотентности',
  providerProfileDigest(idemOff) === BASE_DIGEST, false)

/* ── 11. Канонический реестр ───────────────────────────────────────────── */

t('в реестре ровно одна запись', PROVIDER_PROFILES.length, 1)
t('реестр — массив', Array.isArray(PROVIDER_PROFILES), true)
t('реестр не Map', PROVIDER_PROFILES instanceof Map, false)
t('реестр заморожен', Object.isFrozen(PROVIDER_PROFILES), true)
t('push отвергается', boom(() => PROVIDER_PROFILES.push(clone())) !== '(без ошибки)', true)
t('присваивание по индексу отвергается',
  boom(() => { PROVIDER_PROFILES[0] = clone() }) !== '(без ошибки)', true)
t('после попыток в реестре та же одна запись', PROVIDER_PROFILES.length, 1)
t('публичных экспортов ровно двадцать два', Object.keys(PROFILE_MODULE).length, 22)
/* Появление второго потребителя домена таблицы цен поверхность профиля не
   расширяет: домен живёт в собственном модуле и импортируется обоими. */
t('спецификация таблицы цен наружу отсюда не выдаётся',
  'PRICING_TABLE_SPEC' in PROFILE_MODULE || 'MODEL_PRICING_SPEC' in PROFILE_MODULE, false)
t('и всё же применяется — профиль с чужой спецификацией цен отвергается',
  /pricingTableDigest/.test(boom(() => assertProviderProfileShape({
    ...clone(), pricingTableDigest: { ...clone().pricingTableDigest, spec: 'poi-model-plan/v1' },
  }))), true)
t('среди экспортов нет ни одной функции изменения реестра',
  Object.keys(PROFILE_MODULE).filter((name) => /^(register|add|append|set|push|insert)/i.test(name)).length, 0)

/* Тот же объект, а не копия: существующие потребители импортируют его через
   `model-plan.mjs`, и совместимость обязана быть тождеством, а не сходством. */
t('импорт через model-plan.mjs даёт тот же объект', VIA_MODEL_PLAN === PROVIDER_PROFILES, true)
t('и он тоже заморожен', Object.isFrozen(VIA_MODEL_PLAN), true)

/* ── 12. Разрешатель ───────────────────────────────────────────────────── */

t('resolveProviderProfile принимает ровно два аргумента', resolveProviderProfile.length, 2)
t('незаявленный профиль не разрешается',
  /не объявлен/.test(boom(() => resolveProviderProfile('example-profile', '1.0.0'))), true)
t('третий аргумент — отказ, а не подмена реестра',
  /ровно два аргумента/.test(boom(() => resolveProviderProfile('example-profile', '1.0.0', [VALID]))),
  true)
t('один аргумент — отказ',
  /ровно два аргумента/.test(boom(() => resolveProviderProfile('example-profile'))), true)
t('объект-опции вместо version — отказ',
  boom(() => resolveProviderProfile('example-profile', { profiles: [VALID] })) !== '(без ошибки)', true)
t('мусорный id отвергается до поиска',
  /строчный идентификатор/.test(boom(() => resolveProviderProfile('Example', '1.0.0'))), true)
t('неточная версия отвергается до поиска',
  /точная версия/.test(boom(() => resolveProviderProfile('example-profile', '1.0'))), true)
t('плавающая версия отвергается до поиска',
  /плавающий псевдоним/.test(boom(() => resolveProviderProfile('example-profile', 'latest'))), true)
t('сообщение об отказе называет размер реестра',
  /в каноническом реестре 1 запись/.test(boom(() => resolveProviderProfile('example-profile', '1.0.0'))),
  true)

/* ── 13. Идентичность модели: снимок против наблюдаемого алиаса ────────── */

const ALIAS = Object.freeze({
  ...JSON.parse(JSON.stringify(VALID)),
  contractVersion: PROVIDER_PROFILE_V2_SPEC,
  modelId: 'demo-model-alias',
  modelIdentity: {
    kind: 'observed-alias',
    modelVersion: 'demo-model-alias',
    catalogObservedAt: '2026-08-16',
    validUntil: '2026-09-15',
    revisionPolicy: 'provider-may-revise-without-notice',
  },
})
const aliasNo = (x) => { const c = JSON.parse(JSON.stringify(ALIAS)); delete c.modelVersion; return { ...c, ...x } }
const A = () => aliasNo({})
const SNAP = () => aliasNo({
  modelIdentity: {
    kind: 'dated-snapshot',
    modelVersion: 'demo-model-2026-08-16',
    catalogObservedAt: null,
    validUntil: null,
    revisionPolicy: 'immutable',
  },
})
const withIdentity = (patchObj) => {
  const c = A()
  c.modelIdentity = { ...c.modelIdentity, ...patchObj }
  return c
}
const shapeErr = (p) => boom(() => assertProviderProfileShape(p))

t('обе версии домена объявлены', PROVIDER_PROFILE_SPECS.join(','),
  'poi-model-provider-profile/v1,poi-model-provider-profile/v2')
t('состав v2 — тоже двенадцать ключей', PROVIDER_PROFILE_V2_KEYS.length, 12)
t('в v2 нет голой modelVersion', PROVIDER_PROFILE_V2_KEYS.includes('modelVersion'), false)
t('в v1 нет modelIdentity', PROVIDER_PROFILE_KEYS.includes('modelIdentity'), false)
t('блок идентичности — ровно пять полей', MODEL_IDENTITY_KEYS.length, 5)
t('видов идентификатора ровно два', MODEL_IDENTITY_KINDS.join(','), 'dated-snapshot,observed-alias')
t('политик пересмотра ровно две',
  MODEL_REVISION_POLICIES.join(','), 'immutable,provider-may-revise-without-notice')
t('срок наблюдения — тридцать суток', OBSERVED_ALIAS_VALIDITY_DAYS, 30)

t('фикстура наблюдаемого алиаса валидна', shapeErr(A()), '(без ошибки)')
t('фикстура снимка валидна', shapeErr(SNAP()), '(без ошибки)')
t('версия контракта читается', profileContractSpec(A()), PROVIDER_PROFILE_V2_SPEC)
t('версия модели у v2 берётся из блока', profileModelVersion(A()), 'demo-model-alias')
t('версия модели у v1 берётся с верхнего уровня', profileModelVersion(VALID), '2026-08-01')

/* Мутация «представление алиаса как snapshot». Ровно тот случай, ради
   которого версия контракта и вводилась: имя без даты, объявленное снимком. */
t('алиас, названный снимком, отвергается',
  /дату снимка в самом идентификаторе/.test(shapeErr(withIdentity({
    kind: 'dated-snapshot', revisionPolicy: 'immutable',
    catalogObservedAt: null, validUntil: null,
  }))), true)
t('и «gpt-5.6-luna» снимком назвать тоже нельзя',
  /дату снимка в самом идентификаторе/.test(shapeErr(aliasNo({
    modelId: 'gpt-5.6-luna',
    modelIdentity: {
      kind: 'dated-snapshot', modelVersion: 'gpt-5.6-luna',
      catalogObservedAt: null, validUntil: null, revisionPolicy: 'immutable',
    },
  }))), true)
t('несуществующая дата внутри идентификатора снимка не считается датой',
  shapeErr(aliasNo({
    modelId: 'demo-model-alias',
    modelIdentity: {
      kind: 'dated-snapshot', modelVersion: 'demo-model-2026-02-30',
      catalogObservedAt: null, validUntil: null, revisionPolicy: 'immutable',
    },
  })) !== '(без ошибки)', true)

/* Мутация «отсутствие срока действия алиаса». */
t('алиас без даты наблюдения отвергается',
  /catalogObservedAt/.test(shapeErr(withIdentity({ catalogObservedAt: null }))), true)
t('алиас без срока отвергается',
  /validUntil/.test(shapeErr(withIdentity({ validUntil: null }))), true)
t('срок, натянутый на 31 сутки, отвергается',
  /ровно 30 суток/.test(shapeErr(withIdentity({ validUntil: '2026-09-16' }))), true)
t('срок, укороченный до 29 суток, тоже отвергается',
  /ровно 30 суток/.test(shapeErr(withIdentity({ validUntil: '2026-09-14' }))), true)
t('политика пересмотра обязана соответствовать виду',
  shapeErr(withIdentity({ revisionPolicy: 'immutable' })) !== '(без ошибки)', true)
t('у снимка не бывает даты наблюдения',
  shapeErr(aliasNo({
    modelIdentity: {
      kind: 'dated-snapshot', modelVersion: 'demo-model-2026-08-16',
      catalogObservedAt: '2026-08-16', validUntil: null, revisionPolicy: 'immutable',
    },
  })) !== '(без ошибки)', true)
t('у алиаса версия не существует отдельно от имени',
  /версии нет отдельно от имени/.test(shapeErr(withIdentity({ modelVersion: 'demo-model-alias-2' }))),
  true)
t('плавающий псевдоним остаётся запрещён и в алиасе',
  /плавающий псевдоним/.test(shapeErr(aliasNo({
    modelId: 'demo-model-latest',
    modelIdentity: { ...A().modelIdentity, modelVersion: 'demo-model-latest' },
  }))), true)

/* Отпечаток обязан покрывать блок целиком: иначе срок продлевался бы молча. */
const aliasDigest = providerProfileDigest(A())
t('правка даты наблюдения меняет отпечаток профиля',
  providerProfileDigest(withIdentity({
    catalogObservedAt: '2026-08-15', validUntil: '2026-09-14',
  })) === aliasDigest, false)
t('смена вида идентификатора меняет отпечаток',
  providerProfileDigest(SNAP()) === aliasDigest, false)
/* Домен входит В БАЙТЫ потока, а не лежит рядом со значением. Профиль v2
   хешируется под своим доменом: поток, собранный под доменом v1, — другие
   байты, и подменить один ярлык другим нечем. */
const V2_STREAM = canonicalJsonBytes(A(), PROVIDER_PROFILE_V2_SPEC)
const V2_DOMAIN = Buffer.from(PROVIDER_PROFILE_V2_SPEC, 'utf8')
t('поток v2 начинается ровно своим доменом',
  V2_STREAM.subarray(0, V2_DOMAIN.length).equals(V2_DOMAIN), true)
t('сразу за доменом ровно один 0x0A', V2_STREAM[V2_DOMAIN.length], 0x0a)
t('под доменом v1 те же поля дают другие байты',
  canonicalJsonBytes(A(), PROVIDER_PROFILE_SPEC).equals(V2_STREAM), false)
/* Профиль v2, переклеенный ярлыком v1, не проходит вовсе: состав ключей у
   версий разный, и «та же запись под другой версией» существовать не может. */
t('v2 под ярлыком v1 отвергается по составу',
  /нет обязательных полей|лишние поля/.test(
    shapeErr({ ...A(), contractVersion: PROVIDER_PROFILE_SPEC }),
  ), true)

/* ── 14. Годность профиля для нового плана ────────────────────────────── */

const freshErr = (p, iso) => {
  try { assertProfileIdentityFresh(p, { now: new Date(iso) }); return '(без ошибки)' }
  catch (e) { return e.code ?? e.message }
}
t('снимок годен всегда', freshErr(SNAP(), '2030-01-01T00:00:00Z'), '(без ошибки)')
t('алиас годен в день наблюдения', freshErr(A(), '2026-08-16T00:00:00Z'), '(без ошибки)')
/* Момент истечения — начало следующих суток по Asia/Tokyo, тем же расчётом,
   что и срок policy. 2026-09-15T14:59:59Z — это ещё 15 сентября в Токио. */
t('алиас годен в последний миг срока', freshErr(A(), '2026-09-15T14:59:59Z'), '(без ошибки)')
t('и негоден в первый миг следующих суток JST',
  freshErr(A(), '2026-09-15T15:00:00Z'), PROFILE_IDENTITY_CODES.expired)
t('профиль v1 для нового плана не годится вовсе',
  freshErr(VALID, '2026-08-16T00:00:00Z'), PROFILE_IDENTITY_CODES.unversioned)
t('но парсер v1 сохранён и форму читает', shapeErr(VALID), '(без ошибки)')
t('без часов проверка не выполняется',
  /now обязателен/.test(boom(() => assertProfileIdentityFresh(A(), {}))), true)

/* ── 15. Владельческая запись реестра ─────────────────────────────────── */

const OWNED = PROVIDER_PROFILES[0]
t('профиль владельца объявлен по v2', OWNED.contractVersion, PROVIDER_PROFILE_V2_SPEC)
t('идентификатор модели точный', OWNED.modelId, 'gpt-5.6-luna')
/* Мутация «принятие gpt-5.6»: это алиас другой модели семейства, и цена у
   неё в двадцать пять раз выше. */
t('и это не алиас gpt-5.6', OWNED.modelId === 'gpt-5.6', false)
t('вид идентификатора — наблюдаемый алиас', OWNED.modelIdentity.kind, 'observed-alias')
t('политика пересмотра названа прямо',
  OWNED.modelIdentity.revisionPolicy, 'provider-may-revise-without-notice')
t('дата сверки каталога', OWNED.modelIdentity.catalogObservedAt, '2026-08-17')
t('срок — ровно тридцать суток от сверки', OWNED.modelIdentity.validUntil, '2026-09-16')
t('адрес — точный эндпоинт Responses', OWNED.endpoint, 'https://api.openai.com/v1/responses')
t('строгий структурированный вывод', OWNED.structuredOutput.mode, 'json-schema-strict')
/* Мутация «использование старого сериализатора профилем». */
t('назван сериализатор второй версии',
  `${OWNED.serializer.id}@${OWNED.serializer.version}`, 'openai-responses@2.0.0')
t('и он объявлен по контракту v2',
  SERIALIZER_DESCRIPTORS.find((d) => d.version === OWNED.serializer.version).contractVersion,
  'poi-model-serializer/v2')
t('идемпотентность не поддержана', OWNED.capabilities.idempotencyKey.supported, false)
t('партии отключены', OWNED.capabilities.batch.supported, false)
t('статусный эндпоинт не объявлен', OWNED.capabilities.statusEndpoint.supported, false)
/* Мутация «неправильная цена Luna»: правка любой цены меняет отпечаток
   таблицы, и профиль перестаёт на неё ссылаться. */
t('профиль ссылается на объявленную таблицу цен',
  OWNED.pricingTableDigest.value, PRICING_TABLES[0].pricingTableDigest.value)
t('и на таблицу со ступенчатым тарифом',
  OWNED.pricingTableDigest.spec, 'poi-model-pricing/v2')
t('профиль владельца проходит собственную границу', shapeErr(OWNED), '(без ошибки)')
t('и разрешается по реестру',
  resolveProviderProfile('openai-responses-luna', '1.0.0').modelId, 'gpt-5.6-luna')
t('версия модели для поиска цены — сам алиас',
  profileModelVersion(OWNED), 'gpt-5.6-luna')

console.log(bad.length
  ? `✗ провалено ${bad.length}:\n  ` + bad.join('\n  ')
  : `✓ контракт профиля провайдера: ${ok} проверок пройдено`)
process.exitCode = bad.length ? 1 : 0
