/**
 * Русское склонение существительного при числительном.
 *
 * Появилось из аудита 2026-07-27: карточки маршрутов из конструктора
 * печатали `${dayCount} дней` без склонения, поэтому двухдневная
 * программа подписывалась как «2 дней».
 *
 * @example pluralRu(1, 'день', 'дня', 'дней') // 'день'
 * @example pluralRu(2, 'день', 'дня', 'дней') // 'дня'
 * @example pluralRu(11, 'день', 'дня', 'дней') // 'дней'
 */
export function pluralRu(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(Math.trunc(count))
  const lastTwo = n % 100
  // 11–14 всегда идут по форме «дней», несмотря на последнюю цифру
  if (lastTwo >= 11 && lastTwo <= 14) return many
  const last = n % 10
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}

/** Готовая подпись длительности: `pluralDays(2)` → «2 дня». */
export function pluralDays(count: number): string {
  return `${count} ${pluralRu(count, 'день', 'дня', 'дней')}`
}
