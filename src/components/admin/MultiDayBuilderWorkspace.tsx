'use client'

import { useEffect, useMemo, useState } from 'react'
import { FileText, FolderOpen, LogOut, Plus, Printer, Sparkles } from 'lucide-react'

import { AdminWorkspaceNav } from '@/components/admin/AdminWorkspaceNav'
import type { MultiDayBuilderCityOption, MultiDayBuilderPoiOption } from '@/lib/multi-day-builder-data'
import type { SavedMultiDayRouteSummary } from '@/lib/multi-day-builder-storage'
import {
  buildMultiDaySkeleton,
  type MultiDayBuilderDay,
  type MultiDayBuilderRoute,
} from '@/lib/multi-day-builder'
import { cn } from '@/lib/utils'

const panelClass =
  'rounded-2xl border border-white/10 bg-[#08111d]/92 shadow-[0_18px_45px_rgba(3,8,20,0.3)]'

const inputClass =
  'w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none transition focus:border-sky-500/50'

const dayTypeTone: Record<MultiDayBuilderDay['dayType'], string> = {
  arrival: 'border-sky-400/20 bg-sky-400/12 text-sky-100',
  touring: 'border-white/10 bg-white/[0.04] text-slate-100',
  departure: 'border-amber-300/20 bg-amber-300/12 text-amber-100',
}

function createInitialRoute() {
  return buildMultiDaySkeleton({
    titleRu: 'Классическая Япония',
    titleEn: 'classic-japan',
    dayCount: 7,
    startCityId: 'tokyo',
    startCityLabel: 'Tokyo',
    endCityId: 'osaka',
    endCityLabel: 'Osaka',
  })
}

function getCityLabel(city?: MultiDayBuilderCityOption) {
  if (!city) return ''
  return city.nameEn || city.nameRu || city.cityId
}

function applyLoadedRouteState(
  nextRoute: MultiDayBuilderRoute,
  setTitleRu: (value: string) => void,
  setTitleEn: (value: string) => void,
  setDayCount: (value: string) => void,
  setStartCityId: (value: string) => void,
  setEndCityId: (value: string) => void,
  setRoute: (value: MultiDayBuilderRoute) => void,
  setSelectedDayId: (value: string) => void,
) {
  setTitleRu(nextRoute.title)
  setTitleEn(nextRoute.titleEn)
  setDayCount(String(nextRoute.dayCount))
  setStartCityId(nextRoute.startCityId)
  setEndCityId(nextRoute.endCityId)
  setRoute(nextRoute)
  setSelectedDayId(nextRoute.days[0]?.id ?? '')
}

export function MultiDayBuilderWorkspace() {
  const [titleRu, setTitleRu] = useState('Классическая Япония')
  const [titleEn, setTitleEn] = useState('classic-japan')
  const [dayCount, setDayCount] = useState('7')
  const [cities, setCities] = useState<MultiDayBuilderCityOption[]>([])
  const [citiesLoading, setCitiesLoading] = useState(true)
  const [startCityId, setStartCityId] = useState('tokyo')
  const [endCityId, setEndCityId] = useState('osaka')
  const [route, setRoute] = useState<MultiDayBuilderRoute>(() => createInitialRoute())
  const [selectedDayId, setSelectedDayId] = useState(route.days[0]?.id ?? '')
  const [previewMode, setPreviewMode] = useState<'internal' | 'client' | 'print'>('internal')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveMessage, setSaveMessage] = useState('')
  const [savedRoutes, setSavedRoutes] = useState<SavedMultiDayRouteSummary[]>([])
  const [savedRoutesLoading, setSavedRoutesLoading] = useState(true)
  const [selectedSavedSlug, setSelectedSavedSlug] = useState('')
  const [routeLoadMessage, setRouteLoadMessage] = useState('')
  const [poiQuery, setPoiQuery] = useState('')
  const [poiResults, setPoiResults] = useState<MultiDayBuilderPoiOption[]>([])
  const [poiLoading, setPoiLoading] = useState(false)

  async function refreshSavedRoutes(preferredSlug?: string) {
    try {
      const response = await fetch('/api/admin/multi-day/route', { cache: 'no-store' })
      const data = (await response.json()) as SavedMultiDayRouteSummary[] | { error?: string }
      if (!response.ok || !Array.isArray(data)) {
        throw new Error(Array.isArray(data) ? 'Failed to load saved routes' : data.error || 'Failed to load saved routes')
      }

      setSavedRoutes(data)
      if (preferredSlug) {
        setSelectedSavedSlug(preferredSlug)
      } else if (data.some((item) => item.slug === route.slug)) {
        setSelectedSavedSlug(route.slug)
      } else if (!selectedSavedSlug) {
        setSelectedSavedSlug(data[0]?.slug ?? '')
      }
      return data
    } finally {
      setSavedRoutesLoading(false)
    }
  }

  async function handleLoadSavedRoute(slug: string, options?: { silent?: boolean }) {
    if (!slug) return

    if (!options?.silent) {
      setRouteLoadMessage('Loading saved route…')
    }

    const response = await fetch(`/api/admin/multi-day/route?slug=${encodeURIComponent(slug)}`, { cache: 'no-store' })
    const data = (await response.json()) as MultiDayBuilderRoute | { error?: string }
    if (!response.ok || Array.isArray(data) || !('slug' in data)) {
      throw new Error(!Array.isArray(data) && 'error' in data ? data.error || 'Failed to load route' : 'Failed to load route')
    }

    applyLoadedRouteState(data, setTitleRu, setTitleEn, setDayCount, setStartCityId, setEndCityId, setRoute, setSelectedDayId)
    setSelectedSavedSlug(data.slug)
    setPoiQuery('')
    setPoiResults([])
    setSaveState('idle')
    setSaveMessage('')
    setRouteLoadMessage(options?.silent ? '' : `Loaded ${data.title}`)
  }

  useEffect(() => {
    let alive = true

    async function loadCities() {
      try {
        const response = await fetch('/api/admin/multi-day/cities', { cache: 'no-store' })
        const data = (await response.json()) as MultiDayBuilderCityOption[] | { error?: string }
        if (!response.ok || !Array.isArray(data)) {
          throw new Error(Array.isArray(data) ? 'Failed to load city options' : data.error || 'Failed to load city options')
        }

        if (alive) {
          setCities(data)
          if (data.length > 0) {
            if (!data.some((city) => city.cityId === startCityId)) {
              setStartCityId(data[0]?.cityId ?? '')
            }
            if (!data.some((city) => city.cityId === endCityId)) {
              setEndCityId(data[data.length - 1]?.cityId ?? data[0]?.cityId ?? '')
            }
          }
        }
      } catch (error) {
        console.error(error)
      } finally {
        if (alive) setCitiesLoading(false)
      }
    }

    void loadCities()

    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true

    void refreshSavedRoutes()
      .then((routes) => {
        if (!alive) return
        const matchingCurrentRoute = routes.find((savedRoute) => savedRoute.slug === route.slug)
        if (matchingCurrentRoute) {
          void handleLoadSavedRoute(matchingCurrentRoute.slug, { silent: true }).catch((error) => {
            console.error(error)
          })
        }
      })
      .catch((error) => {
        console.error(error)
        if (alive) setRouteLoadMessage('Could not load saved routes list.')
      })

    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    const query = poiQuery.trim()

    if (query.length < 1) {
      setPoiResults([])
      setPoiLoading(false)
      return () => {
        alive = false
      }
    }

    setPoiLoading(true)
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/multi-day/pois?query=${encodeURIComponent(query)}`, { cache: 'no-store' })
        const data = (await response.json()) as MultiDayBuilderPoiOption[] | { error?: string }
        if (!response.ok || !Array.isArray(data)) {
          throw new Error(Array.isArray(data) ? 'Failed to load POI suggestions' : data.error || 'Failed to load POI suggestions')
        }
        if (alive) setPoiResults(data)
      } catch (error) {
        console.error(error)
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

  const selectedDay = useMemo(() => route.days.find((day) => day.id === selectedDayId) ?? route.days[0], [route.days, selectedDayId])
  const selectedStartCity = useMemo(() => cities.find((city) => city.cityId === startCityId), [cities, startCityId])
  const selectedEndCity = useMemo(() => cities.find((city) => city.cityId === endCityId), [cities, endCityId])
  const liveDayCount = useMemo(() => Math.min(Math.max(Math.round(Number(dayCount)) || 2, 2), 21), [dayCount])

  useEffect(() => {
    const draft = buildMultiDaySkeleton({
      titleRu,
      titleEn,
      dayCount: liveDayCount,
      startCityId,
      startCityLabel: getCityLabel(selectedStartCity),
      endCityId,
      endCityLabel: getCityLabel(selectedEndCity),
    })

    setRoute((prev) => ({
      ...prev,
      title: draft.title,
      titleEn: draft.titleEn,
      slug: draft.slug,
      startCityId: draft.startCityId,
      startCity: draft.startCity,
      endCityId: draft.endCityId,
      endCity: draft.endCity,
      previewTitle: draft.previewTitle,
    }))
  }, [titleRu, titleEn, liveDayCount, startCityId, endCityId, selectedStartCity, selectedEndCity])

  function handleGenerate() {
    const next = buildMultiDaySkeleton({
      titleRu,
      titleEn,
      dayCount: liveDayCount,
      startCityId,
      startCityLabel: getCityLabel(selectedStartCity),
      endCityId,
      endCityLabel: getCityLabel(selectedEndCity),
    })

    setRoute(next)
    setSelectedDayId(next.days[0]?.id ?? '')
    setPoiQuery('')
    setPoiResults([])
    setSaveState('idle')
    setSaveMessage('')
  }

  async function handleSave() {
    if (liveDayCount !== route.days.length) {
      setSaveState('error')
      setSaveMessage('Day count changed. Click Generate builder skeleton to apply the new day structure before saving.')
      return
    }

    setSaveState('saving')
    setSaveMessage('Saving route to Airtable…')

    try {
      const response = await fetch('/api/admin/multi-day/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(route),
      })
      const data = (await response.json()) as { savedAt?: string; error?: string }
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save route')
      }
      await refreshSavedRoutes(route.slug)
      setSelectedSavedSlug(route.slug)
      setSaveState('saved')
      setSaveMessage(`Saved at ${new Date(data.savedAt || Date.now()).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`)
    } catch (error) {
      setSaveState('error')
      setSaveMessage(error instanceof Error ? error.message : String(error))
    }
  }

  function handleCreateNewRoute() {
    const next = buildMultiDaySkeleton({
      titleRu: 'Новый маршрут',
      titleEn: 'new-route',
      dayCount: 2,
      startCityId: cities[0]?.cityId ?? '',
      startCityLabel: getCityLabel(cities[0]),
      endCityId: cities[0]?.cityId ?? '',
      endCityLabel: getCityLabel(cities[0]),
    })

    setTitleRu('Новый маршрут')
    setTitleEn('new-route')
    setDayCount('2')
    setStartCityId(cities[0]?.cityId ?? '')
    setEndCityId(cities[0]?.cityId ?? '')
    setRoute(next)
    setSelectedDayId(next.days[0]?.id ?? '')
    setSelectedSavedSlug('')
    setRouteLoadMessage('')
    setPoiQuery('')
    setPoiResults([])
    setSaveState('idle')
    setSaveMessage('')
  }

  function handleAddPoi(poi: MultiDayBuilderPoiOption) {
    if (!selectedDay) return

    setRoute((prev) => ({
      ...prev,
      days: prev.days.map((day) => {
        if (day.id !== selectedDay.id) return day

        return {
          ...day,
          overnightCity: day.overnightCity || poi.siteCity || day.overnightCity,
          items: [
            ...day.items,
            {
              id: `day-${day.dayNumber}-poi-${poi.poiId}-${Date.now()}`,
              order: day.items.length + 1,
              itemType: 'poi',
              displayTitle: poi.nameRu || poi.nameEn || poi.poiId,
              shortDescription: [poi.siteCity, poi.categoryRu].filter(Boolean).join(' · '),
              sourceMode: 'manual',
              locked: false,
              poiTitle: poi.nameRu || poi.nameEn,
              transportSegmentId: null,
              internalNotes: `POI ID: ${poi.poiId}`,
            },
          ],
        }
      }),
    }))

    setPoiQuery('')
    setPoiResults([])
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[96rem] flex-col gap-4 px-4 py-4 md:px-6 md:py-5">
      <header className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#08111d]/94 px-4 py-3 shadow-[0_18px_45px_rgba(3,8,20,0.32)] md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Admin</div>
          <h1 className="text-lg font-semibold text-white">Multi-day route builder</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <AdminWorkspaceNav currentPath="/admin/multi-day" />
          <a
            href="/api/admin/auth/logout"
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-3.5 text-sm text-slate-200 transition hover:border-white/18 hover:bg-white/[0.08] hover:text-white"
          >
            <LogOut className="mr-2 size-4" />
            Sign out
          </a>
        </div>
      </header>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <article className={cn(panelClass, 'p-4 md:p-5')}>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Builder inputs</div>
              <h2 className="text-base font-semibold text-white">Generate the registered route skeleton first</h2>
              <p className="max-w-2xl text-sm leading-6 text-slate-300">
                Slug is generated from the English route title plus the registered day count. Start and end cities come from Airtable, so we do not build a second sync layer later.
              </p>
            </div>

            <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1">
              {(['internal', 'client', 'print'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPreviewMode(mode)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-sm transition',
                    previewMode === mode ? 'bg-white/[0.1] text-white' : 'text-slate-400 hover:text-white',
                  )}
                >
                  {mode === 'internal' ? 'Internal preview' : mode === 'client' ? 'Client preview' : 'Print preview'}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="space-y-2 xl:col-span-2">
              <span className="text-sm text-slate-300">Route title (RU)</span>
              <input value={titleRu} onChange={(event) => setTitleRu(event.target.value)} className={inputClass} />
            </label>
            <label className="space-y-2 xl:col-span-2">
              <span className="text-sm text-slate-300">Route title (EN, slug source)</span>
              <input value={titleEn} onChange={(event) => setTitleEn(event.target.value)} className={inputClass} />
            </label>
            <label className="space-y-2">
              <span className="text-sm text-slate-300">Days</span>
              <input value={dayCount} onChange={(event) => setDayCount(event.target.value)} className={inputClass} inputMode="numeric" />
              <span className="block text-xs text-slate-500">Slug updates immediately. Click Generate to apply a new day structure.</span>
            </label>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm text-slate-300">Start city (Airtable)</span>
              <select value={startCityId} onChange={(event) => setStartCityId(event.target.value)} className={inputClass} disabled={citiesLoading}>
                <option value="">{citiesLoading ? 'Loading cities…' : 'Select start city'}</option>
                {cities.map((city) => (
                  <option key={`start-${city.cityId}`} value={city.cityId}>
                    {city.nameEn || city.nameRu} {city.regionRu ? `· ${city.regionRu}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm text-slate-300">End city (Airtable)</span>
              <select value={endCityId} onChange={(event) => setEndCityId(event.target.value)} className={inputClass} disabled={citiesLoading}>
                <option value="">{citiesLoading ? 'Loading cities…' : 'Select end city'}</option>
                {cities.map((city) => (
                  <option key={`end-${city.cityId}`} value={city.cityId}>
                    {city.nameEn || city.nameRu} {city.regionRu ? `· ${city.regionRu}` : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <label className="space-y-2">
              <span className="text-sm text-slate-300">Saved routes</span>
              <select
                value={selectedSavedSlug}
                onChange={(event) => setSelectedSavedSlug(event.target.value)}
                className={inputClass}
                disabled={savedRoutesLoading}
              >
                <option value="">{savedRoutesLoading ? 'Loading saved routes…' : 'Select a saved route'}</option>
                {savedRoutes.map((savedRoute) => (
                  <option key={savedRoute.slug} value={savedRoute.slug}>
                    {savedRoute.title} · {savedRoute.dayCount}d · {savedRoute.status}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                void handleLoadSavedRoute(selectedSavedSlug).catch((error) => {
                  console.error(error)
                  setRouteLoadMessage(error instanceof Error ? error.message : String(error))
                })
              }}
              disabled={!selectedSavedSlug}
              className="inline-flex min-h-11 items-center justify-center self-end rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm text-slate-200 transition hover:border-white/18 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FolderOpen className="mr-2 size-4" />
              Load route
            </button>
          </div>
          {routeLoadMessage ? <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-300">{routeLoadMessage}</div> : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleGenerate}
              className="inline-flex min-h-11 items-center rounded-full bg-sky-600 px-4 text-sm font-medium text-white transition hover:bg-sky-500"
            >
              <Sparkles className="mr-2 size-4" />
              Generate builder skeleton
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saveState === 'saving'}
              className={cn(
                'inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium transition',
                saveState === 'saving'
                  ? 'cursor-wait bg-emerald-500/70 text-white'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500',
              )}
            >
              Save changes
            </button>
            <button
              type="button"
              onClick={handleCreateNewRoute}
              className="inline-flex min-h-11 items-center rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm text-slate-200 transition hover:border-white/18 hover:bg-white/[0.08] hover:text-white"
            >
              <Plus className="mr-2 size-4" />
              Add new route
            </button>
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm text-slate-200 transition hover:border-white/18 hover:bg-white/[0.08] hover:text-white"
            >
              <Printer className="mr-2 size-4" />
              PDF pathway placeholder
            </button>
          </div>
          {saveMessage ? (
            <div
              className={cn(
                'mt-3 rounded-xl px-4 py-2 text-sm',
                saveState === 'saved'
                  ? 'border border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
                  : saveState === 'error'
                    ? 'border border-red-400/20 bg-red-500/10 text-red-200'
                    : 'border border-white/10 bg-white/[0.03] text-slate-300',
              )}
            >
              {saveMessage}
            </div>
          ) : null}
        </article>

        <article className={cn(panelClass, 'p-4 md:p-5')}>
          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Route state</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-white">{route.title}</h2>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-300">{route.status}</span>
            <span className="rounded-full border border-sky-300/16 bg-sky-300/10 px-2.5 py-1 text-xs text-sky-100">
              {liveDayCount} days{liveDayCount !== route.dayCount ? ' (pending apply)' : ''}
            </span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <RouteStat label="Slug" value={route.slug} />
            <RouteStat label="Preview mode" value={previewMode} />
            <RouteStat label="Start city" value={route.startCity || 'Not set'} />
            <RouteStat label="End city" value={route.endCity || 'Not set'} />
            <RouteStat label="Title EN" value={route.titleEn} />
            <RouteStat label="City source" value="Airtable" />
          </div>
        </article>
      </section>

      <div className="grid flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="space-y-4">
          <section className={cn(panelClass, 'overflow-hidden')}>
            <div className="border-b border-white/10 px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Route matrix</div>
              <h2 className="mt-1 text-base font-semibold text-white">Whole-trip scan before detailed editing</h2>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white/[0.03] text-left text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Day</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Start</th>
                    <th className="px-4 py-3 font-medium">End</th>
                    <th className="px-4 py-3 font-medium">Overnight</th>
                    <th className="px-4 py-3 font-medium">Blocks</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Regions</th>
                  </tr>
                </thead>
                <tbody>
                  {route.days.map((day) => (
                    <tr
                      key={`row-${day.id}`}
                      onClick={() => setSelectedDayId(day.id)}
                      className={cn(
                        'cursor-pointer border-t border-white/8 text-slate-200 transition hover:bg-white/[0.03]',
                        selectedDay?.id === day.id ? 'bg-sky-400/8' : '',
                      )}
                    >
                      <td className="px-4 py-3 font-medium text-white">Day {day.dayNumber}</td>
                      <td className="px-4 py-3 capitalize">{day.dayType}</td>
                      <td className="px-4 py-3">{day.startLocation || '—'}</td>
                      <td className="px-4 py-3">{day.endLocation || '—'}</td>
                      <td className="px-4 py-3">{day.overnightCity || '—'}</td>
                      <td className="px-4 py-3">{day.items.length}</td>
                      <td className="px-4 py-3">{day.displayStatus}</td>
                      <td className="px-4 py-3">{day.derivedRegions.length > 0 ? day.derivedRegions.join(', ') : 'Derived later'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-3">
            {route.days.map((day) => {
              const isOpen = selectedDay?.id === day.id

              return (
                <article key={day.id} className={cn(panelClass, 'overflow-hidden border', isOpen ? 'border-sky-400/24' : 'border-white/10')}>
                  <button
                    type="button"
                    onClick={() => setSelectedDayId(day.id)}
                    className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-white">Day {day.dayNumber}: {day.dayTitle}</h3>
                        <span className={cn('rounded-full border px-2 py-0.5 text-[11px]', dayTypeTone[day.dayType])}>{day.dayType}</span>
                      </div>
                      <p className="text-sm text-slate-300">{day.daySummary}</p>
                    </div>
                    <div className="text-right text-xs text-slate-400">
                      <div>{day.overnightCity || 'Overnight pending'}</div>
                      <div className="mt-1">{day.items.length} blocks</div>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-white/10 px-4 py-4">
                      <div className="grid gap-3 md:grid-cols-3">
                        <MiniMeta label="Overnight city" value={day.overnightCity || 'Pending'} />
                        <MiniMeta label="Derived regions" value={day.derivedRegions.join(', ') || 'Auto later'} />
                        <MiniMeta label="Status" value={day.displayStatus} />
                      </div>

                      <div className="mt-4 space-y-3">
                        {day.items.map((item) => (
                          <div key={item.id} className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div className="text-sm font-medium text-white">{item.displayTitle}</div>
                                <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{item.itemType}</div>
                              </div>
                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-300">{item.sourceMode}</span>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-slate-300">{item.shortDescription || 'No description yet.'}</p>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 space-y-3 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-white">Add POI from Airtable</div>
                            <div className="mt-1 text-xs text-slate-400">Type the first letters in RU or EN, then insert the POI into this day.</div>
                          </div>
                          <ActionChip label="Add transport" />
                        </div>
                        <input
                          value={poiQuery}
                          onChange={(event) => setPoiQuery(event.target.value)}
                          className={inputClass}
                          placeholder="Start typing a POI name…"
                        />
                        {poiLoading ? <div className="text-sm text-slate-400">Searching Airtable…</div> : null}
                        {!poiLoading && poiQuery.trim().length > 0 && poiResults.length === 0 ? (
                          <div className="text-sm text-slate-400">No POIs match this prefix yet.</div>
                        ) : null}
                        {poiResults.length > 0 ? (
                          <div className="grid gap-2">
                            {poiResults.map((poi) => (
                              <button
                                key={poi.poiId}
                                type="button"
                                onClick={() => handleAddPoi(poi)}
                                className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3 text-left transition hover:border-sky-400/24 hover:bg-sky-400/10"
                              >
                                <div className="text-sm font-medium text-white">{poi.nameRu || poi.nameEn}</div>
                                <div className="mt-1 text-xs text-slate-400">
                                  {[poi.nameEn, poi.siteCity, poi.categoryRu].filter(Boolean).join(' · ')}
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
                </article>
              )
            })}
          </section>
        </main>

        <aside className={cn(panelClass, 'p-4')}>
          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Inspector</div>
          {selectedDay ? (
            <div className="mt-3 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-white">Day {selectedDay.dayNumber}</h2>
                <p className="mt-1 text-sm text-slate-300">{selectedDay.dayTitle}</p>
              </div>

              <div className="grid gap-3">
                <MiniMeta label="Type" value={selectedDay.dayType} />
                <MiniMeta label="Start location" value={selectedDay.startLocation || 'Pending'} />
                <MiniMeta label="End location" value={selectedDay.endLocation || 'Pending'} />
                <MiniMeta label="Overnight city" value={selectedDay.overnightCity || 'Pending'} />
              </div>

              <div className="rounded-2xl border border-amber-300/14 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
                This side panel will hold POI, transport, and override controls once the Airtable read/write layer is connected.
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-sky-600 px-4 text-sm font-medium text-white transition hover:bg-sky-500"
                >
                  <Plus className="mr-2 size-4" />
                  Create manual override
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm text-slate-200 transition hover:border-white/18 hover:bg-white/[0.08] hover:text-white"
                >
                  <FileText className="mr-2 size-4" />
                  Open preview contract
                </button>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  )
}

function RouteStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-white">{value}</div>
    </div>
  )
}

function MiniMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-white">{value}</div>
    </div>
  )
}

function ActionChip({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="inline-flex min-h-10 items-center rounded-full border border-white/10 bg-white/[0.04] px-3.5 text-sm text-slate-200 transition hover:border-white/18 hover:bg-white/[0.08] hover:text-white"
    >
      <Plus className="mr-2 size-4" />
      {label}
    </button>
  )
}
