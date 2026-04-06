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
  tall?: boolean
  options?: string[]
}

const EDITABLE_FIELDS: FieldConfig[] = [
  { key: 'Activity Tag', type: 'text', required: true },
  { key: 'Arrival Time', type: 'text', short: true },
  { key: 'Stop Title Override', type: 'text' },
  { key: 'Photo Path', type: 'text' },
  { key: 'Photo Alt', type: 'text' },
  { key: 'Stop Description Override Approved (RU)', type: 'textarea', tall: true },
  { key: 'SEO Mention Priority', type: 'select', options: ['Primary', 'Secondary', 'None'] },
  { key: 'Status', type: 'select', options: ['Active', 'Inactive'] },
  { key: 'Internal Notes', type: 'textarea' },
]

/* ---------- main component ---------- */
export function RouteStopsEditor() {
  const [routes, setRoutes] = useState<Route[]>([])
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [stops, setStops] = useState<StopRecord[]>([])
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
    fetch(`/api/admin/route-stops/stops?routeSlug=${encodeURIComponent(selectedSlug)}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setStops(data)
      })
      .finally(() => setLoading(false))
  }, [selectedSlug])

  const dirtyCount = Object.keys(dirty).length

  const handleFieldChange = useCallback(
    (stopId: string, fieldKey: string, value: unknown, original: unknown) => {
      setDirty((prev) => {
        const next = { ...prev }
        const rec = { ...(next[stopId] ?? {}) }
        if (value === original) {
          delete rec[fieldKey]
          if (Object.keys(rec).length === 0) delete next[stopId]
          else next[stopId] = rec
        } else {
          rec[fieldKey] = value
          next[stopId] = rec
        }
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
      const records = entries.map(([id, fields]) => ({ id, fields }))
      const res = await fetch('/api/admin/route-stops/stops', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      // merge updated fields into local stops
      const updatedMap = new Map(
        (data.records as StopRecord[]).map((r: StopRecord) => [r.id, r]),
      )
      setStops((prev) =>
        prev.map((s) => {
          const u = updatedMap.get(s.id)
          return u ? { ...s, fields: { ...s.fields, ...u.fields } } : s
        }),
      )
      setDirty({})
      setToast({ type: 'ok', msg: `Saved ${entries.length} record(s)` })
    } catch (e) {
      setToast({ type: 'err', msg: String(e) })
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
          <a
            href="/api/admin/auth/logout"
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-3.5 text-sm text-slate-200 transition hover:border-white/18 hover:bg-white/[0.08] hover:text-white"
          >
            <LogOut className="mr-2 size-4" />
            Sign out
          </a>
        </div>
      </header>

      <div className="flex flex-1 gap-4">
        {/* sidebar */}
        <aside className="w-64 shrink-0 space-y-3 rounded-2xl border border-white/10 bg-[#08111d]/92 p-3 shadow-[0_18px_45px_rgba(3,8,20,0.3)]">
          <div className="text-xs uppercase tracking-widest text-slate-500">Routes</div>
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
        </aside>

        {/* main content */}
        <main className="flex-1 space-y-4">
          {!selectedSlug && (
            <div className="rounded-2xl border border-white/10 bg-[#08111d]/92 p-8 text-center text-slate-400">
              Select a route from the sidebar
            </div>
          )}

          {selectedSlug && selectedRoute && (
            <>
              {/* route header */}
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-[#08111d]/92 px-4 py-3 shadow-[0_18px_45px_rgba(3,8,20,0.3)]">
                <div>
                  <h2 className="text-base font-semibold text-white">{selectedRoute.title}</h2>
                  {(selectedRoute.tourStartTime || selectedRoute.tourEndTime) && (
                    <p className="text-sm text-slate-400">
                      {selectedRoute.tourStartTime} → {selectedRoute.tourEndTime}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {dirtyCount > 0 && (
                    <span className="text-xs text-amber-300">{dirtyCount} unsaved</span>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={dirtyCount === 0 || saving}
                    className={cn(
                      'rounded-full px-4 py-2 text-sm font-medium transition',
                      dirtyCount > 0
                        ? 'bg-sky-600 text-white hover:bg-sky-500'
                        : 'cursor-not-allowed bg-white/[0.06] text-slate-500',
                    )}
                  >
                    {saving ? 'Saving…' : 'Save all changes'}
                  </button>
                </div>
              </div>

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

              {/* stops */}
              {loading ? (
                <div className="py-12 text-center text-slate-400">Loading stops…</div>
              ) : stops.length === 0 ? (
                <div className="py-12 text-center text-slate-400">No stops found for this route</div>
              ) : (
                <div className="space-y-3">
                  {stops.map((stop) => (
                    <StopCard
                      key={stop.id}
                      stop={stop}
                      dirtyFields={dirty[stop.id]}
                      onChange={handleFieldChange}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

/* ---------- stop card ---------- */
function StopCard({
  stop,
  dirtyFields,
  onChange,
}: {
  stop: StopRecord
  dirtyFields?: Record<string, unknown>
  onChange: (stopId: string, fieldKey: string, value: unknown, original: unknown) => void
}) {
  const isDirty = !!dirtyFields && Object.keys(dirtyFields).length > 0
  const order = stop.fields['Order'] as number | undefined
  const activityTag = (dirtyFields?.['Activity Tag'] as string) ?? (stop.fields['Activity Tag'] as string) ?? ''

  return (
    <div
      className={cn(
        'rounded-2xl border bg-[#08111d]/92 p-4 shadow-[0_18px_45px_rgba(3,8,20,0.3)] transition',
        isDirty ? 'border-amber-400/40' : 'border-white/10',
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        {order != null && (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-slate-300">
            #{order}
          </span>
        )}
        {activityTag && (
          <span className="rounded-full bg-sky-500/20 px-2.5 py-0.5 text-xs font-medium text-sky-200">
            {activityTag}
          </span>
        )}
        <span className="text-sm text-slate-400">{stop.id}</span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {EDITABLE_FIELDS.map((f) => {
          const original = stop.fields[f.key] ?? ''
          const current = dirtyFields?.[f.key] !== undefined ? dirtyFields[f.key] : original

          if (f.type === 'select') {
            return (
              <label key={f.key} className="block">
                <span className="mb-1 block text-xs text-slate-400">{f.key}</span>
                <select
                  value={String(current)}
                  onChange={(e) => onChange(stop.id, f.key, e.target.value, original)}
                  className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition focus:border-sky-500/50"
                >
                  <option value="">—</option>
                  {f.options?.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            )
          }

          if (f.type === 'textarea') {
            return (
              <label key={f.key} className={cn('block', f.tall && 'md:col-span-2')}>
                <span className="mb-1 block text-xs text-slate-400">{f.key}</span>
                <textarea
                  value={String(current)}
                  onChange={(e) => onChange(stop.id, f.key, e.target.value, original)}
                  rows={f.tall ? 6 : 3}
                  className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition focus:border-sky-500/50"
                />
              </label>
            )
          }

          return (
            <label key={f.key} className="block">
              <span className="mb-1 block text-xs text-slate-400">
                {f.key}
                {f.required && <span className="text-red-400"> *</span>}
              </span>
              <input
                type="text"
                value={String(current)}
                onChange={(e) => onChange(stop.id, f.key, e.target.value, original)}
                className={cn(
                  'w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition focus:border-sky-500/50',
                  f.short && 'max-w-32',
                )}
              />
            </label>
          )
        })}
      </div>
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
