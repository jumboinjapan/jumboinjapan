/**
 * ГРАНИЦА НАДЁЖНОЙ ЗАПИСИ PARSER-OWNED WRITE-PATH (10f-R, P09.2 и P09.3).
 *
 * Что здесь доказывается и чего здесь нет. Доказывается ровно одно: ЧТО СТАЛО
 * С БАЗОЙ после попытки записи — и устанавливается это независимым чтением, а
 * не кодом ответа, не телом ответа, не локальным кэшем writer'а и не итоговым
 * счётчиком. До 10f-R исход брался из тела POST, а `findBySourceKey` отвечал из
 * кэша, куда запись положил сам writer (воспроизведено:
 * `tmp/10f-r-repro-OLD-2026-09-05.log`) — то есть writer подтверждал сам себя.
 *
 * Граница обёрнута вокруг ХРАНИЛИЩА, а не вставлена в `ingestPoi`. Причина не
 * стилистическая: `ingestPoi` — общая точка приёма, ею пользуется и Telegram-бот
 * (`docs/poi-writers-registry.md`, путь 1). Автоматический перенос данных
 * парсером — это ровно тот store, который собирает `collect-pois.mjs`, и
 * расширять пакет на редакторские, кроновые и административные writer'ы без
 * доказательства их принадлежности этому пути запрещено заданием. Обёртка
 * общая и переиспользуемая: любой другой writer может встать за неё, когда это
 * будет доказано отдельно.
 *
 * Чего граница НЕ делает: не повторяет запись, не откатывает её, ничего не
 * удаляет. Неизвестный исход остаётся неизвестным и уходит в поздний разбор по
 * журналу (`scripts/poi-portals/reconcile-writes.mjs`).
 */
import { describeThrownSafely } from '../../../src/lib/thrown-value.ts'
import { parseMoment } from '../../../src/lib/poi-coordinate-refresh.ts'
import { RECOVERY_STATES } from './write-journal.mjs'

export const VERIFIED_WRITE_SPEC = 'poi-verified-write/v1'

/** Способ независимой проверки — закрытый список, попадает в журнал и отчёт. */
export const VERIFICATION_KINDS = Object.freeze(['liveRead'])

/**
 * Отказ границы записи. Несёт СОСТОЯНИЕ (из закрытого списка журнала) и ключ
 * источника: вызывающий обязан отличать «эффекта не было» от «неизвестно».
 */
export class VerifiedWriteError extends Error {
  constructor({ state, sourceKey, reason, recordId = null, poiId = null }) {
    super(`${VERIFIED_WRITE_SPEC}: ${sourceKey}: ${state} — ${reason}`)
    this.name = 'VerifiedWriteError'
    this.state = state
    this.sourceKey = sourceKey
    this.reason = reason
    this.recordId = recordId
    this.poiId = poiId
    this.recoveryRequired = RECOVERY_STATES.includes(state)
  }
}

/**
 * Как проверять исход у ЭТОГО хранилища.
 *
 * Ровно один способ — независимое чтение мимо кэша (`readFreshBySourceKey`),
 * возвращающее и сырые поля записи. Хранилище без него за границу не
 * ставится: устанавливать исход кэшем writer'а или проекцией снимка запрещено
 * — кэш наполняет тот же writer, чей эффект проверяется, а проекция не видит
 * полей, которых в ней нет. Ветка «storeRead» из R0 снята: в production за
 * границу попадает только живое хранилище, и запасной способ, который
 * никогда не исполняется, ослаблял бы гарантию, ничего не давая.
 */
export function verificationFor(store) {
  if (typeof store?.readFreshBySourceKey !== 'function') {
    throw new TypeError(
      `${VERIFIED_WRITE_SPEC}: хранилище не умеет независимо перечитать запись `
      + '(readFreshBySourceKey). Устанавливать исход кэшем writer’а или проекцией снимка запрещено: '
      + 'кэш наполняет тот же writer, чей эффект проверяется.',
    )
  }
  /* Постинвариант писателя — «номер занят ровно одной записью» — тоже
     устанавливается независимым чтением, а не внутренней проверкой writer'а
     (10f-R R3, находка 1): если она отказала, `verified` без своего чтения
     по номеру был бы успехом при неустановленном инварианте. */
  if (typeof store?.readFreshByPoiId !== 'function') {
    throw new TypeError(
      `${VERIFIED_WRITE_SPEC}: хранилище не умеет независимо перечитать записи по номеру `
      + '(readFreshByPoiId): постинвариант уникальности POI ID установить нечем.',
    )
  }
  return {
    kind: 'liveRead',
    read: (sourceKey, fieldNames) => store.readFreshBySourceKey(sourceKey, fieldNames),
    readByPoiId: (poiId) => store.readFreshByPoiId(poiId),
  }
}

/** Значение поля, которое Airtable не хранит: пустая строка, null, undefined. */
const absent = (value) => value === undefined || value === null || value === ''

/**
 * Равенство одного поля — то, что обещано, против того, что прочитано.
 * Нормализуется только различие «отсутствует», объявленное самим Airtable
 * (пустое значение не хранится); всё остальное сравнивается точно.
 */
const INSTANT_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/
/**
 * Момент — КАЛЕНДАРНО СТРОГИЙ (10f-R R5, находка 2). `Date.parse` нормализует
 * переполнение: `2026-02-31T12:00:00.000Z` он читал как 3 марта, и невозможный
 * момент подтверждал поле записи. Разбор — `parseMoment` (10f-P): день по
 * месяцу, високосный год, диапазоны времени; иначе null.
 */
const asInstant = (value) => (typeof value === 'string' && INSTANT_SHAPE.test(value) ? parseMoment(value) : null)

export function fieldEquals(expected, actual) {
  if (absent(expected) && absent(actual)) return true
  if (absent(expected) || absent(actual)) return false
  /* Момент времени: Airtable возвращает dateTime в своём каноническом ISO
     (с миллисекундами или без — по настройке поля). Сравнивается САМ момент,
     а не его написание; это единственная нормализация помимо «отсутствует»,
     и она объявлена самим типом поля. Значение ФОРМЫ момента, но календарно
     невозможное, не равно ничему — даже побайтово такой же строке: такого
     момента нет, и подтверждать им поле нельзя. */
  const shaped = (v) => typeof v === 'string' && INSTANT_SHAPE.test(v)
  if (shaped(expected) || shaped(actual)) {
    const left = asInstant(expected)
    const right = asInstant(actual)
    if (left === null || right === null) return false
    return left === right
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) return false
    const key = (v) => JSON.stringify(v)
    const left = expected.map(key).sort()
    const right = actual.map(key).sort()
    return left.every((v, i) => v === right[i])
  }
  if (typeof expected === 'object' || typeof actual === 'object') {
    return JSON.stringify(expected) === JSON.stringify(actual)
  }
  return expected === actual
}

/** Тождество прочитанной записи — непустой id из базы; иначе его нет. */
const identityOf = (row) => {
  const id = row?.recordId ?? row?.id ?? null
  return typeof id === 'string' && id.trim() ? id : null
}
/** Номер, который запись НЕСЁТ (из сырых полей либо проекции); иначе null. */
const numberOf = (row) => {
  const number = row?.fields?.['POI ID'] ?? row?.poiId ?? null
  return typeof number === 'string' && number.trim() ? number : null
}
/** Ключ источника, который запись несёт; иначе null. */
const sourceKeyOfRow = (row) => {
  const key = row?.fields?.['Source Key'] ?? row?.sourceKey ?? null
  return typeof key === 'string' && key.trim() ? key : null
}

/**
 * Классификация исхода по РЕЗУЛЬТАТУ НЕЗАВИСИМОГО ЧТЕНИЯ. Чистая функция: ни
 * сети, ни журнала. Аргументы описывают факты, а не намерения.
 *
 * СОДЕРЖАНИЕ СВЕРЯЕТСЯ, А НЕ ТОЛЬКО ФАКТ НАХОЖДЕНИЯ (10f-R R1, находка
 * аудита 1). До R1 сравнивались число записей и `recordId`: PATCH
 * переименования, заявивший `POI-000002`, при записи с `POI-000001` в базе
 * давал `verified`; запись с чужими полями — тоже. Теперь `verified` требует:
 * ровно одна запись; тот же `recordId` и тот же `POI ID`, если writer их
 * назвал; и совпадение КАЖДОГО обещанного поля с прочитанным.
 *
 * Отсутствие сырых полей в прочитанном — `unknown`, а не «сверять нечего»:
 * проверка, которую нельзя выполнить, не пройдена.
 *
 * ТОЖДЕСТВО ЗАПИСИ — ИЗ БАЗЫ, И ТОЛЬКО ИЗ НЕЁ (10f-R R3, находка 2). Строка
 * без `recordId` в прочитанном — не «та же запись, id возьмём у writer'а», а
 * `unknown`: тождество не установлено, и подставлять заявленный id значит
 * верить writer'у в том самом месте, где его проверяют. Ни один результат
 * здесь не берёт `recordId`/`poiId` из `claimed`.
 *
 * ПОСТИНВАРИАНТ УНИКАЛЬНОСТИ (10f-R R3, находка 1). `verified` требует ещё
 * одного независимого чтения — по ожидаемому номеру: ровно одна запись, и это
 * та же запись. Без этого чтения (или при его отказе) исход — `unknown`, даже
 * если строка по ключу источника совпала с ожидаемым итогом поле в поле:
 * совпадение полей созданной строки не устанавливает глобальный инвариант
 * писателя. Так внутренняя проверка уникальности writer'а, отказавшая после
 * POST, не превращается в успех; а потерянный ответ POST по-прежнему
 * устанавливается чтением — двумя чтениями.
 *
 * @param claimed    что writer заявил (`{ poiId, recordId }`) или null, если он бросил
 * @param expected   что было обещано: `{ fields }` из намерения
 * @param found      что вернуло независимое чтение по ключу источника: запись, null или массив
 * @param readError  описание отказа этого чтения или null
 * @param uniqueness независимое чтение по ожидаемому номеру: `{ found, readError }` или null (не читалось)
 */
export function classifyWriteOutcome({ claimed, expected, found, readError, effectIntended = true, uniqueness = null }) {
  if (readError !== null && readError !== undefined) {
    return { state: 'unknown', reason: `независимое чтение отказало: ${readError}` }
  }
  const rows = found === null || found === undefined ? [] : (Array.isArray(found) ? found : [found])
  if (!effectIntended) {
    /* Хранилище не объявило ни одного эффекта: намерение пишется ДО него,
       значит, эффекта не было. Пустое чтение это подтверждает; непустое —
       чужая запись под нашим ключом, и это расхождение, а не успех. */
    if (rows.length === 0) return { state: 'notApplied', reason: 'эффект не объявлялся и записи нет — эффект не состоялся' }
    return { state: 'mismatch', reason: `эффект не объявлялся, а независимое чтение нашло ${rows.length} записей с этим ключом` }
  }
  if (!expected || typeof expected.fields !== 'object' || expected.fields === null) {
    return { state: 'unknown', reason: 'ожидаемые поля не переданы — сверять содержание нечем' }
  }
  /* Чтение по ключу источника доказывает себя само: каждая вернувшаяся
     запись обязана нести запрошенный ключ, иначе это ответ не на тот вопрос
     (R4). Проверяется ДО подсчёта: чужая запись не делает исход ambiguous. */
  const askedKey = expected.fields['Source Key']
  if (typeof askedKey === 'string' && askedKey && rows.some((r) => sourceKeyOfRow(r) !== askedKey)) {
    return { state: 'unknown', reason: `чтение по ключу ${JSON.stringify(askedKey)} отдало запись с другим ключом источника — результат не доказывает исход, фильтру сервера не верим` }
  }
  if (rows.length > 1) {
    return { state: 'ambiguous', reason: `независимое чтение нашло ${rows.length} записей с этим ключом источника` }
  }
  if (rows.length === 0) {
    return claimed
      ? { state: 'mismatch', reason: `writer отчитался записью ${claimed.recordId ?? '(без id)'}, независимое чтение её не нашло` }
      : { state: 'notApplied', reason: 'записи нет — эффект не состоялся' }
  }
  const row = rows[0]
  const recordId = identityOf(row)
  const poiId = numberOf(row)
  if (!recordId) {
    return { state: 'unknown', reason: 'независимое чтение отдало запись без id — тождество записи не установлено, заявка writer’а его не заменяет', recordId: null, poiId }
  }
  if (claimed?.recordId && claimed.recordId !== recordId) {
    return { state: 'mismatch', reason: `writer отчитался ${claimed.recordId}, в базе ${recordId}`, recordId, poiId }
  }
  if (claimed?.poiId && poiId && claimed.poiId !== poiId) {
    return { state: 'mismatch', reason: `writer отчитался номером ${claimed.poiId}, в базе ${poiId}`, recordId, poiId }
  }
  if (typeof row?.fields !== 'object' || row.fields === null) {
    return { state: 'unknown', reason: 'независимое чтение не отдало полей записи — сверить содержание нечем', recordId, poiId }
  }
  const differing = Object.keys(expected.fields)
    .filter((key) => !fieldEquals(expected.fields[key], row.fields[key]))
  if (differing.length) {
    const show = (value) => (absent(value) ? '(пусто)' : JSON.stringify(value).slice(0, 60))
    const described = differing.map((key) => `${key}: ожидалось ${show(expected.fields[key])}, в базе ${show(row.fields[key])}`).join('; ')
    return {
      state: 'mismatch',
      reason: `содержание записи ${recordId ?? '(без id)'} расходится с ожидаемым итогом — ${described}`,
      recordId,
      poiId,
      differing,
    }
  }
  /* Постинвариант уникальности номера — своим чтением. */
  const expectedPoiId = expected.fields['POI ID']
  if (!uniqueness) {
    return { state: 'unknown', reason: 'постинвариант уникальности POI ID не проверялся независимым чтением — исход не установлен', recordId, poiId }
  }
  if (uniqueness.readError !== null && uniqueness.readError !== undefined) {
    return { state: 'unknown', reason: `постинвариант уникальности POI ID не установлен: чтение по номеру отказало: ${uniqueness.readError}`, recordId, poiId }
  }
  const byPoiId = uniqueness.found === null || uniqueness.found === undefined ? [] : (Array.isArray(uniqueness.found) ? uniqueness.found : [uniqueness.found])
  const ids = byPoiId.map(identityOf)
  if (ids.some((id) => !id)) {
    return { state: 'unknown', reason: 'чтение по номеру отдало запись без id — постинвариант уникальности не установлен', recordId, poiId }
  }
  /* РЕЗУЛЬТАТ ЧТЕНИЯ ДОКАЗЫВАЕТ СЕБЯ САМ (10f-R R4, находка 2). Фильтру
     сервера доверять нельзя: запись, вернувшаяся на запрос «все с номером X»,
     обязана нести именно X. Запись с другим номером или без номера —
     ответ не на тот вопрос, и уникальность им не установлена. */
  const foreign = byPoiId.filter((row) => numberOf(row) !== expectedPoiId)
  if (foreign.length) {
    const shown = foreign.map((row) => `${identityOf(row)}: ${numberOf(row) === null ? '(без номера)' : JSON.stringify(numberOf(row))}`).join(', ')
    return { state: 'unknown', reason: `чтение по номеру ${expectedPoiId} отдало запись не с этим номером (${shown}) — результат не доказывает уникальность, фильтру сервера не верим`, recordId, poiId }
  }
  if (byPoiId.length > 1) {
    return { state: 'mismatch', reason: `номер ${expectedPoiId} занят ${byPoiId.length} записями (${ids.join(', ')}) — постинвариант уникальности нарушен`, recordId, poiId, differing: ['POI ID'] }
  }
  if (byPoiId.length === 0) {
    return { state: 'unknown', reason: `чтения расходятся: по ключу источника запись ${recordId} несёт номер ${expectedPoiId}, а чтение по номеру её не нашло`, recordId, poiId }
  }
  if (ids[0] !== recordId) {
    return { state: 'mismatch', reason: `номер ${expectedPoiId} принадлежит записи ${ids[0]}, а по ключу источника найдена ${recordId}`, recordId, poiId, differing: ['POI ID'] }
  }
  return {
    state: 'verified',
    reason: claimed
      ? 'независимое чтение нашло ровно одну запись с этим ключом: тот же id, тот же номер, все обещанные поля совпали; номер занят только ею'
      : 'независимое чтение нашло ровно одну запись с этим ключом, все обещанные поля совпали с намерением; номер занят только ею',
    recordId,
    poiId,
  }
}


/** Поля так, как они уйдут в базу: `undefined` в JSON не существует. */
export function intendedFields(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
}

const sourceKeyOf = (fields) => {
  const value = fields?.['Source Key']
  return typeof value === 'string' && value.trim() ? value : null
}

/**
 * Оборачивает `create` хранилища проверяемой записью.
 *
 * Порядок неизменен и является предметом проверки:
 *   намерение в журнал → эффект → НЕЗАВИСИМОЕ ЧТЕНИЕ → исход в журнал.
 *
 * Возвращает НОВЫЙ объект: исходное хранилище не мутируется, и тождество
 * хранилища в памяти (`isMemoryPoiStore`) обёрткой не подделывается — обёртка
 * ставится только на живой путь записи, а для снимка и dry-run её незачем.
 *
 * Обёртка ставится ТОЛЬКО на живой путь записи. Для dry-run и снимка её нет
 * вовсе: там нет эффекта, который надо доказывать, а журнал с исходами такого
 * прогона был бы журналом успеха, которого не было. Отсутствие журнала —
 * отказ, а не «значит, это dry-run»: признак режима не выводится из
 * подставленной зависимости.
 *
 * @param options.journal   журнал (`write-journal.mjs`); обязателен
 * @param options.onOutcome наблюдатель исходов — им отчёт собирает поимённый префикс
 */
export function withVerifiedWrites(store, { journal, maxRenames = 0, onOutcome = () => {} } = {}) {
  if (!journal || typeof journal.intent !== 'function' || typeof journal.outcome !== 'function') {
    throw new TypeError(`${VERIFIED_WRITE_SPEC}: живая запись без журнала не начинается — доказательству намерения негде лечь`)
  }
  /* БЮДЖЕТ ВНУТРЕННИХ ПЕРЕИМЕНОВАНИЙ (10f-S R1, находка 4).
     PATCH переименования номера — ЭФФЕКТ, и до R1 он не входил ни в один
     потолок: разрешение владельца называло только `maxCreates`, а текст
     разрешения обещал «только создание». Теперь бюджет объявлен числом и
     считается здесь, на той же границе, что и всё остальное. Ноль означает
     ровно то, что написано в разрешении: при коллизии номера прогон
     останавливается ДО PATCH. Умолчание — ноль: незаявленный бюджет не
     означает «сколько угодно». */
  if (!Number.isInteger(maxRenames) || maxRenames < 0) {
    throw new TypeError(`${VERIFIED_WRITE_SPEC}: бюджет переименований обязан быть целым не меньше нуля, получено ${JSON.stringify(maxRenames)}`)
  }
  let renamesUsed = 0
  const verification = verificationFor(store)

  const wrapped = Object.create(Object.getPrototypeOf(store))
  for (const key of Reflect.ownKeys(store)) {
    Object.defineProperty(wrapped, key, Object.getOwnPropertyDescriptor(store, key))
  }

  wrapped.create = async (fields) => {
    const sourceKey = sourceKeyOf(fields)
    if (!sourceKey) {
      /* Ключ источника — единственное, по чему запись можно найти независимым
         чтением. Без него доказать исход нечем, и запись не начинается. */
      throw new VerifiedWriteError({
        state: 'notApplied',
        sourceKey: '(без ключа источника)',
        reason: 'у записи нет Source Key: независимым чтением её потом не найти, эффект не начат',
      })
    }
    /* 1. НАМЕРЕНИЕ — ДО первого сетевого вызова. Отказ здесь означает, что
          эффекта не было вовсе: писать, не сумев записать намерение, значит
          заводить эффект без доказательства. Шаг `prepare` несёт входные поля;
          ТОЧНУЮ нагрузку назовёт хранилище перед каждым своим эффектом. */
    const promised = intendedFields(fields)
    await journal.intent({ sourceKey, verification: verification.kind, step: 'prepare', fields: promised })

    /* ПОЛНЫЙ ОЖИДАЕМЫЙ ИТОГ (10f-R R2, находка аудита 1). До R2 намерение
       знало только вход `store.create`, а не то, что хранилище добавляет само
       (`POI ID`, `POI Category (EN)`, `Last Seeded At`) и в какой номер
       переименовывает запись при коллизии; PATCH переименования, отказавший
       500, оставлял дублирующий номер, а сверка по входным полям объявляла
       успех. Теперь хранилище ДОЖИДАЕТСЯ намерения перед каждым эффектом с
       точной нагрузкой, и ожидаемый итог — нагрузка POST с номером
       последнего переименования. Именно он сверяется с прочитанным. */
    let expected = null
    const onEffect = async (effect) => {
      if (effect?.step === 'create') {
        expected = { ...effect.payload }
        await journal.intent({ sourceKey, verification: verification.kind, step: 'create', fields: expected })
        return
      }
      if (effect?.step === 'rename') {
        if (!expected) throw new VerifiedWriteError({ state: 'unknown', sourceKey, reason: 'переименование объявлено раньше создания — порядок эффектов нарушен' })
        /* Отказ ДО намерения и, значит, до PATCH: хранилище дожидается этого
           вызова, поэтому брошенное здесь значение отменяет второй эффект, а
           не сопровождает его. Запись при этом уже создана с занятым номером —
           исход назовёт независимое чтение, и постинвариант уникальности
           сделает его расхождением, требующим ручного вмешательства. */
        if (renamesUsed >= maxRenames) {
          throw new VerifiedWriteError({
            state: 'mismatch',
            sourceKey,
            recordId: effect.recordId ?? null,
            recoveryRequired: true,
            reason: `бюджет переименований исчерпан (${maxRenames}): PATCH номера ${effect.from ?? '(неизвестен)'} не выполняется, прогон останавливается`,
          })
        }
        renamesUsed += 1
        /* Нагрузка PATCH берётся из объявления хранилища как есть: граница
           не называет полей записи (P07), она лишь запоминает обещанное. */
        const renamed = { ...effect.payload }
        await journal.intent({
          sourceKey, verification: verification.kind, step: 'rename',
          fields: renamed, recordId: effect.recordId, from: effect.from,
        })
        expected = { ...expected, ...renamed }
        return
      }
      throw new VerifiedWriteError({ state: 'unknown', sourceKey, reason: `хранилище объявило неизвестный эффект ${JSON.stringify(effect?.step)}` })
    }

    /* 2. ЭФФЕКТ. Брошенное значение описывается безопасно: враждебный объект
          не должен выносить своё исключение мимо границы. */
    let claimed = null
    let effectError = null
    try {
      claimed = await store.create(fields, { onEffect })
    } catch (thrown) {
      effectError = describeThrownSafely(thrown)
    }

    /* 3. НЕЗАВИСИМОЕ ЧТЕНИЕ. Оно же — единственный источник исхода: по ключу
          источника (содержание) и по ожидаемому номеру (постинвариант
          уникальности). Второе чтение — только когда номер обещан. */
    let found = null
    let readError = null
    try {
      found = await verification.read(sourceKey, Object.keys(expected ?? promised))
    } catch (thrown) {
      readError = describeThrownSafely(thrown)
    }
    let uniqueness = null
    if (expected && typeof expected['POI ID'] === 'string' && expected['POI ID']) {
      try {
        uniqueness = { found: await verification.readByPoiId(expected['POI ID']), readError: null }
      } catch (thrown) {
        uniqueness = { found: null, readError: describeThrownSafely(thrown) }
      }
    }

    /* Хранилище не назвало нагрузку — эффекта быть не могло (намерение
       пишется до него). Тогда единственный доказуемый исход — «записи нет»;
       найденная запись при этом — расхождение, а не успех. */
    const classified = classifyWriteOutcome({
      claimed,
      expected: expected ? { fields: expected } : null,
      found,
      readError,
      effectIntended: Boolean(expected),
      uniqueness,
    })
    /* Тождество в исходе — ТОЛЬКО из базы. Заявка writer'а идёт в причину,
       не в поля исхода: подставленный id выглядел бы как прочитанный. */
    const claimedNote = claimed ? `; writer заявил ${claimed.recordId ?? '(без id)'} / ${claimed.poiId ?? '(без номера)'}` : ''
    const outcome = {
      sourceKey,
      state: classified.state,
      reason: `${classified.reason}${classified.state === 'verified' ? '' : claimedNote}${effectError ? `; writer сообщил об ошибке: ${effectError}` : ''}`,
      verification: verification.kind,
      recordId: classified.recordId ?? null,
      poiId: classified.poiId ?? null,
      ...(classified.differing ? { differing: classified.differing } : {}),
    }
    /* 4. ИСХОД — в журнал. Отказ записи исхода после возможного эффекта — это
          `recoveryRequired`, а не «всё хорошо»: эффект есть, доказательства нет. */
    try {
      await journal.outcome(outcome)
    } catch (thrown) {
      const reason = `исход не записан в журнал после возможного эффекта: ${describeThrownSafely(thrown)}`
      onOutcome({ ...outcome, state: 'unknown', reason })
      throw new VerifiedWriteError({ state: 'unknown', sourceKey, reason, recordId: outcome.recordId, poiId: outcome.poiId })
    }
    onOutcome(outcome)

    if (outcome.state !== 'verified') {
      throw new VerifiedWriteError({
        state: outcome.state, sourceKey, reason: outcome.reason, recordId: outcome.recordId, poiId: outcome.poiId,
      })
    }
    /* ОТВЕТ ПОТЕРЯН, ЭФФЕКТ ДОКАЗАН. Writer бросил, а независимые чтения
       нашли ровно одну запись, совпадающую с намерением по всем обещанным
       полям, и номер занят только ею: исход установлен чтением, а не
       догадкой. Запись возвращается с номером и id ИЗ БАЗЫ — всегда, не только
       при потерянном ответе: заявка writer'а уже сверена с базой и больше не
       нужна. */
    return { poiId: outcome.poiId, recordId: outcome.recordId }
  }

  return wrapped
}
