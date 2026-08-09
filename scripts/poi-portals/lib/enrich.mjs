/**
 * Каскад AI-обогащения кандидатов POI.
 *
 * Принцип: механическую работу отдаём самой дешёвой модели, финальный
 * русский текст для сайта — только Claude по skill'ам проекта
 * (jj-title-copywriter, russian-naturalness-editor). Между ними —
 * человек, а не автопубликация.
 *
 * Каскад из четырёх ступеней. Каждая следующая дороже предыдущей на
 * порядок, поэтому задача каждой — уменьшить объём работы для следующей.
 *
 *   0. ПРАВИЛА (бесплатно)      resolveCategory() в scoring.mjs.
 *                               На реальных данных разбирает ~45% Осаки и
 *                               ~43% Киото. Всё, что она забрала, не стоит
 *                               ни цента и не может «сгаллюцинировать».
 *   1. КЛАССИФИКАТОР (дёшево)   только остаток без категории. Батч-API,
 *                               strict JSON schema, 17 категорий канона.
 *   2. ИЗВЛЕЧЕНИЕ (дёшево)      нормализация часов, цены, транспорта из
 *                               японского в поля схемы. Только для тех,
 *                               кто прошёл отбор.
 *   3. РУССКИЙ ТЕКСТ (дорого)   Claude, по одной точке, только после
 *                               ручного одобрения карточки. Это единственная
 *                               ступень, которая пишет то, что увидит клиент.
 *
 * Ступени 1-2 идут через Batch API (-50% у всех трёх провайдеров, окно 24 ч).
 * Сбор POI не срочный — ждать час-два нормально.
 */

/**
 * Цены за 1M токенов, Batch API. Проверено 2026-08-06.
 * ВНИМАНИЕ: gpt-4.1-mini, на котором сейчас работает src/lib/poi-intake.ts,
 * убран с прайс-листа OpenAI; gpt-5-nano/mini отключаются 11.12.2026.
 * Модель в существующем агенте придётся менять независимо от этой задачи.
 */
export const MODEL_PRICING_BATCH = {
  'gemini-2.5-flash-lite': { in: 0.05, out: 0.2, schema: 'native', note: 'самый дешёвый со схемой' },
  'gpt-5.6-luna': { in: 0.1, out: 0.6, schema: 'strict', note: 'строгая json_schema' },
  'claude-haiku-4.5': { in: 0.5, out: 2.5, schema: 'GA', note: 'один стек с текстовой ступенью' },
  'claude-sonnet-5': { in: 1.0, out: 5.0, schema: 'GA', note: 'вводная цена до 31.08.2026' },
}

/** Грубая оценка токенов. Японский плотнее латиницы: ~1 токен на символ. */
export function estimateTokens(text, { script = 'ja' } = {}) {
  const len = String(text ?? '').length
  return script === 'ja' ? Math.ceil(len * 1.05) : Math.ceil(len / 3.2)
}

/** Системный промпт классификатора — фиксирован, значит кэшируется. */
export const CLASSIFY_SYSTEM_PROMPT = `Ты классифицируешь японские туристические объекты для базы POI туроператора.

Отвечай ТОЛЬКО объектом по схеме. Никаких пояснений.

Категории (выбирай ИСКЛЮЧИТЕЛЬНО из этого списка, максимум 2):
Синтоистское святилище, Буддийский храм, Архитектурный объект, Музей,
Арт-пространство / Галерея, Смотровая площадка, Ландшафтный сад / Парк,
Достопримечательность, Историческое место, Ресторан, Японский отель,
Парк развлечений, Шоппинг, Термальный Источник, СПА, Городской район,
Транспортный узел.

Поле isTourPoi = false, если объект НЕ является самостоятельной точкой
экскурсионного маршрута: средство размещения, филиал сети, магазин,
муниципальное учреждение, продавец мастер-классов, разовое событие.
Сомневаешься — ставь false и объясни в reason. Ложный пропуск дешевле,
чем мусор в базе.

Поле nameRu — транслитерация по системе Поливанова, без «дж», «ши», «чи».
Если объект широко известен под устоявшимся русским именем — используй его.`

export const CLASSIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isTourPoi', 'categoriesRu', 'nameRu', 'confidence', 'reason'],
  properties: {
    isTourPoi: { type: 'boolean' },
    categoriesRu: { type: 'array', items: { type: 'string' }, maxItems: 2 },
    nameRu: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reason: { type: 'string', maxLength: 200 },
  },
}

/**
 * Считает стоимость прогона по РЕАЛЬНОМУ корпусу, а не по средним оценкам.
 *
 * @param evaluated  результат evaluatePoiCandidate по каждому кандидату:
 *                   [{ candidate, verdict }]
 */
export function estimateCascadeCost(evaluated, { model = 'gemini-2.5-flash-lite' } = {}) {
  const price = MODEL_PRICING_BATCH[model]
  if (!price) throw new Error(`Нет цен для модели ${model}`)

  const systemTokens = estimateTokens(CLASSIFY_SYSTEM_PROMPT, { script: 'ru' })

  // Ступень 1: только те, кого правила не разобрали и кто не отброшен.
  const needClassify = evaluated.filter((e) => e.verdict.decision !== 'reject' && !e.verdict.category)
  // Ступень 2: те, кто прошёл отбор и имеет что нормализовать.
  const needExtract = evaluated.filter(
    (e) => e.verdict.decision !== 'reject' && (e.candidate.workingHours || e.candidate.priceLabel),
  )

  let classifyIn = 0
  for (const { candidate } of needClassify) {
    classifyIn +=
      systemTokens +
      estimateTokens(candidate.nameJa) +
      estimateTokens(String(candidate.descriptionJa ?? '').slice(0, 600))
  }
  const classifyOut = needClassify.length * 90

  let extractIn = 0
  for (const { candidate } of needExtract) {
    extractIn +=
      200 + estimateTokens(`${candidate.workingHours} ${candidate.priceLabel} ${candidate.access}`)
  }
  const extractOut = needExtract.length * 70

  const cost = (tin, tout) => (tin / 1e6) * price.in + (tout / 1e6) * price.out

  return {
    model,
    resolvedByRulesFree: evaluated.filter((e) => e.verdict.category).length,
    stage1: {
      records: needClassify.length,
      inputTokens: classifyIn,
      outputTokens: classifyOut,
      usd: Number(cost(classifyIn, classifyOut).toFixed(4)),
    },
    stage2: {
      records: needExtract.length,
      inputTokens: extractIn,
      outputTokens: extractOut,
      usd: Number(cost(extractIn, extractOut).toFixed(4)),
    },
    totalUsd: Number((cost(classifyIn, classifyOut) + cost(extractIn, extractOut)).toFixed(4)),
    // Ступень 3 намеренно не считается автоматически: русский текст пишется
    // только для точек, одобренных владельцем, и это решение не машины.
    stage3Note:
      'Русский текст — Claude, только по одобренным карточкам. ' +
      'Порядок 2-4 тыс. токенов на точку; при Sonnet 5 batch ≈ $0.02 за точку.',
  }
}
