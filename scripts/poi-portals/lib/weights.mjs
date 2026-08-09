/**
 * Модель весов источников: авторитет × свежесть, с поправкой на класс поля.
 *
 * ЗАЧЕМ ПОПРАВКА НА КЛАСС ПОЛЯ. Требование «свежее доминирует над старым»
 * верно не для всех фактов. Координаты храма Тодайдзи и его история не
 * меняются — там должен побеждать авторитетный источник, даже если его
 * страница не трогалась три года. А часы работы, цена билета и «закрыто
 * на реставрацию» устаревают за месяцы — там свежая запись частного блога
 * полезнее старой страницы национальной турорганизации.
 *
 * Поэтому вес считается не один на источник, а отдельно для двух классов:
 *
 *   STABLE   имя, координаты, категория, историческая справка, район
 *            → доминирует АВТОРИТЕТ
 *   VOLATILE часы, цена, статус работы, доступ и транспорт, сезонность
 *            → доминирует СВЕЖЕСТЬ
 *
 * Формула:  w = authority^aExp × freshness^fExp
 *
 * Проверка на крайних случаях (см. тест внизу файла):
 *   волатильное поле, свежий блог (0,40/1,00) против старого официального
 *   портала (1,00/0,15):  0,632 против 0,058 — блог выигрывает в 11 раз.
 *   стабильное поле, те же двое:  0,400 против 0,570 — выигрывает
 *   официальный портал. Ровно то поведение, которое нужно.
 */

/** @typedef {'stable'|'volatile'} FieldClass */

export const FIELD_CLASS = {
  // Меняются раз в никогда.
  nameJa: 'stable',
  nameEn: 'stable',
  nameRu: 'stable',
  lat: 'stable',
  lon: 'stable',
  address: 'stable',
  category: 'stable',
  history: 'stable',
  descriptionFacts: 'stable',
  // Меняются каждый сезон, а то и чаще.
  workingHours: 'volatile',
  priceLabel: 'volatile',
  closedStatus: 'volatile',
  access: 'volatile',
  seasonality: 'volatile',
  website: 'volatile',
  phone: 'volatile',
}

const EXPONENTS = {
  stable: { authority: 1.0, freshness: 0.3 },
  volatile: { authority: 0.5, freshness: 1.5 },
}

/**
 * Авторитет источника — редакторское суждение о том, насколько ему можно
 * верить в фактах. Ставится руками, в реестре, и не вычисляется машиной:
 * это ответственность владельца, а не алгоритма.
 *
 * Шкала:
 *   1.00  первоисточник — официальный сайт самого объекта
 *   0.90  национальная / префектурная турорганизация (DMO)
 *   0.85  энциклопедический справочник с редакцией
 *   0.60  коммерческий туроператор, витрина продукта
 *   0.50  UGC-платформа, пользовательские отчёты
 *   0.40  частный блог одного автора
 */
export const AUTHORITY_SCALE = {
  primary: 1.0,
  dmo: 0.9,
  reference: 0.85,
  operator: 0.6,
  ugc: 0.5,
  blog: 0.4,
}

/**
 * Множитель свежести по возрасту факта в днях.
 * Разрывы намеренно крупные: цель — чтобы протухшее не спорило со свежим.
 */
export function freshnessMultiplier(ageDays) {
  if (ageDays === null || ageDays === undefined || !Number.isFinite(ageDays)) return 0.15
  if (ageDays <= 90) return 1.0
  if (ageDays <= 365) return 0.7
  if (ageDays <= 730) return 0.4
  return 0.15
}

/**
 * Итоговый вес источника для конкретного поля.
 *
 * @param authority   0..1, из AUTHORITY_SCALE
 * @param ageDays     возраст факта в днях; null = свежесть неизвестна
 * @param fieldClass  'stable' | 'volatile'
 */
export function sourceWeight({ authority, ageDays, fieldClass = 'stable' }) {
  const exp = EXPONENTS[fieldClass] ?? EXPONENTS.stable
  const f = freshnessMultiplier(ageDays)
  return Number((authority ** exp.authority * f ** exp.freshness).toFixed(4))
}

/**
 * Разрешение конфликта, когда несколько источников дают разные значения
 * одного поля. Возвращает победителя и полную раскладку — раскладка важнее
 * победителя: по ней видно, ПОЧЕМУ выбрано это значение.
 *
 * @param field    имя поля, определяет класс
 * @param claims   [{ sourceId, authority, ageDays, value }]
 */
export function resolveFieldConflict(field, claims) {
  const fieldClass = FIELD_CLASS[field] ?? 'stable'
  const scored = claims
    .filter((c) => c.value !== null && c.value !== undefined && String(c.value).trim() !== '')
    .map((c) => ({
      ...c,
      fieldClass,
      weight: sourceWeight({ authority: c.authority, ageDays: c.ageDays, fieldClass }),
    }))
    .sort((a, b) => b.weight - a.weight)

  if (!scored.length) return { field, fieldClass, winner: null, claims: [], agreement: null }

  // Согласие источников: доля веса, приходящаяся на значение-победитель.
  // Низкое согласие по волатильному полю — прямой повод отправить человеку.
  const winner = scored[0]
  const normalize = (v) => String(v).replace(/\s+/g, ' ').trim().toLowerCase()
  const totalWeight = scored.reduce((s, c) => s + c.weight, 0)
  const agreeingWeight = scored
    .filter((c) => normalize(c.value) === normalize(winner.value))
    .reduce((s, c) => s + c.weight, 0)

  const distinctValues = new Set(scored.map((c) => normalize(c.value))).size
  const agreement = Number((agreeingWeight / totalWeight).toFixed(3))

  // Взвешенное согласие и факт расхождения — РАЗНЫЕ вещи, и их нельзя
  // смешивать. Пример из прогона: свежий блог (вес 0,63) против трёхлетней
  // страницы JNTO (вес 0,055) по часам работы. Взвешенное согласие выходит
  // 0,92 — просто потому, что у возражающего почти нет веса. Но источники
  // при этом прямо противоречат друг другу, и цена ошибки здесь — клиент
  // у закрытых ворот.
  //
  // Поэтому по волатильным полям человек вызывается на ЛЮБОЕ расхождение,
  // а не только на низкое взвешенное согласие. Модель при этом всё равно
  // считает победителя: человек подтверждает готовый ответ, а не ищет с нуля.
  const conflict = distinctValues > 1

  return {
    field,
    fieldClass,
    winner: { sourceId: winner.sourceId, value: winner.value, weight: winner.weight },
    agreement,
    distinctValues,
    conflict,
    needsHuman: fieldClass === 'volatile' && (conflict || agreement < 0.75),
    claims: scored.map((c) => ({
      sourceId: c.sourceId,
      value: c.value,
      weight: c.weight,
      ageDays: c.ageDays,
    })),
  }
}

/** Самопроверка модели на граничных случаях. Запуск: node lib/weights.mjs */
export function selfTest() {
  const freshBlog = { authority: AUTHORITY_SCALE.blog, ageDays: 10 }
  const staleDmo = { authority: AUTHORITY_SCALE.dmo, ageDays: 1200 }
  const rows = [
    ['волатильное: свежий блог', sourceWeight({ ...freshBlog, fieldClass: 'volatile' })],
    ['волатильное: старый DMO', sourceWeight({ ...staleDmo, fieldClass: 'volatile' })],
    ['стабильное: свежий блог', sourceWeight({ ...freshBlog, fieldClass: 'stable' })],
    ['стабильное: старый DMO', sourceWeight({ ...staleDmo, fieldClass: 'stable' })],
  ]
  const volatileOk = rows[0][1] > rows[1][1]
  const stableOk = rows[3][1] > rows[2][1]
  return { rows, volatileOk, stableOk, pass: volatileOk && stableOk }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t = selfTest()
  for (const [label, w] of t.rows) console.log(`  ${label.padEnd(30)} ${w}`)
  console.log(`\n  волатильное — свежее побеждает: ${t.volatileOk ? 'ДА' : 'НЕТ'}`)
  console.log(`  стабильное — авторитет побеждает: ${t.stableOk ? 'ДА' : 'НЕТ'}`)
  process.exitCode = t.pass ? 0 : 1
}
