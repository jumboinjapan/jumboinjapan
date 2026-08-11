/**
 * Контракт классификации кандидата POI. Чистый модуль: вход → результат, без I/O.
 *
 * Потребитель № 2a из ADR-0001 §13. Единственный источник словарей —
 * канонический loader src/lib/poi-taxonomy.ts. Своих перечней кодов, подписей
 * и маршрутов здесь нет и быть не может: тест сверяет строковые литералы этого
 * файла со строковыми значениями реестра.
 *
 * Разделение обязанностей, ради которого модуль существует:
 *
 *   модель или правило  →  ПРЕДЛОЖЕНИЕ: что это за сущность и какого типа
 *   вызывающий код      →  ПРОИСХОЖДЕНИЕ: кто предложил (rule / model / human)
 *   реестр              →  МАРШРУТ: исход приёма, каталог, причина отказа
 *
 * Модель не выбирает маршрут. Раньше выбирала: поле isTourPoi в старой схеме
 * было ровно решением о допуске, принятым моделью, а не политикой.
 */
import {
  classificationSources,
  entityKindCodes,
  entityKindOptions,
  facetCodes,
  facetOptions,
  poiPrimaryTypeCodes,
  poiType,
  poiTypeOptions,
  resolveRoute,
  taxonomyVersion,
} from '../../../src/lib/poi-taxonomy.ts'

/* ── Происхождение классификации ──────────────────────────────────────────
   Два имени, которые модуль обязан знать по смыслу: какой из объявленных
   источников означает «детерминированное правило», а какой — «языковая
   модель». Вывести это из данных нельзя — реестр перечисляет источники, но не
   объясняет, что каждый значит. Поэтому имена написаны здесь и тут же
   сверяются с реестром: переименование источника ломает загрузку модуля, а не
   всплывает молча в отчёте. Тест сторожит, что список не растёт. */
export const SOURCE_RULE = 'rule'
export const SOURCE_MODEL = 'model'
export const DECLARED_SOURCE_NAMES = Object.freeze([SOURCE_RULE, SOURCE_MODEL])

for (const source of DECLARED_SOURCE_NAMES) {
  if (!classificationSources.includes(source)) {
    throw new Error(
      `Контракт классификации: источник ${JSON.stringify(source)} не объявлен в ${taxonomyVersion}; `
      + `реестр знает ${classificationSources.join(', ')}`,
    )
  }
}

/** Поля, которые модель ИМЕЕТ право вернуть. */
export const PROPOSAL_FIELDS = Object.freeze([
  'entityKind',
  'poiPrimaryType',
  'facets',
  'confidence',
  'reasons',
  'nameRu',
])

/**
 * Поля, которых в ответе модели быть не может.
 *
 * Первые четыре вычисляет политика реестра, а не тот, кто смотрит на
 * название. Последнее — редакционный слой: бейдж ставит редактор или правило
 * публикации, и предложение модели тут ничего не решает.
 */
export const FORBIDDEN_PROPOSAL_FIELDS = Object.freeze([
  'classificationSource',
  'intakeDisposition',
  'catalogTarget',
  'excludeReason',
  'badges',
])

/**
 * Strict JSON schema для ответа модели. Строится из реестра при каждом вызове:
 * добавится тип в реестре — он появится в enum сам, без правки этого файла.
 *
 * Это НЕ config/poi-classification.schema.json. Та схема описывает полный
 * результат ПОСЛЕ маршрутизации и содержит поля маршрута; отдать её модели
 * целиком значило бы снова позволить модели выбирать каталог.
 */
export function buildProposalSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: [...PROPOSAL_FIELDS],
    properties: {
      entityKind: { type: 'string', enum: [...entityKindCodes] },
      poiPrimaryType: {
        anyOf: [{ type: 'string', enum: [...poiPrimaryTypeCodes] }, { type: 'null' }],
      },
      facets: {
        type: 'array',
        uniqueItems: true,
        maxItems: facetCodes.length,
        items: { type: 'string', enum: [...facetCodes] },
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      reasons: { type: 'array', maxItems: 4, items: { type: 'string', minLength: 1, maxLength: 200 } },
      nameRu: { type: 'string', minLength: 1 },
    },
  }
}

const bullet = (options) => options.map((o) => `- ${o.code} — ${o.label}`).join('\n')

/**
 * Системный промпт классификатора. Перечни в нём — из реестра, поэтому
 * промпт не может разойтись со схемой ответа: оба построены из одного файла.
 * Раньше промпт нёс 17 русских названий строкой и уже разошёлся с каноном на
 * два значения.
 */
export function buildClassifySystemPrompt() {
  const types = poiTypeOptions()
  const byGroup = new Map()
  for (const option of types) {
    if (!byGroup.has(option.groupLabel)) byGroup.set(option.groupLabel, [])
    byGroup.get(option.groupLabel).push(option)
  }
  const typeBlock = [...byGroup.entries()]
    .map(([group, items]) => `${group}:\n${bullet(items)}`)
    .join('\n\n')

  const guidance = types
    .map((option) => {
      const full = poiType(option.code)
      const include = full?.include?.length ? `подходит: ${full.include.join('; ')}` : ''
      const exclude = full?.exclude?.length ? `не подходит: ${full.exclude.join('; ')}` : ''
      const parts = [include, exclude].filter(Boolean)
      return parts.length ? `${option.code} — ${parts.join('. ')}` : ''
    })
    .filter(Boolean)
    .join('\n')

  return [
    'Ты классифицируешь японские туристические объекты для базы POI туроператора.',
    'Отвечай ТОЛЬКО объектом по схеме. Никаких пояснений.',
    '',
    `Реестр таксономии: ${taxonomyVersion}. Коды бери ИСКЛЮЧИТЕЛЬНО из списков ниже.`,
    '',
    'Вид сущности (entityKind), ровно один:',
    bullet(entityKindOptions()),
    '',
    'Тип объекта (poiPrimaryType) — только когда entityKind туристический;',
    'во всех остальных случаях null:',
    '',
    typeBlock,
    '',
    'Границы типов:',
    guidance,
    '',
    'Признаки (facets), ноль или больше:',
    bullet(facetOptions()),
    '',
    'Чего ты НЕ решаешь: попадёт ли объект в базу, в какой каталог он уйдёт и',
    'по какой причине будет отклонён. Это вычисляет политика реестра по твоему',
    'ответу. Не возвращай полей ' + FORBIDDEN_PROPOSAL_FIELDS.join(', ') + '.',
    '',
    'Не уверен в типе — верни poiPrimaryType = null и объясни в reasons.',
    'Пустой тип честнее выдуманного: запись уйдёт человеку, а не в базу.',
    '',
    'Поле nameRu — транслитерация по системе Поливанова, без «дж», «ши», «чи».',
    'Если объект широко известен под устоявшимся русским именем — используй его.',
  ].join('\n')
}

/**
 * Проверка сырого ответа модели ДО маршрутизации.
 *
 * Неизвестный код останавливается здесь, а не превращается в маршрут: иначе
 * выдуманный моделью тип доехал бы до политики и получил бы там какое-нибудь
 * решение по обобщённому состоянию.
 */
export function validateProposal(raw) {
  const problems = []
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, problems: ['ответ модели не объект'], proposal: null }
  }

  for (const field of FORBIDDEN_PROPOSAL_FIELDS) {
    if (field in raw) problems.push(`модель вернула запрещённое поле ${field}`)
  }
  for (const field of Object.keys(raw)) {
    if (!PROPOSAL_FIELDS.includes(field) && !FORBIDDEN_PROPOSAL_FIELDS.includes(field)) {
      problems.push(`модель вернула неизвестное поле ${field}`)
    }
  }

  const entityKind = typeof raw.entityKind === 'string' ? raw.entityKind.trim() : ''
  if (!entityKind) problems.push('вид сущности не указан')
  else if (!entityKindCodes.includes(entityKind)) {
    problems.push(`вид сущности ${JSON.stringify(entityKind)} не объявлен в реестре`)
  }

  const rawType = raw.poiPrimaryType
  let poiPrimaryType = null
  if (rawType !== null && rawType !== undefined) {
    if (typeof rawType !== 'string') problems.push('тип объекта не строка и не null')
    else if (!poiPrimaryTypeCodes.includes(rawType)) {
      problems.push(`тип объекта ${JSON.stringify(rawType)} не объявлен в реестре`)
    } else poiPrimaryType = rawType
  }

  const facets = []
  if (raw.facets !== undefined) {
    if (!Array.isArray(raw.facets)) problems.push('признаки не массив')
    else {
      for (const facet of raw.facets) {
        if (typeof facet !== 'string' || !facetCodes.includes(facet)) {
          problems.push(`признак ${JSON.stringify(facet)} не объявлен в реестре`)
        } else if (!facets.includes(facet)) facets.push(facet)
      }
    }
  }

  const confidence = typeof raw.confidence === 'number' ? raw.confidence : null
  if (confidence === null || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    problems.push('уверенность вне диапазона 0…1')
  }

  const reasons = Array.isArray(raw.reasons)
    ? raw.reasons.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim())
    : []

  const nameRu = typeof raw.nameRu === 'string' ? raw.nameRu.trim() : ''

  if (problems.length) return { ok: false, problems, proposal: null }
  return {
    ok: true,
    problems: [],
    proposal: Object.freeze({ entityKind, poiPrimaryType, facets: Object.freeze(facets), confidence, reasons: Object.freeze(reasons), nameRu }),
  }
}

/**
 * Полный результат классификации: предложение + происхождение + маршрут.
 *
 * Происхождение приходит ОТ ВЫЗЫВАЮЩЕГО КОДА, а не из предложения. Даже если
 * модель попытается прислать своё — validateProposal остановит её раньше.
 */
export function classify({ proposal, classificationSource, sourceKey = null }) {
  if (!classificationSources.includes(classificationSource)) {
    throw new Error(
      `Контракт классификации: источник ${JSON.stringify(classificationSource)} не объявлен в ${taxonomyVersion}`,
    )
  }
  if (!proposal || typeof proposal !== 'object') {
    throw new Error('Контракт классификации: предложение не передано')
  }
  if ('classificationSource' in proposal) {
    throw new Error('Контракт классификации: предложение не имеет права нести происхождение')
  }

  const route = resolveRoute({
    entityKind: proposal.entityKind,
    poiPrimaryType: proposal.poiPrimaryType,
    classificationSource,
  })

  return Object.freeze({
    sourceKey,
    taxonomyVersion,
    classificationSource,
    entityKind: proposal.entityKind,
    poiPrimaryType: proposal.poiPrimaryType ?? null,
    facets: proposal.facets ?? [],
    confidence: proposal.confidence ?? null,
    reasons: proposal.reasons ?? [],
    intakeDisposition: route.disposition,
    catalogTarget: route.catalogTarget,
    excludeReason: route.excludeReason,
    requiresNote: route.requiresNote,
    routeRuleId: route.ruleId,
  })
}
