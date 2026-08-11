import { buildClassifySystemPrompt, buildProposalSchema } from './classification-contract.mjs'

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
 *   0. ПРАВИЛА (бесплатно)      classifyByRules() в scoring.mjs.
 *                               На реальных данных разбирает ~45% Осаки и
 *                               ~43% Киото. Всё, что она забрала, не стоит
 *                               ни цента и не может «сгаллюцинировать».
 *                               Происхождение таких записей — rule, не model.
 *   1. КЛАССИФИКАТОР (дёшево)   только остаток, который правила не разобрали.
 *                               Батч-API, strict JSON schema; и промпт, и
 *                               схема строятся из реестра таксономии, а не
 *                               из списка в этом файле.
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

/**
 * Системный промпт и схема ответа классификатора.
 *
 * Раньше здесь лежали 17 русских названий строкой и схема с полями
 * `categoriesRu` и `isTourPoi`. Оба списка были собственными: промпт уже
 * разошёлся с каноном на два значения, а `isTourPoi` был решением о допуске,
 * принятым моделью вместо политики.
 *
 * Теперь и то и другое строится из реестра в classification-contract.mjs.
 * Здесь только пересборка на каждый вызов: реестр читается один раз при
 * загрузке модуля, а промпт и схема собираются из него, поэтому расходиться
 * им не с чем.
 */
export const CLASSIFY_SYSTEM_PROMPT = buildClassifySystemPrompt()
export const CLASSIFY_SCHEMA = buildProposalSchema()

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
  const needClassify = evaluated.filter((e) => e.verdict.decision !== 'reject' && !e.verdict.ruleClassified)
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
    resolvedByRulesFree: evaluated.filter((e) => e.verdict.ruleClassified).length,
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
