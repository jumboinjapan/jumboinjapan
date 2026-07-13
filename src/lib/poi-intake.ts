import { fetchAirtableWithRetry } from '@/lib/airtable-retry'

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
const BASE_ID = process.env.AIRTABLE_BASE_ID?.trim() ?? ''
const POI_TABLE = 'POI'

// Канон категорий POI (RU) — ровно опции поля «POI Category (RU)» в Airtable
export const POI_CATEGORIES_RU = [
  'Синтоистское святилище',
  'Буддийский храм',
  'Архитектурный объект',
  'Музей',
  'Арт-пространство / Галерея',
  'Смотровая площадка',
  'Ландшафтный сад / Парк',
  'Достопримечательность',
  'Историческое место',
  'Ресторан',
  'Японский отель',
  'Парк развлечений',
  'Шоппинг',
  'Термальный Источник',
  'СПА',
  'Городской район',
  'Транспортный узел',
] as const

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

export interface PoiIntakeReport {
  created: boolean
  poiId: string
  recordId: string
  research: PoiResearchResult
  duplicates: PoiDuplicateHint[]
  airtableUrl: string
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

/** Следующий свободный POI ID: POI-000445 после POI-000444. */
async function getNextPoiId(records: AirtableRecord[]): Promise<string> {
  let max = 0
  for (const record of records) {
    const match = text(record.fields, 'POI ID').match(/^POI-(\d{6})$/)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `POI-${String(max + 1).padStart(6, '0')}`
}

/** Нормализация для сравнения названий: регистр, ё, пунктуация, пробелы. */
function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Поиск возможных дублей среди существующих POI. Намеренно «шумит» в сторону
 * ложных срабатываний: лучше показать владельцу лишнего кандидата, чем
 * завести вторую «Асакусу».
 */
export function findDuplicateCandidates(
  research: Pick<PoiResearchResult, 'nameRu' | 'nameEn'>,
  records: AirtableRecord[],
): PoiDuplicateHint[] {
  const needles = [normalizeName(research.nameRu), normalizeName(research.nameEn)].filter((n) => n.length >= 3)
  if (needles.length === 0) return []

  const hits: PoiDuplicateHint[] = []
  for (const record of records) {
    const nameRu = text(record.fields, 'POI Name (RU)')
    const nameEn = text(record.fields, 'POI Name (EN)')
    const haystacks = [normalizeName(nameRu), normalizeName(nameEn)].filter(Boolean)
    const isHit = needles.some((needle) =>
      haystacks.some((hay) => hay === needle || hay.includes(needle) || needle.includes(hay)),
    )
    if (isHit) {
      hits.push({
        poiId: text(record.fields, 'POI ID'),
        nameRu: nameRu || nameEn,
        siteCity: text(record.fields, 'Site City'),
      })
    }
  }
  return hits.slice(0, 5)
}

async function createPoiRecord(poiId: string, research: PoiResearchResult): Promise<string> {
  ensureCredentials()
  const categoriesRu = research.categoriesRu.filter((category) => POI_CATEGORIES_RU.includes(category as never))
  const categoriesEn = categoriesRu.map((category) => CATEGORY_RU_TO_EN[category]).filter(Boolean)

  const fields: Record<string, unknown> = {
    'POI ID': poiId,
    'POI Name (RU)': research.nameRu,
    'POI Name (EN)': research.nameEn || null,
    'Site City': research.siteCity || null,
    'Prefecture (RU)': research.prefectureRu || null,
    'Prefecture (EN)': research.prefectureEn || null,
    'POI Category (RU)': categoriesRu.length ? categoriesRu : undefined,
    'POI Category (EN)': categoriesEn.length ? categoriesEn : undefined,
    'Working Hours': research.workingHours || null,
    Website: research.website || null,
    // Черновик, не публикация: тексты идут в Draft-поля, Approved остаются пустыми
    'Description Draft (RU)': research.descriptionRu || null,
    'Description Draft (EN)': research.descriptionEn || null,
    'Copy Status': 'Draft',
    'Fact Check Status': 'Todo',
    Notes: [
      'Создано агентом приёма POI (Telegram).',
      research.ticketsNote ? `Билеты: ${research.ticketsNote}` : '',
      research.openQuestions.length ? `Открытые вопросы: ${research.openQuestions.join('; ')}` : '',
      research.sources.length ? `Источники: ${research.sources.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  }

  const response = await fetchAirtableWithRetry(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(POI_TABLE)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: [{ fields }] }),
  })

  if (!response.ok) throw new Error(`Airtable POI create failed: ${response.status} ${await response.text()}`)
  const data = (await response.json()) as { records?: Array<{ id: string }> }
  const recordId = data.records?.[0]?.id
  if (!recordId) throw new Error('Airtable POI create returned no record id')
  return recordId
}

// ── Исследование (OpenAI Responses API + web_search + vision) ───────────────

const RESEARCH_SYSTEM_PROMPT = [
  'Ты — исследователь-редактор travel-справочника JumboInJapan (частный гид по Японии, русскоязычная аудитория).',
  'Задача: по входным данным (текст, фото таблички/буклета/скана) определить, что это за место в Японии, собрать проверяемые факты и написать сдержанное описание.',
  '',
  'Правила фактов:',
  '- Ищи в вебе подтверждение: официальный сайт, часы работы, город, префектура, стоимость билетов.',
  '- НИЧЕГО не выдумывай. Если факт не подтверждён — оставь поле пустым и напиши об этом в openQuestions.',
  '- Часы работы и цены меняются: указывай их только со ссылкой на источник, иначе оставляй пустыми.',
  '',
  'Правила описания (descriptionRu / descriptionEn):',
  '- Третье лицо, спокойный фактурный тон. 1–2 абзаца.',
  '- Начинай с того, ЧТО это за место и почему оно имеет значение.',
  '- Конкретика вместо восторгов. Запрещены клише: «жемчужина», «обязательно к посещению», «не пропустите», «уникальный», «незабываемый».',
  '- Не рекламный буклет и не перевод с английского — живой текст информированного человека.',
  '- Никаких формулировок «автомобиль с гидом», «гид-водитель» — если нужен транспортный контекст, только «частный транспорт».',
  '',
  'Ответ — СТРОГО JSON без markdown-обёртки, по схеме:',
  '{"nameRu":"","nameEn":"","siteCity":"","prefectureRu":"","prefectureEn":"","categoriesRu":[],"workingHours":"","website":"","ticketsNote":"","descriptionRu":"","descriptionEn":"","openQuestions":[],"sources":[]}',
  '',
  `categoriesRu — только из этого списка (0–3 значения): ${POI_CATEGORIES_RU.join(' | ')}`,
  'siteCity — короткое имя города латиницей в нижнем регистре, как ключ (tokyo, kyoto, hakone, nara, osaka, nikko, kamakura, kanazawa…).',
].join('\n')

interface ResponsesContentItem {
  type: 'input_text' | 'input_image'
  text?: string
  image_url?: string
}

/**
 * Исследование через OpenAI Responses API. Веб-поиск подключается как tool;
 * если модель/аккаунт его не поддерживает, повторяем без tools — тогда
 * агент работает только по присланным данным и своим знаниям, а всё
 * неподтверждённое честно уходит в openQuestions.
 */
export async function researchPoi(input: { note?: string; imageDataUrls?: string[] }): Promise<PoiResearchResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured on the server')
  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini'

  const content: ResponsesContentItem[] = []
  content.push({
    type: 'input_text',
    text: input.note?.trim()
      ? `Входные данные от владельца:\n${input.note.trim()}`
      : 'Владелец прислал только изображение(я). Определи место по ним.',
  })
  for (const url of input.imageDataUrls ?? []) {
    content.push({ type: 'input_image', image_url: url })
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
    openQuestions: asStringArray(parsed.openQuestions),
    sources: asStringArray(parsed.sources).slice(0, 5),
  }
}

// ── Оркестратор ─────────────────────────────────────────────────────────────

export async function intakePoi(input: { note?: string; imageDataUrls?: string[] }): Promise<PoiIntakeReport> {
  const research = await researchPoi(input)

  // Один проход по таблице обслуживает и дедупликацию, и выдачу нового ID
  const existing = await fetchPoiRecords(['POI ID', 'POI Name (RU)', 'POI Name (EN)', 'Site City'])
  const duplicates = findDuplicateCandidates(research, existing)
  const poiId = await getNextPoiId(existing)
  const recordId = await createPoiRecord(poiId, research)

  return {
    created: true,
    poiId,
    recordId,
    research,
    duplicates,
    airtableUrl: `https://airtable.com/${BASE_ID}/tblVCmFcHRpXUT24y/${recordId}`,
  }
}
