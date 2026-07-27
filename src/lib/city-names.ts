/**
 * Латинские названия японских городов → канон сайта на кириллице.
 *
 * Нужно потому, что города в записях конструктора (Airtable) заводятся
 * то как «Tokyo», то как «Токио», и на хабе /multi-day это выходило
 * соседними карточками с «Старт: Tokyo» и «Старт: Токио» (аудит 2026-07-27).
 *
 * Транслитерация — по канону CLAUDE.md: система Поливанова, кроме
 * устоявшихся поисковых написаний («Хаконе», не «Хаконэ»). Новые
 * исключения добавлять и сюда, и в RESEARCH_SYSTEM_PROMPT POI-бота.
 *
 * Неизвестные значения возвращаются как есть — словарь нормализует
 * известное, а не прячет незаполненные данные.
 */
const CITY_NAMES_RU: Record<string, string> = {
  tokyo: 'Токио',
  osaka: 'Осака',
  kyoto: 'Киото',
  nara: 'Нара',
  hakone: 'Хаконе',
  nikko: 'Никко',
  kanazawa: 'Канадзава',
  kamakura: 'Камакура',
  himeji: 'Химэдзи',
  enoshima: 'Эносима',
  uji: 'Удзи',
  yokohama: 'Иокогама',
  nagoya: 'Нагоя',
  hiroshima: 'Хиросима',
  sapporo: 'Саппоро',
  fukuoka: 'Фукуока',
  takayama: 'Такаяма',
  matsumoto: 'Мацумото',
  sendai: 'Сендай',
  narita: 'Нарита',
  haneda: 'Ханэда',
  fuji: 'Фудзи',
}

/** «Tokyo» → «Токио»; неизвестное и уже кириллическое — без изменений. */
export function cityNameRu(value: string | null | undefined): string {
  if (!value) return ''
  const trimmed = value.trim()
  return CITY_NAMES_RU[trimmed.toLowerCase()] ?? trimmed
}
