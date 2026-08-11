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
  catalogTargets,
  classificationSources,
  dispositions,
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
const SOURCE_RULE = 'rule'
const SOURCE_MODEL = 'model'
export const DECLARED_SOURCE_NAMES = Object.freeze([SOURCE_RULE, SOURCE_MODEL])

/* Исход и каталог, означающие «это POI и его можно заводить». Реестр их
   перечисляет, но не объясняет; поэтому имена написаны здесь и сверяются с
   реестром при загрузке — переименование в реестре ломает импорт. */
const DISPOSITION_ROUTE = 'route'
const DISPOSITION_EXCLUDE = 'exclude'
const CATALOG_POI = 'poi'

for (const source of DECLARED_SOURCE_NAMES) {
  if (!classificationSources.includes(source)) {
    throw new Error(
      `Контракт классификации: источник ${JSON.stringify(source)} не объявлен в ${taxonomyVersion}; `
      + `реестр знает ${classificationSources.join(', ')}`,
    )
  }
}
for (const [what, value, declared] of [
  ['исход', DISPOSITION_ROUTE, dispositions],
  ['исход', DISPOSITION_EXCLUDE, dispositions],
  ['каталог', CATALOG_POI, catalogTargets],
]) {
  if (!declared.includes(value)) {
    throw new Error(`Контракт классификации: ${what} ${JSON.stringify(value)} не объявлен в ${taxonomyVersion}`)
  }
}

/** Поля, которые модель ИМЕЕТ право вернуть; они же все обязательны. */
export const PROPOSAL_FIELDS = Object.freeze([
  'entityKind',
  'poiPrimaryType',
  'facets',
  'confidence',
  'reasons',
  'nameRu',
])

/** Обязательные поля ответа. Совпадают со схемой, и тест это стережёт. */
export const PROPOSAL_REQUIRED = PROPOSAL_FIELDS

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
 * Проверка ЭКВИВАЛЕНТНА strict-схеме: что схема отвергает — отвергает и она,
 * что схема принимает — принимает и она. Раньше была слабее и, хуже того,
 * молча чинила ответ: повторяющиеся признаки дедуплицировала, нестроковые
 * обоснования отфильтровывала, лишние — отбрасывала. Невалидный ответ модели
 * превращался в правдоподобный валидный, и разобраться потом, что именно
 * прислала модель, было уже нельзя.
 *
 * Отсюда правило: НИЧЕГО не нормализуем. Значения проходят как есть или
 * ответ отвергается целиком.
 *
 * Схема ограничивает и максимум признаков (по числу кодов реестра), и число
 * обоснований, и длину каждого; всё это повторено ниже, и дифференциальный
 * тест через AJV сверяет две реализации на общем корпусе.
 */
const MAX_REASONS = 4
const MAX_REASON_LENGTH = 200

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
  for (const field of PROPOSAL_REQUIRED) {
    if (!(field in raw)) problems.push(`модель не вернула обязательное поле ${field}`)
  }

  if ('entityKind' in raw) {
    if (typeof raw.entityKind !== 'string') problems.push('вид сущности не строка')
    else if (!entityKindCodes.includes(raw.entityKind)) {
      problems.push(`вид сущности ${JSON.stringify(raw.entityKind)} не объявлен в реестре`)
    }
  }

  if ('poiPrimaryType' in raw && raw.poiPrimaryType !== null) {
    if (typeof raw.poiPrimaryType !== 'string') problems.push('тип объекта не строка и не null')
    else if (!poiPrimaryTypeCodes.includes(raw.poiPrimaryType)) {
      problems.push(`тип объекта ${JSON.stringify(raw.poiPrimaryType)} не объявлен в реестре`)
    }
  }

  if ('facets' in raw) {
    if (!Array.isArray(raw.facets)) problems.push('признаки не массив')
    else {
      if (raw.facets.length > facetCodes.length) {
        problems.push(`признаков ${raw.facets.length}, в реестре объявлено ${facetCodes.length}`)
      }
      if (new Set(raw.facets).size !== raw.facets.length) {
        problems.push('признаки повторяются')
      }
      for (const facet of raw.facets) {
        if (typeof facet !== 'string' || !facetCodes.includes(facet)) {
          problems.push(`признак ${JSON.stringify(facet)} не объявлен в реестре`)
        }
      }
    }
  }

  if ('confidence' in raw) {
    if (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence)) {
      problems.push('уверенность не число')
    } else if (raw.confidence < 0 || raw.confidence > 1) {
      problems.push('уверенность вне диапазона 0…1')
    }
  }

  if ('reasons' in raw) {
    if (!Array.isArray(raw.reasons)) problems.push('обоснования не массив')
    else {
      if (raw.reasons.length > MAX_REASONS) {
        problems.push(`обоснований ${raw.reasons.length}, максимум ${MAX_REASONS}`)
      }
      for (const reason of raw.reasons) {
        if (typeof reason !== 'string') problems.push(`обоснование ${JSON.stringify(reason)} не строка`)
        else if (!reason.length) problems.push('пустое обоснование')
        else if (reason.length > MAX_REASON_LENGTH) {
          problems.push(`обоснование длиннее ${MAX_REASON_LENGTH} символов`)
        }
      }
    }
  }

  if ('nameRu' in raw) {
    if (typeof raw.nameRu !== 'string') problems.push('русское имя не строка')
    else if (!raw.nameRu.length) problems.push('русское имя пусто')
  }

  if (problems.length) return { ok: false, problems, proposal: null }
  return {
    ok: true,
    problems: [],
    proposal: Object.freeze({
      entityKind: raw.entityKind,
      poiPrimaryType: raw.poiPrimaryType ?? null,
      facets: Object.freeze([...raw.facets]),
      confidence: raw.confidence,
      reasons: Object.freeze([...raw.reasons]),
      nameRu: raw.nameRu,
    }),
  }
}

/* ── Терминальный исход ───────────────────────────────────────────────────
   Одна реализация условия «это POI и его можно заводить». Раньше их было две
   — в decision и в canAutoImport, — и обе смотрели на факт совпадения
   шаблона вместо маршрута реестра. Из-за этого вокзал и рёкан попадали в
   writable, а останавливал их только legacy-мост слоем ниже. */

export const TERMINAL = Object.freeze({
  /* ВНИМАНИЕ: eligible, а не writable. Эта функция считается ДО определения
     маршрутного города и до дедупликации, поэтому «можно записывать» она
     сказать не может — только «таксономия и качество дальше пропускают».
     Назвать её writable значило бы объявить автоимпортируемыми 336 объектов
     там, где до записи доходит 116. Финальное решение — poiWritableDecision
     ниже, и canAutoImport считается только по нему. */
  POI_ELIGIBLE: 'poiEligible',
  NEEDS_REVIEW: 'classificationNeedsReview',
  EXCLUDED: 'excludedByTaxonomy',
  ROUTED_ELSEWHERE: 'routedElsewhere',
  QUALITY_REJECTED: 'qualityRejected',
  AWAITING: 'awaitingClassification',
})

/**
 * Единственный конечный исход кандидата.
 *
 * Порядок ветвления не косметика. Сначала спрашивается ТАКСОНОМИЯ: «это
 * отель» или «это вокзал» — терминальное утверждение о том, чей это объект,
 * и оценка качества карточки его не отменяет. И только для того, что
 * таксономия направила в POI, спрашивается качество: достаточно ли записи,
 * чтобы её заводить.
 *
 * Обратный порядок дал бы неверные очереди: рёкан ушёл бы в «отклонено по
 * качеству» из-за блокера «средство размещения», хотя на деле он просто
 * принадлежит другому каталогу.
 */
export function terminalOutcome({
  classification,
  blockingReasons = [],
  score = 0,
  hasCoords = false,
  importMinScore,
}) {
  if (classification) {
    if (classification.intakeDisposition !== DISPOSITION_ROUTE) {
      return {
        outcome: classification.intakeDisposition === DISPOSITION_EXCLUDE
          ? TERMINAL.EXCLUDED
          : TERMINAL.NEEDS_REVIEW,
        reason: classification.excludeReason ?? classification.routeRuleId,
      }
    }
    if (classification.catalogTarget !== CATALOG_POI) {
      return { outcome: TERMINAL.ROUTED_ELSEWHERE, reason: classification.catalogTarget }
    }
    if (!classification.poiPrimaryType) {
      return { outcome: TERMINAL.NEEDS_REVIEW, reason: 'маршрут в POI без типа объекта' }
    }
  }

  if (blockingReasons.length) {
    return { outcome: TERMINAL.QUALITY_REJECTED, reason: blockingReasons.join(', ') }
  }
  if (!Number.isFinite(importMinScore)) {
    throw new Error('Терминальный исход: не передан порог качества')
  }
  if (score < importMinScore) {
    return { outcome: TERMINAL.QUALITY_REJECTED, reason: `оценка ${score} ниже порога ${importMinScore}` }
  }
  if (!hasCoords) return { outcome: TERMINAL.QUALITY_REJECTED, reason: 'нет координат' }
  if (!classification) return { outcome: TERMINAL.AWAITING, reason: 'правила не разобрали, ждёт модель' }
  return { outcome: TERMINAL.POI_ELIGIBLE, reason: classification.routeRuleId }
}

/**
 * ФИНАЛЬНОЕ решение о записи: таксономия и качество пропустили, город
 * определён, город маршрутный, дедуп не снял.
 *
 * Одна реализация на два потребителя: по ней отбирается portal.writable и по
 * ней же выставляется canAutoImport. Считать их порознь нельзя — именно так и
 * получилось расхождение 336 против 116.
 */
export function poiWritableDecision({ terminal, municipalityResolved, insideRegion, deduped }) {
  if (terminal !== TERMINAL.POI_ELIGIBLE) return { writable: false, reason: terminal }
  if (!municipalityResolved) return { writable: false, reason: 'cityUnresolved' }
  if (!insideRegion) return { writable: false, reason: 'outsideRegion' }
  if (deduped) return { writable: false, reason: 'poiDeduped' }
  return { writable: true, reason: null }
}

/**
 * Та же проверка по уже собранной строке отчёта — второй уровень защиты в
 * writeRun. Маршрут пересчитывается реестром заново, а не читается из строки:
 * доверять полю, которое кто-то мог проставить сам, здесь нечему.
 */
export function isRouteToPoi({ entityKind, poiPrimaryType, classificationSource }) {
  if (!DECLARED_SOURCE_NAMES.includes(classificationSource)) return false
  if (!poiPrimaryType) return false
  let route
  try {
    route = resolveRoute({ entityKind, poiPrimaryType, classificationSource })
  } catch {
    return false
  }
  return route.disposition === DISPOSITION_ROUTE && route.catalogTarget === CATALOG_POI
}

/* ── Две границы происхождения ────────────────────────────────────────────
   Общей функции с параметром «источник» больше нет. Она была обходом: любой
   вызывающий код мог передать `human` и получить маршрут в POI с резервным
   типом без заметки — то есть выдать машинный вызов за решение владельца.
   requiresNote при этом возвращался как справка и никем не исполнялся.

   Канал `human` в портальном классификаторе не реализован намеренно. Его
   место — граница владельца, где заметка обязательна и проверяема. */

function buildResult(proposal, classificationSource, sourceKey) {
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
    facets: Object.freeze([...(proposal.facets ?? [])]),
    confidence: proposal.confidence ?? null,
    reasons: Object.freeze([...(proposal.reasons ?? [])]),
    intakeDisposition: route.disposition,
    catalogTarget: route.catalogTarget,
    excludeReason: route.excludeReason,
    requiresNote: route.requiresNote,
    routeRuleId: route.ruleId,
  })
}

/**
 * Граница детерминированного правила. Источник равен `rule` жёстко: параметра
 * для него нет, подменить нечем. Коды всё равно сверяются с реестром —
 * правила пишет человек, и опечатка обязана падать, а не маршрутизироваться.
 */
export function classifyByRule({ entityKind, poiPrimaryType = null, reasons = [], sourceKey = null }) {
  if (!entityKindCodes.includes(entityKind)) {
    throw new Error(`Правило классификации: вид сущности ${JSON.stringify(entityKind)} не объявлен в реестре`)
  }
  if (poiPrimaryType !== null && !poiPrimaryTypeCodes.includes(poiPrimaryType)) {
    throw new Error(`Правило классификации: тип ${JSON.stringify(poiPrimaryType)} не объявлен в реестре`)
  }
  return buildResult(
    { entityKind, poiPrimaryType, facets: [], confidence: null, reasons },
    SOURCE_RULE,
    sourceKey,
  )
}

/**
 * Граница ответа модели. Сырой ответ СНАЧАЛА проходит строгую проверку и
 * только потом получает источник `model`. Обойти проверку нечем: функции,
 * принимающей готовое предложение вместе с источником, наружу больше нет.
 */
export function classifyModelResponse(raw, { sourceKey = null } = {}) {
  const checked = validateProposal(raw)
  if (!checked.ok) return { ok: false, problems: checked.problems, proposal: null, classification: null }
  /* Нормализованное предложение возвращается рядом с классификацией: в нём
     живёт nameRu, которое проверка требует, а маршрут не использует. Без
     этого обязательное поле модели терялось сразу после проверки. */
  return {
    ok: true,
    problems: [],
    proposal: checked.proposal,
    classification: buildResult(checked.proposal, SOURCE_MODEL, sourceKey),
  }
}
