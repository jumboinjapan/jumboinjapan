/**
 * JA-5: АРТЕФАКТ РЕШЕНИЙ ВЛАДЕЛЬЦА — `poi-owner-decisions/v1`.
 *
 * Малый файл, в котором лежат ТОЛЬКО действительно неоднозначные строки. Не
 * «всё, что не прошло»: решение владельца 3.3 (06.09.2026) прямо говорит, что
 * 919 несопоставленных вручную не просматриваются, а 196 совпадений по имени
 * без второго независимого признака не связываются — это уже решено, и
 * переспрашивать значило бы отменять принятое решение чужими руками.
 *
 * ПОВОД ДЛЯ ВОПРОСА — ИЗ ЗАКРЫТОГО СПИСКА, и каждый повод объясним: он о
 * тождестве или о запрете, то есть о том, что машина решить не вправе.
 *
 * ЧЕГО ЭТОТ ФАЙЛ НЕ ДЕЛАЕТ. Он не выдаёт полномочий: ответ владельца здесь —
 * ответ на вопрос, а не разрешение на сеть, запись или Git. Каждое разрешение
 * остаётся отдельным, и в этом файле его нет и быть не может.
 *
 * МАШИННОЕ НЕ ВЫДАЁТСЯ ЗА ЧЕЛОВЕЧЕСКОЕ. Всё, что предложено кодом —
 * предполагаемый тип, русское имя, возможный дубль, — помечено `machine` и
 * несёт свою уверенность. Ни одно поле артефакта не является решением, пока
 * человек не ответил.
 */
import { canonicalJsonBytes } from '../../lib/canonical-contract.mjs'
import { sha256Bytes } from '../../lib/byte-digest.mjs'
import { poiNameFromKana, poiNameToRu } from '../../../src/lib/polivanov.ts'

export const OWNER_DECISIONS_SPEC = 'poi-owner-decisions/v1'

/**
 * ПОВОДЫ СПРОСИТЬ. Список закрыт; каждый — о тождестве либо о запрете.
 * Категориальная неоднозначность (`categoryAmbiguous`) сюда НЕ входит: это
 * вопрос о типе, а не о тождестве, и он решается правилом реестра, а не
 * построчно.
 */
export const DECISION_REASONS = Object.freeze([
  'ambiguousName',      // одно имя указывает на несколько записей базы
  'linkConflict',       // свидетельства о тождестве противоречат друг другу
  'placeAmbiguous',     // опознание вернуло больше одного подходящего места
  'sourceForbidden',    // сайт объекта запретил чтение — брать ли данные иначе
])
/** Что владелец может ответить. Ответ не даёт полномочий — см. заголовок. */
export const DECISION_ANSWERS = Object.freeze(['createNew', 'linkExisting', 'skip', 'postpone'])
/**
 * Потолок малой очереди. Он не обрезает молча: превышение названо в отчёте
 * отдельным полем, и владелец видит, что осталось за пределами файла.
 */
export const MAX_DECISIONS = 40

const machine = (value, confidence, note = null) => ({ value, source: 'machine', confidence, note })

/**
 * Предложение русского имени. Из каны — транслитерацией Поливанова, иначе из
 * английского. В обоих случаях это ПРЕДЛОЖЕНИЕ: редакторская сверка обязательна
 * и объявлена полем `needsEditorialReview`, а не подразумевается.
 */
export function proposeRussianName({ nameJa, nameKana, nameEn }) {
  if (nameKana) {
    const fromKana = poiNameFromKana(nameJa ?? '', nameKana)
    if (fromKana.nameRu) {
      return { ...machine(fromKana.nameRu, fromKana.confidence, 'Поливанов по кане'), needsEditorialReview: true, warnings: fromKana.warnings }
    }
  }
  const fromEn = poiNameToRu(nameEn ?? '')
  return {
    ...machine(fromEn.nameRu || null, fromEn.confidence, fromEn.nameRu ? 'по английскому имени' : 'предложить нечем'),
    needsEditorialReview: true,
    warnings: fromEn.warnings,
  }
}

/**
 * СБОР МАЛОЙ ОЧЕРЕДИ.
 *
 * Вход — отчёты трёх этапов; каждый может отсутствовать (этап не запускался), и
 * это не повод молчать: строка попадает в артефакт от того этапа, который её
 * назвал.
 */
export function collectOwnerDecisions({ queues, enrichment = null, identification = null, createdAt, limit = MAX_DECISIONS }) {
  const enrichedByKey = new Map((enrichment?.rows ?? []).map((row) => [row.sourceKey, row]))
  const identifiedByKey = new Map((identification?.rows ?? []).map((row) => [row.sourceKey, row]))
  const items = []

  const factOf = (key, field) => enrichedByKey.get(key)?.facts?.find((fact) => fact.field === field)?.value ?? null
  /**
   * ФАКТЫ, РАЗЛОЖЕННЫЕ ПО МЕСТАМ.
   *
   * Когда официальная страница описала несколько мест, спрашивать человека
   * «какое из них наше» и показывать при этом ОДНО сборное значение поля —
   * то же смешивание, от которого избавлен разбор (JG2-03). Поэтому вопрос
   * несёт факты каждого места отдельно, ровно как их назвал источник.
   */
  const factsByPlace = (key) => {
    const row = enrichedByKey.get(key)
    const places = new Map()
    for (const fact of row?.facts ?? []) {
      const at = fact.place ?? 0
      if (!places.has(at)) places.set(at, { place: at, facts: {} })
      const slot = places.get(at).facts
      if (!(fact.field in slot)) slot[fact.field] = fact.value
    }
    return [...places.values()].sort((left, right) => left.place - right.place)
  }
  /**
   * `conflicted` — строка, у которой источник назвал НЕСКОЛЬКО мест. У неё
   * сводных `names.ja` и `geography` не бывает: выбрать между местами — это и
   * есть вопрос, который задаётся. Всё, что известно, лежит в `sourcePlaces`.
   */
  const push = (row, reason, question, extra, { conflicted = false } = {}) => {
    const nameJa = conflicted ? null : factOf(row.sourceKey, 'nameJa')
    const identified = identifiedByKey.get(row.sourceKey) ?? null
    items.push({
      sourceKey: row.sourceKey,
      reason,
      question,
      source: { portal: 'japan-guide', url: row.url ?? row.sourceUrl ?? null, categories: row.categories ?? [] },
      names: {
        en: row.nameEn ?? null,
        ja: nameJa,
        ru: proposeRussianName({ nameJa, nameKana: conflicted ? null : factOf(row.sourceKey, 'nameKana'), nameEn: row.nameEn }),
      },
      suggestedType: machine(row.classification?.poiPrimaryType ?? null, row.classification ? 'rule' : 'none'),
      geography: {
        address: conflicted ? null : factOf(row.sourceKey, 'address'),
        postalCode: conflicted ? null : factOf(row.sourceKey, 'postalCode'),
        lat: conflicted ? null : factOf(row.sourceKey, 'lat'),
        lon: conflicted ? null : factOf(row.sourceKey, 'lon'),
        placeId: identified?.place?.placeId ?? null,
      },
      /* Факты источника по местам: непусты у строк, где мест оказалось больше
         одного, и пусты у всех остальных. */
      sourcePlaces: conflicted ? factsByPlace(row.sourceKey) : [],
      /*
       * ВАРИАНТЫ ВЫБОРА — ВМЕСТЕ С ВОПРОСОМ.
       *
       * Аудит JG-2 (находка 06) предъявил вопрос «какое место верное», у
       * которого не было ни одного различимого варианта: идентификаторы
       * терялись, география пустовала, и в строке стояли два одинаковых имени.
       * Ответить на такой вопрос нельзя. Варианты идут сюда как есть — с
       * идентификатором, точкой, сроком её годности и административной
       * единицей; отображаемых имён Google в них нет по правилу хранения
       * (runbook § 3а), и различают варианты именно эти признаки.
       */
      placeAlternatives: identified?.alternatives ?? [],
      possibleDuplicates: row.nameMatches ?? [],
      answers: [...DECISION_ANSWERS],
      answer: null,
      ...extra,
    })
  }

  for (const row of queues.queues.review ?? []) {
    if (row.reason === 'ambiguousName') push(row, 'ambiguousName', `Имя «${row.nameEn}» указывает на несколько записей базы. Какая из них об этом объекте?`, { detail: row.detail })
    else if (row.reason === 'linkConflict') push(row, 'linkConflict', `Свидетельства о тождестве «${row.nameEn}» противоречат друг другу. Что считать верным?`, { detail: row.detail })
  }
  for (const row of identification?.rows ?? []) {
    if (row.outcome !== 'ambiguous') continue
    const options = (row.alternatives ?? []).length
    if (!options) {
      /* Вопрос без вариантов задавать нельзя: ответить на него нечем. Пусть
         прогон остановится и скажет, где потерялись варианты. */
      throw new Error(`${OWNER_DECISIONS_SPEC}: ${row.sourceKey}: неоднозначность без вариантов выбора — вопрос, на который нельзя ответить`)
    }
    push({ sourceKey: row.sourceKey, nameEn: row.nameEn, url: row.sourceUrl }, 'placeAmbiguous',
      `Опознание вернуло ${options} подходящих места для «${row.nameEn}». Какое из них верное? Варианты различаются идентификатором, точкой и префектурой — они в поле placeAlternatives.`,
      { detail: row.detail ?? null })
  }
  /*
   * ИСХОДЫ ОБОГАЩЕНИЯ ЧИТАЮТСЯ У ОБОГАЩЕНИЯ.
   *
   * `factsConflict` — исход JA-3, и в очереди `review` отчёта JG-1 его нет и
   * быть не может: JG-1 ничего не знает об официальных сайтах, а строка,
   * дошедшая до обогащения, была у него `candidate`. Прежняя редакция искала
   * этот исход в чужом обходе — ветка не срабатывала ни на одном настоящем
   * прогоне и держалась только на фикстуре, в которой исход был положен не
   * туда, где он бывает.
   */
  for (const row of enrichment?.rows ?? []) {
    if (row.outcome === 'factsConflict') {
      const places = (row.conflicts ?? []).length
      push({ sourceKey: row.sourceKey, nameEn: row.nameEn, url: row.sourceUrl }, 'linkConflict',
        `Официальная страница «${row.nameEn}» описывает несколько мест и расходится по полям ${(row.conflicts ?? []).join(', ') || '(поля не названы)'}. `
        + 'Какое из них наш объект? Факты каждого места — в поле sourcePlaces.',
        { detail: row.detail, placeAlternatives: [] }, { conflicted: true })
      if (!places) {
        throw new Error(`${OWNER_DECISIONS_SPEC}: ${row.sourceKey}: исход «factsConflict» без названных расхождений — спрашивать не о чем`)
      }
      continue
    }
    if (row.outcome !== 'policyDenied') continue
    push({ sourceKey: row.sourceKey, nameEn: row.nameEn, url: row.sourceUrl }, 'sourceForbidden',
      `Сайт ${row.domain} запретил чтение страницы «${row.nameEn}». Заводить объект без его данных?`, { detail: row.detail, placeAlternatives: [] })
  }

  const sorted = items.sort((a, b) => (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : (a.sourceKey < b.sourceKey ? -1 : 1)))
  const kept = sorted.slice(0, limit)
  const report = {
    spec: OWNER_DECISIONS_SPEC,
    createdAt,
    portal: 'japan-guide',
    note: 'Ответ на вопрос этого файла НЕ является разрешением на сеть, запись в базу или Git. '
      + 'Каждое такое разрешение остаётся отдельным. Всё, помеченное source: machine, предложено кодом и решением не является.',
    inputs: {
      queues: queues.reportDigest ?? null,
      enrichment: enrichment?.reportDigest ?? null,
      identification: identification?.reportDigest ?? null,
    },
    counts: {
      asked: kept.length,
      found: sorted.length,
      beyondLimit: Math.max(0, sorted.length - kept.length),
      limit,
      byReason: Object.fromEntries(DECISION_REASONS.map((reason) => [reason, sorted.filter((i) => i.reason === reason).length])),
    },
    grants: { network: false, write: false, git: false },
    items: kept,
  }
  for (const item of kept) {
    if (!DECISION_REASONS.includes(item.reason)) throw new Error(`${OWNER_DECISIONS_SPEC}: ${item.sourceKey}: повод вне закрытого списка`)
    if (item.answer !== null) throw new Error(`${OWNER_DECISIONS_SPEC}: ${item.sourceKey}: ответ уже проставлен — машинное решение выдаётся за решение владельца`)
    if (item.reason === 'placeAmbiguous' && !item.placeAlternatives.length) {
      throw new Error(`${OWNER_DECISIONS_SPEC}: ${item.sourceKey}: вопрос о выборе места без вариантов`)
    }
    /* У вопроса о нескольких местах на странице должны быть сами места, иначе
       выбирать снова не из чего. */
    if (item.sourcePlaces.length === 1) {
      throw new Error(`${OWNER_DECISIONS_SPEC}: ${item.sourceKey}: одно место в вопросе о нескольких — выбирать не из чего`)
    }
    /* Отображаемых имён Google в артефакте нет — то же правило хранения. */
    for (const option of item.placeAlternatives) {
      if ('matchedName' in option || 'displayName' in option) {
        throw new Error(`${OWNER_DECISIONS_SPEC}: ${item.sourceKey}: вариант несёт отображаемое имя Google (runbook § 3а)`)
      }
    }
  }
  return { ...report, reportDigest: sha256Bytes(canonicalJsonBytes({ ...report, createdAt: null }, OWNER_DECISIONS_SPEC)) }
}

export function summarizeOwnerDecisions(report) {
  const c = report.counts
  return [
    `РЕШЕНИЯ ВЛАДЕЛЬЦА JA-5 — вопросов ${c.asked} из найденных ${c.found}${c.beyondLimit ? ` (за потолком ${c.beyondLimit})` : ''}`,
    Object.entries(c.byReason).filter(([, n]) => n).map(([reason, n]) => `  ${reason}: ${n}`).join('\n') || '  вопросов нет',
    'ответ на вопрос не даёт полномочий: сеть, запись и Git разрешаются отдельно',
  ].filter(Boolean).join('\n')
}
