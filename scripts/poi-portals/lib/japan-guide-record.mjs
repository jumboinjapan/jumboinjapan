/**
 * JA-6в: ПОДГОТОВКА ЗАПИСИ ПРИЁМА из кандидата сухого прогона.
 *
 * Между «строка годна по качеству» и «Intake заведёт черновик» лежит граница,
 * которой до этого пакета не было. Оценка коллектора судит о КАРТОЧКЕ —
 * японское имя, координаты, регион, тип; об обязательных данных ЗАПИСИ —
 * русском имени и направлении — она не знает ничего и знать не должна. Пока
 * этой границы не было, строка без проверенного русского имени объявлялась
 * `writable`, и обещание «запись была бы создана» держалось только на том, что
 * до записи дело не доходило.
 *
 * ПРАВИЛА ЗДЕСЬ НЕ ЗАВОДЯТСЯ ЗАНОВО — ЭТО ГЛАВНОЕ.
 *
 *   • имя и направление берутся из ПРОВЕРЕННОГО ФАЙЛА ИМЁН владельца, того же,
 *     что у портального пути (`names-file.mjs`), — машинной транслитерации на
 *     этом пути нет вовсе;
 *   • направление сверяется с префектурой опознанного места ОБЩИМ правилом
 *     (`siteCityAgrees` в `poi-portal-place.ts`), а не своей редакцией;
 *   • обязательные проверки Intake — это `applyCanon`, ТА ЖЕ функция, которую
 *     зовёт `ingestPoi`; отказ собирается из её собственных сообщений;
 *   • происхождение точки судит `classifyCoordinatePolicy`, ТА ЖЕ функция, что
 *     и в приёме, и её код отказа едет в отчёт как есть.
 *
 * Поэтому граница не может разойтись с приёмом: разойтись было бы с чем, если
 * бы она повторяла его правила у себя, а она их зовёт.
 *
 * ОПИСАНИЯ ЗДЕСЬ НЕТ И НЕ ПОЯВИТСЯ. Решение владельца § V: новые POI заводятся
 * черновиками, тексты готовятся отдельно по фактам. `descriptionRu` и
 * `descriptionEn` в запрос не кладутся ни при каких входах — не «пусты по
 * стечению обстоятельств», а не существуют как поле запроса.
 */
import { applyCanon, canonicalCity, operatingStatusFromGoogle } from '../../../src/lib/poi-canon.ts'
import { classifyCoordinatePolicy } from '../../../src/lib/poi-coordinate-policy.ts'
import { siteCityAgrees, siteCityDirection } from '../../../src/lib/poi-portal-place.ts'
import { canonicalPrefecture } from '../../../src/lib/prefectures.ts'
import { taxonomyRecordFields } from '../../../src/lib/poi-taxonomy-airtable.ts'
import { legacyAirtableCategory } from './legacy-airtable-category-bridge.mjs'
import { isStrictCalendarDate } from '../../lib/canonical-contract.mjs'

export const JG_RECORD_SPEC = 'poi-japan-guide-record/v1'

/**
 * ЗАКРЫТЫЙ СПИСОК ОТКАЗОВ ПОДГОТОВКИ.
 *
 * Имена совпадают с уже существующими там, где событие то же самое:
 * `siteCityUnverifiable`, `cityConflict` и `missingPlaceId` — из закрытого
 * списка портальной границы места. Заводить для одного события второе имя
 * значит заводить второй словарь.
 */
export const RECORD_REFUSALS = Object.freeze([
  'taxonomyUnrepresentable',
  'canonBlocking',
  'siteCityUnverifiable',
  'cityConflict',
  'missingPlaceId',
  'coordinatesExpired',
  'coordinateProvenance',
])

const filled = (value) => typeof value === 'string' && value.trim().length > 0
const finite = (value) => typeof value === 'number' && Number.isFinite(value)

const refuse = (refusal, missing, message) => {
  if (!RECORD_REFUSALS.includes(refusal)) throw new Error(`${JG_RECORD_SPEC}: отказ «${refusal}» вне закрытого списка`)
  return { ok: false, refusal, missing: Object.freeze([...missing]), message }
}

/**
 * Готовит запрос приёма или отказывает ИМЕНОВАННО.
 *
 * `today` — календарный день прогона, параметром: часы здесь не читаются,
 * иначе один и тот же прогон на тех же байтах давал бы разные исходы.
 */
export function prepareIntakeRequest({ candidate, row, portal, identified = null, classification = null, today }) {
  if (!isStrictCalendarDate(today)) {
    throw new TypeError(`${JG_RECORD_SPEC}: нужен календарный день прогона, получено ${JSON.stringify(today)}`)
  }

  /*
   * ── 0. КЛАССИФИКАЦИЯ, РАЗРЕШИВШАЯ СОЗДАНИЕ, ЕДЕТ В ЗАПИСЬ ───────────────
   *
   * Это ТА ЖЕ классификация, по которой строка получила терминальный исход
   * `poi_eligible`: без типа и маршрута в POI этого исхода не бывает вовсе
   * (`terminalOutcome`). Выводить тип заново другим правилом здесь нечем и
   * незачем — вторая редакция разошлась бы с первой молча, и запись уехала бы
   * с типом, которого оценка не называла.
   *
   * Представимость проверяется ТОЙ ЖЕ функцией, которой writer собирает поля
   * (`taxonomyRecordFields`), и тем же preflight'ом, что у коллектора: отчёт,
   * собранный под прошлой версией реестра, останавливается ЗДЕСЬ — до приёма и
   * до любого эффекта, — а не половиной пакета внутри `ingestPoi`.
   */
  const taxonomy = {
    poiPrimaryType: classification?.poiPrimaryType,
    facets: classification?.facets ?? [],
    classificationSource: classification?.classificationSource,
    taxonomyVersion: classification?.taxonomyVersion,
  }
  const taxonomyVerdict = taxonomyRecordFields(taxonomy)
  if (!taxonomyVerdict.ok) {
    return refuse('taxonomyUnrepresentable', ['taxonomy'],
      `Классификация не представима в схеме POI: ${taxonomyVerdict.issues.join('; ')}`)
  }
  /* Старое поле категории — существующим мостом. Где перевода нет, поле
     остаётся пустым, а причина уезжает в открытые вопросы записи: истина о
     типе живёт в канонических полях таксономии, и подменять её приблизительным
     русским значением нельзя. */
  const legacyCategory = legacyAirtableCategory(taxonomy.poiPrimaryType)

  const place = identified?.place ?? null
  const siteCity = canonicalCity(candidate.siteCity)
  const externalKey = String(candidate.sourceKey ?? '').startsWith(`${portal.id}:`)
    ? String(candidate.sourceKey).slice(portal.id.length + 1)
    : String(candidate.sourceKey ?? '')

  /*
   * ЗАПРОС СОБИРАЕТСЯ ЦЕЛИКОМ И СРАЗУ — И ТОЛЬКО ПОТОМ СУДИТСЯ.
   *
   * Порядок такой намеренно: обязательные данные называет КАНОН ПРИЁМА, та же
   * `applyCanon`, которую первым шагом зовёт `ingestPoi`. Своего списка
   * обязательных полей здесь нет вовсе — иначе он разошёлся бы с приёмом ровно
   * тогда, когда приём заведёт новое правило, а граница о нём не узнает.
   *
   * ОПИСАНИЯ В ЗАПРОСЕ НЕТ КАК ПОЛЯ. Решение владельца § V: новые POI заводятся
   * черновиками, тексты готовятся отдельно по фактам. Это не «пусто по
   * стечению обстоятельств» — `descriptionRu` и `descriptionEn` сюда не
   * кладутся ни при каких входах.
   */
  const request = {
    source: {
      kind: 'portal-collector',
      id: portal.id,
      externalKey,
      url: candidate.sourceUrl ?? row?.url ?? undefined,
    },
    poi: {
      nameRu: candidate.nameRu ?? '',
      /* Имя выбирает человек в файле имён — машинной отметки здесь быть не
         может: транслитератора на этом пути нет вовсе. */
      machineNamed: false,
      nameEn: filled(candidate.nameEn) ? candidate.nameEn : undefined,
      sourceName: [candidate.nameJa, candidate.nameKana].filter(filled).join(' / ') || candidate.nameEn || undefined,
      siteCity,
      categoriesRu: legacyCategory.value ? [legacyCategory.value] : [],
      openQuestions: legacyCategory.value
        ? undefined
        : [`старое поле категории не выражает тип ${taxonomy.poiPrimaryType}: ${legacyCategory.reason}`],
      taxonomy,
      lat: candidate.lat,
      lon: candidate.lon,
      operatingStatus: place ? operatingStatusFromGoogle(place.businessStatus, null) : undefined,
      sources: [candidate.sourceUrl].filter(filled),
      resolved: {
        // Verified source name, not a retained Google display name.
        nameJa: filled(candidate.nameJa) ? candidate.nameJa.trim() : undefined,
        placeId: filled(place?.placeId) ? place.placeId.trim() : undefined,
        /* Пара, которую назвал резолвер: политика координат подтверждает
           происхождение сравнением с ней, а не доверием. */
        lat: place?.coordinates?.lat,
        lon: place?.coordinates?.lon,
        /* Календарный день наблюдения — ровно то, что записал отчёт опознания.
           Достраивать до времени суток значило бы придумать час, которого никто
           не наблюдал. */
        coordsCheckedAt: place?.coordinates?.observedOn,
      },
    },
  }

  /* ── 1. ОБЯЗАТЕЛЬНЫЕ ПРОВЕРКИ ПРИЁМА — ЕГО СОБСТВЕННОЙ ФУНКЦИЕЙ ────────
     Пустое русское имя и пустое направление называет здесь сам канон: своей
     редакции этих правил у границы нет. Отказ несёт ИМЕНА ПОЛЕЙ, а не только
     прозу, — по ним отчёт отбирает строки, которых владелец ещё не назвал. */
  const { issues } = applyCanon(request.poi)
  const blocking = issues.filter((issue) => issue.level === 'error')
  if (blocking.length) {
    const missing = [...new Set(blocking.map((issue) => issue.field))]
    const hint = missing.includes('nameRu') ? ' Файл проверенных имён эту строку не называет.' : ''
    return refuse('canonBlocking', missing,
      `Канон приёма назвал ошибки: ${blocking.map((issue) => issue.message).join('; ')}.${hint}`)
  }

  /* ── 2. НАПРАВЛЕНИЕ — ОБЩИМ ПРАВИЛОМ ──────────────────────────────────
     Канон о справочнике направлений знает только предупреждение; настоящее
     правило — в `poi-portal-place.ts`, и зовётся оно там же, где портальный
     путь. Двух редакций одного правила быть не должно. */
  const direction = siteCityDirection(siteCity)
  if (!direction.ok) return refuse(direction.refusal, ['siteCity'], direction.message)

  /* ── 3. ОПОЗНАННОЕ МЕСТО ──────────────────────────────────────────────── */
  if (!filled(place?.placeId)) {
    return refuse('missingPlaceId', ['placeId'],
      'Место не опознано: без Google Place ID происхождение точки подтвердить нечем')
  }
  const agreement = siteCityAgrees(siteCity, canonicalPrefecture(place.prefecture?.en ?? place.prefecture?.ja ?? place.prefecture ?? null))
  if (!agreement.ok) return refuse(agreement.refusal, ['siteCity'], agreement.message)
  request.poi.resolved.prefectureEn = agreement.expected.en
  request.poi.resolved.prefectureRu = agreement.expected.ru

  /* Срок годности координат объявлен самим отчётом опознания (JA-4).
     Просроченная точка — утверждение о прошлом, поданное как утверждение о
     настоящем. */
  const validUntil = place.coordinates?.validUntil ?? null
  if (!isStrictCalendarDate(validUntil)) {
    return refuse('coordinatesExpired', ['coordinates'],
      'У координат опознания нет объявленного срока годности — принимать их нечем')
  }
  if (validUntil < today) {
    return refuse('coordinatesExpired', ['coordinates'],
      `Координаты опознания годны до ${validUntil}, прогон идёт ${today}: точку нужно снять заново`)
  }

  /* ── 4. ПРОИСХОЖДЕНИЕ ТОЧКИ — ФУНКЦИЕЙ ПРИЁМА ─────────────────────────
     Записываемая пара обязана быть ТОЙ ЖЕ, что назвал резолвер. Сборщик
     кандидата инъектируем, и полагаться на его дисциплину здесь нельзя. */
  const policy = classifyCoordinatePolicy({
    lat: request.poi.lat,
    lon: request.poi.lon,
    resolved: request.poi.resolved,
    decision: null,
  })
  if (!policy.ok) {
    return refuse('coordinateProvenance', ['coordinates'],
      `Политика координат не выводится (${policy.refusal}): ${policy.message}`)
  }

  return { ok: true, request, policy: policy.policy }
}

/**
 * ПОСТУСЛОВИЕ ГРАНИЦЫ, проверяемое отдельно от неё.
 *
 * Подготовленный запрос обязан проходить обязательные проверки приёма — и это
 * утверждение проверяется ТОЙ ЖЕ функцией канона, а не пересказом. Зовётся
 * теми, кто подготовленные запросы принимает: canary не отдаёт приёму ничего,
 * что не прошло здесь.
 */
export function assertIntakeAdmissible(request, where = JG_RECORD_SPEC) {
  const { issues } = applyCanon(request.poi)
  const blocking = issues.filter((issue) => issue.level === 'error')
  if (blocking.length) {
    throw new Error(`${where}: подготовленный запрос не проходит канон приёма: ${blocking.map((i) => i.message).join('; ')}`)
  }
  if (!finite(request.poi.lat) || !finite(request.poi.lon)) {
    throw new Error(`${where}: подготовленный запрос без полной пары координат`)
  }
  const policy = classifyCoordinatePolicy({
    lat: request.poi.lat, lon: request.poi.lon, resolved: request.poi.resolved, decision: null,
  })
  if (!policy.ok) throw new Error(`${where}: подготовленный запрос без выводимой политики координат: ${policy.message}`)
  return policy.policy
}
