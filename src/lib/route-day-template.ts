import type { MultiDayBuilderDayItem } from './multi-day-builder'
import { routePoiIssues, RoutePoiReadinessError } from './route-poi-readiness'

export interface TemplateStop { id: string; fields: Record<string, unknown> }

/** Shared by the fresh server admission and the day builder. */
export function activeTemplateStops(input: unknown): TemplateStop[] {
  if (!Array.isArray(input)) throw new Error('Не удалось прочитать точки макета.')
  const ids = new Set<string>()
  for (const stop of input) {
    if (!stop || typeof stop.id !== 'string' || !stop.id || ids.has(stop.id)
      || !stop.fields || typeof stop.fields !== 'object' || Array.isArray(stop.fields)) {
      throw new Error('Макет содержит некорректные или повторяющиеся точки.')
    }
    ids.add(stop.id)
  }
  return (input as TemplateStop[]).filter(stop => {
    const status = stop.fields.Status as { name?: string } | string | undefined
    const name = typeof status === 'string' ? status : status?.name
    return stop.fields['Is Helper'] !== true && name !== 'Inactive' && name !== 'Archived'
  })
}

/** Use only a template admitted by GET ?forTemplate=1. Save rechecks fresh POIs. */
export function templateStopsToDayItems(input: unknown, dayId: string): MultiDayBuilderDayItem[] {
  const stops = activeTemplateStops(input)
  const refs = stops.map(s => ({ key: s.id, poiId: s.fields['POI ID'] }))
  const structural = routePoiIssues(refs, []).filter(i => i.code !== 'unknown_poi')
  if (structural.length) throw new RoutePoiReadinessError(structural)
  const text = (s: TemplateStop, key: string) => typeof s.fields[key] === 'string' ? s.fields[key] as string : ''
  return stops.map((s, index) => ({
    id: `item-${dayId}-tpl-${s.id}`, order: index + 1, itemType: 'poi',
    displayTitle: text(s, 'Stop Title Override') || text(s, 'POI Name Snapshot'), displayTitleEn: '',
    shortDescription: '', shortDescriptionEn: '', sourceMode: 'manual', locked: false,
    poiTitle: text(s, 'POI Name Snapshot'), transportSegmentId: null,
    poiId: text(s, 'POI ID').trim(), internalNotes: '',
  }))
}
