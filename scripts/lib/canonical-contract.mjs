/**
 * Общие примитивы строгой формы контрактов: канонизация, проверки формы и
 * digest-объект.
 *
 * Выделены из `scripts/poi-portals/lib/model-plan.mjs` без единой правки
 * поведения: тела функций перенесены как есть, изменён только модификатор
 * видимости. Причина выделения — второй потребитель тех же примитивов
 * (`poi-model-approval/v1`); держать их в модуле плана значило бы либо
 * сделать план библиотекой общих форм, либо завести вторую реализацию
 * каждой проверки, а вторая реализация одной спецификации расходится с
 * первой молча.
 *
 * Модуль ничего не знает ни о плане, ни о approval, ни о таксономии: он
 * оперирует значениями, доменами и байтами. Файловой системы и сети не
 * касается.
 */
import { DIGEST_ALGORITHM } from './byte-digest.mjs'

/* ── Канонический JSON ────────────────────────────────────────────────────
   Не `JSON.stringify`: тот молча выкидывает ключи со значением undefined,
   сериализует Date и Map как «что-то», зависит от порядка вставки ключей и
   не отвергает ничего. Здесь всё перечисленное — отказ. */

const OBJECT_PROTO = Object.getPrototypeOf({})

/**
 * Строгий контракт собственных ключей.
 *
 * `Object.keys` видит только перечисляемые строковые свойства. Символьные,
 * неперечисляемые и accessor-свойства он пропускает молча — они остаются в
 * объекте, но в подпись не попадают. Тогда два разных объекта дают один
 * digest, и подпись перестаёт отвечать на вопрос, ради которого считается.
 * Поэтому не «пропускаем», а отказываемся.
 */
export function assertStrictOwnKeys(value, where) {
  if (Object.getOwnPropertySymbols(value).length) {
    throw new TypeError(`${where}: символьные ключи не сериализуются`)
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor.get || descriptor.set) {
      throw new TypeError(`${where}.${key}: accessor-свойство не сериализуется`)
    }
    if (!descriptor.enumerable) {
      throw new TypeError(`${where}.${key}: неперечисляемое собственное свойство не сериализуется`)
    }
  }
}

/**
 * Строгий контракт массива: без дыр и без посторонних ключей.
 *
 * `new Array(1)` имеет длину 1 и не имеет элемента 0. `JSON.stringify`
 * подставил бы туда `null`, превратив «элемента нет» в «элемент есть и он
 * null» — разные входы, одинаковые байты.
 */
export function assertStrictArray(value, where) {
  if (Object.getOwnPropertySymbols(value).length) {
    throw new TypeError(`${where}: символьные ключи не сериализуются`)
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === 'length') continue
    /* Канонический ключ индекса и только он: String(index) === key.
       Number('00') равно нулю, Number('1e0') — единице, Number('-0') — нулю;
       все три прошли бы проверку «целое в диапазоне» и дали бы два разных
       объекта с одинаковой подписью. */
    const index = Number(key)
    if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
      throw new TypeError(`${where}.${key}: неканонический или посторонний ключ массива не сериализуется`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor.get || descriptor.set) throw new TypeError(`${where}[${index}]: accessor-элемент не сериализуется`)
    if (!descriptor.enumerable) throw new TypeError(`${where}[${index}]: неперечисляемый элемент не сериализуется`)
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError(`${where}[${index}]: разрежённый массив — дыра неотличима от null`)
    }
  }
}

export function assertNoLoneSurrogate(value, where) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError(`${where}: одиночный старший суррогат в позиции ${i}`)
      }
      i += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(`${where}: одиночный младший суррогат в позиции ${i}`)
    }
  }
}

function encodeString(value, where) {
  /* Одиночный суррогат при кодировании в UTF-8 превращается в U+FFFD.
     Два разных входа дали бы одинаковые байты и одинаковый digest — ровно
     то свойство, ради которого digest и считается. Поэтому отказ, а не
     замена. */
  assertNoLoneSurrogate(value, where)
  let out = '"'
  for (const ch of value) {
    const code = ch.codePointAt(0)
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`
    else out += ch
  }
  return `${out}"`
}

function encodeValue(value, seen, where) {
  if (value === null) return 'null'
  const type = typeof value
  if (type === 'boolean') return value ? 'true' : 'false'
  if (type === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${where}: не конечное число ${String(value)}`)
    }
    /* -0 — отказ, а не нормализация. Прежний код подменял его на 0, хотя
       комментарий рядом утверждал обратное: два разных runtime-входа
       давали одни байты и одну подпись — ровно то свойство, ради которого
       digest и считается. Та же причина, что у одиночного суррогата. */
    if (Object.is(value, -0)) {
      throw new TypeError(`${where}: -0 не сериализуется — в JSON отрицательного нуля нет`)
    }
    return String(value)
  }
  if (type === 'string') return encodeString(value, where)
  if (type === 'undefined' || type === 'function' || type === 'symbol' || type === 'bigint') {
    throw new TypeError(`${where}: значение типа ${type} не сериализуется`)
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError(`${where}: циклическая ссылка`)
    assertStrictArray(value, where)
    seen.add(value)
    const out = `[${value.map((item, i) => encodeValue(item, seen, `${where}[${i}]`)).join(',')}]`
    seen.delete(value)
    return out
  }
  if (type === 'object') {
    const proto = Object.getPrototypeOf(value)
    if (proto !== OBJECT_PROTO && proto !== null) {
      // Date, Map, Set и классы дали бы `{}` — пустой объект вместо данных.
      throw new TypeError(`${where}: только простые объекты; получен ${value.constructor?.name ?? 'объект с прототипом'}`)
    }
    assertStrictOwnKeys(value, where)
    if (seen.has(value)) throw new TypeError(`${where}: циклическая ссылка`)
    seen.add(value)
    const keys = Object.keys(value).sort()
    const out = `{${keys
      .map((key) => `${encodeString(key, `${where}.${key}`)}:${encodeValue(value[key], seen, `${where}.${key}`)}`)
      .join(',')}}`
    seen.delete(value)
    return out
  }
  throw new TypeError(`${where}: неподдерживаемое значение`)
}

/**
 * Канонические байты домена: `<домен>\n<канонический JSON>` в UTF-8.
 *
 * Ключи объектов сортируются рекурсивно по кодовым единицам UTF-16, порядок
 * массивов сохраняется, пробелов нет.
 */
export function canonicalJsonBytes(value, domain) {
  if (typeof domain !== 'string' || !domain) {
    throw new TypeError('canonicalJsonBytes: домен обязателен')
  }
  return Buffer.from(`${domain}\n${encodeValue(value, new Set(), domain)}`, 'utf8')
}
/* ── Тождество множеств ──────────────────────────────────────────────── */

/**
 * Не «сравнение множеств»: множества скрыли бы повтор.
 * Проверяются четыре вещи по отдельности — уникальность слева, уникальность
 * справа, равенство длин, поэлементное равенство отсортированных копий.
 * Контрпример: [A,B] против [A,A,B] обязан упасть.
 */
export function assertIdentity(left, right, label) {
  const duplicates = (list) => {
    const seen = new Set()
    const found = []
    for (const value of list) {
      if (seen.has(value)) found.push(value)
      seen.add(value)
    }
    return [...new Set(found)]
  }
  const leftDupes = duplicates(left)
  if (leftDupes.length) {
    throw new Error(`${label}: повторы в выбранном множестве: ${leftDupes.join(', ')}`)
  }
  const rightDupes = duplicates(right)
  if (rightDupes.length) {
    throw new Error(`${label}: повторы в спланированном множестве: ${rightDupes.join(', ')}`)
  }
  if (left.length !== right.length) {
    throw new Error(`${label}: выбрано ${left.length}, спланировано ${right.length}`)
  }
  const leftSorted = [...left].sort()
  const rightSorted = [...right].sort()
  for (let i = 0; i < leftSorted.length; i += 1) {
    if (leftSorted[i] !== rightSorted[i]) {
      throw new Error(`${label}: множества расходятся на «${leftSorted[i]}» против «${rightSorted[i]}»`)
    }
  }
}
export function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === OBJECT_PROTO || proto === null
}

export function isStrictCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}
/**
 * Идентичность кода проверяется ДО подписи.
 *
 * Полный hex-hash, а не сокращённый: сокращённый неоднозначен, и подпись,
 * которую нельзя разрешить в один коммит, подписью не является. Сорок
 * знаков — SHA-1, шестьдесят четыре — репозиторий на SHA-256.
 */
export const CODE_IDENTITY_KEYS = Object.freeze(['commit', 'dirty'])

export function assertCodeIdentity(codeIdentity) {
  if (!isPlainObject(codeIdentity)) {
    throw new TypeError('codeIdentity обязан быть простым объектом')
  }
  assertStrictOwnKeys(codeIdentity, 'codeIdentity')
  const keys = Object.keys(codeIdentity).sort()
  const expected = [...CODE_IDENTITY_KEYS].sort()
  if (keys.length !== expected.length || keys.some((key, i) => key !== expected[i])) {
    throw new TypeError(
      `codeIdentity обязан содержать ровно ${expected.join(' и ')}; получено ${keys.join(', ') || '(пусто)'}`,
    )
  }
  const commit = codeIdentity?.commit
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(commit)) {
    throw new TypeError(
      `codeIdentity.commit обязан быть полным hex-hash'ем Git (40 или 64 знака), получено ${JSON.stringify(commit)}`,
    )
  }
  if (typeof codeIdentity.dirty !== 'boolean') {
    throw new TypeError(`codeIdentity.dirty обязан быть boolean, получено ${typeof codeIdentity.dirty}`)
  }
}

export function digest(value, algorithm, spec) {
  return { value, algorithm, spec }
}
/** Точный состав digest-объекта. */
export const DIGEST_KEYS = Object.freeze(['value', 'algorithm', 'spec'])
/**
 * Каноническая форма значения digest.
 *
 * Остаётся ПРИВАТНЫМ и наружу не отдаётся. Экспортированный `RegExp` — это
 * изменяемая глобальная политика: `SHA256_VALUE.compile('.*')` у одного
 * импортёра отключил бы проверку у всех остальных, и `Object.freeze` тут не
 * помогает — `compile()` успевает подменить шаблон до исключения. Наружу
 * идёт функция, а не объект, который можно переписать.
 */
const SHA256_VALUE = /^sha256:[0-9a-f]{64}$/
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export function assertExactKeys(value, expected, where) {
  if (!isPlainObject(value)) throw new TypeError(`${where}: ожидается простой объект`)
  const keys = Object.keys(value).sort()
  const want = [...expected].sort()
  const missing = want.filter((key) => !keys.includes(key))
  const extra = keys.filter((key) => !want.includes(key))
  if (missing.length) throw new TypeError(`${where}: нет обязательных полей ${missing.join(', ')}`)
  if (extra.length) throw new TypeError(`${where}: лишние поля ${extra.join(', ')}`)
}

export function assertNonEmptyString(value, where) {
  if (typeof value !== 'string' || !value.length) {
    throw new TypeError(`${where}: ожидается непустая строка, получено ${JSON.stringify(value)}`)
  }
}

/**
 * Безопасное целое, а не просто целое.
 *
 * `Number.isInteger` истинно и выше `Number.MAX_SAFE_INTEGER`, где числа
 * перестают быть точными: 2**53 и 2**53+1 там неразличимы. Для байтов,
 * токенов и счётчиков это означало бы, что сумма сошлась не потому, что
 * она верна, а потому, что разницу нечем выразить.
 *
 * `-0` отвергается отдельно: он безопасное целое и проходит `>= 0`, а
 * канонизация его уже не приняла бы — но эта функция вызывается и на
 * агрегатах, посчитанных здесь же, и полагаться на чужой порядок нечем.
 */
export function assertInteger(value, where, min = 0) {
  if (typeof value !== 'number' || Object.is(value, -0) || !Number.isSafeInteger(value) || value < min) {
    throw new TypeError(
      `${where}: ожидается безопасное целое не меньше ${min}, получено ${JSON.stringify(value) ?? String(value)}`,
    )
  }
}

/**
 * Сложение и умножение с fail-closed отказом при выходе за безопасное целое.
 *
 * Числа с плавающей точкой не переполняются, они молча теряют точность:
 * `2**53 + 1 === 2**53`. Потолок, посчитанный таким сложением, оказывается
 * равен собственному слагаемому, отношение лимитов на нём сходится, и
 * разрешено становится больше объявленного. Поэтому отказ, а не приближение.
 *
 * BigInt здесь не заводится: величин, которым он нужен, в этих контрактах не
 * бывает, а подменять контракт типом значило бы разрешить те самые значения,
 * из-за которых проверка и стоит.
 */
export function safeAdd(left, right, where) {
  assertInteger(left, `${where}: левое слагаемое`)
  assertInteger(right, `${where}: правое слагаемое`)
  const sum = left + right
  if (!Number.isSafeInteger(sum)) {
    throw new RangeError(`${where}: сумма ${left} + ${right} выходит за безопасное целое`)
  }
  return sum
}

/**
 * Умножение с той же границей.
 *
 * Обратной проверки делением здесь нет намеренно, и это не упущение:
 * множители уже прошли `assertInteger`, поэтому оба — безопасные целые. Если
 * их точное произведение помещается в безопасный диапазон, оно представимо
 * и вычисляется без потерь; если не помещается, результат оказывается не
 * меньше 2^53 и `isSafeInteger` его отвергает. Третьего случая для таких
 * входов не существует, а сторож, который не может сработать, — не сторож.
 */
export function safeMul(left, right, where) {
  assertInteger(left, `${where}: левый множитель`)
  assertInteger(right, `${where}: правый множитель`)
  const product = left * right
  if (!Number.isSafeInteger(product)) {
    throw new RangeError(`${where}: произведение ${left} × ${right} выходит за безопасное целое`)
  }
  return product
}

/** `Object.is`, а не `===`: иначе -0 прошёл бы там, где ждут 0. */
export function assertExactly(value, expected, where) {
  if (!Object.is(value, expected)) {
    throw new TypeError(`${where}: ожидается ${String(expected)}, получено ${JSON.stringify(value) ?? String(value)}`)
  }
}

export function assertStringList(value, where) {
  if (!Array.isArray(value)) throw new TypeError(`${where}: ожидается массив строк`)
  value.forEach((item, i) => assertNonEmptyString(item, `${where}[${i}]`))
  const sorted = [...value].sort()
  if (value.some((item, i) => item !== sorted[i])) {
    throw new TypeError(`${where}: список обязан быть отсортирован — порядок входит в подпись`)
  }
  if (new Set(value).size !== value.length) throw new TypeError(`${where}: список содержит повторы`)
}

/**
 * Каноническое значение digest: `sha256:` и ровно 64 строчных hex-знака.
 *
 * Единственная точка, где это выражение применяется. Ею пользуются и
 * `assertDigestShape` для объекта digest, и контракты, у которых значение
 * лежит голой строкой, — второго литерала того же шаблона в проекте нет.
 */
export function assertSha256Value(value, where) {
  if (typeof value !== 'string' || !SHA256_VALUE.test(value)) {
    throw new TypeError(
      `${where}: ожидается «sha256:» и ровно 64 строчных hex-знака, получено ${JSON.stringify(value)}`,
    )
  }
}

export function assertDigestShape(value, spec, where) {
  assertExactKeys(value, DIGEST_KEYS, where)
  assertSha256Value(value.value, `${where}.value`)
  assertExactly(value.algorithm, DIGEST_ALGORITHM, `${where}.algorithm`)
  assertExactly(value.spec, spec, `${where}.spec`)
}
/**
 * Канонический момент времени: ровно `toISOString()` и ничего иного.
 * Регулярное выражение задаёт форму, обратное преобразование — существование:
 * `2026-02-30T00:00:00.000Z` форму проходит, а моментом времени не является.
 */
export function assertCanonicalInstant(value, where) {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value)) {
    throw new TypeError(
      `${where}: ожидается канонический момент вида 2026-08-13T00:00:00.000Z, получено ${JSON.stringify(value)}`,
    )
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${where}: ${JSON.stringify(value)} не существует как момент времени`)
  }
  return parsed.getTime()
}

/**
 * `Object.freeze` мелкий: он закрывает верхний объект и оставляет вложенные
 * живыми. Проверенный план обязан быть неизменяемым целиком — иначе
 * «проверено» относится к состоянию, которого уже нет.
 *
 * Циклов здесь быть не может: канонизация отвергает их до этой точки.
 */
export function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  Object.freeze(value)
  for (const key of Object.getOwnPropertyNames(value)) deepFreeze(value[key])
  return value
}
