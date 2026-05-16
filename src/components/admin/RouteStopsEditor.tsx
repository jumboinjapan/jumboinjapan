'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronUp, ChevronDown, Trash2 } from 'lucide-react'
import { AdminShell } from '@/components/admin/AdminShell'
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
}

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
  { key: 'Activity Tag', type: 'text', required: true, colSpan2: true, group: 'Identity' },
  { key: 'Eyebrow', type: 'text', group: 'Identity' },
  { key: 'Tags', type: 'text', group: 'Identity' },
  { key: 'stop_type', type: 'select', options: ['landmark','shrine','cruise','ropeway','volcano','museum','nature','gastronomy'], group: 'Identity' },
  { key: 'Arrival Time', type: 'text', short: true, group: 'Identity' },
  { key: 'Stop Title Override', type: 'text', group: 'Identity' },
  { key: 'Photo Path', type: 'text', group: 'Media' },
  { key: 'Photo Alt', type: 'text', group: 'Media' },
  { key: 'Stop Description Override Approved (RU)', type: 'textarea', rows: 7, colSpan2: true, group: 'Content' },
  { key: 'Selling Highlights', type: 'textarea', rows: 8, colSpan2: true, group: 'Content' },
  { key: 'Helper Criteria Label', type: 'text', group: 'Content' },
  { key: 'Is Helper', type: 'checkbox', group: 'Content' },
  { key: 'SEO Mention Priority', type: 'select', options: ['Primary', 'Secondary'], group: 'SEO & Status' },
  { key: 'Status', type: 'select', options: ['Active', 'Inactive'], group: 'SEO & Status' },
  { key: 'Internal Notes', type: 'textarea', rows: 3, colSpan2: true, group: 'Internal' },
]

const FIELD_GROUPS = ['Identity', 'Media', 'Content', 'SEO & Status', 'Internal']
const EMPTY_SELECT_VALUES = new Set(['', 'None', '—'])

const panelClass =
  'overflow-y-auto rounded-2xl border border-white/10 bg-[#08111d]/92 shadow-[0_18px_45px_rgba(3,8,20,0.3)]'
const inputClass =
  'w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition focus:border-sky-500/50'

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
  const [newStopName, setNewStopName] = useState('')
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  /* load routes */
  useEffect(() => {
    fetch('/api/admin/route-stops/routes')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setRoutes(data)
      })
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

  const handleAddStop = useCallback(async () => {
    if (!selectedSlug || !newStopName.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/route-stops/stops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routeSlug: selectedSlug,
          poiNameSnapshot: newStopName.trim(),
          order: stops.length + 1,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add stop')
      setStops((prev) => [...prev, { id: data.id, fields: data.fields }])
      setNewStopName('')
      setToast({ type: 'ok', msg: `Добавлено: ${newStopName.trim()}` })
    } catch (e) {
      setToast({ type: 'err', msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }, [selectedSlug, newStopName, stops.length])

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
              ? 'border border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
              : 'border border-red-400/20 bg-red-500/10 text-red-200',
          )}
        >
          {toast.msg}
        </div>
      )}

      {/* 3-column body */}
      <div className="flex flex-1 gap-4">
        {/* col 1: routes sidebar */}
        <aside className={cn(panelClass, 'w-64 shrink-0 p-3')}>
          <div className="text-xs uppercase tracking-widest text-slate-500">Routes</div>
          <div className="mt-3 space-y-3">
            {Object.entries(grouped).map(([type, list]) => (
              <div key={type}>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">{type}</div>
                {list.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedSlug(r.slug)}
                    className={cn(
                      'block w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition',
                      selectedSlug === r.slug
                        ? 'bg-white/10 text-white'
                        : 'text-slate-300 hover:bg-white/[0.06] hover:text-white',
                    )}
                  >
                    {r.title || r.slug}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </aside>

        {/* col 2: stops list */}
        <div className={cn(panelClass, 'w-[280px] shrink-0 p-3')}>
          {!selectedSlug ? (
            <div className="py-8 text-center text-sm text-slate-400">Select a route</div>
          ) : (
            <>
              {/* header */}
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-white">{selectedRoute?.title}</h2>
                {selectedRoute && (selectedRoute.tourStartTime || selectedRoute.tourEndTime) && (
                  <p className="text-xs text-slate-400">
                    {selectedRoute.tourStartTime} → {selectedRoute.tourEndTime}
                  </p>
                )}
              </div>

              <button
                onClick={handleSave}
                disabled={dirtyCount === 0 || saving}
                className={cn(
                  'mb-3 w-full rounded-lg px-3 py-2 text-sm font-medium transition',
                  dirtyCount > 0
                    ? 'bg-sky-600 text-white hover:bg-sky-500'
                    : 'cursor-not-allowed bg-white/[0.06] text-slate-500',
                )}
              >
                {saving ? 'Saving…' : 'Save all changes'}
                {dirtyCount > 0 && (
                  <span className="ml-2 rounded-full bg-amber-400/20 px-1.5 py-0.5 text-xs text-amber-300">
                    {dirtyCount}
                  </span>
                )}
              </button>

              {loading ? (
                <div className="py-8 text-center text-sm text-slate-400">Loading…</div>
              ) : stops.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-400">No stops</div>
              ) : (
                <div className="space-y-1">
                  {stops.map((stop, idx) => {
                    const order = Number(stop.fields['№'] ?? stop.fields['Order'] ?? idx + 1)
                    const title =
                      normalizeTextValue(stop.fields['Stop Title Override']) ||
                      normalizeTextValue(stop.fields['Activity Tag']) ||
                      stop.id
                    const arrival = normalizeTextValue(stop.fields['Arrival Time'])
                    const activityTag = getDraftFieldValue(
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
                          isSelected ? 'bg-white/10 border-white/10' : 'border-transparent hover:bg-white/[0.04]',
                          isStopDirty && 'border-amber-400/50',
                        )}
                      >
                        {/* reorder buttons */}
                        <div className="flex shrink-0 flex-col">
                          <button
                            onClick={() => handleReorder(stop.id, 'up')}
                            disabled={idx === 0 || reordering}
                            className="rounded p-0.5 text-slate-500 transition hover:text-slate-200 disabled:opacity-20"
                            title="Move up"
                          >
                            <ChevronUp className="size-3.5" />
                          </button>
                          <button
                            onClick={() => handleReorder(stop.id, 'down')}
                            disabled={idx === stops.length - 1 || reordering}
                            className="rounded p-0.5 text-slate-500 transition hover:text-slate-200 disabled:opacity-20"
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
                          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-medium text-slate-300">
                            {order}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm text-white">{title}</span>
                              {arrival && <span className="shrink-0 text-[11px] text-slate-400">{arrival}</span>}
                            </div>
                            {activityTag && (
                              <span className="mt-0.5 inline-block rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] text-sky-300">
                                {activityTag}
                              </span>
                            )}
                          </div>
                        </button>

                        {/* delete button */}
                        <button
                          onClick={() => handleDeleteStop(stop.id, title)}
                          disabled={deleting === stop.id}
                          className="rounded p-1 text-slate-500 transition hover:text-red-400 disabled:opacity-40"
                          title="Delete stop"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Add new stop form */}
              <div className="mt-3 flex gap-2 border-t border-white/10 pt-3">
                <input
                  type="text"
                  value={newStopName}
                  onChange={(e) => setNewStopName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddStop()}
                  placeholder="Название остановки"
                  className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition focus:border-sky-500/50 placeholder:text-slate-500"
                />
                <button
                  onClick={handleAddStop}
                  disabled={!newStopName.trim() || saving}
                  className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
                >
                  +
                </button>
              </div>
            </>
          )}
        </div>

        {/* col 3: stop detail */}
        <div className={cn(panelClass, 'flex-1 p-4')}>
          {!selectedStop ? (
            <div className="py-12 text-center text-sm text-slate-400">
              {selectedSlug ? 'Select a stop' : 'Select a route and stop'}
            </div>
          ) : (
            <StopDetail stop={selectedStop} dirtyFields={dirty[selectedStop.id]} onChange={handleFieldChange} />
          )}
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
  const title = normalizeTextValue(stop.fields['Stop Title Override']) || normalizeTextValue(stop.fields['Activity Tag']) || stop.id
  const activityTag = getDraftFieldValue(EDITABLE_FIELDS[0], dirtyFields, stop)

  return (
    <div>
      {/* header */}
      <div className="mb-4 flex items-center gap-2">
        {order != null && <span className="text-sm font-medium text-slate-300">#{order}</span>}
        <h3 className="text-base font-semibold text-white">{title}</h3>
        {activityTag && (
          <span className="rounded-full bg-sky-500/20 px-2.5 py-0.5 text-xs font-medium text-sky-200">
            {activityTag}
          </span>
        )}
        {isDirty && <span className="size-2 rounded-full bg-amber-400" />}
      </div>

      {/* field groups */}
      {FIELD_GROUPS.map((group) => {
        const fields = EDITABLE_FIELDS.filter((f) => f.group === group)
        if (fields.length === 0) return null
        return (
          <div key={group} className="mb-5">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-slate-400">{group}</div>
            <div className="grid gap-3 md:grid-cols-2">
              {fields.map((field) => {
                const original = stop.fields[field.key]
                const current = getDraftFieldValue(field, dirtyFields, stop)

                if (field.type === 'select') {
                  return (
                    <label key={field.key} className={cn('block', field.colSpan2 && 'md:col-span-2')}>
                      <span className="mb-1 block text-xs text-slate-400">{field.key}</span>
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
                        className="size-4 rounded border-white/10 bg-white/[0.04]"
                      />
                      <span className="text-xs text-slate-400">{field.key}</span>
                    </label>
                  )
                }

                if (field.type === 'textarea') {
                  return (
                    <label key={field.key} className={cn('block', field.colSpan2 && 'md:col-span-2')}>
                      <span className="mb-1 block text-xs text-slate-400">{field.key}</span>
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
                    <span className="mb-1 block text-xs text-slate-400">
                      {field.key}
                      {field.required && <span className="text-red-400"> *</span>}
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

