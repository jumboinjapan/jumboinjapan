import { fetchAirtableWithRetry } from './airtable-retry.ts'
import { TEXT_BUDGET_PROFILES } from './text-budgets.ts'
import {
  screenNewPoi,
  toPoiLike,
  type PoiLike,
  type PoiScreenResult,
} from './poi-matching.ts'
// Идентификатор таблицы — из общей схемы, а не литералом. Ровно тот случай,
// от которого предостерегает комментарий в airtable-schema.ts.
import { POI_TABLE_ID } from './airtable-schema.ts'
import {
  ingestPoi,
  resolveIntakeRunId,
  type PoiIngestOutcome,
  type PoiIngestRequest,
  type PoiSourceKind,
  type PoiStore,
} from './poi-ingest.ts'
import { OPERATING_STATUSES, POI_CATEGORIES_RU, operatingStatusFromGoogle } from './poi-canon.ts'
import { resolveJapaneseName, resolvePlace } from './place-resolve.ts'

/**
 * Агент приёма новых POI (2026-07-11).
 *
 * Вход: свободный текст, фото таблички/буклета, скан — из Telegram-бота.
 * Выход: черновик POI в Airtable (Copy Status = Draft, Fact Check = Todo)
 * + отчёт владельцу.
 *
 * Принципы:
 * - Агент НИКОГДА не публикует: только черновик, до ручной проверки.
 * - Факты, которые не удалось подтвердить, попадают в «открытые вопросы»
 *   отчёта, а не выдумываются (Fact Check Status = Todo по умолчанию).
 * - Категории берутся ТОЛЬКО из существующих опций Airtable: создавать
 *   новые опции select у токена нет прав, и плодить синонимы вредно.
 */

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN?.trim() ?? ''
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY?.trim() ?? ''
const BASE_ID = process.env.AIRTABLE_BASE_ID?.trim() ?? ''
const POI_TABLE = 'POI'

// Канон категорий POI (RU) — ровно опции поля «POI Category (RU)» в Airtable.
//
// Список НЕ дублируется, а берётся из канона. Своя копия здесь была,
// и она разошлась в тот же день, когда в канон добавили «Знаковый вид»:
// applyCanon категорию принимал, а бот о ней не знал и предложить не мог.
// Два списка одного и того же расходятся всегда — вопрос лишь когда.
export { POI_CATEGORIES_RU }

// RU → EN для поля «POI Category (EN)» (опции существуют в Airtable)
const CATEGORY_RU_TO_EN: Record<string, string> = {
  'Синтоистское святилище': 'Shinto Shrine',
  'Буддийский храм': 'Buddhist Temple',
  'Архитектурный объект': 'Architectural Object',
  Музей: 'Museum',
  'Арт-пространство / Галерея': 'Art Venue',
  'Смотровая площадка': 'Viewing Spot',
  'Ландшафтный сад / Парк': 'Park/Garden',
  Достопримечательность: 'City Attraction',
  'Историческое место': 'Historical Location',
  Ресторан: 'Restaurant',
  'Японский отель': 'Ryokan',
  'Парк развлечений': 'Amusement Park',
  Шоппинг: 'Shopping',
  'Термальный Источник': 'Hot Spring',
  СПА: 'SPA',
  'Городской район': 'City District',
  'Транспортный узел': 'Transit Hub',
  'Знаковый вид': 'Iconic View',
}

export interface PoiResearchResult {
  nameRu: string
  nameEn: string
  siteCity: string
  prefectureRu: string
  prefectureEn: string
  categoriesRu: string[]
  workingHours: string
  website: string
  ticketsNote: string
  descriptionRu: string
  descriptionEn: string
  /**
   * Родительский объект, если место находится на территории / в составе
   * другого (павильон храмового комплекса, работа внутри арт-проекта).
   * Пусто, если место самостоятельное.
   */
  parentNameRu: string
  parentNameEn: string
  /**
   * Дополнительные локации, когда вход — программа тура или список мест:
   * главный объект исследуется полностью, остальные становятся заглушками
   * (имя + город), которые владелец наполняет по одной.
   */
  otherLocations: Array<{ nameRu: string; nameEn: string; siteCity: string }>
  /**
   * Состояние объекта — ТОЛЬКО когда есть источник о закрытии или сезонности.
   * Пусто в остальных случаях, включая «похоже, работает»: см. разбор
   * в RESEARCH_SYSTEM_PROMPT и в parseResearchJson.
   */
  operatingStatus: string
  /** Чего агент не смог подтвердить — идёт в отчёт, а не в поля */
  openQuestions: string[]
  /** Источники, на которые опирался агент */
  sources: string[]
}

export interface PoiDuplicateHint {
  poiId: string
  nameRu: string
  siteCity: string
}

/** Опознание места во внешнем источнике. Подменяется в тестах. */
export type PlaceResolver = (
  input: { nameEn?: string; nameRu?: string; siteCity?: string; prefectureEn?: string },
) => Promise<Awaited<ReturnType<typeof resolvePlace>>>

/** Японское имя из Wikidata. Подменяется в тестах. */
export type JapaneseNameResolver = (
  input: { nameEn?: string },
) => Promise<{ nameJa: string; qid: string } | null>

/** Заглушка, которая не была создана: имя, город и причина. */
export interface PoiStubOutcome {
  nameRu: string
  siteCity: string
  outcome: PoiIngestOutcome
  reason: string
}

export interface PoiIntakeReport {
  /**
   * false — запись НЕ создана, потому что гейт нашёл уверенный дубль.
   * Раньше это поле всегда было true: дубли печатались в отчёт, но
   * ничего не блокировали.
   */
  created: boolean
  /** Итог проверки на дубли и родителя. Заполняется всегда. */
  screen: PoiScreenResult
  poiId: string
  recordId: string
  research: PoiResearchResult
  duplicates: PoiDuplicateHint[]
  /** Найденный или созданный родительский POI (поле Parent POI) */
  parent: PoiDuplicateHint | null
  /**
   * true — родителя в базе не было, создана заглушка (Draft, только имя):
   * владельцу нужно заполнить её факты или прогнать через бота отдельно.
   */
  parentCreatedAsStub: boolean
  /** Заглушки, созданные из программы/списка (кроме главного объекта) */
  stubs: PoiDuplicateHint[]
  /**
   * Локации из программы, пропущенные как уже существующие в базе.
   * Только когда у исхода ЕСТЬ существующий poiId — то есть
   * blocked_duplicate или already_ingested.
   */
  stubsSkippedAsExisting: PoiDuplicateHint[]
  /**
   * Локации, остановленные гейтом: сущность неоднозначна, решает человек.
   *
   * Отдельный список появился 11.08.2026 вместе с исходом needs_review.
   * До него всё, что не 'created', сваливалось в stubsSkippedAsExisting —
   * и остановленная локация уезжала владельцу под подписью «уже есть
   * в базе» с пустым poiId. То есть с неверной причиной и без записи,
   * которую можно открыть.
   */
  stubsNeedsReview: PoiStubOutcome[]
  /** Локации, не прошедшие канон. Тоже не «уже есть в базе». */
  stubsRejected: PoiStubOutcome[]
  /**
   * Родитель назван в исследовании, но заглушка под него не создана и
   * существующая запись не найдена. Раньше такой случай исчезал молча:
   * ветка привязки смотрела только на stub.poiId, которого при остановке
   * нет, и родитель просто оставался непроставленным без следа в отчёте.
   */
  parentNotLinked: PoiStubOutcome | null
  /** Замечания канона: что поправлено автоматически и что осталось. */
  canonIssues: Array<{ field: string; level: 'error' | 'warn'; message: string }>
  /** Итог приёма. Тот же союз, что у ingestPoi, — не свободная строка. */
  outcome: PoiIngestOutcome
  /** Человекочитаемое объяснение решения — идёт в ответ боту. */
  explanation: string
  airtableUrl: string
}

/** Пустой вердикт для случаев, когда гейт не запускался (отказ по канону). */
const EMPTY_SCREEN: PoiScreenResult = {
  verdict: 'clear',
  blockingDuplicate: null,
  duplicates: [],
  parent: null,
  parentAmbiguous: [],
  geoNeighbours: [],
  geoRefutedDuplicate: null,
  reasons: [],
}

// ── Airtable ────────────────────────────────────────────────────────────────

interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
}

function ensureCredentials() {
  if (!AIRTABLE_TOKEN || !BASE_ID) {
    throw new Error('AIRTABLE_TOKEN and AIRTABLE_BASE_ID are required for POI intake')
  }
}

async function fetchPoiRecords(fields: string[], filterByFormula?: string): Promise<AirtableRecord[]> {
  ensureCredentials()
  const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(POI_TABLE)}`)
  url.searchParams.set('pageSize', '100')
  for (const field of fields) url.searchParams.append('fields[]', field)
  if (filterByFormula) url.searchParams.set('filterByFormula', filterByFormula)

  const records: AirtableRecord[] = []
  let offset: string | undefined
  do {
    if (offset) url.searchParams.set('offset', offset)
    const response = await fetchAirtableWithRetry(url.toString(), {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`Airtable POI read failed: ${response.status} ${await response.text()}`)
    const data = (await response.json()) as { records?: AirtableRecord[]; offset?: string }
    records.push(...(data.records ?? []))
    offset = data.offset
  } while (offset)

  return records
}

function text(fields: Record<string, unknown>, key: string): string {
  const value = fields[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Очередь выдачи идентификаторов.
 *
 * `getNextPoiId` читает максимум и прибавляет единицу в памяти — при двух
 * одновременных приёмах оба получат один номер. Внутри процесса это
 * снимается сериализацией: пока идёт выдача и запись одной записи, вторая
 * ждёт. Между разными процессами (бот и коллектор одновременно) остаётся
 * узкое окно, и его закрывает проверка коллизии после записи.
 */
let idQueue: Promise<unknown> = Promise.resolve()

function serializeIdAssignment<T>(task: () => Promise<T>): Promise<T> {
  const run = idQueue.then(task, task)
  // Хвост очереди не должен наследовать отказ: одна упавшая запись не
  // обязана валить все последующие.
  idQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/**
 * Есть ли в базе больше одной записи с этим POI ID.
 * Вызывается ПОСЛЕ создания: Airtable не умеет уникальных ограничений,
 * поэтому коллизию можно только обнаружить и починить.
 */
async function countByPoiId(poiId: string): Promise<AirtableRecord[]> {
  // Значение генерируем мы сами, но экранируем всё равно — подстановка
  // в filterByFormula без экранирования уже стоила этому проекту трёх
  // мест в airtable.ts.
  const escaped = poiId.replace(/'/g, "\\'")
  return fetchPoiRecords(['POI ID'], `{POI ID}='${escaped}'`)
}

/** Следующий свободный POI ID: POI-000445 после POI-000444. */
async function getNextPoiId(records: AirtableRecord[]): Promise<string> {
  let max = 0
  for (const record of records) {
    const match = text(record.fields, 'POI ID').match(/^POI-(\d{6})$/)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `POI-${String(max + 1).padStart(6, '0')}`
}

/**
 * Сравнение названий вынесено в @/lib/poi-matching — единый матчер для
 * агента приёма, пакетного коллектора и админки. Здесь оставлены только
 * тонкие обёртки: собственной логики сравнения в этом файле быть не должно.
 *
 * Что изменилось по сравнению с прежней реализацией. Раньше дубли искались
 * двусторонним вхождением подстроки при пороге в 3 символа, и результат
 * НИ НА ЧТО НЕ ВЛИЯЛ: `created: true` возвращалось всегда, а дубли просто
 * печатались в отчёт. На живой базе (431 запись) это дало четыре пары
 * настоящих дублей, два из которых уже опубликованы (Copy Status = Synced).
 */
export function findDuplicateCandidates(
  research: Pick<PoiResearchResult, 'nameRu' | 'nameEn'> & { siteCity?: string },
  records: AirtableRecord[],
): PoiDuplicateHint[] {
  const screen = screenNewPoi(
    { nameRu: research.nameRu, nameEn: research.nameEn, siteCity: research.siteCity },
    records.map(toPoiLike),
  )
  return screen.duplicates.map((match) => ({
    poiId: match.candidate.poiId,
    nameRu: match.candidate.nameRu,
    siteCity: match.candidate.siteCity ?? '',
  }))
}

/**
 * Сырое создание записи. Поля приходят готовыми из @/lib/poi-ingest —
 * этот файл их больше не собирает и не решает, что писать. Единственная
 * добавка здесь — служебные поля происхождения, которые знает только
 * слой Airtable.
 */
async function createPoiRecordRaw(fields: Record<string, unknown>): Promise<string> {
  ensureCredentials()
  const categoriesRu = Array.isArray(fields['POI Category (RU)'])
    ? (fields['POI Category (RU)'] as string[]).filter((c) => POI_CATEGORIES_RU.includes(c as never))
    : []
  const categoriesEn = categoriesRu.map((c) => CATEGORY_RU_TO_EN[c]).filter(Boolean)

  const payload: Record<string, unknown> = {
    ...fields,
    'POI Category (RU)': categoriesRu.length ? categoriesRu : undefined,
    'POI Category (EN)': categoriesEn.length ? categoriesEn : undefined,
    'Last Seeded At': new Date().toISOString(),
  }

  const response = await fetchAirtableWithRetry(
    `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(POI_TABLE)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [{ fields: payload }] }),
    },
  )

  if (!response.ok) throw new Error(`Airtable POI create failed: ${response.status} ${await response.text()}`)
  const data = (await response.json()) as { records?: Array<{ id: string }> }
  const recordId = data.records?.[0]?.id
  if (!recordId) throw new Error('Airtable POI create returned no record id')
  return recordId
}

// ── Исследование (OpenAI Responses API + web_search + vision) ───────────────

const POI_DESCRIPTION_BUDGET = TEXT_BUDGET_PROFILES.poiDescription

const RESEARCH_SYSTEM_PROMPT = [
  'Ты — исследователь-редактор travel-справочника JumboInJapan (частный гид по Японии, русскоязычная аудитория).',
  'Задача: по входным данным (текст, фото таблички/буклета/скана, PDF-документ) определить, что это за место в Японии, собрать проверяемые факты и написать сдержанное описание.',
  '',
  'Родительский объект (parentNameRu / parentNameEn):',
  '- Если место находится НА ТЕРРИТОРИИ или В СОСТАВЕ другого объекта — павильон храмового комплекса, сад при замке, работа/дом внутри арт-проекта (например Echigo-Tsumari Art Field, Benesse Art Site Naoshima) — укажи название этого родительского объекта.',
  '- Комментарий владельца о принадлежности («часть …», «на территории …») — важнейший сигнал: не игнорируй его.',
  '- Если место самостоятельное — оставь оба поля пустыми. Город и префектура родителем НЕ считаются.',
  '',
  'Состояние объекта (operatingStatus):',
  '- Заполняй ТОЛЬКО при подтверждённой находке: «Закрыт навсегда» (объект закрылся, снесён, съехал), «Закрыт временно» (реконструкция, ремонт, объявленный перерыв), «Сезонный» (открыт лишь часть года: сад цветения, лавандовые поля, снежный коридор, горная канатка зимой).',
  '- Во ВСЕХ остальных случаях оставляй поле пустым. Не пиши «Работает»: отсутствие новостей о закрытии — не подтверждение работы, и этот статус ставится не исследованием, а автоматической сверкой с Google.',
  '- Нашёл закрытие или сезонность — укажи в sources, откуда, а окно сезона напиши в workingHours коротким тире без пробелов (например «20 февраля–15 марта»).',
  '',
  'Правила фактов:',
  '- Ищи в вебе подтверждение: официальный сайт, часы работы, город, префектура, стоимость билетов.',
  '- НИЧЕГО не выдумывай. Если факт не подтверждён — оставь поле пустым и напиши об этом в openQuestions.',
  '- Часы работы и цены меняются: указывай их только со ссылкой на источник, иначе оставляй пустыми.',
  '',
  'Транслитерация (ОБЯЗАТЕЛЬНО): русские названия — строго по системе Поливанова:',
  '- си/дзи/ти/цу, а не ши/джи/чи/тсу: Дзуйходэн (не Зуйходэн), Этиго-Цумари (не Тсумари), Сибуя, Мацусима.',
  '- Если сомневаешься между «народным» и поливановским написанием — выбирай поливановское.',
  '- ИСКЛЮЧЕНИЯ — устоявшийся канон сайта важнее Поливанова: «Хаконе» (НЕ Хаконэ) — так ищут в поиске; список может пополняться.',
  '',
  'Программы туров и списки мест:',
  '- Если вход — программа тура, маршрут по дням или список из нескольких мест: выбери ГЛАВНЫЙ объект (первый содержательный), исследуй и заполни для него основные поля, а остальные места перечисли в otherLocations (только nameRu/nameEn/siteCity, без исследования).',
  '- Отели, рёканы, станции и аэропорты из программ — НЕ места для записи: пропускай их молча, не включай в otherLocations.',
  '- Время, встречи с гидом, переезды, обеды — логистика, не места.',
  '',
  'Правила описания (descriptionRu / descriptionEn):',
  // Бюджет берётся из text-budgets.ts — той же шкалы, по которой описание
  // потом оценивается в админке. Раньше в промпте стояло «1–2 абзаца», и
  // генератор не знал предела, по которому его будут судить.
  `- Третье лицо, спокойный фактурный тон. Длина: ориентир ${POI_DESCRIPTION_BUDGET.target} знаков, предел ${POI_DESCRIPTION_BUDGET.hardMax}. Дальше описание не влезает в карточку POI.`,
  '- Начинай с того, ЧТО это за место и почему оно имеет значение.',
  '- Конкретика вместо восторгов. Запрещены клише: «жемчужина», «обязательно к посещению», «не пропустите», «уникальный», «незабываемый».',
  '- Не рекламный буклет и не перевод с английского — живой текст информированного человека.',
  '- Никаких формулировок «автомобиль с гидом», «гид-водитель» — если нужен транспортный контекст, только «частный транспорт».',
  // Оба языка обязательны. Английский текст пишется в том же прогоне, что
  // и русский: половина записи — это половина карточки на сайте, и дописать
  // её потом можно только руками, вспомнив, что она недоделана.
  '- ОБА языка обязательны. Пустой descriptionEn недопустим — карточка места выйдет наполовину пустой.',
  '- descriptionEn — тот же смысл по-английски, выведенный из русского текста, а не отдельное сочинение и не подстрочник. Те же факты, естественный английский.',
  '- Если по месту мало данных — короткое описание на обоих языках лучше, чем полное на одном.',
  '',
  'Типографика — про РУССКИЙ текст. В английском кавычки и числа пиши по английским правилам. Неразрывные пробелы, многоточие и тире вместо дефиса сайт расставляет сам на рендере — руками не вставляй. Но эти четыре вещи система НЕ исправляет, пиши сразу правильно:',
  '- кавычки — «ёлочки», внутри них „лапки“; прямые " и английские “ ” недопустимы;',
  '- диапазоны — короткое тире без пробелов: 1–2 дня, 09:00–17:00, ¥3 500–7 500;',
  '- десятичная запятая: 2,5 часа (не 2.5);',
  '- разряды числа — пробелом: 15 000 человек.',
  '- в descriptionEn ничего из этого списка не применяй: “quotes”, 1–2 days, 2.5 hours, 15,000 people.',
  '',
  'Ответ — СТРОГО JSON без markdown-обёртки, по схеме:',
  '{"nameRu":"","nameEn":"","siteCity":"","prefectureRu":"","prefectureEn":"","categoriesRu":[],"workingHours":"","website":"","ticketsNote":"","operatingStatus":"","descriptionRu":"","descriptionEn":"","parentNameRu":"","parentNameEn":"","otherLocations":[{"nameRu":"","nameEn":"","siteCity":""}],"openQuestions":[],"sources":[]}',
  '',
  'otherLocations — ТОЛЬКО для программ/списков из нескольких мест; для одиночного места оставь пустой массив.',
  '',
  `categoriesRu — только из этого списка (0–3 значения): ${POI_CATEGORIES_RU.join(' | ')}`,
  'siteCity — короткое имя города латиницей в нижнем регистре, как ключ (tokyo, kyoto, hakone, nara, osaka, nikko, kamakura, kanazawa…).',
].join('\n')

interface ResponsesContentItem {
  type: 'input_text' | 'input_image' | 'input_file'
  text?: string
  image_url?: string
  filename?: string
  file_data?: string
}

/**
 * Исследование через OpenAI Responses API. Веб-поиск подключается как tool;
 * если модель/аккаунт его не поддерживает, повторяем без tools — тогда
 * агент работает только по присланным данным и своим знаниям, а всё
 * неподтверждённое честно уходит в openQuestions.
 */
export async function researchPoi(input: {
  note?: string
  imageDataUrls?: string[]
  pdfDataUrls?: string[]
}): Promise<PoiResearchResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured on the server')
  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini'

  const content: ResponsesContentItem[] = []
  content.push({
    type: 'input_text',
    text: input.note?.trim()
      ? `Входные данные от владельца:\n${input.note.trim()}`
      : 'Владелец прислал только изображение(я) или документ(ы). Определи место по ним.',
  })
  for (const url of input.imageDataUrls ?? []) {
    content.push({ type: 'input_image', image_url: url })
  }
  for (const [index, url] of (input.pdfDataUrls ?? []).entries()) {
    content.push({ type: 'input_file', filename: `document-${index + 1}.pdf`, file_data: url })
  }

  async function call(withWebSearch: boolean): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        instructions: RESEARCH_SYSTEM_PROMPT,
        input: [{ role: 'user', content }],
        ...(withWebSearch ? { tools: [{ type: 'web_search' }] } : {}),
      }),
    })

    if (!response.ok) {
      throw new Error(`OpenAI research failed: ${response.status} ${await response.text()}`)
    }

    const data = (await response.json()) as {
      output_text?: string
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
    }
    const fromOutput = data.output
      ?.flatMap((item) => item.content ?? [])
      .filter((item) => item.type === 'output_text')
      .map((item) => item.text ?? '')
      .join('')
    return (data.output_text ?? fromOutput ?? '').trim()
  }

  let raw: string
  try {
    raw = await call(true)
  } catch (error) {
    console.warn('[poi-intake] web_search unavailable, retrying without tools:', error instanceof Error ? error.message : error)
    raw = await call(false)
  }

  return parseResearchJson(raw)
}

/**
 * Статус из ответа исследователя. «Работает» отсюда НЕ принимается.
 *
 * Правило асимметричное, и это осознанно. Закрытие и сезонность модель
 * читает с таблички, из новости, с сайта — это извлечение факта.
 * «Работает» же почти никогда не написано нигде: это вывод из того, что
 * обратного не нашлось, а такой вывод модель делает охотно и ошибается
 * молча. Единственный статус, действующий без единого замечания, обязан
 * приходить из проверяемого источника — businessStatus у Google.
 * Отсюда — только пусто или плохие новости; пустое канон превращает
 * в «Не проверено».
 */
function parseOperatingStatus(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''
  const hit = OPERATING_STATUSES.find((s) => s.toLowerCase() === raw.toLowerCase())
  if (!hit || hit === 'Работает' || hit === 'Не проверено') return ''
  return hit
}

export function parseResearchJson(raw: string): PoiResearchResult {
  const cleaned = raw
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error(`Не удалось разобрать ответ исследователя: ${raw.slice(0, 200)}`)

  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Partial<PoiResearchResult>
  const asString = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  const asStringArray = (value: unknown) =>
    Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : []

  const nameRu = asString(parsed.nameRu)
  if (!nameRu) throw new Error('Исследователь не определил название места (nameRu пуст)')

  return {
    nameRu,
    nameEn: asString(parsed.nameEn),
    siteCity: asString(parsed.siteCity).toLowerCase(),
    prefectureRu: asString(parsed.prefectureRu),
    prefectureEn: asString(parsed.prefectureEn),
    categoriesRu: asStringArray(parsed.categoriesRu).slice(0, 3),
    workingHours: asString(parsed.workingHours),
    website: asString(parsed.website),
    ticketsNote: asString(parsed.ticketsNote),
    descriptionRu: asString(parsed.descriptionRu),
    descriptionEn: asString(parsed.descriptionEn),
    parentNameRu: asString(parsed.parentNameRu),
    parentNameEn: asString(parsed.parentNameEn),
    otherLocations: (Array.isArray(parsed.otherLocations) ? parsed.otherLocations : [])
      .map((item) => ({
        nameRu: asString((item as Record<string, unknown>)?.nameRu),
        nameEn: asString((item as Record<string, unknown>)?.nameEn),
        siteCity: asString((item as Record<string, unknown>)?.siteCity).toLowerCase(),
      }))
      .filter((item) => item.nameRu || item.nameEn)
      .slice(0, 20),
    operatingStatus: parseOperatingStatus(parsed.operatingStatus),
    openQuestions: asStringArray(parsed.openQuestions),
    sources: asStringArray(parsed.sources).slice(0, 5),
  }
}

// ── Оркестратор ─────────────────────────────────────────────────────────────

/**
 * Поиск родительского POI по имени из исследования. Требование строже, чем
 * у дедупликации: линкуем только уверенное совпадение (равенство или полное
 * вхождение нормализованного имени), иначе честно говорим «не найден».
 */
export function findParentCandidate(
  research: Pick<PoiResearchResult, 'parentNameRu' | 'parentNameEn'> & { siteCity?: string },
  records: AirtableRecord[],
): { record: AirtableRecord; hint: PoiDuplicateHint } | null {
  const parentName = research.parentNameRu || research.parentNameEn
  if (!parentName) return null

  const screen = screenNewPoi(
    { nameRu: parentName, siteCity: research.siteCity },
    records.map(toPoiLike),
    { nameRu: research.parentNameRu, nameEn: research.parentNameEn },
  )
  if (!screen.parent) return null

  const record = records.find((r) => r.id === screen.parent!.candidate.recordId)
  if (!record) return null
  return {
    record,
    hint: {
      poiId: screen.parent.candidate.poiId,
      nameRu: screen.parent.candidate.nameRu,
      siteCity: screen.parent.candidate.siteCity ?? '',
    },
  }
}


// ── Хранилище для единого конвейера приёма ──────────────────────────────────

/**
 * Реализация PoiStore поверх Airtable. Единственное место, где этот файл
 * умеет создавать записи; вся логика решения — в @/lib/poi-ingest.
 */
/**
 * Поля снимка базы для гейта. Вынесены в константу намеренно: снимок
 * перечитывается ещё раз при коллизии POI ID, и раньше там стоял список
 * из одного «POI ID». После такого перечитывания кэш терял имена и
 * координаты, а следующая запись пакета проверялась гейтом против пустых
 * названий — то есть проходила всегда. Отказ был бы бесшумным.
 */
const SNAPSHOT_FIELDS = [
  'POI ID', 'POI Name (RU)', 'POI Name (EN)', 'Site City', 'Source Key',
  // Latitude/Longitude обязаны быть в снимке: гейт сравнивает расстояние,
  // и без них у существующих записей координат «нет», то есть
  // географическая проверка просто не сработает.
  'Latitude', 'Longitude',
  // Google Place ID — ключ тождества сильнее любого имени: два разных имени
  // с одним place_id это одно место, и второе заводить нельзя.
  'Google Place ID',
]

function createAirtableStore(snapshot?: AirtableRecord[]): PoiStore & { records: AirtableRecord[] } {
  let cache = snapshot ?? null
  const store = {
    get records() {
      return cache ?? []
    },
    async listExisting(): Promise<PoiLike[]> {
      if (!cache) {
        cache = await fetchPoiRecords(SNAPSHOT_FIELDS)
      }
      return cache.map(toPoiLike)
    },
    async findBySourceKey(sourceKey: string): Promise<PoiLike | null> {
      // Ищем по уже загруженному снимку, а не отдельным запросом: снимок
      // всё равно нужен гейту, а лишний round-trip на каждую запись пакета
      // упёрся бы в лимит Airtable в 5 запросов в секунду.
      if (!cache) await store.listExisting()
      const hit = (cache ?? []).find((r) => text(r.fields, 'Source Key') === sourceKey)
      return hit ? toPoiLike(hit) : null
    },
    /**
     * Выдача ID и запись — одна неделимая операция под очередью.
     * После записи проверяется, не занял ли кто-то этот же номер из
     * другого процесса; если занял — номер меняется на свободный.
     */
    async create(fields: Record<string, unknown>): Promise<{ poiId: string; recordId: string }> {
      return serializeIdAssignment(async () => {
        if (!cache) await store.listExisting()
        let poiId = await getNextPoiId(cache ?? [])
        const recordId = await createPoiRecordRaw({ 'POI ID': poiId, ...fields })

        const clash = await countByPoiId(poiId)
        if (clash.length > 1) {
          // Гонка между процессами: номер уже занят чужой записью.
          // Уступаем — берём следующий свободный и правим свою.
          const fresh = await fetchPoiRecords(SNAPSHOT_FIELDS)
          cache = fresh
          // Занятые номера подмешиваются явно, а не через надежду на то,
          // что перечитанный снимок уже содержит чужую запись: Airtable
          // отдаёт список с задержкой, и тогда «свободный» номер оказался бы
          // тем же самым — PATCH стал бы пустой операцией, а коллизия
          // осталась бы в базе без единого следа.
          poiId = await getNextPoiId(fresh.concat(clash))
          await fetchAirtableWithRetry(
            `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(POI_TABLE)}/${recordId}`,
            {
              method: 'PATCH',
              headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ fields: { 'POI ID': poiId } }),
            },
          )
          console.warn(`[poi-intake] коллизия POI ID, запись ${recordId} переименована в ${poiId}`)
        }

        // Пополняем снимок, чтобы следующая запись пакета видела эту.
        cache?.push({ id: recordId, fields: { ...fields, 'POI ID': poiId } })
        return { poiId, recordId }
      })
    },
  }
  return store
}

function ingestSourceFor(kind: PoiSourceKind, id: string, url?: string, externalKey?: string) {
  return { kind, id, url, externalKey }
}

export async function intakePoi(
  input: {
    note?: string
    imageDataUrls?: string[]
    pdfDataUrls?: string[]
  },
  options: {
    /** Завести даже при уверенном дубле — только по подтверждению владельца. */
    force?: boolean
    /** Готовый идентификатор запуска. Только ради повторяемых тестов. */
    runId?: string
    /**
     * Внешние зависимости, каждая сама по себе. В production не задаются.
     *
     * Раньше признаком «тестового режима» служило наличие store, и это была
     * ошибка: подстановка другого production-хранилища молча выключала бы
     * Google и Wikidata, а отчёт при этом писал бы, что ключ Google не
     * задан. Факт подстановки хранилища не должен менять смысл приёма —
     * поэтому каждая зависимость подставляется отдельно и явно.
     */
    store?: PoiStore
    research?: PoiResearchResult
    placeResolver?: PlaceResolver
    japaneseNameResolver?: JapaneseNameResolver
  } = {},
): Promise<PoiIntakeReport> {
  const research = options.research ?? (await researchPoi(input))

  // Один снимок таблицы на весь вызов: он обслуживает и гейт, и поиск
  // родителя, и выдачу следующего POI ID, и все заглушки из списка мест.
  const store = options.store ?? createAirtableStore()
  const existing = await store.listExisting()

  // Координаты этот путь НЕ БЕРЁТ У ИССЛЕДОВАТЕЛЯ, и это осознанно.
  // Исследователь — языковая модель со свободным поиском; широту и долготу
  // она выдаст охотно и правдоподобно, а проверить их нечем. Ложные
  // координаты хуже отсутствующих: гейт решает по расстоянию, и выдуманная
  // точка либо заблокирует законную запись, либо пропустит дубль.
  //
  // Запрет на МОДЕЛЬ, а не на координаты. До 10.08.2026 их тут не было
  // вовсе, и запись приезжала без места на карте — гейт дублей работал
  // вслепую. Теперь они приходят из структурного источника (Google Places
  // по опознанному place_id), где координата — поле записи, а не пересказ.
  // Опознание во внешних источниках. Ошибка здесь НЕ останавливает приём:
  // запись без place_id хуже записи с place_id, но лучше отсутствия записи.
  // Причина неудачи уходит в openQuestions — владелец увидит её в отчёте.
  const resolveNotes: string[] = []
  let resolved: PoiIngestRequest['poi']['resolved']
  let statusFromGoogle = ''
  let coords: { lat?: number; lon?: number } = {}

  // Резолвер либо подставлен, либо собирается из ключа. Отсутствие ключа —
  // единственная причина, по которой опознания нет; сообщение об этом ниже
  // должно оставаться правдой при любой подстановке зависимостей.
  const placeResolver: PlaceResolver | null =
    options.placeResolver ??
    (GOOGLE_PLACES_API_KEY
      ? (input) => resolvePlace(input, { apiKey: GOOGLE_PLACES_API_KEY })
      : null)

  if (placeResolver) {
    const found = await placeResolver({
      nameEn: research.nameEn,
      nameRu: research.nameRu,
      siteCity: research.siteCity,
      prefectureEn: research.prefectureEn,
    })
    resolveNotes.push(found.reason)
    if (found.place) {
      // Координаты приходят ОТ GOOGLE, а не от языковой модели, и это
      // принципиально: широту и долготу модель выдаёт охотно и правдоподобно,
      // а проверить их нечем. Гейт же решает по расстоянию, и выдуманная
      // точка либо блокирует законную запись, либо пропускает дубль.
      coords = { lat: found.place.lat, lon: found.place.lon }
      statusFromGoogle = found.place.businessStatus
      resolved = {
        placeId: found.place.placeId,
        prefectureRu: found.place.prefecture?.ru,
        prefectureEn: found.place.prefecture?.en,
        coordsCheckedAt: new Date().toISOString(),
      }
    }
  } else {
    resolveNotes.push('GOOGLE_PLACES_API_KEY не задан — место не опознано, координат и place_id не будет')
  }

  // Японское имя — из Wikidata (CC0, хранить можно вечно), а не у Google:
  // у Google это содержимое со сроком годности тридцать дней, а Name (JA)
  // служит ключом сверки дублей и обязан быть постоянным.
  const japanese = await (options.japaneseNameResolver ?? resolveJapaneseName)({ nameEn: research.nameEn })
  if (japanese) {
    resolved = { ...(resolved ?? {}), nameJa: japanese.nameJa, wikidataQid: japanese.qid }
  }

  const mainRequest: PoiIngestRequest = {
    source: ingestSourceFor('telegram-agent', 'poi-intake-bot'),
    poi: {
      ...coords,
      resolved,
      // Статус собирается из двух источников: исследователь сообщает только
      // плохие новости (закрытие, сезонность), «Работает» приходит от Google.
      operatingStatus: operatingStatusFromGoogle(statusFromGoogle, research.operatingStatus),
      nameRu: research.nameRu,
      nameEn: research.nameEn,
      siteCity: research.siteCity,
      categoriesRu: research.categoriesRu,
      workingHours: research.workingHours,
      descriptionRu: research.descriptionRu,
      descriptionEn: research.descriptionEn,
      website: research.website,
      parentNameRu: research.parentNameRu,
      parentNameEn: research.parentNameEn,
      ticketsNote: research.ticketsNote,
      openQuestions: [...research.openQuestions, ...resolveNotes],
      sources: research.sources,
    },
  }

  // Один Intake — один запуск. ID рождается ЗДЕСЬ, на верхней границе, и
  // передаётся главному POI, родительской заглушке и каждой заглушке из
  // списка мест. Иначе одно сообщение боту рассыпалось бы в базе на пять
  // независимых записей, и собрать их обратно было бы нечем.
  const runId = resolveIntakeRunId(options.runId)

  const result = await ingestPoi(mainRequest, store, { force: options.force, runId, existing })
  const screen = result.screen ?? EMPTY_SCREEN
  const duplicates: PoiDuplicateHint[] = screen.duplicates.map((m) => ({
    poiId: m.candidate.poiId,
    nameRu: m.candidate.nameRu,
    siteCity: m.candidate.siteCity ?? '',
  }))

  // Приём остановлен — ничего не создаём и не трогаем список мест.
  if (result.outcome !== 'created') {
    return {
      created: false,
      screen,
      poiId: result.poiId ?? '',
      recordId: result.recordId ?? '',
      research,
      duplicates,
      parent: null,
      parentCreatedAsStub: false,
      parentNotLinked: null,
      stubs: [],
      stubsSkippedAsExisting: [],
      stubsNeedsReview: [],
      stubsRejected: [],
      canonIssues: result.canonIssues,
      outcome: result.outcome,
      explanation: result.explanation,
      airtableUrl: result.recordId
        ? `https://airtable.com/${BASE_ID}/${POI_TABLE_ID}/${result.recordId}`
        : `https://airtable.com/${BASE_ID}/${POI_TABLE_ID}`,
    }
  }

  const parentHint: PoiDuplicateHint | null = screen.parent
    ? {
        poiId: screen.parent.candidate.poiId,
        nameRu: screen.parent.candidate.nameRu,
        siteCity: screen.parent.candidate.siteCity ?? '',
      }
    : null

  // Родитель назван, но в базе не найден и неоднозначности нет — заводим
  // заглушку ЧЕРЕЗ ТОТ ЖЕ КОНВЕЙЕР. Раньше заглушки создавались в обход
  // любых проверок, и это был основной источник дублей.
  let parentCreatedAsStub = false
  let parentNotLinked: PoiStubOutcome | null = null
  let resolvedParent = parentHint
  const parentName = research.parentNameRu || research.parentNameEn
  if (parentName && !screen.parent && screen.parentAmbiguous.length === 0) {
    const stub = await ingestPoi(
      {
        source: ingestSourceFor('telegram-agent', 'poi-intake-bot'),
        poi: {
          nameRu: research.parentNameRu || research.parentNameEn,
          nameEn: research.parentNameEn,
          siteCity: research.siteCity,
          // Пояснение про заглушку идёт в примечания, а НЕ в описание.
          // Описанием это никогда и не было — служебная строка о том, что
          // запись пустая. В поле описания она мешала дважды: попадала
          // в карточку места и нарушала правило «описание только парой»,
          // из-за чего заглушки перестали бы создаваться вовсе.
          openQuestions: [`Заглушка: родительский объект для ${result.poiId}. Заполнить факты или прислать боту отдельно.`],
        },
      },
      store,
      { runId },
    )
    if (stub.outcome === 'created') {
      parentCreatedAsStub = true
      resolvedParent = { poiId: stub.poiId ?? '', nameRu: research.parentNameRu || research.parentNameEn, siteCity: research.siteCity }
    } else if (stub.poiId) {
      // Заглушка не создана, потому что такой объект уже есть — это и есть
      // родитель. Прежний код в этой ситуации молча заводил бы дубль.
      resolvedParent = { poiId: stub.poiId, nameRu: research.parentNameRu || research.parentNameEn, siteCity: research.siteCity }
    } else {
      // Ни создана, ни найдена: гейт остановился или канон отказал. Раньше
      // эта ветка отсутствовала, и родитель просто оставался непроставленным
      // без единой строки в отчёте — владелец не узнавал, что связь потеряна.
      parentNotLinked = {
        nameRu: research.parentNameRu || research.parentNameEn,
        siteCity: research.siteCity,
        outcome: stub.outcome,
        reason: stub.explanation,
      }
    }
  }

  // Прочие места из программы — пакетом, через тот же гейт, против
  // пополняемого снимка. Повтор внутри одного списка больше не проходит.
  const stubs: PoiDuplicateHint[] = []
  const stubsSkippedAsExisting: PoiDuplicateHint[] = []
  const stubsNeedsReview: PoiStubOutcome[] = []
  const stubsRejected: PoiStubOutcome[] = []
  for (const location of research.otherLocations) {
    const name = location.nameRu || location.nameEn
    if (!name) continue
    const stub = await ingestPoi(
      {
        source: ingestSourceFor('telegram-agent', 'poi-intake-bot'),
        poi: {
          nameRu: name,
          nameEn: location.nameEn,
          siteCity: location.siteCity,
          openQuestions: ['Заглушка из программы или списка мест. Наполнить фактами — прислать боту это место отдельным сообщением.'],
        },
      },
      store,
      { runId },
    )
    // Три разных исхода — три разных списка. Один общий «пропущено как уже
    // существующее» врал бы в двух случаях из трёх: у остановленной и у не
    // прошедшей канон локации существующей записи нет, и poiId пустой.
    if (stub.outcome === 'created') {
      stubs.push({ poiId: stub.poiId ?? '', nameRu: name, siteCity: location.siteCity })
    } else if (stub.outcome === 'needs_review') {
      stubsNeedsReview.push({ nameRu: name, siteCity: location.siteCity, outcome: stub.outcome, reason: stub.explanation })
    } else if (stub.poiId) {
      stubsSkippedAsExisting.push({ poiId: stub.poiId, nameRu: name, siteCity: location.siteCity })
    } else {
      stubsRejected.push({ nameRu: name, siteCity: location.siteCity, outcome: stub.outcome, reason: stub.explanation })
    }
  }

  return {
    created: true,
    screen,
    poiId: result.poiId ?? '',
    recordId: result.recordId ?? '',
    research,
    duplicates,
    parent: resolvedParent,
    parentCreatedAsStub,
    parentNotLinked,
    stubs,
    stubsSkippedAsExisting,
    stubsNeedsReview,
    stubsRejected,
    canonIssues: result.canonIssues,
    outcome: result.outcome,
    explanation: result.explanation,
    airtableUrl: `https://airtable.com/${BASE_ID}/${POI_TABLE_ID}/${result.recordId}`,
  }
}
