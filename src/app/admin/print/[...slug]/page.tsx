import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { buildPrintProgram, type DayTourPrintProgram, type MultiDayPrintProgram, type PrintStop } from '@/lib/print-program'
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

function MultiDayDocument({ program }: { program: MultiDayPrintProgram }) {
  const { route } = program
  const segmentById = new Map(
    route.days.flatMap((day) => day.transportSegments.map((segment) => [segment.id, segment] as const)),
  )
  return (
    <>
      {program.intro && <p className="print-intro">{program.intro}</p>}
      <p className="print-meta">
        {route.dayCount} дней · {route.startCity} → {route.endCity}
      </p>
      {route.days.map((day) => (
        <section key={day.id} className="print-day">
          <header className="print-day-header">
            <p className="print-eyebrow">
              День {day.dayNumber} · {DAY_TYPE_LABELS[day.dayType] ?? day.dayType}
              {day.overnightCity ? ` · ночёвка: ${day.overnightCity}` : ''}
            </p>
            <h2 className="print-day-title">{day.dayTitle || `День ${day.dayNumber}`}</h2>
          </header>
          {day.printLead && <p className="print-intro">{day.printLead}</p>}
          {day.daySummary && !day.printLead && <p className="print-body">{day.daySummary}</p>}
          <div className="print-day-items">
            {day.items.map((item) => {
              if (item.itemType === 'transport') {
                const segment = item.transportSegmentId ? segmentById.get(item.transportSegmentId) : undefined
                const label = segment?.displayLabel || item.displayTitle
                if (!label) return null
                return (
                  <div key={item.id} className="print-transition">
                    <p className="print-body">→ {label}</p>
                    {segment?.reservationNote && <p className="print-meta">{segment.reservationNote}</p>}
                    {segment?.baggageNote && <p className="print-meta">{segment.baggageNote}</p>}
                  </div>
                )
              }
              return (
                <div key={item.id} className="print-item">
                  <p className="print-item-title">{item.displayTitle || item.poiTitle}</p>
                  {item.shortDescription && <p className="print-body">{item.shortDescription}</p>}
                </div>
              )
            })}
          </div>
          {day.printFooterNote && <p className="print-day-footer">{day.printFooterNote}</p>}
        </section>
      ))}
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
      <PrintToolbar />
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
