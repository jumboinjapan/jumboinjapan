'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { LogOut } from 'lucide-react'
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
  type: 'text' | 'textarea' | 'select'
  required?: boolean
  short?: boolean
  rows?: number
  colSpan2?: boolean
  options?: string[]
  group: string
}

const EDITABLE_FIELDS: FieldConfig[] = [
  { key: 'Activity Tag', type: 'text', required: true, colSpan2: true, group: 'Identity' },
  { key: 'Arrival Time', type: 'text', short: true, group: 'Identity' },
  { key: 'Stop Title Override', type: 'text', group: 'Identity' },
  { key: 'Photo Path', type: 'text', group: 'Media' },
  { key: 'Photo Alt', type: 'text', group: 'Media' },
  { key: 'Stop Description Override Approved (RU)', type: 'textarea', rows: 7, colSpan2: true, group: 'Content' },
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

function normalizeFieldValue(field: FieldConfig, value: unknown): string {
  return field.type === 'select' ? normalizeSelectValue(value) : normalizeTextValue(value)
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
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-4">
      {/* top bar */}
      <header className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#08111d]/94 px-4 py-3 shadow-[0_18px_45px_rgba(3,8,20,0.32)] md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Admin</div>
          <h1 className="text-lg font-semibold text-white">Route Stops Editor</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NavPill href="/admin" label="Overview" />
          <NavPill href="/admin/seo-llm" label="POI text" />
          <NavPill href="/admin/route-stops" label="Route Stops" active />
          <NavPill href="/admin/services" label="Services" />
          <a
            href="/api/admin/auth/logout"
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-3.5 text-sm text-slate-200 transition hover:border-white/18 hover:bg-white/[0.08] hover:text-white"
          >
            <LogOut className="mr-2 size-4" />
            Sign out
          </a>
        </div>
      </header>

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
                  {stops.map((stop) => {
                    const order = stop.fields['Order'] as number | undefined
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
                      <button
                        key={stop.id}
                        onClick={() => setSelectedStopId(stop.id)}
                        className={cn(
                          'flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition',
                          isSelected ? 'bg-white/10 border-white/10' : 'border-transparent hover:bg-white/[0.04]',
                          isStopDirty && 'border-amber-400/50',
                        )}
                      >
                        {order != null && (
                          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-medium text-slate-300">
                            {order}
                          </span>
                        )}
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
                    )
                  })}
                </div>
              )}
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
    </div>
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

/* ---------- nav pill ---------- */
function NavPill({ href, label, active }: { href: string; label: string; active?: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex min-h-10 items-center justify-center rounded-full border px-3.5 text-sm transition',
        active
          ? 'border-white/14 bg-white/[0.08] text-white'
          : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/16 hover:bg-white/[0.06] hover:text-white',
      )}
    >
      {label}
    </Link>
  )
}
