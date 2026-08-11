/**
 * Путь приёма из Telegram: разбор ответа исследователя.
 *
 * До 10.08.2026 тестов тут не было вовсе — модуль импортировал '@/lib/...',
 * а прогон идёт голым node без резолвера алиасов, и файл просто не грузился.
 * Отсутствие тестов было не решением, а следствием одной строки импорта.
 */
import { intakePoi, parseResearchJson, findParentCandidate, POI_CATEGORIES_RU } from '../src/lib/poi-intake.ts'

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
  const report = await intakePoi({ note: 'тест' }, {
    store, research, runId: 'run-telegram-1',
    placeResolver: async () => ({ place: null, reason: 'опознание отключено в тесте' }),
    japaneseNameResolver: async () => null,
  })

  t('главный POI создан', report.created, true)
  t('создано три записи', created.length, 3)
  const runIds = new Set(created.map((f) => f['Intake Run ID']))
  t('все под одним ID запуска', runIds.size, 1)
  t('и это переданный ID', [...runIds][0], 'run-telegram-1')
  t('источник — телеграм-агент', created[0]['Intake Origin'], 'telegram-agent:poi-intake-bot')
  t('заглушка родителя создана', report.parentCreatedAsStub, true)
  t('заглушка из списка создана', report.stubs.length, 1)
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
    placeResolver: async () => { placeCalls++; return { place: null, reason: 'опознание отключено в тесте' } },
    japaneseNameResolver: async () => { nameCalls++; return { nameJa: '東福寺', qid: 'Q123' } },
  })
  t('запись создана', report.created, true)
  t('резолвер места вызван при своём store', placeCalls, 1)
  t('резолвер имени вызван при своём store', nameCalls, 1)
  t('и его результат доехал до полей', created[0]['Name (JA)'], '東福寺')
}

console.log(bad.length ? `✗ провалено ${bad.length}:\n  ` + bad.join('\n  ') : `✓ приём POI: ${ok} проверок пройдено`)
process.exitCode = bad.length ? 1 : 0
