/**
 * Печатная программа тура (Задание 8): сборка данных для /admin/print/[...slug].
 *
 * Два вида маршрутов, один печатный шаблон:
 *  - multi-day/*  — билдер: Route Days + Day Items + Transport Segments,
 *    Print Lead / Print Footer Note как вводный абзац и подвал дня;
 *  - intercity/* и city-tour/* — Route Stops: описания по каноническому
 *    приоритету (Stop Override Approved → POI Approved → POI raw) плюс
 *    нарративный слой (Why This Stop Matters, Narrative Note, переходы).
 *
 * Документ клиентский: внутренние поля (Internal Notes, стоимости
 * транспорта, Pricing Confidence, Lock Status) сюда не попадают.
 */

import { AIRTABLE_BASE_ID, ROUTES_TABLE_ID } from '@/lib/airtable-schema'
import { fetchAirtableWithRetry } from '@/lib/airtable-retry'
import { getIntercityRouteStops, getPoisByIds } from '@/lib/airtable'
import { getMultiDayRouteSeoFields, loadMultiDayBuilderRoute } from '@/lib/multi-day-builder-storage'
import type { MultiDayBuilderRoute } from '@/lib/multi-day-builder'
import { tours } from '@/data/tours'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN

export interface PrintStop {
  order: number
  title: string
  eyebrow: string
  description: string
  whyThisStopMatters: string
  narrativeNote: string
  transitionToNext: string
  travelNoteToNext: string
  sellingHighlights: Array<{ title: string; body: string }>
  workingHours: string
  arrivalTime: string
}

export interface DayTourPrintProgram {
  kind: 'day-tour'
  slug: string
  title: string
  intro: string
  tourStartTime: string
  tourEndTime: string
  stops: PrintStop[]
}

/**
 * Данные POI для печатного документа, разложенные по Day Item ID.
 *
 * Зачем: в конструкторе у элемента дня живёт только короткая подпись
 * (Short Description) — её достаточно на экране, но в документе, который гость
 * читает перед поездкой, точка должна быть раскрыта: полное описание, часы
 * работы. Тянем их из базы POI по ID, который конструктор пишет в Internal
 * Notes элемента («POI ID: POI-000286»).
 */
export interface PrintPoiDetails {
  description: string
  workingHours: string
}

export interface MultiDayPrintProgram {
  kind: 'multi-day'
  slug: string
  title: string
  intro: string
  route: MultiDayBuilderRoute
  /** Ключ — Day Item ID; отсутствие записи означает «у элемента нет POI». */
  poiDetailsByItemId: Record<string, PrintPoiDetails>
}

export type PrintProgram = DayTourPrintProgram | MultiDayPrintProgram

export interface RouteMeta {
  title: string
  status: string
  tourStartTime: string
  tourEndTime: string
}

/** Публичные метаданные записи Routes по slug (печать + страницы новых пакетов). */
export async function getRouteMeta(slug: string): Promise<RouteMeta | null> {
  if (!AIRTABLE_TOKEN) return null
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${ROUTES_TABLE_ID}`)
  url.searchParams.set('filterByFormula', `{Slug}='${slug.replace(/'/g, "\\'")}'`)
  url.searchParams.set('pageSize', '1')
  for (const f of ['Title', 'Status', 'Tour Start Time', 'Tour End Time']) url.searchParams.append('fields[]', f)
  const res = await fetchAirtableWithRetry(url.toString(), {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const data = (await res.json()) as { records: Array<{ fields: Record<string, unknown> }> }
  const fields = data.records[0]?.fields
  if (!fields) return null
  return {
    title: typeof fields['Title'] === 'string' ? fields['Title'] : '',
    status: typeof fields['Status'] === 'string' ? fields['Status'] : '',
    tourStartTime: typeof fields['Tour Start Time'] === 'string' ? fields['Tour Start Time'] : '',
    tourEndTime: typeof fields['Tour End Time'] === 'string' ? fields['Tour End Time'] : '',
  }
}

async function buildDayTourProgram(slug: string): Promise<DayTourPrintProgram | null> {
  const [stops, meta, seo] = await Promise.all([
    getIntercityRouteStops(slug),
    getRouteMeta(slug),
    getMultiDayRouteSeoFields(slug).catch(() => null),
  ])

  const visibleStops = stops
    .filter((s) => !s.isHelper && s.status !== 'Inactive')
    .sort((a, b) => a.order - b.order)

  if (visibleStops.length === 0 && !meta) return null

  const pois = await getPoisByIds(visibleStops.map((s) => s.poiId))
  const poiById = new Map(pois.map((p) => [p.poiId, p]))
  const tour = tours.find((t) => t.slug === slug)

  const printStops: PrintStop[] = visibleStops.map((stop, index) => {
    const poi = poiById.get(stop.poiId)
    return {
      order: index + 1,
      title: stop.titleOverride || poi?.nameRu || stop.poiNameSnapshot,
      eyebrow: stop.eyebrow,
      // Канонический приоритет описаний (intercity-pois.ts)
      description: stop.descriptionOverride || poi?.approvedRu || poi?.descriptionRu || '',
      whyThisStopMatters: stop.whyThisStopMatters,
      narrativeNote: stop.narrativeNote,
      transitionToNext: stop.transitionToNextStop,
      travelNoteToNext: stop.travelNoteToNextStop,
      sellingHighlights: stop.sellingHighlights,
      workingHours: poi?.workingHours ?? '',
      arrivalTime: '',
    }
  })

  return {
    kind: 'day-tour',
    slug,
    title: meta?.title || tour?.title || slug,
    intro: seo?.routeIntro || tour?.description || '',
    tourStartTime: meta?.tourStartTime ?? '',
    tourEndTime: meta?.tourEndTime ?? '',
    stops: printStops,
  }
}

/** POI ID элемента дня: конструктор пишет его в Internal Notes («POI ID: …»). */
function extractPoiId(internalNotes: string): string {
  const match = internalNotes.match(/POI ID:\s*(POI-\d+)/i)
  return match ? match[1] : ''
}

async function buildMultiDayProgram(slug: string): Promise<MultiDayPrintProgram | null> {
  const [route, seo] = await Promise.all([
    loadMultiDayBuilderRoute(slug),
    getMultiDayRouteSeoFields(slug).catch(() => null),
  ])
  if (!route) return null

  // Полные описания точек: одним запросом на весь маршрут, а не по одному на день.
  const itemPoiIds = route.days.flatMap((day) =>
    day.items.map((item) => ({ itemId: item.id, poiId: extractPoiId(item.internalNotes) })).filter((x) => x.poiId),
  )

  const poiDetailsByItemId: Record<string, PrintPoiDetails> = {}
  if (itemPoiIds.length > 0) {
    const pois = await getPoisByIds(itemPoiIds.map((x) => x.poiId)).catch(() => [])
    const poiById = new Map(pois.map((poi) => [poi.poiId, poi]))

    for (const { itemId, poiId } of itemPoiIds) {
      const poi = poiById.get(poiId)
      if (!poi) continue
      // Канонический приоритет описаний: утверждённое → рабочее.
      const description = poi.approvedRu || poi.descriptionRu || ''
      if (!description && !poi.workingHours) continue
      poiDetailsByItemId[itemId] = { description, workingHours: poi.workingHours }
    }
  }

  return {
    kind: 'multi-day',
    slug,
    title: route.title || route.previewTitle || slug,
    intro: seo?.routeIntro || route.previewSubtitle || '',
    route,
    poiDetailsByItemId,
  }
}

export async function buildPrintProgram(slug: string): Promise<PrintProgram | null> {
  if (slug.startsWith('multi-day/')) return buildMultiDayProgram(slug)
  if (slug.startsWith('intercity/') || slug.startsWith('city-tour/')) return buildDayTourProgram(slug)
  return null
}
