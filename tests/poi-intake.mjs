/**
 * Путь приёма из Telegram: разбор ответа исследователя.
 *
 * До 10.08.2026 тестов тут не было вовсе — модуль импортировал '@/lib/...',
 * а прогон идёт голым node без резолвера алиасов, и файл просто не грузился.
 * Отсутствие тестов было не решением, а следствием одной строки импорта.
 */
import { intakePoi, parseResearchJson, findParentCandidate, POI_CATEGORIES_RU } from '../src/lib/poi-intake.ts'
import { buildReport } from '../src/lib/poi-intake-report.ts'
import { matchPoi, toPoiLike, PARENT_MIN } from '../src/lib/poi-matching.ts'

let ok = 0
const bad = []
const t = (label, actual, expected) => {
  if (actual === expected) ok++
  else bad.push(`${label}: ждали ${JSON.stringify(expected)}, получили ${JSON.stringify(actual)}`)
}
const j = (o) => JSON.stringify(o)

// ── Статус работы: асимметричное правило ────────────────────────────────
//
// Закрытие и сезонность модель ЧИТАЕТ — с таблички, из новости, с сайта.
// «Работает» же нигде не написано: это вывод из того, что обратного не
// нашлось, и модель делает его охотно. Единственный статус, проходящий
// без замечаний, обязан приходить из проверяемого источника — от Google.
t('закрытие принимается', parseResearchJson(j({nameRu:'Т', operatingStatus:'Закрыт навсегда'})).operatingStatus, 'Закрыт навсегда')
t('сезонность принимается', parseResearchJson(j({nameRu:'Т', operatingStatus:'Сезонный'})).operatingStatus, 'Сезонный')
t('«Работает» подрезается', parseResearchJson(j({nameRu:'Т', operatingStatus:'Работает'})).operatingStatus, '')
t('«Не проверено» тоже подрезается', parseResearchJson(j({nameRu:'Т', operatingStatus:'Не проверено'})).operatingStatus, '')
t('мусор подрезается', parseResearchJson(j({nameRu:'Т', operatingStatus:'открыто вроде'})).operatingStatus, '')
t('пусто остаётся пустым', parseResearchJson(j({nameRu:'Т'})).operatingStatus, '')
t('регистр не мешает', parseResearchJson(j({nameRu:'Т', operatingStatus:'закрыт временно'})).operatingStatus, 'Закрыт временно')

// ── Разбор ответа ───────────────────────────────────────────────────────
t('имя обязательно', (() => { try { parseResearchJson(j({nameRu:''})); return 'без ошибки' } catch { return 'ошибка' } })(), 'ошибка')
t('markdown-обёртка снимается', parseResearchJson('```json\n{"nameRu":"Храм"}\n```').nameRu, 'Храм')
t('город в нижний регистр', parseResearchJson(j({nameRu:'Т', siteCity:'Kyoto'})).siteCity, 'kyoto')
t('категорий не больше трёх', parseResearchJson(j({nameRu:'Т', categoriesRu:['Музей','СПА','Шоппинг','Ресторан']})).categoriesRu.length, 3)
t('otherLocations без имён отбрасываются', parseResearchJson(j({nameRu:'Т', otherLocations:[{nameRu:'',nameEn:'',siteCity:'x'},{nameRu:'Есть',nameEn:'',siteCity:'y'}]})).otherLocations.length, 1)

// ── Категории берутся из канона, а не из копии ──────────────────────────
//
// Своя копия списка тут была и разошлась с каноном в день, когда в него
// добавили «Знаковый вид»: applyCanon категорию принимал, а бот о ней
// не знал и предложить не мог.
t('канон категорий один', POI_CATEGORIES_RU.includes('Знаковый вид'), true)

// ── Родитель линкуется только при уверенном совпадении ──────────────────
//
// Требование строже, чем у дедупликации: заглушки-родители раньше
// создавались в обход проверок и были основным источником дублей.
const rec = (id, ru, en, city) => ({ id, fields: { 'POI ID': id, 'POI Name (RU)': ru, 'POI Name (EN)': en, 'Site City': city } })
const pool = [
  rec('POI-000001', 'Святилище Фусими Инари', 'Fushimi Inari Shrine', 'kyoto'),
  rec('POI-000002', 'Храм Киёмидзудэра', 'Kiyomizudera Temple', 'kyoto'),
]
const parent = (ru, en, city) => findParentCandidate({ parentNameRu: ru, parentNameEn: en, siteCity: city }, pool)
t('точное имя находит родителя', parent('Святилище Фусими Инари', '', 'kyoto')?.hint?.poiId ?? 'нет', 'POI-000001')
t('чужое имя родителя не даёт', parent('Замок Химэдзи', '', 'himeji')?.hint?.poiId ?? 'нет', 'нет')
t('пустое имя родителя не даёт', parent('', '', 'kyoto')?.hint?.poiId ?? 'нет', 'нет')
t('английское имя тоже находит', parent('', 'Fushimi Inari Shrine', 'kyoto')?.hint?.poiId ?? 'нет', 'POI-000001')

// ── Публичная граница findParentCandidate: контракт идентичности ────────
//
// findParentCandidate — НЕ отдельная реализация выбора родителя: это обёртка
// над screenNewPoi, и она наследует контракт PoiMatch.issues. Раньше это
// нигде не было закреплено исполнением, и утверждение держалось на чтении
// кода. Два теста ниже закрепляют границу так, как её видит вызывающий:
// на входе — записи Airtable, на выходе — родитель или null.
{
  const wrong = rec('PARENT-WRONG', 'Дом-проект: Кадоя', 'Echigo-Tsumari: Kadoya', 'naoshima')
  const clean = rec('PARENT-OK', 'Дом-проект: Кадоя', 'Art House Project: Kadoya', 'naoshima')
  const ask = (records) => findParentCandidate(
    { parentNameRu: 'Дом-проект: Кадоя', parentNameEn: 'Art House Project: Kadoya', siteCity: 'naoshima' },
    records,
  )

  // 1. Единственный кандидат — с несогласованными полями имён.
  t('спорный кандидат не выдаётся за родителя', ask([wrong]), null)

  // 2. Есть чистый и спорный — выдаётся чистый, и порядок записей не решает.
  //    Порядок проверяется обеими перестановками намеренно: выбор «первый
  //    по списку» уже был здесь однажды и молча проставлял неверного родителя.
  t('чистый кандидат выигрывает у спорного', ask([clean, wrong])?.hint?.poiId ?? 'нет', 'PARENT-OK')
  t('и в обратном порядке тоже', ask([wrong, clean])?.hint?.poiId ?? 'нет', 'PARENT-OK')

  // 3. КОНТРОЛЬНЫЙ КОНТРПРИМЕР СТАРОГО ПРАВИЛА.
  //    Продуктовый код здесь НЕ изменяется и не подменяется. Тест просто
  //    исполняет рядом два правила выбора родителя на одном и том же входе:
  //    прежнее — «взять лучшего по весу, порог PARENT_MIN» — и действующее,
  //    через публичную границу findParentCandidate. Результаты различаются:
  //    прежнее выдаёт спорного кандидата, действующее — null. Это показывает,
  //    что ответ определяется фильтром по issues, а не порогом веса.
  //
  //    Роль сторожа при этом играют не эти строки, а регрессионные
  //    утверждения выше: если findParentCandidate снова начнёт выбирать
  //    только по весу, они упадут сами по себе.
  const byScoreOnly = (records) =>
    matchPoi(
      { nameRu: 'Дом-проект: Кадоя', nameEn: 'Art House Project: Kadoya', siteCity: 'naoshima' },
      records.map(toPoiLike),
    ).filter((m) => m.score >= PARENT_MIN)[0] ?? null
  t('старое правило выбрало бы спорного кандидата',
    byScoreOnly([wrong])?.candidate.poiId ?? 'нет', 'PARENT-WRONG')
  t('и оно проходило бы по порогу веса', byScoreOnly([wrong])?.score >= PARENT_MIN, true)
  t('а у спорного кандидата расхождение видно',
    byScoreOnly([wrong])?.issues.map((i) => i.kind).join(','), 'collection_conflict')
  t('новое правило на том же входе даёт null', ask([wrong]), null)
}



// ── Один Intake — один Run ID ───────────────────────────────────────────
// Одно сообщение боту рождает до трёх записей: главный POI, заглушку
// родителя и заглушки из списка мест. Все они обязаны нести один и тот же
// идентификатор запуска, иначе по базе нельзя ответить, что приехало одним
// заходом, и разобрать неудачный приём целиком тоже нечем.
{
  const created = []
  let n = 0
  const store = {
    async listExisting() { return created.map((f) => ({
      poiId: f['POI ID'], nameRu: f['POI Name (RU)'], siteCity: f['Site City'], recordId: f.recordId })) },
    async findBySourceKey() { return null },
    async create(fields) {
      const poiId = `POI-00${900 + n++}`
      created.push({ ...fields, 'POI ID': poiId, recordId: `rec${poiId}` })
      return { poiId, recordId: `rec${poiId}` }
    },
  }
  const research = {
    nameRu: 'Храм Кэнниндзи', nameEn: 'Kenninji Temple', siteCity: 'kyoto',
    prefectureRu: 'Киото', prefectureEn: 'Kyoto', categoriesRu: ['Буддийский храм'],
    workingHours: '', ticketsNote: '', website: '', descriptionRu: 'Описание объекта.',
    descriptionEn: 'Object description.', parentNameRu: 'Район Гион', parentNameEn: 'Gion',
    otherLocations: [{ nameRu: 'Улица Ханамикодзи', nameEn: 'Hanamikoji', siteCity: 'kyoto' }],
    sources: [], openQuestions: [], operatingStatus: '',
  }
  // Каждая зависимость подставляется отдельно. Подстановка хранилища сама по
  // себе НЕ отключает внешние источники — иначе другое production-хранилище
  // молча выключило бы Google и Wikidata.
  // (а) Резолвер молчит — приём останавливается целиком и не пишет ничего.
  // Прежде эта же ветка заводила три записи без политики координат: главный
  // POI, заглушку родителя и заглушку из списка мест. Ровно так и копился
  // долг в 444 координатированные записи без политики.
  const silent = await intakePoi({ note: 'тест' }, {
    store, research, runId: 'run-telegram-0',
    placeResolver: async () => ({ place: null, reason: 'опознание отключено в тесте' }),
    japaneseNameResolver: async () => null,
  })
  t('без резолвера главный POI не создан', silent.created, false)
  t('и не создано ни одной записи', created.length, 0)
  t('причина названа политикой координат', /[Пп]олитика координат не выводится/.test(silent.explanation ?? ''), true)

  // (б) Резолвер вернул место — главный POI проходит, а обе заглушки нет:
  // у них нет ни координат, ни предметного решения. Заглушка с выдуманной
  // политикой была бы хуже её отсутствия — она неотличима от разобранной.
  const place = {
    placeId: 'PID-KENNINJI', lat: 34.9989, lon: 135.7742,
    businessStatus: 'OPERATIONAL', prefecture: { ru: 'Киото', en: 'Kyoto' },
  }
  const report = await intakePoi({ note: 'тест' }, {
    store, research, runId: 'run-telegram-1',
    placeResolver: async () => ({ place, reason: 'опознано в тесте' }),
    japaneseNameResolver: async () => null,
  })

  t('с резолвером главный POI создан', report.created, true)
  t('создана ровно одна запись', created.length, 1)
  t('и это главный POI', created[0]?.['POI Name (RU)'], 'Храм Кэнниндзи')
  t('политика выведена из точки резолвера', created[0]?.['Coordinate Policy'], 'exactObjectPoint')
  t('политика записана тем же объектом, что координаты', created[0]?.Latitude, 34.9989)
  const runIds = new Set(created.map((f) => f['Intake Run ID']))
  t('все под одним ID запуска', runIds.size, 1)
  t('и это переданный ID', [...runIds][0], 'run-telegram-1')
  t('источник — телеграм-агент', created[0]?.['Intake Origin'], 'telegram-agent:poi-intake-bot')
  t('заглушка родителя НЕ создана', report.parentCreatedAsStub, false)
  t('и её остановка названа', report.parentNotLinked !== null, true)
  t('заглушка из списка НЕ создана', report.stubs.length, 0)
  t('и она ушла на проверку человеком', report.stubsNeedsReview.length, 1)
}


// ── Контракт вызова проверяется ДО любого ввода-вывода ──────────────────
// Тест доказывает порядок, а не только факт ошибки: всё, что может быть
// вызвано, при вызове падает. Если проверка runId стоит не первой, тест
// упадёт с чужим сообщением — исследования, хранилища или резолвера.
{
  const boom = async (fn) => { try { await fn(); return 'без ошибки' } catch (e) { return e.message } }
  const exploding = {
    async listExisting() { throw new Error('хранилище не должно опрашиваться') },
    async findBySourceKey() { throw new Error('хранилище не должно опрашиваться') },
    async create() { throw new Error('до записи дойти не должно') },
  }

  // research НЕ подставлен: без OPENAI_API_KEY researchPoi бросает своё
  // сообщение. Получить вместо него ошибку контракта — и есть доказательство
  // того, что runId проверен раньше исследования.
  const emptyRun = await boom(() => intakePoi({ note: 'т' }, {
    store: exploding, runId: '   ',
    placeResolver: async () => { throw new Error('резолвер места не должен вызываться') },
    japaneseNameResolver: async () => { throw new Error('резолвер имени не должен вызываться') },
  }))
  t('пустой runId — ошибка контракта, а не новый UUID', /пустой runId/.test(emptyRun), true)
  t('и она приходит раньше исследования', /OPENAI/.test(emptyRun), false)
  t('и раньше хранилища', /хранилище/.test(emptyRun), false)
}

// ── Подстановка хранилища не подавляет резолверы ────────────────────────
// Раньше признаком «тестового режима» служило наличие store, и Google с
// Wikidata молча выключались. Счётчики держат это исправленным.
{
  let placeCalls = 0
  let nameCalls = 0
  const created = []
  const store = {
    async listExisting() { return [] },
    async findBySourceKey() { return null },
    async create(fields) { created.push(fields); return { poiId: 'POI-000950', recordId: 'rec950' } },
  }
  const research3 = {
    nameRu: 'Храм Тофукудзи', nameEn: 'Tofukuji Temple', siteCity: 'kyoto',
    prefectureRu: 'Киото', prefectureEn: 'Kyoto', categoriesRu: ['Буддийский храм'],
    workingHours: '', ticketsNote: '', website: '', descriptionRu: 'Описание объекта.',
    descriptionEn: 'Object description.', parentNameRu: '', parentNameEn: '',
    otherLocations: [], sources: [], openQuestions: [], operatingStatus: '',
  }
  const report = await intakePoi({ note: 'т' }, {
    store, research: research3, runId: 'run-counters',
    // Резолвер отдаёт место: иначе политика координат не выводится и запись
    // не создаётся, а тест проверяет не её, а факт вызова обоих резолверов.
    placeResolver: async () => { placeCalls++; return { place: { placeId: 'PID-TOFUKUJI', lat: 34.9761, lon: 135.7742, businessStatus: 'OPERATIONAL', prefecture: { ru: 'Киото', en: 'Kyoto' } }, reason: 'опознано в тесте' } },
    japaneseNameResolver: async () => { nameCalls++; return { nameJa: '東福寺', qid: 'Q123' } },
  })
  t('запись создана', report.created, true)
  t('резолвер места вызван при своём store', placeCalls, 1)
  t('резолвер имени вызван при своём store', nameCalls, 1)
  // Безопасное чтение намеренно: при сломанном стороже запись не создаётся,
  // и падение по undefined скрыло бы провалы утверждений ниже.
  t('и его результат доехал до полей', created[0]?.['Name (JA)'], '東福寺')
}

// ── Заглушка родителя НЕ создаётся, когда кандидат есть, но спорный ─────
//
// Пустой parent при пустом parentAmbiguous означал для intakePoi «родителя
// в базе нет», и он заводил заглушку. Если просто отфильтровать кандидата
// с несогласованными именами, рядом с уже существующей записью появилась бы
// вторая — второй дефект вместо исправленного первого.
{
  const mkStore = (pool) => {
    const created = []
    let n = 0
    return {
      created,
      async listExisting() { return pool },
      async findBySourceKey() { return null },
      async create(fields) {
        const poiId = `POI-00${800 + n++}`
        created.push({ ...fields, 'POI ID': poiId, recordId: `rec${poiId}` })
        return { poiId, recordId: `rec${poiId}` }
      },
    }
  }
  const research = (parentRu, parentEn) => ({
    nameRu: 'Новый отдельный объект', nameEn: 'New Separate Object', siteCity: 'naoshima',
    prefectureRu: 'Кагава', prefectureEn: 'Kagawa', categoriesRu: ['Художественный музей'],
    workingHours: '', ticketsNote: '', website: '', descriptionRu: 'Описание объекта.',
    descriptionEn: 'Object description.', parentNameRu: parentRu, parentNameEn: parentEn,
    otherLocations: [], sources: [], openQuestions: [], operatingStatus: '',
  })
  const run = (store, res) => intakePoi({ note: 'т' }, {
    store, research: res, runId: 'run-parent-1',
    // Место опознано: без него политика координат не выводится и запись не
    // создаётся, а этот тест проверяет не политику, а связь с родителем.
    placeResolver: async () => ({ place: { placeId: `PID-${Math.random().toString(36).slice(2, 10)}`, lat: 35.0116, lon: 135.7681, businessStatus: 'OPERATIONAL', prefecture: { ru: 'Киото', en: 'Kyoto' } }, reason: 'опознано в тесте' }),
    japaneseNameResolver: async () => null,
  })

  // 1. Единственный кандидат — спорный.
  {
    const store = mkStore([{ poiId: 'PARENT-WRONG', recordId: 'recParentWrong',
      nameRu: 'Дом-проект: Кадоя', nameEn: 'Echigo-Tsumari: Kadoya', siteCity: 'naoshima' }])
    const report = await run(store, research('Дом-проект: Кадоя', 'Art House Project: Kadoya'))
    t('главный POI создан', report.created, true)
    t('заглушка родителя НЕ создана', report.parentCreatedAsStub, false)
    t('и записана ровно одна запись', store.created.length, 1)
    t('родитель не связан — и это сказано', report.parentNotLinked !== null, true)
    t('с причиной про несогласованные имена',
      /поля имён кандидата не согласованы/.test(report.parentNotLinked?.reason ?? ''), true)
    t('и с указанием, что заглушки нет',
      /Заглушка не создана/.test(report.parentNotLinked?.reason ?? ''), true)
    const telegram = buildReport(report)
    t('Telegram сообщает о несвязанном родителе', /Родитель «[^»]*» не связан/.test(telegram), true)
    t('и называет спорного кандидата', telegram.includes('PARENT-WRONG'), true)
    // Notes главной записи тоже помнят причину.
    t('в Notes есть отметка о спорном кандидате',
      /РОДИТЕЛЬ НЕ ПРОСТАВЛЕН — ИМЕНА КАНДИДАТА НЕ СОГЛАСОВАНЫ/.test(store.created[0]?.Notes ?? ''), true)
  }

  // 2. Есть чистый кандидат и спорный: связывается чистый.
  {
    const store = mkStore([
      { poiId: 'PARENT-OK', recordId: 'recParentOk', nameRu: 'Дом-проект: Кадоя',
        nameEn: 'Art House Project: Kadoya', siteCity: 'naoshima' },
      { poiId: 'PARENT-WRONG', recordId: 'recParentWrong', nameRu: 'Дом-проект: Кадоя',
        nameEn: 'Echigo-Tsumari: Kadoya', siteCity: 'naoshima' },
    ])
    const report = await run(store, research('Дом-проект: Кадоя', 'Art House Project: Kadoya'))
    t('чистый родитель связан', report.parent?.poiId, 'PARENT-OK')
    t('заглушка не заводилась', report.parentCreatedAsStub, false)
    t('и жалобы на несвязанного родителя нет', report.parentNotLinked, null)
    t('но спорный кандидат сохранён в Notes',
      /РОДИТЕЛЬ ПРОСТАВЛЕН, НО ЕСТЬ СПОРНЫЙ КАНДИДАТ/.test(store.created[0]?.Notes ?? ''), true)
  }

  // 3. Два близких чистых кандидата: неоднозначность доезжает до отчёта.
  //    Раньше она оставалась только в Notes, а Telegram молчал.
  {
    const store = mkStore([
      { poiId: 'PARENT-A', recordId: 'recA', nameRu: 'Дом-проект: Кадоя',
        nameEn: 'Art House Project: Kadoya', siteCity: 'naoshima' },
      { poiId: 'PARENT-B', recordId: 'recB', nameRu: 'Дом-проект: Кадоя',
        nameEn: 'Art House Project: Kadoya', siteCity: 'naoshima' },
    ])
    const report = await run(store, research('Дом-проект: Кадоя', 'Art House Project: Kadoya'))
    t('при неоднозначности родитель не связан', report.parent, null)
    t('заглушка не заводилась', report.parentCreatedAsStub, false)
    t('и запись ровно одна', store.created.length, 1)
    t('неоднозначность доехала до отчёта', report.parentNotLinked !== null, true)
    t('с причиной про близких кандидатов',
      /несколько близких кандидатов/.test(report.parentNotLinked?.reason ?? ''), true)
    t('и Telegram об этом говорит', /Родитель «[^»]*» не связан/.test(buildReport(report)), true)
  }
}

/* ── Отказ резолвера места не роняет приём из Telegram (F-24) ────────────
   До финального пакета `placeResolver` вызывался без `try`/`catch`, а
   канонический `resolvePlace` читал `data.places` вне своего `try`. Тело ответа
   Google, разобравшееся в JSON `null`, роняло ВЕСЬ приём: ни записи, ни отчёта,
   ни открытого вопроса — только исключение наружу. Это нарушало основной
   инвариант приёма: неизвестное обязано заканчиваться `needs_review`. */
{
  const { resolvePlace } = await import('../src/lib/place-resolve.ts')

  const research = {
    nameRu: 'Замок Химэдзи', nameEn: 'Himeji Castle', siteCity: 'himeji',
    prefectureRu: 'Хёго', prefectureEn: 'Hyogo', categoriesRu: ['Историческое место'],
    workingHours: '', website: '', ticketsNote: '',
    descriptionRu: 'Описание объекта.', descriptionEn: 'Object description.',
    parentNameRu: '', parentNameEn: '', otherLocations: [], operatingStatus: '',
    openQuestions: [], sources: [],
  }
  const storeOf = () => {
    const created = []
    return {
      created,
      store: {
        async listExisting() { return [] },
        async findBySourceKey() { return null },
        async create(fields) { created.push(fields); return { poiId: 'POI-000999', recordId: 'rec-999' } },
      },
    }
  }
  const run = async (placeResolver) => {
    const c = storeOf()
    try {
      const report = await intakePoi({ note: 'x' }, {
        research, store: c.store, placeResolver, japaneseNameResolver: async () => null,
      })
      return { report, created: c.created }
    } catch (error) {
      return { threw: error?.message ?? String(error), created: c.created }
    }
  }

  /* Бросающий инъецированный резолвер. */
  const thrown = await run(async () => { throw new Error('RESOLVER_THROW') })
  t('бросающий резолвер не роняет приём', thrown.threw, undefined)
  t('и приём останавливается на needs_review', thrown.report?.outcome, 'needs_review')
  t('и записи не создаётся', thrown.created.length, 0)
  t('и причина видна в открытых вопросах',
    (thrown.report?.research?.openQuestions ?? []).some((q) => q.includes('RESOLVER_THROW')), true)
  t('и сказано, что места не записано',
    (thrown.report?.research?.openQuestions ?? []).some((q) => q.includes('ни координат, ни place_id')), true)

  /* Канонический резолвер на повреждённом теле Google. */
  const nulled = await run((q) => resolvePlace(q, {
    apiKey: 'ключ-фикстуры', fetchImpl: async () => ({ ok: true, json: async () => null }),
  }))
  t('повреждённое тело Google не роняет приём', nulled.threw, undefined)
  t('и приём останавливается на needs_review', nulled.report?.outcome, 'needs_review')
  t('и записи не создаётся', nulled.created.length, 0)
  t('и причина названа исходом резолвера',
    (nulled.report?.research?.openQuestions ?? []).some((q) => q.includes('тело не той формы')), true)

  /* Успешный резолвер — контроль: приём по-прежнему доходит до записи. */
  const good = await run(async () => ({
    outcome: 'resolved',
    place: {
      placeId: 'PID-HIMEJI', lat: 34.8394, lon: 134.6939, businessStatus: 'OPERATIONAL',
      prefecture: { en: 'Hyogo', ru: 'Хёго', ja: '兵庫県' }, matchedName: 'Himeji Castle',
    },
    reason: 'Опознано как «Himeji Castle»',
  }))
  t('исправный резолвер по-прежнему доводит до записи', good.report?.outcome, 'created')
  t('и Place ID доезжает', good.created[0]?.['Google Place ID'], 'PID-HIMEJI')

  /* ПОВРЕЖДЁННАЯ ВЛОЖЕННАЯ ФОРМА ОТВЕТА через КАНОНИЧЕСКИЙ резолвер (R1).
     Не инъецированная заглушка, а тот же `resolvePlace`, что и в production:
     подменён только `fetchImpl`. Три ответа, которые до исправления выносили
     исключение наружу мимо всей границы. */
  const canonicalOn = (places) => (q) => resolvePlace(q, {
    apiKey: 'ключ-фикстуры',
    fetchImpl: async () => ({ ok: true, json: async () => ({ places }) }),
  })
  const himejiRaw = (over = {}) => ({
    id: 'PID-HIMEJI', displayName: { text: 'Himeji Castle' },
    location: { latitude: 34.8394, longitude: 134.6939 }, businessStatus: 'OPERATIONAL', ...over,
  })
  for (const [label, over] of [
    ['addressComponents объектом', { addressComponents: {} }],
    ['компонент null', { addressComponents: [null] }],
    ['types числом', { addressComponents: [{ types: 42, longText: '兵庫県' }] }],
  ]) {
    const r = await run(canonicalOn([himejiRaw(over)]))
    t(`повреждённая форма (${label}) не роняет приём`, r.threw, undefined)
    t(`и записи не создаётся (${label})`, r.created.length, 0)
    t(`и приём останавливается на needs_review (${label})`, r.report?.outcome, 'needs_review')
    t(`и причина видна владельцу (${label})`,
      (r.report?.research?.openQuestions ?? []).some((q) => q.includes('Google')), true)
  }

  /* Брошенный null: до исправления падал сам catch резолвера. */
  const nullThrown = await run((q) => resolvePlace(q, {
    apiKey: 'ключ-фикстуры', fetchImpl: async () => { throw null },
  }))
  t('брошенный null не роняет приём из Telegram', nullThrown.threw, undefined)
  t('и записи не создаётся', nullThrown.created.length, 0)
  t('и приём останавливается на needs_review', nullThrown.report?.outcome, 'needs_review')

  /* Сосед в том же прогоне доходит до записи: повреждение одного ответа не
     отменяет работы приёма вообще. */
  const neighbour = await run(canonicalOn([himejiRaw({
    addressComponents: [{ types: ['administrative_area_level_1'], longText: 'Hyogo Prefecture' }],
  })]))
  t('валидный ответ через тот же канонический путь доводит до записи',
    neighbour.report?.outcome, 'created')
  t('и Place ID доезжает', neighbour.created[0]?.['Google Place ID'], 'PID-HIMEJI')

  /* Ошибка СОБСТВЕННОГО контракта не маскируется под отказ провайдера. */
  const brokenStore = {
    async listExisting() { throw new Error('СВОЙ ДЕФЕКТ: снимок не читается') },
    async findBySourceKey() { return null },
    async create() { throw new Error('не должно дойти') },
  }
  let ownDefect = '(без ошибки)'
  try {
    await intakePoi({ note: 'x' }, {
      research, store: brokenStore, placeResolver: async () => { throw new Error('RESOLVER_THROW') },
      japaneseNameResolver: async () => null,
    })
  } catch (error) { ownDefect = error.message }
  t('свой дефект летит наружу, а не превращается в отказ провайдера',
    ownDefect.includes('СВОЙ ДЕФЕКТ'), true)
}

console.log(bad.length ? `✗ провалено ${bad.length}:\n  ` + bad.join('\n  ') : `✓ приём POI: ${ok} проверок пройдено`)
process.exitCode = bad.length ? 1 : 0
