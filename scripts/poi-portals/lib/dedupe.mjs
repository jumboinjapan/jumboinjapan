/**
 * Дедупликация кандидатов POI для пакетного сбора.
 *
 * Сравнение НАЗВАНИЙ живёт в src/lib/poi-matching.ts и импортируется отсюда:
 * агент приёма из Telegram, пакетный коллектор и админка обязаны сравнивать
 * имена одинаково. Собственной реализации сравнения в этом файле нет и быть
 * не должно — раньше их было две, и они расходились в поведении.
 *
 * Здесь остаётся только то, чего нет в приложении:
 *   — дедупликация внутри одной партии (кандидат против кандидата, до
 *     всякого обращения к базе).
 *
 * Расстояние тоже переехало в приложение (06.08.2026, вместе с полями
 * Latitude/Longitude в таблице POI). Свой haversineMeters здесь жил ровно
 * потому, что «в базе координат пока нет» — теперь есть, и вторая копия
 * формулы стала бы тем же расхождением, от которого предостерегает
 * абзац выше про сравнение имён.
 */

export {
  normalizeName,
  splitName,
  nameCore,
  nameSimilarity,
  containmentRelation,
  romajiSkeleton,
  skeletonMatch,
  cyrillicToRomaji,
  haversineMeters,
  screenNewPoi,
  matchPoi,
  DUPLICATE_BLOCK,
  DUPLICATE_REVIEW,
  GEO_SAME_PLACE_M,
  GEO_NEIGHBOUR_M,
} from '../../../src/lib/poi-matching.ts'

import { haversineMeters, nameSimilarity, screenNewPoi } from '../../../src/lib/poi-matching.ts'

const COORD_SAME_M = 120
const COORD_NEAR_M = 400
const NAME_STRONG = 0.82
const NAME_WEAK = 0.6

/**
 * Сопоставление кандидата с существующими записями с учётом координат.
 * Координаты — самый надёжный ключ для географических объектов, и когда
 * они появятся в схеме POI, именно эта ветка станет основной.
 */
export function matchAgainstExisting(candidate, existing) {
  const matches = []

  for (const record of existing) {
    if (candidate.sourceKey && record.sourceKey && candidate.sourceKey === record.sourceKey) {
      matches.push({ record, confidence: 1, reasons: ['source_key'] })
      continue
    }

    const nameScore = Math.max(
      nameSimilarity(candidate.nameJa, record.nameJa),
      nameSimilarity(candidate.nameEn, record.nameEn),
      nameSimilarity(candidate.nameEn, record.nameRu),
      nameSimilarity(candidate.nameJa, record.nameRu),
    )

    // Общий haversineMeters сам возвращает null, если координат нет хотя бы
    // у одной из точек, — проверять Number.isFinite здесь больше не нужно.
    const distance = haversineMeters(candidate, record)

    let confidence = 0
    const reasons = []

    if (distance !== null && distance <= COORD_SAME_M && nameScore >= NAME_WEAK) {
      confidence = 0.95
      reasons.push(`coords_${Math.round(distance)}m`, `name_${nameScore.toFixed(2)}`)
    } else if (distance !== null && distance <= COORD_SAME_M) {
      // Рядом, но названия разные — чаще всего павильон внутри комплекса.
      // Это кандидат в Parent POI, а не дубль.
      confidence = 0.5
      reasons.push(`coords_${Math.round(distance)}m`, 'name_differs')
    } else if (nameScore >= NAME_STRONG && (distance === null || distance <= COORD_NEAR_M)) {
      confidence = 0.85
      reasons.push(`name_${nameScore.toFixed(2)}`)
    } else if (nameScore >= NAME_STRONG) {
      // Одинаковое имя далеко друг от друга — тёзки. Инари-дзиндзя тысячи.
      confidence = 0.35
      reasons.push(`name_${nameScore.toFixed(2)}`, 'far_apart')
    }

    if (confidence > 0) matches.push({ record, confidence, reasons })
  }

  matches.sort((a, b) => b.confidence - a.confidence)
  const top = matches[0]
  const verdict = !top ? 'new' : top.confidence >= 0.9 ? 'same' : top.confidence >= 0.5 ? 'likely' : 'new'
  return { verdict, matches: matches.slice(0, 5) }
}

/**
 * Дедупликация внутри партии. Источники дублируют сами себя, и без этого
 * шага повтор внутри одной выгрузки попадает в базу двумя записями.
 * Проверка идёт против УЖЕ ОТОБРАННЫХ, а не против исходного списка.
 */
export function dedupeWithinBatch(candidates) {
  const kept = []
  const collisions = []
  for (const candidate of candidates) {
    const { verdict, matches } = matchAgainstExisting(candidate, kept)
    if (verdict === 'same') {
      collisions.push({ candidate, against: matches[0].record, reasons: matches[0].reasons })
    } else {
      kept.push(candidate)
    }
  }
  return { kept, collisions }
}

/**
 * Гейт для пакетного пути — тот же, что у агента приёма.
 * Возвращает решение по кандидату относительно текущей базы.
 */
export function screenBatchCandidate(candidate, existingPoiLike) {
  return screenNewPoi(
    {
      nameRu: candidate.nameRu ?? '',
      nameEn: candidate.nameEn || candidate.nameJa || '',
      siteCity: candidate.siteCity ?? candidate.cityJa ?? '',
      // Координаты внешних источников доходят до гейта. Это главное, что
      // даёт коллектору преимущество над Telegram-путём: у него имена
      // латиницей и по-японски, где строковое сравнение слабее всего,
      // зато есть точка — признак, не зависящий от языка.
      lat: Number.isFinite(candidate.lat) ? candidate.lat : null,
      lon: Number.isFinite(candidate.lon) ? candidate.lon : null,
    },
    existingPoiLike,
  )
}
