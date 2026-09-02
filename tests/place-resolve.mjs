/**
 * Опознание места: проверки гейта на подставном Google.
 *
 * Сеть тут не нужна и вредна: тест обязан падать от логики, а не от того,
 * что Google сегодня переименовал объект.
 */
import { resolvePlace, namesAgree } from '../src/lib/place-resolve.ts'
import { canonicalPrefecture, PREFECTURES } from '../src/lib/prefectures.ts'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  actual === expected ? ok++ : bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
/* Проверка ВХОЖДЕНИЯ, а не равенства: причина отказа обязана называть уровень
   повреждения, но её полный текст — не контракт, и закреплять его целиком
   значит ломать набор при каждой правке формулировки. */
const has = (label, text, needle) => {
  if (typeof text === 'string' && text.includes(needle)) ok++
  else bad.push(`${label}: в ${JSON.stringify(text)} нет «${needle}»`)
}

// ── Префектуры ──────────────────────────────────────────────────────────
t('всех сорок семь', PREFECTURES.length, 47)
t('английское имя', canonicalPrefecture('Kyoto')?.ru, 'Киото')
// Ровно тот случай, из-за которого таблица и заведена: Google при
// languageCode=en иногда отдаёт японское название, и шесть записей
// уехали с «京都府» в английском поле.
t('японское имя приводится к паре', canonicalPrefecture('京都府')?.en, 'Kyoto')
t('с суффиксом Prefecture', canonicalPrefecture('Tokyo Prefecture')?.ru, 'Токио')
t('несуществующая отвергается', canonicalPrefecture('Мордор'), null)
t('пустая отвергается', canonicalPrefecture(''), null)

// ── Сверка имён ─────────────────────────────────────────────────────────
/* ПОЛИТИКА ТОЖДЕСТВА переписана в 10f-N FINAL по находке аудита F-01: прежняя
   вычёркивала родовые слова (`castle`, `station`, `park`, `museum`) и сравнивала
   остаток через `includes`, из-за чего принимала за одно место разные объекты.
   Теперь — равенство множеств значащих токенов; выбрасываются только
   грамматические слова, нормализуется только написание. */
t('одно и то же', namesAgree('Fushimi Inari Shrine', 'Fushimi Inari Taisha Shrine'), true)
t('разные места', namesAgree('Numa-no-Daira Plateau', 'Daisetsuzan National Park'), false)
t('короткое не сходится', namesAgree('Mt', 'Mount Fuji'), false)

/* Четыре пары аудита. Каждая принималась прежней политикой за одно место. */
t('замок и вокзал — разное', namesAgree('Osaka Castle', 'Osaka Station'), false)
t('парк и зоопарк — разное', namesAgree('Ueno Park', 'Ueno Zoo'), false)
t('музей и парк замка — разное', namesAgree('Osaka Museum of History', 'Osaka Castle Park'), false)
t('часть не равна целому', namesAgree('Nara Park', 'Nara'), false)

/* Различия написания тождества не нарушают. */
t('регистр и пробелы', namesAgree('Himeji Castle', 'himeji   castle'), true)
t('знаки препинания', namesAgree('Himeji Castle', 'Himeji-Castle!'), true)
t('диакритика', namesAgree('Ōsaka Castle', 'Osaka Castle'), true)
t('явный эквивалент mt/mount', namesAgree('Mt Fuji', 'Mount Fuji'), true)

/* Японские имена сравниваются строгим равенством написания: токенов у них нет,
   а послабление «одно внутри другого» вернуло бы дефект F-01. */
t('японское имя равно себе', namesAgree('海遊館', '海遊館'), true)
t('японская часть не равна целому', namesAgree('大阪城', '大阪城公園'), false)
t('разные алфавиты не сравниваются', namesAgree('海遊館', 'Osaka Aquarium Kaiyukan'), false)

// ── Гейт ────────────────────────────────────────────────────────────────
const google = (places) => async () => ({ ok: true, json: async () => ({ places }) })
const place = (id, name, lat, lon, pref, status = 'OPERATIONAL') => ({
  id, displayName: { text: name }, location: { latitude: lat, longitude: lon },
  businessStatus: status,
  addressComponents: pref ? [{ types: ['administrative_area_level_1'], longText: pref }] : [],
})
const run = (places, input = {}) =>
  resolvePlace({ nameEn: 'Fushimi Inari Shrine', siteCity: 'kyoto', ...input },
    { apiKey: 'k', fetchImpl: google(places) })

const good = await run([place('PID1', 'Fushimi Inari Taisha', 34.967, 135.772, 'Kyoto')])
t('совпадение принимается', good.place?.placeId, 'PID1')
t('префектура приводится', good.place?.prefecture?.ru, 'Киото')

// Имя проверяется ВСЕГДА. Без этого «тот же регион, недалеко» пропускал
// совершенно другой объект — так «Numa-no-Daira Plateau» однажды принял
// «Daisetsuzan National Park».
const wrongName = await run([place('PID2', 'Daisetsuzan National Park', 34.97, 135.77, 'Kyoto')])
t('чужое имя отвергается', wrongName.place, null)

const abroad = await run([place('PID3', 'Fushimi Inari Shrine', 48.85, 2.35, null)])
t('вне Японии отвергается', abroad.place, null)

const wrongPref = await run([place('PID4', 'Fushimi Inari Shrine', 34.7, 135.5, 'Osaka')], { prefectureEn: 'Kyoto' })
t('чужая префектура отвергается', wrongPref.place, null)

// Первый кандидат негоден, второй годен — берём второй, а не сдаёмся.
const second = await run([
  place('BAD', 'Some Ramen Shop', 34.9, 135.7, 'Kyoto'),
  place('GOOD', 'Fushimi Inari Shrine', 34.967, 135.772, 'Kyoto'),
])
t('перебирает кандидатов', second.place?.placeId, 'GOOD')

const empty = await run([])
t('пустой ответ — не падение', empty.place, null)
t('и с причиной', empty.reason.length > 0, true)
t('и машинный исход назван', empty.outcome, 'notFound')

/* ── Закрытый машинный исход вместо разбора текста ─────────────────────── */
t('успех назван машинно', good.outcome, 'resolved')

/* НЕОДНОЗНАЧНОСТЬ: проверки прошли двое. Прежняя редакция возвращала первого и
   не замечала второго — «нашли» было неотличимо от «не смогли выбрать». */
const twins = await run([
  place('TWIN1', 'Fushimi Inari Shrine', 34.967, 135.772, 'Kyoto'),
  place('TWIN2', 'Fushimi Inari Shrine', 34.968, 135.773, 'Kyoto'),
])
t('двое прошедших — ambiguous', twins.outcome, 'ambiguous')
t('и места не выдаётся', twins.place, null)

/* ПОВРЕЖДЁННЫЙ ОТВЕТ разбирается ВНУТРИ границы и наружу не бросает (F-24). */
/* ОПИСАНИЕ БРОШЕННОГО — БЕЗ ПРЯМОГО ЧТЕНИЯ. Прежняя редакция делала
   `error?.message` и падала ровно на том значении, ради которого написана: у
   `Error` с враждебным getter'ом чтение `message` бросает, и проверяющий
   аппарат умирал вместо того, чтобы назвать провал. Читается только
   собственный data-дескриптор, и любая ошибка рефлексии означает «текста нет». */
const said = (error) => {
  try {
    if (typeof error === 'string') return error
    if (error === null || typeof error !== 'object') return `значение типа ${error === null ? 'null' : typeof error}`
    const slot = Object.getOwnPropertyDescriptor(error, 'message')
    if (slot && 'value' in slot && typeof slot.value === 'string') return slot.value
    return 'объект без читаемого message'
  } catch {
    return '(описать не удалось)'
  }
}
const neverThrows = async (fn) => {
  try { return await fn() } catch (error) {
    return { outcome: `БРОСИЛ: ${said(error)}`, place: 'БРОСИЛ', reason: '' }
  }
}
const raw = (body) => neverThrows(() => resolvePlace({ nameEn: 'X Temple' },
  { apiKey: 'k', fetchImpl: async () => ({ ok: true, json: async () => body }) }))
for (const [label, body, outcome] of [
  ['тело null', null, 'malformedResponse'],
  ['тело массив', [], 'malformedResponse'],
  ['places не массив', { places: 5 }, 'malformedResponse'],
  ['places отсутствует', { x: 1 }, 'notFound'],
]) {
  const r = await raw(body)
  t(`повреждённый ответ: ${label}`, r.outcome, outcome)
  t(`и места нет: ${label}`, r.place, null)
}
{
  /* Заголовок `resolvePlace` обещает «ничего не бросает», и проверять это
     обещание надо ТАК, чтобы нарушение стало проваленной проверкой, а не
     падением набора: упавший набор не печатает итога, и регрессия выглядит
     сломанным тестом. */
  const r = await neverThrows(() => resolvePlace({ nameEn: 'X Temple' },
    { apiKey: 'k', fetchImpl: async () => ({ ok: true, json: async () => { throw new Error('BAD_JSON') } }) }))
  t('брошенный json() — providerError', r.outcome, 'providerError')
}
{
  const r = await resolvePlace({ nameEn: 'X Temple' },
    { apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) })
  t('ответ 500 — providerError', r.outcome, 'providerError')
}
{
  const r = await resolvePlace({ nameEn: 'X' }, { apiKey: 'k', fetchImpl: google([{ id: 'A' }]) })
  t('кандидат без координат не роняет', r.place, null)
}

/* ── ПОВРЕЖДЁННАЯ ВЛОЖЕННАЯ ФОРМА ОТВЕТА (аудит R1 к FINAL) ──────────────
   Тело проверялось на форму, а его содержимое — нет: `as Array<...>` и
   `as string[]` были обещанием компилятору, которого провайдер не давал.
   Каждый случай ниже выносил исключение НАРУЖУ мимо заголовка «ничего не
   бросает», и внешний catch в `poi-intake` или в портальной границе тут ни
   при чём — предмет проверки именно канонический резолвер. */
{
  const ok = (over = {}) => ({
    id: 'PID-OK', displayName: { text: 'Fushimi Inari Shrine' },
    location: { latitude: 34.967, longitude: 135.772 },
    businessStatus: 'OPERATIONAL', ...over,
  })
  const one = (over) => neverThrows(() => run([ok(over)]))

  /* 1–3: три ответа, предъявленные аудитом поимённо. */
  const notArray = await one({ addressComponents: {} })
  t('addressComponents объектом не роняет границу', notArray.place, null)
  t('и это назван повреждением ответа', notArray.outcome, 'malformedResponse')
  has('и причина называет addressComponents', notArray.reason, 'addressComponents не массив')

  const nullComponent = await one({ addressComponents: [null] })
  t('компонент null не роняет границу', nullComponent.place, null)
  t('компонент null назван повреждением ответа', nullComponent.outcome, 'malformedResponse')
  has('и причина называет компонент', nullComponent.reason, 'компонент адреса не объект')

  const typesNumber = await one({ addressComponents: [{ types: 42, longText: '兵庫県' }] })
  t('types числом не роняет границу', typesNumber.place, null)
  t('types числом назван повреждением ответа', typesNumber.outcome, 'malformedResponse')
  has('и причина называет types', typesNumber.reason, 'types не массив')

  /* Остальные уровни требования: каждый читается фактом, а не приведением. */
  const typesItem = await one({ addressComponents: [{ types: ['x', 7] }] })
  t('нестроковый элемент types — повреждение', typesItem.outcome, 'malformedResponse')
  has('и причина называет элемент types', typesItem.reason, 'types содержит не строку')

  const longNotString = await one({
    addressComponents: [{ types: ['administrative_area_level_1'], longText: 5 }],
  })
  t('longText не строкой — повреждение', longNotString.outcome, 'malformedResponse')
  const shortNotString = await one({
    addressComponents: [{ types: ['administrative_area_level_1'], longText: 'Kyoto', shortText: {} }],
  })
  t('shortText не строкой — повреждение', shortNotString.outcome, 'malformedResponse')

  const nullComponents = await one({ addressComponents: null })
  t('addressComponents = null — повреждение, а не «поля нет»', nullComponents.outcome, 'malformedResponse')
  const noComponents = await neverThrows(() => run([{
    id: 'PID-NOCOMP', displayName: { text: 'Fushimi Inari Shrine' },
    location: { latitude: 34.967, longitude: 135.772 }, businessStatus: 'OPERATIONAL',
  }]))
  t('отсутствие addressComponents законно', noComponents.outcome, 'resolved')
  t('и префектуры при этом нет', noComponents.place?.prefecture, null)

  const nameString = await one({ displayName: 'Fushimi Inari Shrine' })
  t('displayName строкой — повреждение', nameString.outcome, 'malformedResponse')
  has('и причина называет displayName', nameString.reason, 'displayName не объект')
  const textNumber = await one({ displayName: { text: 7 } })
  t('displayName.text не строкой — повреждение', textNumber.outcome, 'malformedResponse')

  const locString = await one({ location: { latitude: '34.967', longitude: 135.772 } })
  t('широта строкой — повреждение', locString.outcome, 'malformedResponse')
  has('и причина называет широту', locString.reason, 'location.latitude не конечное число')
  const locNan = await one({ location: { latitude: 34.967, longitude: Number.NaN } })
  t('долгота NaN — повреждение', locNan.outcome, 'malformedResponse')
  const locMissing = await one({ location: undefined })
  t('location отсутствует — повреждение', locMissing.outcome, 'malformedResponse')

  const idNumber = await one({ id: 42 })
  t('id числом — повреждение', idNumber.outcome, 'malformedResponse')
  const idEmpty = await one({ id: '   ' })
  t('пустой id — не повреждение, а отказ кандидату', idEmpty.outcome, 'notFound')
  has('и отказ назван', idEmpty.reason, 'без идентификатора места')

  const notObject = await neverThrows(() => run(['строка вместо кандидата']))
  t('кандидат строкой — повреждение', notObject.outcome, 'malformedResponse')
  const arrayCandidate = await neverThrows(() => run([[]]))
  t('кандидат массивом — повреждение', arrayCandidate.outcome, 'malformedResponse')

  /* Ядовитый геттер: чужой код исполняется внутри нашего чтения. */
  const poisoned = await neverThrows(() => run([ok({
    addressComponents: [{ get types() { throw new Error('ЯД') } }],
  })]))
  t('ядовитый геттер не роняет границу', poisoned.place, null)
  t('и даёт повреждение ответа', poisoned.outcome, 'malformedResponse')
  has('и причина названа отказом чтения', poisoned.reason, 'чтение кандидата отказало')

  /* ПОЛИТИКА СМЕШАННОГО ОТВЕТА — объявлена и различена тестом, а не выведена
     из поведения. Повреждённый кандидат отвергается, валидные продолжают
     оцениваться; «повреждено» и «не найдено» — разные исходы. */
  const mixedGood = await neverThrows(() => run([
    { id: 'BAD', displayName: { text: 'Fushimi Inari Shrine' }, location: { latitude: 34.967, longitude: 135.772 }, addressComponents: {} },
    place('GOOD', 'Fushimi Inari Taisha', 34.967, 135.772, 'Kyoto'),
  ]))
  t('валидный сосед повреждённого доходит до resolved', mixedGood.place?.placeId, 'GOOD')
  has('и отброшенный назван в причине', mixedGood.reason, 'Отброшено повреждённых кандидатов: 1')

  const mixedNone = await neverThrows(() => run([
    { id: 'BAD', displayName: { text: 'X' }, location: { latitude: 1, longitude: 2 }, addressComponents: [null] },
    place('OTHER', 'Daisetsuzan National Park', 34.97, 135.77, 'Kyoto'),
  ]))
  t('валидная структура была, но проверок не прошла — notFound', mixedNone.outcome, 'notFound')
  has('и повреждённый всё равно назван', mixedNone.reason, 'Отброшено повреждённых кандидатов: 1')

  const allBad = await neverThrows(() => run([{ addressComponents: {} }, null]))
  t('ни одной пригодной структуры — malformedResponse', allBad.outcome, 'malformedResponse')
  t('и места нет', allBad.place, null)
}

/* ── ФОРМАТИРОВАНИЕ БРОШЕННОГО ЗНАЧЕНИЯ (требование 6) ──────────────────
   `(error as Error).message` — приведение, а не факт: `throw null` роняло сам
   catch. Описание идёт через барьер, который не бросает ни на чём. */
{
  const thrownBy = (value) => neverThrows(() => resolvePlace({ nameEn: 'X Temple' }, {
    apiKey: 'k', fetchImpl: async () => { throw value },
  }))
  const hostile = new Error('видимое сообщение')
  Object.defineProperty(hostile, 'message', { get() { throw new Error('ЯД') } })
  const revoked = Proxy.revocable({}, {})
  revoked.revoke()

  for (const [label, value] of [
    ['null', null],
    ['undefined', undefined],
    ['Symbol', Symbol('секрет')],
    ['объект с бросающим message', hostile],
    ['отозванный Proxy', revoked.proxy],
    ['Proxy с бросающей ловушкой', new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('ЯД') } })],
    ['число', 42],
  ]) {
    const r = await thrownBy(value)
    t(`брошен ${label}: граница не падает`, r.place, null)
    t(`брошен ${label}: назван providerError`, r.outcome, 'providerError')
  }
  const secret = await thrownBy(Symbol('секрет-не-выносить'))
  t('текст символа наружу не выносится', secret.reason.includes('секрет-не-выносить'), false)
  const plain = await thrownBy(new Error('сеть легла'))
  has('обычный Error сохраняет сообщение', plain.reason, 'сеть легла')
}

/* ── Японский ключ и locationBias (F-04) ──────────────────────────────── */
{
  let seenBody = null
  const spy = async (_url, init) => {
    seenBody = JSON.parse(init.body)
    return { ok: true, json: async () => ({ places: [place('JA1', '海遊館', 34.6545, 135.4289, 'Osaka')] }) }
  }
  const r = await resolvePlace(
    { nameJa: '海遊館', nameEn: '', siteCity: 'osaka', prefectureEn: 'Osaka', locationBias: { lat: 34.6545, lon: 135.4289 } },
    { apiKey: 'k', fetchImpl: spy },
  )
  t('японское имя становится запросом', seenBody.textQuery, '海遊館')
  t('и язык запроса японский', seenBody.languageCode, 'ja')
  t('точка источника уходит предпочтением', seenBody.locationBias.circle.radius, 500)
  t('центр предпочтения — точка источника', seenBody.locationBias.circle.center.latitude, 34.6545)
  t('японское имя опознаётся', r.place?.placeId, 'JA1')
  t('и исход resolved', r.outcome, 'resolved')
}
{
  /* ОБА ИМЕНИ СРАЗУ. Прежде японский путь проверялся только там, где
     английского имени нет вовсе, и «японское имя главнее» было неотличимо от
     «берём единственное, что есть». У Telegram-пути имена приходят оба. */
  let seenBody = null
  const spy = async (_url, init) => {
    seenBody = JSON.parse(init.body)
    return { ok: true, json: async () => ({ places: [place('BOTH', '姫路城', 34.8394, 134.6939, 'Hyogo')] }) }
  }
  const r = await resolvePlace(
    { nameJa: '姫路城', nameEn: 'Himeji Castle', siteCity: 'himeji', prefectureEn: 'Hyogo' },
    { apiKey: 'k', fetchImpl: spy },
  )
  t('при двух именах запрос идёт японским', seenBody.textQuery, '姫路城')
  t('и язык при двух именах японский', seenBody.languageCode, 'ja')
  t('и место опознано японским именем', r.place?.placeId, 'BOTH')
}
{
  let seenBody = null
  const spy = async (_url, init) => {
    seenBody = JSON.parse(init.body)
    return { ok: true, json: async () => ({ places: [] }) }
  }
  await resolvePlace({ nameEn: 'Himeji Castle', siteCity: 'himeji' }, { apiKey: 'k', fetchImpl: spy })
  t('без японского имени язык остаётся английским', seenBody.languageCode, 'en')
  t('и предпочтения нет, когда точки нет', 'locationBias' in seenBody, false)
}
{
  let seenBody = null
  const spy = async (_url, init) => {
    seenBody = JSON.parse(init.body)
    return { ok: true, json: async () => ({ places: [] }) }
  }
  await resolvePlace({ nameEn: 'X', locationBias: { lat: 34.6, lon: Number.NaN } }, { apiKey: 'k', fetchImpl: spy })
  t('половина пары предпочтением не становится', 'locationBias' in seenBody, false)
}

/* ── Происхождение префектуры (F-16) ──────────────────────────────────── */
{
  const right = await run([place('P1', 'Fushimi Inari Shrine', 34.967, 135.772, 'Kyoto')], { prefectureEn: 'Kyoto' })
  t('Google вернул правильную префектуру', right.place?.prefecture?.en, 'Kyoto')
  const alien = await run([place('P2', 'Fushimi Inari Shrine', 34.7, 135.5, 'Osaka')], { prefectureEn: 'Kyoto' })
  t('чужая префектура отвергает кандидата', alien.place, null)
  const none = await run([place('P3', 'Fushimi Inari Shrine', 34.967, 135.772, null)], { prefectureEn: 'Kyoto' })
  t('Google префектуру не вернул — эха ожидания нет', none.place?.prefecture, null)
  t('и место при этом опознано', none.place?.placeId, 'P3')
  const unknown = await run([place('P4', 'Fushimi Inari Shrine', 34.967, 135.772, 'Мордор')], { prefectureEn: 'Kyoto' })
  t('неизвестное написание префектуры не приводится', unknown.place?.prefecture, null)
}

const noName = await resolvePlace({ nameEn: '' }, { apiKey: 'k', fetchImpl: google([]) })
t('без имени искать нечем', noName.place, null)
t('и это названный исход', noName.outcome, 'noQuery')

const failing = await neverThrows(() => resolvePlace({ nameEn: 'X Temple' },
  { apiKey: 'k', fetchImpl: async () => { throw new Error('сеть легла') } }))
t('падение сети не роняет приём', failing.place, null)
t('и названо исходом провайдера', failing.outcome, 'providerError')

t('статус доезжает', good.place?.businessStatus, 'OPERATIONAL')

console.log(bad.length ? `✗ провалено ${bad.length}:\n  ` + bad.join('\n  ') : `✓ опознание места: ${ok} проверок пройдено`)
process.exitCode = bad.length ? 1 : 0
