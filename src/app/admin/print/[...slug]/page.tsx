import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import {
  buildPrintProgram,
  isOwnerActionNote,
  type DayTourPrintProgram,
  type MultiDayPrintProgram,
  type PrintStop,
} from '@/lib/print-program'
import { PrintToolbar } from '@/components/admin/PrintToolbar'

// Admin surface: always fresh, never prerendered at build.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Программа тура — печать',
  robots: { index: false, follow: false },
}

const DAY_TYPE_LABELS: Record<string, string> = {
  arrival: 'Прилёт',
  touring: 'Экскурсионный день',
  departure: 'Отъезд',
  independent: 'Самостоятельный день',
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Дата дня в шапке: «18 июля, суббота» — в UTC, как и вся датовая логика тура. */
function formatDayDate(date: Date): string {
  const formatted = date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
    timeZone: 'UTC',
  })
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

/**
 * Примечания владельца («Требует предварительной организации», «по желанию
 * гостей», «Уточнить: …») — акцентом и жирнее, чтобы не терялись в тексте
 * (задание владельца 2026-07-15). Тот же приём — в PDF (isOwnerActionNote).
 */
const ownerNoteStyle: React.CSSProperties = { color: '#8C3722', fontWeight: 700, fontSize: '1.05em' }

function Narrative({ label, text, accent = false }: { label?: string; text: string; accent?: boolean }) {
  if (!text.trim()) return null
  return (
    <div className={accent ? 'print-narrative print-narrative-accent' : 'print-narrative'}>
      {label && <p className="print-label">{label}</p>}
      <p className="print-body">{text}</p>
    </div>
  )
}

function StopBlock({ stop, isLast }: { stop: PrintStop; isLast: boolean }) {
  return (
    <>
      <section className="print-stop">
        <header className="print-stop-header">
          <span className="print-stop-number">{String(stop.order).padStart(2, '0')}</span>
          <div>
            {stop.eyebrow && <p className="print-eyebrow">{stop.eyebrow}</p>}
            <h3 className="print-stop-title">{stop.title}</h3>
          </div>
        </header>
        {stop.description && <p className="print-body">{stop.description}</p>}
        <Narrative label="Зачем эта точка в маршруте" text={stop.whyThisStopMatters} accent />
        <Narrative text={stop.narrativeNote} />
        {stop.sellingHighlights.length > 0 && (
          <div className="print-highlights">
            <p className="print-label">Рядом и внутри</p>
            {stop.sellingHighlights.map((h, i) => (
              <p key={i} className="print-body">
                <strong>{h.title}.</strong> {h.body}
              </p>
            ))}
          </div>
        )}
        {stop.workingHours && <p className="print-meta">Часы работы: {stop.workingHours}</p>}
      </section>
      {!isLast && (stop.transitionToNext || stop.travelNoteToNext) && (
        <div className="print-transition">
          {stop.transitionToNext && <p className="print-body">{stop.transitionToNext}</p>}
          {stop.travelNoteToNext && <p className="print-meta">{stop.travelNoteToNext}</p>}
        </div>
      )}
    </>
  )
}

function DayTourDocument({ program }: { program: DayTourPrintProgram }) {
  return (
    <>
      {program.intro && <p className="print-intro">{program.intro}</p>}
      {(program.tourStartTime || program.tourEndTime) && (
        <p className="print-meta">
          Время тура: {program.tourStartTime}{program.tourEndTime ? ` — ${program.tourEndTime}` : ''}
        </p>
      )}
      <div className="print-stops">
        {program.stops.map((stop, index) => (
          <StopBlock key={stop.order} stop={stop} isLast={index === program.stops.length - 1} />
        ))}
      </div>
    </>
  )
}

/**
 * Служебные типы элементов дня (прилёт, транспорт, отель, питание, свободное
 * время) не равны достопримечательностям: в печатной программе они — тонкая
 * служебная строка, а не полноценная остановка. Иначе документ превращается в
 * стену одинаковых заголовков, где «Частный транспорт» весит столько же,
 * сколько храм Сэнсо-дзи.
 */
const SERVICE_ITEM_TYPES = new Set(['transport', 'hotel', 'meal', 'arrival', 'departure', 'day_block'])

function isServiceItem(item: { itemType: string; displayTitle: string }) {
  if (SERVICE_ITEM_TYPES.has(item.itemType)) return true
  // Служебные блоки конструктора сохраняются в Airtable как 'note' —
  // распознаём их по каноническим названиям (см. таблицу Day Blocks).
  const serviceTitles = [
    'частный транспорт',
    'общественный транспорт',
    'заказной транспорт',
    'самостоятельный трансфер',
    'лимузин сервис',
    'свободное время',
    'прилёт',
    'выезд',
  ]
  return serviceTitles.includes(item.displayTitle.trim().toLowerCase())
}

function MultiDayDocument({ program }: { program: MultiDayPrintProgram }) {
  const { route } = program
  const segmentById = new Map(
    route.days.flatMap((day) => day.transportSegments.map((segment) => [segment.id, segment] as const)),
  )
  const startDate = route.startDate ? new Date(route.startDate) : null

  return (
    <>
      {program.intro && <p className="print-intro">{program.intro}</p>}
      <p className="print-route-meta">
        {route.dayCount} дней · {route.startCity} → {route.endCity}
      </p>
      {route.days.map((day) => {
        // Нумеруются только настоящие остановки — служебные строки не сбивают счёт.
        let stopNumber = 0
        const dayDate = startDate ? new Date(startDate.getTime() + (day.dayNumber - 1) * 86400000) : null

        return (
          <section key={day.id} className="print-day">
            <header className="print-day-header">
              <div className="print-day-rule">
                <span className="print-day-number">День {day.dayNumber}</span>
                <span className="print-day-line" />
                <span className="print-day-type">
                  {dayDate ? `${formatDayDate(dayDate)} · ` : ''}
                  {DAY_TYPE_LABELS[day.dayType] ?? day.dayType}
                </span>
              </div>
              <h2 className="print-day-title">{day.dayTitle || `День ${day.dayNumber}`}</h2>
              {/* «Гостиница», не «ночёвка» — решение владельца 2026-07-15 (просторечие в клиентской выдаче). */}
              {day.overnightCity && <p className="print-day-overnight">Гостиница: {day.overnightCity}</p>}
            </header>

            {day.printLead && (
              <p className="print-day-lead" style={isOwnerActionNote(day.printLead) ? ownerNoteStyle : undefined}>
                {day.printLead}
              </p>
            )}
            {day.daySummary && !day.printLead && (
              <p className="print-day-lead" style={isOwnerActionNote(day.daySummary) ? ownerNoteStyle : undefined}>
                {day.daySummary}
              </p>
            )}

            <div className="print-day-items">
              {day.items.map((item) => {
                const title = item.displayTitle || item.poiTitle

                if (isServiceItem({ itemType: item.itemType, displayTitle: title })) {
                  const segment = item.transportSegmentId ? segmentById.get(item.transportSegmentId) : undefined
                  const label = segment?.displayLabel || title
                  if (!label) return null
                  return (
                    <div key={item.id} className="print-service">
                      <p className="print-service-label">{label}</p>
                      {item.shortDescription && (
                        <p className="print-service-body" style={isOwnerActionNote(item.shortDescription) ? ownerNoteStyle : undefined}>
                          {item.shortDescription}
                        </p>
                      )}
                      {segment?.reservationNote && <p className="print-service-body">{segment.reservationNote}</p>}
                      {segment?.baggageNote && <p className="print-service-body">{segment.baggageNote}</p>}
                    </div>
                  )
                }

                stopNumber += 1
                const details = program.poiDetailsByItemId[item.id]
                const note = item.shortDescription.trim()
                const description = (details?.description ?? '').trim()
                // Подпись из конструктора и описание POI иногда совпадают —
                // печатать одно и то же дважды незачем.
                const noteIsRedundant = Boolean(note && description && description.startsWith(note.slice(0, 40)))

                return (
                  <article key={item.id} className="print-stop">
                    <header className="print-stop-header">
                      <span className="print-stop-number">{String(stopNumber).padStart(2, '0')}</span>
                      <h3 className="print-stop-title">{title}</h3>
                    </header>
                    {note && !noteIsRedundant && (
                      <p className="print-stop-note" style={isOwnerActionNote(note) ? ownerNoteStyle : undefined}>
                        {note}
                      </p>
                    )}
                    {description && <p className="print-body">{description}</p>}
                    {details?.workingHours && <p className="print-stop-hours">Часы работы: {details.workingHours}</p>}
                  </article>
                )
              })}
            </div>

            {day.printFooterNote && <p className="print-day-footer">{day.printFooterNote}</p>}
          </section>
        )
      })}

      {/* Смета из блока «Расчёт тура»: в превью показывается всегда, чтобы
          владелец видел расчёт; в PDF попадает только при включённом флажке. */}
      {program.pricing && (
        <section className="print-day">
          <header className="print-day-header">
            <div className="print-day-rule">
              <span className="print-day-number">Стоимость программы</span>
              <span className="print-day-line" />
              <span className="print-day-type">
                {program.pricing.printInPdf ? 'печатается в PDF' : 'в PDF не печатается (флажок выключен)'}
              </span>
            </div>
          </header>
          <div className="print-day-items">
            {program.pricing.dayRows.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1em' }}>
                <thead>
                  <tr>
                    {['День', 'Формат работы', 'Работа гида', 'Ночёвка гида'].map((header, index) => (
                      <th
                        key={header}
                        className="print-meta"
                        style={{
                          textAlign: index >= 2 ? 'right' : 'left',
                          borderBottom: '1px solid currentColor',
                          padding: '0 0 0.3em',
                          fontWeight: 600,
                        }}
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {program.pricing.dayRows.map((row) => (
                    <tr key={row.day}>
                      <td className="print-body" style={{ padding: '0.25em 0', whiteSpace: 'nowrap' }}>
                        <strong>{row.day}</strong>
                      </td>
                      <td className="print-body" style={{ padding: '0.25em 0.5em' }}>{row.format}</td>
                      <td className="print-body" style={{ padding: '0.25em 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{row.work}</td>
                      <td className="print-body" style={{ padding: '0.25em 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{row.night}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {program.pricing.lines.map((line, index) => (
              <div key={index} style={{ marginBottom: '0.6em' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1em', alignItems: 'baseline' }}>
                  <p className="print-body" style={{ margin: 0 }}>
                    <strong>{line.label}</strong>
                    {line.detail ? ` — ${line.detail}` : ''}
                  </p>
                  <p className="print-body" style={{ margin: 0, whiteSpace: 'nowrap' }}>
                    <strong>{line.amount}</strong>
                  </p>
                </div>
                {line.note && <p className="print-meta" style={{ margin: 0 }}>{line.note}</p>}
              </div>
            ))}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '1em',
                borderTop: '1px solid currentColor',
                paddingTop: '0.5em',
                marginTop: '0.5em',
              }}
            >
              <p className="print-body" style={{ margin: 0 }}>
                <strong>Итого</strong>
              </p>
              <p className="print-body" style={{ margin: 0 }}>
                <strong>{program.pricing.total}</strong>
              </p>
            </div>
            {program.pricing.perPerson && program.pricing.paxCount && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1em' }}>
                <p className="print-body" style={{ margin: 0 }}>
                  Стоимость на человека (группа {program.pricing.paxCount} чел.)
                </p>
                <p className="print-body" style={{ margin: 0 }}>
                  <strong>{program.pricing.perPerson}</strong>
                </p>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  )
}

export default async function PrintProgramPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string[] }>
  searchParams: Promise<{ client?: string }>
}) {
  const { slug } = await params
  const { client } = await searchParams
  const routeSlug = decodeURIComponent(slug.join('/'))

  const program = await buildPrintProgram(routeSlug)
  if (!program) notFound()

  const clientName = client?.trim() || ''

  return (
    <div className="print-page">
      <PrintToolbar slug={routeSlug} />
      <article className="print-doc">
        <header className="print-cover">
          <p className="print-brand">Jumbo in Japan · частный гид Эдуард Ревидович</p>
          <h1 className="print-title">{program.title}</h1>
          {clientName && <p className="print-client">Программа для: {clientName}</p>}
          <p className="print-meta">Подготовлено {formatDate(new Date())}</p>
        </header>
        {program.kind === 'day-tour' ? (
          <DayTourDocument program={program} />
        ) : (
          <MultiDayDocument program={program} />
        )}
        <footer className="print-doc-footer">
          <p className="print-meta">
            Jumbo in Japan · jumboinjapan.com · hello@jumboinjapan.com — программа предварительная, детали уточняем вместе.
          </p>
        </footer>
      </article>
    </div>
  )
}
