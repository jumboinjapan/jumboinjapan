import type { AirtableRouteStop } from '@/lib/airtable'
import photoFallback from '@/data/route-stop-photos.generated.json'
import {
  mergeCityTourStops,
  selectPhotoFallback,
  type CityTourStopLike,
  type PhotoFallbackFile,
} from './city-tour-stop-merge'

export type { CityTourStopLike } from './city-tour-stop-merge'

/**
 * Мост между админкой (Route Stops) и городскими днями.
 *
 * Тексты остановок city-tour живут в коде страниц; ФОТО остановок — только
 * в Airtable (Route Stops.«Photo Path»/«Photo Alt») — это единственный
 * источник правды пути к фото (канон 2026-07-24, docs/photo-storage.md).
 * Кодовых photo:/alt: в stops[] больше нет — раньше они дублировали Airtable
 * и молча дрейфовали (инциденты «Мэйдзи/Сибаматы», «Сибуя 2026-07-24»).
 *
 * Fallback при недоступности Airtable — сгенерированный снапшот
 * src/data/route-stop-photos.generated.json (npm run sync:photo-fallback);
 * он не редактируется руками и источником правды не является.
 *
 * Override текстов из админки — по той же приоритетной схеме, что
 * buildIntercityRouteStopsFromAirtable (админка выигрывает, код — fallback);
 * заодно сортировка по полю «№».
 *
 * Сопоставление записи с кодовой остановкой — по POI Name Snapshot или
 * Stop Title Override (записи Route Stops сеялись с живых страниц, поэтому
 * snapshot совпадает с кодовым title).
 */
export function applyCityTourStopOverrides<T extends CityTourStopLike>(
  baseStops: T[],
  airtableStops: AirtableRouteStop[],
  routeSlug?: string,
): T[] {
  const fallbackForSlug = selectPhotoFallback(photoFallback as PhotoFallbackFile, routeSlug)
  return mergeCityTourStops(baseStops, airtableStops, fallbackForSlug)
}
