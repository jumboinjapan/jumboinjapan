'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronUp, ChevronDown, Trash2 } from 'lucide-react'
import { AdminShell } from '@/components/admin/AdminShell'
import { adminInputClass, adminPanelClass, adminPrimaryButtonClass } from '@/components/admin/ui'
import type { MultiDayBuilderPoiOption } from '@/lib/multi-day-builder-data'
import { cn } from '@/lib/utils'

/* ---------- types ---------- */
interface Route {
  id: string
  slug: string
  title: string
  routeType: string
  tourStartTime: string
  tourEndTime: string
}

interface StopRecord {
  id: string
  fields: Record<string, unknown>
  /** POI-первоисточник: описание наследуется отсюда, пока не задан override */
  poi?: { nameRu: string; approvedRu: string; descriptionRu: string } | null
}

const DESCRIPTION_OVERRIDE_KEY = 'Stop Description Override Approved (RU)'

/* ---------- editable field config ---------- */
interface FieldConfig {
  key: string
  type: 'text' | 'textarea' | 'select' | 'checkbox'
  required?: boolean
  short?: boolean
  rows?: number
  colSpan2?: boolean
  options?: string[]
  group: string
}

const EDITABLE_FIELDS: FieldConfig[] = [
  { key: 'Eyebrow', type: 'text', colSpan2: true, group: 'Identity' },
  { key: 'Stop Title Override', type: 'text', group: 'Identity' },
  { key: 'Tags', type: 'text', group: 'Identity' },
  { key: 'Photo Path', type: 'text', group: 'Media' },
  { key: 'Photo Alt', type: 'text', group: 'Media' },
  { key: 'Stop Description Override Approved (RU)', type: 'textarea', rows: 7, colSpan2: true, group: 'Content' },
  { key: 'Selling Highlights', type: 'textarea', rows: 8, colSpan2: true, group: 'Content' },
  { key: 'Helper Criteria Label', type: 'text', group: 'Content' },
  { key: 'Is Helper', type: 'checkbox', group: 'Content' },
  { key: 'Why This Stop Matters', type: 'textarea', rows: 4, colSpan2: true, group: 'Narrative' },
  { key: 'Narrative Note', type: 'textarea', rows: 3, colSpan2: true, group: 'Narrative' },
  { key: 'Transition to Next Stop', type: 'textarea', rows: 3, colSpan2: true, group: 'Narrative' },
  { key: 'Travel Note To Next Stop', type: 'textarea', rows: 3, colSpan2: true, group: 'Narrative' },
  { key: 'SEO Mention Priority', type: 'select', options: ['Primary', 'Secondary'], group: 'SEO & Status' },
  { key: 'Status', type: 'select', options: ['Active', 'Inactive'], group: 'SEO & Status' },
  { key: 'Internal Notes', type: 'textarea', rows: 3, colSpan2: true, group: 'Internal' },
]

const FIELD_GROUPS = ['Identity', 'Media', 'Content', 'Narrative', 'SEO & Status', 'Internal']
const EMPTY_SELECT_VALUES = new Set(['', 'None', '—'])

const GROUP_LABELS: Record<string, string> = {
  Identity: 'Основное',
  Media: 'Медиа',
  Content: 'Контент',
  Narrative: 'Нарратив — в модалку точки и печатную программу',
  'SEO & Status': 'SEO и статус',
  Internal: 'Служебное',
}

const panelClass = cn(adminPanelClass, 'overflow-y-auto')
const inputClass = adminInputClass

function normalizeTextValue(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

function normalizeSelectValue(value: unknown): string {
  const normalized = normalizeTextValue(value).trim()
  return EMPTY_SELECT_VALUES.has(normalized) ? '' : normalized
}

function normalizeCheckboxValue(value: unknown): string {
  return value === true || value === 'true' || value === '1' ? 'true' : ''
}

function normalizeFieldValue(field: FieldConfig, value: unknown): string {
  if (field.type === 'select') return normalizeSelectValue(value)
  if (field.type === 'checkbox') return normalizeCheckboxValue(value)
  return normalizeTextValue(value)
}

function getDraftFieldValue(field: FieldConfig, dirtyFields: Record<string, unknown> | undefined, record: StopRecord): string {
  if (dirtyFields && Object.prototype.hasOwnProperty.call(dirtyFields, field.key)) {
    return normalizeFieldValue(field, dirtyFields[field.key])
  }
  return normalizeFieldValue(field, record.fields[field.key])
}

/* ---------- main component ---------- */
export function RouteStopsEditor() {
  const [routes, setRoutes] = useState<Route[]>([])
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [stops, setStops] = useState<StopRecord[]>([])
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null)
  const [dirty, setDirty] = useState<Record<string, Record<string, unknown>>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reordering, setReordering] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [poiQuery, setPoiQuery] = useState('')
  const [poiResults, setPoiResults] = useState<MultiDayBuilderPoiOption[]>([])
  const [poiLoading, setPoiLoading] = useState(false)
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const [showNewRouteForm, setShowNewRouteForm] = useState(false)
  const [newRoute, setNewRoute] = useState({ title: '', section: 'intercity', slugSuffix: '', routeType: '' })
  const [creatingRoute, setCreatingRoute] = useState(false)

  /* load routes; ?slug= — deep-link из Route Texts и других экранов */
  useEffect(() => {
    const slugParam = new URLSearchParams(window.location.search).get('slug')
    if (slugParam) setSelectedSlug(slugParam)
    fetch('/api/admin/route-stops/routes')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setRoutes(data)
      })
  }, [])

  const selectRoute = useCallback((slug: string) => {
    setSelectedSlug(slug)
    window.history.replaceState(null, '', `/admin/route-stops?slug=${encodeURIComponent(slug)}`)
  }, [])

  const grouped = useMemo(() => {
    const map: Record<string, Route[]> = {}
    for (const r of routes) {
      const t = r.routeType || 'other'
      ;(map[t] ??= []).push(r)
    }
    return map
  }, [routes])

  const selectedRoute = useMemo(() => routes.find((r) => r.slug === selectedSlug) ?? null, [routes, selectedSlug])

  /* load stops when route changes */
  useEffect(() => {
    if (!selectedSlug) return
    setLoading(true)
    setDirty({})
    setSelectedStopId(null)
    fetch(`/api/admin/route-stops/stops?routeSlug=${encodeURIComponent(selectedSlug)}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setStops(data)
          if (data.length > 0) setSelectedStopId(data[0].id)
        }
      })
      .finally(() => setLoading(false))
  }, [selectedSlug])

  /* debounced POI search for the add-stop picker — searches the same POI
     table used by the multi-day builder, including service/system POI
     records (Свободное время, Заселение в отель и т.п.) which live there
     with Is System = true, not in a separate table. */
  useEffect(() => {
    const query = poiQuery.trim()
    if (query.length < 1) {
      setPoiResults([])
      setPoiLoading(false)
      return
    }
    let alive = true
    setPoiLoading(true)
    const timeout = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/multi-day/pois?query=${encodeURIComponent(query)}`, { cache: 'no-store' })
        const data = (await res.json()) as MultiDayBuilderPoiOption[] | { error?: string }
        if (alive) setPoiResults(Array.isArray(data) ? data : [])
      } catch {
        if (alive) setPoiResults([])
      } finally {
        if (alive) setPoiLoading(false)
      }
    }, 180)
    return () => {
      alive = false
      window.clearTimeout(timeout)
    }
  }, [poiQuery])

  const handleCreateRoute = useCallback(async () => {
    if (creatingRoute) return
    setCreatingRoute(true)
    try {
      const res = await fetch('/api/admin/route-stops/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRoute),
      })
      const data = (await res.json()) as Route & { error?: string }
      if (!res.ok) {
        setToast({ type: 'err', msg: data.error || 'Не удалось создать маршрут' })
        return
      }
      setRoutes((prev) => [...prev, data])
      selectRoute(data.slug)
      setShowNewRouteForm(false)
      setNewRoute({ title: '', section: 'intercity', slugSuffix: '', routeType: '' })
      setToast({ type: 'ok', msg: `Маршрут «${data.title}» создан — добавляйте остановки` })
    } catch {
      setToast({ type: 'err', msg: 'Не удалось создать маршрут' })
    } finally {
      setCreatingRoute(false)
    }
  }, [creatingRoute, newRoute, selectRoute])

  const dirtyCount = Object.keys(dirty).length

  const selectedStop = useMemo(() => stops.find((s) => s.id === selectedStopId) ?? null, [stops, selectedStopId])

  const handleFieldChange = useCallback(
    (stopId: string, field: FieldConfig, value: unknown, original: unknown) => {
      const normalizedValue = normalizeFieldValue(field, value)
      const normalizedOriginal = normalizeFieldValue(field, original)

      setDirty((prev) => {
        const next = { ...prev }
        const rec = { ...(next[stopId] ?? {}) }

        if (normalizedValue === normalizedOriginal) {
          delete rec[field.key]
          if (Object.keys(rec).length === 0) delete next[stopId]
          else next[stopId] = rec
          return next
        }

        rec[field.key] = normalizedValue
        next[stopId] = rec
        return next
      })
    },
    [],
  )

  const handleReorder = useCallback(async (stopId: string, direction: 'up' | 'down') => {
    const idx = stops.findIndex((s) => s.id === stopId)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= stops.length) return

    const a = stops[idx]
    const b = stops[swapIdx]
    const aOrder = Number(a.fields['№'] ?? idx + 1)
    const bOrder = Number(b.fields['№'] ?? swapIdx + 1)

    // optimistic update
    setStops((prev) => {
      const next = [...prev]
      next[idx] = { ...a, fields: { ...a.fields, '№': bOrder } }
      next[swapIdx] = { ...b, fields: { ...b.fields, '№': aOrder } }
      return next.sort((x, y) => Number(x.fields['№'] ?? 0) - Number(y.fields['№'] ?? 0))
    })

    setReordering(true)
    try {
      await fetch('/api/admin/route-stops/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            { id: a.id, order: bOrder },
            { id: b.id, order: aOrder },
          ],
        }),
      })
    } catch (e) {
      setToast({ type: 'err', msg: e instanceof Error ? e.message : 'Reorder failed' })
    } finally {
      setReordering(false)
    }
  }, [stops])

  const handleDeleteStop = useCallback(async (stopId: string, title: string) => {
    if (!confirm(`Удалить "${title}"?`)) return
    setDeleting(stopId)
    try {
      const res = await fetch(`/api/admin/route-stops/stops/${stopId}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete stop')
      setStops((prev) => prev.filter((s) => s.id !== stopId))
      if (selectedStopId === stopId) setSelectedStopId(null)
      setToast({ type: 'ok', msg: `Удалено: ${title}` })
    } catch (e) {
      setToast({ type: 'err', msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setDeleting(null)
    }
  }, [selectedStopId])

  const handleAddStop = useCallback(async (poi: MultiDayBuilderPoiOption) => {
    if (!selectedSlug) return
    setSaving(true)
    try {
      const stopName = poi.nameRu || poi.nameEn || poi.poiId
      const res = await fetch('/api/admin/route-stops/stops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routeSlug: selectedSlug,
          poiId: poi.poiId,
          poiNameSnapshot: stopName,
          order: stops.length + 1,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add stop')
      setStops((prev) => [...prev, { id: data.id, fields: data.fields }])
      setPoiQuery('')
      setPoiResults([])
      setToast({ type: 'ok', msg: `Добавлено: ${stopName}` })
    } catch (e) {
      setToast({ type: 'err', msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }, [selectedSlug, stops.length])

  const handleSave = useCallback(async () => {
    const entries = Object.entries(dirty)
    if (entries.length === 0) return
    setSaving(true)
    setToast(null)
    try {
      const records = entries
        .map(([id, fields]) => ({ id, fields }))
        .filter(({ fields }) => Object.keys(fields).length > 0)

      if (records.length === 0) {
        setDirty({})
        setToast({ type: 'ok', msg: 'No changes to save' })
        return
      }

      const res = await fetch('/api/admin/route-stops/stops', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to save route stops')
      }

      const updatedMap = new Map((data.records as StopRecord[]).map((r: StopRecord) => [r.id, r]))

      setStops((prev) =>
        prev.map((stop) => {
          const updated = updatedMap.get(stop.id)
          return updated ? updated : stop
        }),
      )
      setDirty({})

      const skippedCount = Number(data.skipped ?? 0)
      const savedCount = Number(data.saved ?? records.length - skippedCount)
      const message = skippedCount > 0 ? `Saved ${savedCount} record(s), skipped ${skippedCount} unchanged` : `Saved ${savedCount} record(s)`
      setToast({ type: 'ok', msg: message })
    } catch (e) {
      setToast({ type: 'err', msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }, [dirty])

  /* auto-dismiss toast */
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  return (
    <AdminShell currentPath="/admin/route-stops" title="Остановки маршрутов" maxWidth="max-w-7xl">
      {/* toast */}
      {toast && (
        <div
          className={cn(
            'rounded-xl px-4 py-2 text-sm',
            toast.type === 'ok'
              ? 'border border-[var(--adm-ok-border)] bg-[var(--adm-ok-bg)] text-[var(--adm-ok-text)]'
              : 'border border-[var(--adm-danger-border)] bg-[var(--adm-danger-bg)] text-[var(--adm-danger-text)]',
          )}
        >
          {toast.msg}
        </div>
      )}

      {/* body: routes sidebar + full-width stack (stops list above stop detail) */}
      <div className="flex flex-1 gap-4">
        {/* col 1: routes sidebar */}
        <aside className={cn(panelClass, 'w-64 shrink-0 p-3')}>
          <div className="text-xs font-semibold uppercase tracking-[0.06em] text-[var(--adm-text-3)]">Маршруты</div>
          <div className="mt-3 space-y-3">
            {Object.entries(grouped).map(([type, list]) => (
              <div key={type}>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--adm-text-3)]">{type}</div>
                {list.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => selectRoute(r.slug)}
                    className={cn(
                      'block w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition',
                      selectedSlug === r.slug
                        ? 'bg-[var(--adm-active)] text-[var(--adm-text)]'
                        : 'text-[var(--adm-text-2)] hover:bg-[var(--adm-active)] hover:text-[var(--adm-text)]',
                    )}
                  >
                    {r.title || r.slug}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* new route package */}
          <div className="mt-4 border-t border-[var(--adm-border)] pt-3">
            {!showNewRouteForm ? (
              <button
                onClick={() => setShowNewRouteForm(true)}
                className="block w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--adm-accent-text)] transition hover:bg-[var(--adm-active)] hover:text-[var(--adm-accent-text)]"
              >
                + Новый маршрут
              </button>
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  value={newRoute.title}
                  onChange={(e) => setNewRoute((p) => ({ ...p, title: e.target.value }))}
                  placeholder="Название маршрута"
                  className={inputClass}
                  autoFocus
                />
                <select
                  value={newRoute.section}
                  onChange={(e) => setNewRoute((p) => ({ ...p, section: e.target.value }))}
                  className={inputClass}
                >
                  <option value="intercity">Выездной (intercity)</option>
                  <option value="city-tour">Городской (city-tour)</option>
                </select>
                <input
                  type="text"
                  value={newRoute.slugSuffix}
                  onChange={(e) => setNewRoute((p) => ({ ...p, slugSuffix: e.target.value }))}
                  placeholder="slug: yokohama-day"
                  className={inputClass}
                />
                <input
                  type="text"
                  list="route-type-options"
                  value={newRoute.routeType}
                  onChange={(e) => setNewRoute((p) => ({ ...p, routeType: e.target.value }))}
                  placeholder="Тип (как в списке слева)"
                  className={inputClass}
                />
                <datalist id="route-type-options">
                  {Object.keys(grouped).map((type) => (
                    <option key={type} value={type} />
                  ))}
                </datalist>
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateRoute}
                    disabled={creatingRoute || !newRoute.title.trim() || !newRoute.slugSuffix.trim()}
                    className={cn(adminPrimaryButtonClass, 'flex-1')}
                  >
                    {creatingRoute ? 'Создаю…' : 'Создать'}
                  </button>
                  <button
                    onClick={() => setShowNewRouteForm(false)}
                    className="rounded-full border border-[var(--adm-border)] px-3 text-sm text-[var(--adm-text-3)] transition hover:text-[var(--adm-text)]"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* stops list + stop detail: stacked, full width of the remaining space */}
        <div className="flex flex-1 flex-col gap-4">
        {/* stops list (day schedule) — now full width, stacked above the detail panel */}
        <div className={cn(panelClass, 'p-3')}>
          {!selectedSlug ? (
            <div className="py-8 text-center text-sm text-[var(--adm-text-3)]">Выберите маршрут</div>
          ) : (
            <>
              {/* header */}
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-[var(--adm-text)]">{selectedRoute?.title}</h2>
                {selectedRoute && (selectedRoute.tourStartTime || selectedRoute.tourEndTime) && (
                  <p className="text-xs text-[var(--adm-text-3)]">
                    {selectedRoute.tourStartTime} → {selectedRoute.tourEndTime}
                  </p>
                )}
                {selectedRoute?.slug && (
                  <div className="mt-1 flex flex-col gap-0.5">
                    <a
                      href={`/${selectedRoute.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-xs text-[var(--adm-accent-text)] hover:underline"
                    >
                      Открыть на сайте ↗
                    </a>
                    <a
                      href={`/admin/print/${selectedRoute.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-xs text-[var(--adm-accent-text)] hover:underline"
                    >
                      Печатная программа ↗
                    </a>
                    <a
                      href={`/admin/route-text?slug=${encodeURIComponent(selectedRoute.slug)}`}
                      className="inline-block text-xs text-[var(--adm-accent-text)] hover:underline"
                    >
                      Тексты маршрута →
                    </a>
                  </div>
                )}
              </div>

              <button
                onClick={handleSave}
                disabled={dirtyCount === 0 || saving}
                className={cn(adminPrimaryButtonClass, 'mb-3 w-full')}
              >
                {saving ? 'Сохраняю…' : 'Сохранить изменения'}
                {dirtyCount > 0 && (
                  <span className="ml-2 rounded-full bg-[var(--adm-warn-bg)] px-1.5 py-0.5 text-xs text-[var(--adm-warn-text)]">
                    {dirtyCount}
                  </span>
                )}
              </button>

              {loading ? (
                <div className="py-8 text-center text-sm text-[var(--adm-text-3)]">Загрузка…</div>
              ) : stops.length === 0 ? (
                <div className="py-8 text-center text-sm text-[var(--adm-text-3)]">Нет остановок</div>
              ) : (
                <div className="space-y-1">
                  {stops.map((stop, idx) => {
                    const order = Number(stop.fields['№'] ?? stop.fields['Order'] ?? idx + 1)
                    const title =
                      normalizeTextValue(stop.fields['Stop Title Override']) ||
                      normalizeTextValue(stop.fields['POI Name Snapshot']) ||
                      stop.id
                    const arrival = normalizeTextValue(stop.fields['Arrival Time'])
                    const eyebrowBadge = getDraftFieldValue(
                      EDITABLE_FIELDS[0],
                      dirty[stop.id],
                      stop,
                    )
                    const isStopDirty = !!dirty[stop.id] && Object.keys(dirty[stop.id]).length > 0
                    const isSelected = selectedStopId === stop.id

                    return (
                      <div
                        key={stop.id}
                        className={cn(
                          'flex items-center gap-1 rounded-lg border transition',
                          isSelected ? 'bg-[var(--adm-active)] border-[var(--adm-border)]' : 'border-transparent hover:bg-[var(--adm-hover)]',
                          isStopDirty && 'border-[var(--adm-warn-border)]',
                        )}
                      >
                        {/* reorder buttons */}
                        <div className="flex shrink-0 flex-col">
                          <button
                            onClick={() => handleReorder(stop.id, 'up')}
                            disabled={idx === 0 || reordering}
                            className="rounded p-0.5 text-[var(--adm-text-3)] transition hover:text-[var(--adm-text-2)] disabled:opacity-20"
                            title="Move up"
                          >
                            <ChevronUp className="size-3.5" />
                          </button>
                          <button
                            onClick={() => handleReorder(stop.id, 'down')}
                            disabled={idx === stops.length - 1 || reordering}
                            className="rounded p-0.5 text-[var(--adm-text-3)] transition hover:text-[var(--adm-text-2)] disabled:opacity-20"
                            title="Move down"
                          >
                            <ChevronDown className="size-3.5" />
                          </button>
                        </div>

                        {/* stop row */}
                        <button
                          onClick={() => setSelectedStopId(stop.id)}
                          className="flex flex-1 items-start gap-2 px-1.5 py-2 text-left"
                        >
                          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--adm-active)] text-[10px] font-medium text-[var(--adm-text-2)]">
                            {order}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm text-[var(--adm-text)]">{title}</span>
                              {arrival && <span className="shrink-0 text-[11px] text-[var(--adm-text-3)]">{arrival}</span>}
                            </div>
                            {eyebrowBadge && (
                              <span className="mt-0.5 inline-block rounded-full bg-[var(--adm-accent-bg)] px-2 py-0.5 text-[10px] text-[var(--adm-accent-text)]">
                                {eyebrowBadge}
                              </span>
                            )}
                          </div>
                        </button>

                        {/* delete button */}
                        <button
                          onClick={() => handleDeleteStop(stop.id, title)}
                          disabled={deleting === stop.id}
                          className="rounded p-1 text-[var(--adm-text-3)] transition hover:text-[var(--adm-danger-text)] disabled:opacity-40"
                          title="Delete stop"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Add stop: search & select existing POI — никакого свободного ввода,
                  сервисные точки (Свободное время, Заселение в отель и т.п.)
                  ищутся точно так же, это обычные POI с пометкой Is System */}
              <div className="relative mt-3 border-t border-[var(--adm-border)] pt-3">
                <input
                  type="text"
                  value={poiQuery}
                  onChange={(e) => setPoiQuery(e.target.value)}
                  placeholder="Найти точку (POI) и добавить…"
                  className={inputClass}
                />
                {poiLoading && (
                  <div className="absolute right-3 top-6 text-xs text-[var(--adm-text-3)]">…</div>
                )}
                {poiResults.length > 0 && (
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-lg border border-[var(--adm-border)] bg-[var(--adm-panel)] shadow-xl">
                    {poiResults.map((poi) => (
                      <button
                        key={poi.poiId}
                        type="button"
                        onClick={() => handleAddStop(poi)}
                        disabled={saving}
                        className="block w-full border-b border-[var(--adm-border)] px-3 py-2 text-left text-sm transition last:border-0 hover:bg-[var(--adm-hover)] disabled:opacity-50"
                      >
                        <div className="text-[var(--adm-text)]">{poi.nameRu || poi.nameEn || poi.poiId}</div>
                        <div className="text-[11px] text-[var(--adm-text-3)]">
                          {[poi.siteCity, poi.categoryRu].filter(Boolean).join(' · ')}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {!poiLoading && poiQuery.trim().length > 0 && poiResults.length === 0 && (
                  <p className="mt-2 text-xs text-[var(--adm-text-3)]">Ничего не найдено — точку нужно сначала завести в POI.</p>
                )}
              </div>
            </>
          )}
        </div>

        {/* stop detail — full width, below the stops list */}
        <div className={cn(panelClass, 'p-4')}>
          {!selectedStop ? (
            <div className="py-12 text-center text-sm text-[var(--adm-text-3)]">
              {selectedSlug ? 'Выберите остановку' : 'Выберите маршрут и остановку'}
            </div>
          ) : (
            <StopDetail stop={selectedStop} dirtyFields={dirty[selectedStop.id]} onChange={handleFieldChange} />
          )}
        </div>
        </div>
      </div>
    </AdminShell>
  )
}

/* ---------- stop detail panel ---------- */
function StopDetail({
  stop,
  dirtyFields,
  onChange,
}: {
  stop: StopRecord
  dirtyFields?: Record<string, unknown>
  onChange: (stopId: string, field: FieldConfig, value: unknown, original: unknown) => void
}) {
  const isDirty = !!dirtyFields && Object.keys(dirtyFields).length > 0
  const order = stop.fields['Order'] as number | undefined
  const title = normalizeTextValue(stop.fields['Stop Title Override']) || normalizeTextValue(stop.fields['POI Name Snapshot']) || stop.id
  const eyebrowTag = getDraftFieldValue(EDITABLE_FIELDS[0], dirtyFields, stop)

  return (
    <div>
      {/* header */}
      <div className="mb-4 flex items-center gap-2">
        {order != null && <span className="text-sm font-medium text-[var(--adm-text-2)]">#{order}</span>}
        <h3 className="text-base font-semibold text-[var(--adm-text)]">{title}</h3>
        {eyebrowTag && (
          <span className="rounded-full bg-[var(--adm-accent-bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--adm-accent-text)]">
            {eyebrowTag}
          </span>
        )}
        {isDirty && <span className="size-2 rounded-full bg-[var(--adm-warn-text)]" />}
      </div>

      {/* field groups */}
      {FIELD_GROUPS.map((group) => {
        const fields = EDITABLE_FIELDS.filter((f) => f.group === group)
        if (fields.length === 0) return null
        return (
          <div key={group} className="mb-5">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-[var(--adm-text-3)]">{GROUP_LABELS[group] ?? group}</div>
            <div className="grid gap-3 md:grid-cols-2">
              {fields.map((field) => {
                const original = stop.fields[field.key]
                const current = getDraftFieldValue(field, dirtyFields, stop)

                if (field.type === 'select') {
                  return (
                    <label key={field.key} className={cn('block', field.colSpan2 && 'md:col-span-2')}>
                      <span className="mb-1 block text-xs text-[var(--adm-text-3)]">{field.key}</span>
                      <select
                        value={current}
                        onChange={(e) => onChange(stop.id, field, e.target.value, original)}
                        className={inputClass}
                      >
                        <option value="">—</option>
                        {field.options?.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                  )
                }

                if (field.type === 'checkbox') {
                  return (
                    <label key={field.key} className={cn('flex items-center gap-2', field.colSpan2 && 'md:col-span-2')}>
                      <input
                        type="checkbox"
                        checked={current === 'true'}
                        onChange={(e) => onChange(stop.id, field, e.target.checked, original)}
                        className="size-4 rounded border-[var(--adm-border)] bg-[var(--adm-hover)]"
                      />
                      <span className="text-xs text-[var(--adm-text-3)]">{field.key}</span>
                    </label>
                  )
                }

                if (field.type === 'textarea') {
                  // Описание точки: наследуется из POI-первоисточника, пока не
                  // задан override. Правка POI разлетается на все маршруты;
                  // override замораживает текст только в этом маршруте.
                  if (field.key === DESCRIPTION_OVERRIDE_KEY) {
                    const inherited = (stop.poi?.approvedRu || stop.poi?.descriptionRu || '').trim()
                    const inheritedSource = stop.poi?.approvedRu ? 'POI Approved (RU)' : stop.poi?.descriptionRu ? 'POI Description (RU)' : null
                    const hasOverride = current.trim() !== ''
                    return (
                      <div key={field.key} className={cn('block', field.colSpan2 && 'md:col-span-2')}>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="text-xs text-[var(--adm-text-3)]">Описание точки</span>
                          {hasOverride ? (
                            <span className="rounded-full bg-[var(--adm-warn-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--adm-warn-text)]">
                              переопределено для этого маршрута
                            </span>
                          ) : (
                            <span className="rounded-full bg-[var(--adm-ok-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--adm-ok-text)]">
                              {inheritedSource ? `наследуется из ${inheritedSource}` : 'у POI нет описания'}
                            </span>
                          )}
                        </div>
                        {hasOverride ? (
                          <>
                            <textarea
                              value={current}
                              onChange={(e) => onChange(stop.id, field, e.target.value, original)}
                              rows={field.rows ?? 7}
                              className={inputClass}
                            />
                            <div className="mt-2 flex flex-wrap items-center gap-3">
                              <button
                                type="button"
                                onClick={() => onChange(stop.id, field, '', original)}
                                className="text-xs text-[var(--adm-accent-text)] hover:underline"
                                title="Очистить override — точка снова будет показывать описание из POI на всех маршрутах одинаково"
                              >
                                Вернуть наследование из POI
                              </button>
                              {inherited && (
                                <details className="w-full">
                                  <summary className="cursor-pointer text-xs text-[var(--adm-text-3)] hover:text-[var(--adm-text-2)]">
                                    Показать оригинал из POI
                                  </summary>
                                  <p className="mt-1 whitespace-pre-line rounded-lg border border-[var(--adm-border)] bg-[var(--adm-inset)] p-3 text-xs leading-relaxed text-[var(--adm-text-2)]">
                                    {inherited}
                                  </p>
                                </details>
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="min-h-16 whitespace-pre-line rounded-lg border border-dashed border-[var(--adm-border)] bg-[var(--adm-inset)] p-3 text-sm leading-relaxed text-[var(--adm-text-2)]">
                              {inherited || 'У POI-первоисточника нет описания — заполните его в редакторе POI, и оно появится на всех маршрутах с этой точкой.'}
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <p className="text-[11px] leading-snug text-[var(--adm-text-3)]">
                                Правка описания в POI автоматически обновит эту точку во всех маршрутах.
                              </p>
                              <button
                                type="button"
                                onClick={() => onChange(stop.id, field, inherited || ' ', original)}
                                className="shrink-0 text-xs text-[var(--adm-accent-text)] hover:underline"
                                title="Скопировать текст POI в override и отредактировать его только для этого маршрута"
                              >
                                Переопределить для этого маршрута
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )
                  }
                  return (
                    <label key={field.key} className={cn('block', field.colSpan2 && 'md:col-span-2')}>
                      <span className="mb-1 block text-xs text-[var(--adm-text-3)]">{field.key}</span>
                      <textarea
                        value={current}
                        onChange={(e) => onChange(stop.id, field, e.target.value, original)}
                        rows={field.rows ?? 3}
                        className={inputClass}
                      />
                    </label>
                  )
                }

                return (
                  <label key={field.key} className={cn('block', field.colSpan2 && 'md:col-span-2')}>
                    <span className="mb-1 block text-xs text-[var(--adm-text-3)]">
                      {field.key}
                      {field.required && <span className="text-[var(--adm-danger-text)]"> *</span>}
                    </span>
                    <input
                      type="text"
                      value={current}
                      onChange={(e) => onChange(stop.id, field, e.target.value, original)}
                      className={cn(inputClass, field.short && 'max-w-32')}
                    />
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

