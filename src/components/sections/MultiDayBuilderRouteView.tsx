import { BedDouble, MapPin, Plane, StickyNote, TrainFront, Utensils } from 'lucide-react'
import { PageHero } from '@/components/sections/PageHero'
import { SectionHeading } from '@/components/sections/SectionHeading'
import type { MultiDayBuilderDayItem, MultiDayBuilderRoute } from '@/lib/multi-day-builder'

const DEFAULT_HERO_IMAGE = '/dest-multi-day-journeys-hero-20260421c.jpg'

const itemTypeIcon: Record<MultiDayBuilderDayItem['itemType'], typeof MapPin> = {
  poi: MapPin,
  transport: TrainFront,
  hotel: BedDouble,
  meal: Utensils,
  note: StickyNote,
  arrival: Plane,
  departure: Plane,
  day_block: StickyNote,
}

const dayTypeLabel: Record<MultiDayBuilderRoute['days'][number]['dayType'], string> = {
  arrival: 'Прилёт',
  touring: 'Экскурсионный день',
  departure: 'Отъезд',
  independent: 'Свободный день',
}

// Людям интересны города, которые они увидят, а не «ночёвки» (решение
// владельца): секция строится как последовательная цепочка остановок
// маршрута, ночи — вторичная подпись.
const CITY_RU: Record<string, string> = {
  tokyo: 'Токио',
  kyoto: 'Киото',
  osaka: 'Осака',
  hakone: 'Хаконэ',
  nara: 'Нара',
  kanazawa: 'Канадзава',
  hiroshima: 'Хиросима',
  sapporo: 'Саппоро',
  nikko: 'Никко',
  kamakura: 'Камакура',
}

function normalizeCity(raw: string): string {
  const trimmed = raw.trim()
  return CITY_RU[trimmed.toLowerCase()] ?? trimmed
}

function nightsLabel(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} ночь`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ночи`
  return `${n} ночей`
}

// Ночёвка есть каждый день, кроме дня отъезда. Пустое поле «Ночёвка» в
// середине маршрута означает «там же, где вчера» — иначе город недосчитывал
// ночи (Киото показывал «1 ночь» вместо трёх при незаполненных днях 5–6).
function resolveOvernights(route: MultiDayBuilderRoute): string[] {
  let last = ''
  return route.days.map((day) => {
    if (day.dayType === 'departure') return ''
    const raw = (day.overnightCity ?? '').trim()
    const city = raw && raw !== '—' ? normalizeCity(raw) : last
    last = city
    return city
  })
}

function getRouteStops(route: MultiDayBuilderRoute) {
  const stops: Array<{ city: string; nights: number }> = []
  for (const city of resolveOvernights(route)) {
    if (!city) continue
    const last = stops[stops.length - 1]
    if (last && last.city.toLowerCase() === city.toLowerCase()) last.nights += 1
    else stops.push({ city, nights: 1 })
  }
  return stops
}

// Служебные заглушки конструктора не должны протекать на публичную страницу
function isPlaceholderSummary(summary: string): boolean {
  return /^День \d+ готов к заполнению\.?$/.test(summary.trim()) || /— заполните программу\.?$/.test(summary.trim())
}

// ── Варианты переезда дня (ЖД/Авиа/Авто) ──
type RouteTransportSegment = MultiDayBuilderRoute['days'][number]['transportSegments'][number]

// КАНОН видов транспорта (владелец, 2026-07-11): Самостоятельно /
// Общественный транспорт / Частный транспорт / Заказной транспорт / ЖД /
// Авиа. «Автомобиль с гидом» и «гид с машиной» публично ЗАПРЕЩЕНЫ (юридика).
const TRANSPORT_MODE_RU: Record<string, string> = {
  shinkansen: 'ЖД',
  train: 'ЖД',
  flight: 'Авиа',
  car: 'Частный транспорт',
  bus: 'Общественный транспорт',
  walk: 'Пешком',
  mixed: 'Общественный транспорт',
}

// Формулировки выезда — по транспортной доктрине: гид — отдельная
// переменная (любой способ может быть с гидом или без), без гида выезд
// помечается как самостоятельный; заказной транспорт подаётся комплиментарно.
function departurePhrase(segment: RouteTransportSegment): string {
  const target = segment.mode === 'flight' ? 'в аэропорт' : segment.mode === 'car' ? 'из отеля' : 'на станцию'
  const guide = segment.departureWithGuide ? 'с гидом' : 'самостоятельно'
  // «Частный транспорт» — принятая публичная формулировка (кто за рулём,
  // не уточняем — юридика); «самостоятельно» к ней не добавляется.
  const how =
    segment.departureMode === 'public_transport'
      ? `выезд ${target} на общественном транспорте, ${guide}`
      : segment.departureMode === 'chartered'
        ? `выезд ${target} — заказной транспорт, ${guide}`
        : segment.departureMode === 'private'
          ? `выезд ${target} — частный транспорт${segment.departureWithGuide ? ', с гидом' : ''}`
          : segment.departureWithGuide
            ? `выезд ${target} вместе с гидом`
            : ''
  const time = segment.recommendedDepartureTime ? `рекомендуемый выезд из отеля — ${segment.recommendedDepartureTime}` : ''
  return [how, time].filter(Boolean).join('; ')
}

function isMeaningfulSegment(segment: RouteTransportSegment): boolean {
  return Boolean(
    segment.fromLocation ||
      segment.toLocation ||
      segment.serviceNumber ||
      segment.departureMode ||
      segment.departureWithGuide ||
      segment.recommendedDepartureTime ||
      segment.guestComments?.trim() ||
      // Вариант, добавленный в конструкторе, но ещё без деталей: у него
      // осмысленный ярлык, в отличие от пустой заготовки скелета
      (segment.displayLabel && segment.displayLabel !== 'Блок транспорта'),
  )
}

// Один вариант переезда (строка + ремарка выезда + комментарий гостям).
// Используется и в позиции якоря «Переезд» среди блоков дня, и в фолбэке
// внизу дня (для программ без якоря).
function TransferVariantRow({ segment }: { segment: RouteTransportSegment }) {
  const details = departurePhrase(segment)
  return (
    <div className="space-y-1">
      <p className="text-[14px] text-[var(--text)]">
        {/* Ярлык варианта — источник подписи (Такси и Автомобиль с гидом
            делят mode 'car'); фолбэк по mode — для старых сегментов. */}
        <span className="font-medium">
          {segment.displayLabel && segment.displayLabel !== 'Блок транспорта'
            ? segment.displayLabel
            : (TRANSPORT_MODE_RU[segment.mode] ?? segment.displayLabel)}
        </span>
        {segment.serviceNumber ? <span className="font-medium"> {segment.serviceNumber}</span> : null}
        {segment.fromLocation || segment.toLocation ? (
          <span className="text-[var(--text-muted)]">
            {' '}· {normalizeCity(segment.fromLocation)} → {normalizeCity(segment.toLocation)}
          </span>
        ) : null}
        {segment.durationMinutes ? (
          <span className="text-[var(--text-muted)]"> · ~{Math.round(segment.durationMinutes / 60)} ч</span>
        ) : null}
      </p>
      {details ? <p className="text-[13px] font-light text-[var(--text-muted)]">{details}</p> : null}
      {segment.guestComments?.trim() ? (
        <p className="text-[14px] font-light leading-[1.7] text-[var(--text-muted)]">{segment.guestComments.trim()}</p>
      ) : null}
    </div>
  )
}

export function MultiDayBuilderRouteView({
  route,
  heroImage,
  intro,
  poiDescriptions = {},
}: {
  route: MultiDayBuilderRoute
  heroImage?: string | null
  intro?: string | null
  /** POI ID → описание из первоисточника (Approved → raw); конструктор описания не хранит */
  poiDescriptions?: Record<string, string>
}) {
  const routeStops = getRouteStops(route)
  const dayOvernights = resolveOvernights(route)
  const title = route.previewTitle || route.title
  const subtitle = route.previewSubtitle || `${route.dayCount} дней · ${route.startCity} → ${route.endCity}`.trim()

  return (
    <>
      <PageHero image={heroImage || DEFAULT_HERO_IMAGE} eyebrow="Готовый маршрут" title={title} subtitle={subtitle} />

      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-12 md:px-6 md:py-16">
        <div className="mx-auto w-full max-w-6xl space-y-10 md:space-y-14">
          {intro ? (
            <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.85] text-[var(--text)] md:text-[16px]">
              {intro}
            </p>
          ) : null}

          {routeStops.length > 0 && (
            <section className="space-y-6 md:space-y-8">
              <SectionHeading eyebrow="Остановки маршрута" title="Города, которые вы увидите" />
              {/* Цепочка городов в порядке маршрута; ночи — вторичная подпись */}
              <div className="flex flex-wrap items-center gap-y-5">
                {routeStops.map((stop, index) => (
                  <div key={`${route.slug}-stop-${index}`} className="flex items-center">
                    {index > 0 && (
                      <span aria-hidden="true" className="mx-4 text-[18px] font-light text-[var(--accent)] md:mx-5">
                        →
                      </span>
                    )}
                    <div>
                      <p className="text-[19px] font-medium tracking-[-0.01em] text-[var(--text)] md:text-[22px]">{stop.city}</p>
                      <p className="mt-0.5 text-[13px] font-light text-[var(--text-muted)]">{nightsLabel(stop.nights)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-6 md:space-y-8">
            <SectionHeading eyebrow="Маршрут по дням" title="Как маршрут развивается день за днём" />
            <div className="space-y-4">
              {route.days.map((day, dayIndex) => (
                <article key={day.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 md:p-8">
                  {/* Двухколоночный день: слева рейка-навигация, справа программа
                      на всю ширину — раньше текст жался к левому краю, а справа
                      пустовал воздух */}
                  <div className="grid gap-6 md:grid-cols-[190px_minmax(0,1fr)] md:gap-10">
                    <div className="space-y-2.5 md:border-r md:border-[var(--border)] md:pr-6">
                      <p className="text-[13px] font-medium uppercase tracking-[0.1em] text-[var(--accent)]">
                        День {day.dayNumber}
                      </p>
                      <p className="text-[13px] text-[var(--text-muted)]">{dayTypeLabel[day.dayType]}</p>
                      {dayOvernights[dayIndex] ? (
                        <p className="text-[13px] text-[var(--text-muted)]">
                          Остановка: <span className="text-[var(--text)]">{dayOvernights[dayIndex]}</span>
                        </p>
                      ) : null}
                    </div>

                    <div className="min-w-0">
                      <h3 className="font-sans text-[22px] font-medium leading-[1.25] tracking-[-0.02em] text-[var(--text)] md:text-[24px]">
                        {day.dayTitle}
                      </h3>
                      {day.daySummary && !isPlaceholderSummary(day.daySummary) ? (
                        <p className="mt-2 font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">{day.daySummary}</p>
                      ) : null}

                      {day.items.length > 0 && (
                        <ul className="mt-6 space-y-5">
                          {day.items.map((item) => {
                            const Icon = itemTypeIcon[item.itemType]
                            // Блок «Переезд» (якорь) выводит варианты переезда
                            // прямо в своей позиции среди блоков дня — переезд
                            // не прибит к низу дня, владелец двигает его стрелками.
                            const transferSegments =
                              item.itemType === 'transport' ? day.transportSegments.filter(isMeaningfulSegment) : []
                            const isTransferAnchor =
                              transferSegments.length > 0 &&
                              day.items.find((candidate) => candidate.itemType === 'transport')?.id === item.id
                            if (isTransferAnchor) {
                              return (
                                <li key={item.id} className="flex items-start gap-3.5">
                                  <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--accent)]">
                                    <Icon aria-hidden="true" className="h-4 w-4" />
                                  </span>
                                  <div className="min-w-0 flex-1 space-y-3">
                                    {transferSegments.length > 1 ? (
                                      <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-[var(--accent)]">
                                        Варианты переезда — на выбор
                                      </p>
                                    ) : null}
                                    {/* Общая заметка к переезду (тело блока в конструкторе) */}
                                    {item.shortDescription?.trim() ? (
                                      <p className="text-[14px] font-light leading-[1.7] text-[var(--text-muted)]">
                                        {item.shortDescription.trim()}
                                      </p>
                                    ) : null}
                                    {transferSegments.map((segment) => (
                                      <TransferVariantRow key={segment.id} segment={segment} />
                                    ))}
                                  </div>
                                </li>
                              )
                            }
                            // Наследование описания: POI ID → таблица POI;
                            // блок из макета без POI → Route Stop исходного
                            // маршрута (ключ «STOP:<Route Stop ID>»).
                            const poiId = item.internalNotes?.match(/POI-\d{6}/)?.[0]
                            const stopId = item.internalNotes?.match(/^STOP ID:\s*(.+?)\s*$/m)?.[1]
                            const poiDescription = (poiId && poiDescriptions[poiId]) || (stopId && poiDescriptions[`STOP:${stopId}`]) || ''
                            return (
                              <li key={item.id} className="flex items-start gap-3.5">
                                <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--accent)]">
                                  <Icon aria-hidden="true" className="h-4 w-4" />
                                </span>
                                <div className="min-w-0">
                                  <span className="text-[16px] font-medium leading-[1.5] tracking-[-0.01em] text-[var(--text)] md:text-[17px]">
                                    {item.displayTitle}
                                    {item.shortDescription ? (
                                      <span className="font-light text-[var(--text-muted)]"> — {item.shortDescription}</span>
                                    ) : null}
                                  </span>
                                  {poiDescription ? (
                                    <p className="mt-1.5 text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
                                      {poiDescription}
                                    </p>
                                  ) : null}
                                </div>
                              </li>
                            )
                          })}
                        </ul>
                      )}

                      {/* Фолбэк для программ без якоря «Переезд» в списке
                          блоков (старые сохранения): варианты внизу дня.
                          С якорем переезд рендерится в его позиции выше. */}
                      {day.transportSegments.some(isMeaningfulSegment) &&
                        !day.items.some((item) => item.itemType === 'transport') && (
                        <div className="mt-6 space-y-3 border-t border-[var(--border)] pt-4">
                          {day.transportSegments.filter(isMeaningfulSegment).length > 1 && (
                            <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-[var(--accent)]">
                              Варианты переезда — на выбор
                            </p>
                          )}
                          {day.transportSegments.filter(isMeaningfulSegment).map((segment) => (
                            <TransferVariantRow key={segment.id} segment={segment} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-6 py-8 space-y-4">
            <h2 className="font-sans text-xl font-medium tracking-[-0.01em]">Обсудить этот маршрут</h2>
            <p className="max-w-2xl text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
              Логику маршрута можно адаптировать под ваши даты, состав группы, темп поездки и интересы.
            </p>
            <a
              href="/contact"
              className="inline-flex min-h-[44px] items-center rounded-sm border border-[var(--accent)] px-5 py-2.5 text-[14px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
            >
              Обсудить поездку
            </a>
          </section>
        </div>
      </section>
    </>
  )
}
