'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, BookOpen, FileText, FolderOpen, LogOut, Plus, Printer, Sparkles } from 'lucide-react'

import { AdminWorkspaceNav } from '@/components/admin/AdminWorkspaceNav'
import type { MultiDayBuilderCityOption, MultiDayBuilderPoiOption } from '@/lib/multi-day-builder-data'
import type { SavedMultiDayRouteSummary } from '@/lib/multi-day-builder-storage'
import {
  buildMultiDaySkeleton,
  reconcileMultiDayRoute,
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

function normalizeDayItems(items: MultiDayBuilderDay['items']) {
  return items.map((item, index) => ({
    ...item,
    order: index + 1,
  }))
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
  const [poiTargetDayId, setPoiTargetDayId] = useState<string | null>(null)
  const poiSearchRef = useRef<HTMLInputElement>(null)

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

  function buildNextRouteState() {
    return reconcileMultiDayRoute(route, {
      titleRu,
      titleEn,
      dayCount: liveDayCount,
      startCityId,
      startCityLabel: getCityLabel(selectedStartCity),
      endCityId,
      endCityLabel: getCityLabel(selectedEndCity),
    })
  }

  function handleGenerate() {
    const next = buildNextRouteState()

    setRoute(next)
    setSelectedDayId((current) => (next.days.some((day) => day.id === current) ? current : next.days[0]?.id ?? ''))
    setPoiQuery('')
    setPoiResults([])
    setSaveState('idle')
    setSaveMessage('')
  }

  async function handleSave() {
    const nextRoute = buildNextRouteState()

    setSaveState('saving')
    setSaveMessage(liveDayCount !== route.days.length ? 'Applying the new day structure and saving route…' : 'Saving route to Airtable…')

    try {
      const response = await fetch('/api/admin/multi-day/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextRoute),
      })
      const data = (await response.json()) as { savedAt?: string; error?: string }
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save route')
      }
      setRoute(nextRoute)
      setSelectedDayId((current) => (nextRoute.days.some((day) => day.id === current) ? current : nextRoute.days[0]?.id ?? ''))
      await refreshSavedRoutes(nextRoute.slug)
      setSelectedSavedSlug(nextRoute.slug)
      setSaveState('saved')
      setSaveMessage(
        liveDayCount !== route.days.length
          ? `Applied the new day count and saved at ${new Date(data.savedAt || Date.now()).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
          : `Saved at ${new Date(data.savedAt || Date.now()).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`,
      )
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

  function handleFocusPoiForDay(dayId: string) {
    setSelectedDayId(dayId)
    setPoiTargetDayId(dayId)
    setPoiQuery('')
    setPoiResults([])
    setTimeout(() => {
      poiSearchRef.current?.focus()
      poiSearchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
  }

  function handleAddTransport(dayId: string) {
    setRoute((prev) => ({
      ...prev,
      days: prev.days.map((day) => {
        if (day.id !== dayId) return day
        const nextItems = normalizeDayItems([
          ...day.items,
          {
            id: `day-${day.dayNumber}-transport-${Date.now()}`,
            order: day.items.length + 1,
            itemType: 'transport' as const,
            displayTitle: 'Transport segment',
            shortDescription: 'Edit: from → to, mode, duration.',
            sourceMode: 'manual' as const,
            locked: false,
            poiTitle: '',
            transportSegmentId: null,
            internalNotes: 'Added manually — fill in details.',
          },
        ])
        return { ...day, items: nextItems, displayStatus: 'Edited' }
      }),
    }))
  }

  function handleAddPoi(poi: MultiDayBuilderPoiOption) {
    const targetDayId = poiTargetDayId ?? selectedDay?.id
    if (!targetDayId) return

    setRoute((prev) => ({
      ...prev,
      days: prev.days.map((day) => {
        if (day.id !== targetDayId) return day

        const nextItems = normalizeDayItems([
          ...day.items,
          {
            id: `day-${day.dayNumber}-poi-${poi.poiId}-${Date.now()}`,
            order: day.items.length + 1,
            itemType: 'poi' as const,
            displayTitle: poi.nameRu || poi.nameEn || poi.poiId,
            shortDescription: [poi.siteCity, poi.categoryRu].filter(Boolean).join(' · '),
            sourceMode: 'manual' as const,
            locked: false,
            poiTitle: poi.nameRu || poi.nameEn,
            transportSegmentId: null,
            internalNotes: `POI ID: ${poi.poiId}`,
          },
        ])

        return {
          ...day,
          overnightCity: day.overnightCity || poi.siteCity || day.overnightCity,
          items: nextItems,
          displayStatus: 'Edited',
        }
      }),
    }))
    setPoiTargetDayId(null)

    setPoiQuery('')
    setPoiResults([])
  }

  function handleMoveDayItem(dayId: string, itemId: string, direction: 'up' | 'down') {
    setRoute((prev) => ({
      ...prev,
      days: prev.days.map((day) => {
        if (day.id !== dayId) return day

        const currentIndex = day.items.findIndex((item) => item.id === itemId)
        if (currentIndex === -1) return day

        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
        if (targetIndex < 0 || targetIndex >= day.items.length) return day

        const nextItems = [...day.items]
        const [movedItem] = nextItems.splice(currentIndex, 1)
        nextItems.splice(targetIndex, 0, movedItem)

        return {
          ...day,
          items: normalizeDayItems(nextItems),
          displayStatus: 'Edited',
        }
      }),
    }))
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[96rem] flex-col gap-4 px-4 py-4 md:px-6 md:py-5">
      <header className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#08111d]/94 px-4 py-3 shadow-[0_18px_45px_rgba(3,8,20,0.32)] md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Admin</div>
          <h1 className="text-lg font-semibold text-white">Multi-day route builder</h1>
        </div>

        <div className="flex flex-col items-end gap-2">
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
          <div className="flex items-center gap-2">
            <BookOpen className="size-4 shrink-0 text-slate-500" />
            <select
              value={selectedSavedSlug}
              onChange={(event) => setSelectedSavedSlug(event.target.value)}
              disabled={savedRoutesLoading}
              className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition focus:border-sky-500/50 min-w-[220px] max-w-xs"
            >
              <option value="">{savedRoutesLoading ? 'Loading routes…' : 'Select saved route…'}</option>
              {savedRoutes.map((savedRoute) => (
                <option key={savedRoute.slug} value={savedRoute.slug}>
                  {savedRoute.title} · {savedRoute.dayCount}d
                </option>
              ))}
            </select>
            <button
              onClick={() => void handleLoadSavedRoute(selectedSavedSlug).catch(console.error)}
              disabled={!selectedSavedSlug || savedRoutesLoading}
              className="inline-flex min-h-9 items-center rounded-xl border border-white/10 bg-white/[0.04] px-3.5 text-sm text-slate-200 transition hover:border-white/18 hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Load
            </button>
            {routeLoadMessage && (
              <span className="text-xs text-slate-400">{routeLoadMessage}</span>
            )}
          </div>
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

      {/* 3-column MultiDayBuilder per Johny spec: left rail (library/nav), center timeline, right inspector */}
      <div className="grid flex-1 gap-4 xl:grid-cols-[260px_1fr_340px]">
        {/* Left Rail: Resources Library & Route Navigator - library-first */}
        <div className={cn(panelClass, 'p-4 flex flex-col')}>
          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500 mb-3">Resources Library</div>
          <div className="text-sm text-slate-400 mb-4">POI, hotels, transport templates. Search and add to timeline.</div>
          <input
            ref={poiSearchRef}
            value={poiQuery}
            onChange={(event) => setPoiQuery(event.target.value)}
            className={inputClass}
            placeholder="Search POI…"
          />
          {poiTargetDayId && (
            <div className="mt-2 rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-xs text-sky-200">
              Adding to: Day {route.days.find((d) => d.id === poiTargetDayId)?.dayNumber ?? '?'}
              <button
                onClick={() => setPoiTargetDayId(null)}
                className="ml-2 text-sky-400 hover:text-white"
              >
                ✕
              </button>
            </div>
          )}
          {poiResults.length > 0 && (
            <div className="mt-3 max-h-64 overflow-auto space-y-2">
              {poiResults.map((poi) => (
                <button
                  key={poi.poiId}
                  onClick={() => handleAddPoi(poi)}
                  className="w-full text-left rounded-xl border border-white/10 bg-white/[0.03] p-3 hover:border-sky-400/30 text-sm"
                >
                  {poi.nameRu || poi.nameEn}
                  <div className="text-xs text-slate-500">{poi.siteCity}</div>
                </button>
              ))}
            </div>
          )}

        </div>

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

          <section className="space-y-6">
            {route.days.map((day) => {
              const isSelected = selectedDay?.id === day.id
              return (
                <article 
                  key={day.id} 
                  className={cn(
                    panelClass, 
                    'p-5 transition-all', 
                    isSelected ? 'ring-1 ring-sky-400/30 bg-[#0a1422]' : ''
                  )}
                  onClick={() => setSelectedDayId(day.id)}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <div className="text-xs font-mono tracking-widest bg-white/5 px-2 py-0.5 rounded">DAY {day.dayNumber}</div>
                        <span className={cn('rounded-full border px-2.5 py-0.5 text-xs', dayTypeTone[day.dayType])}>{day.dayType.toUpperCase()}</span>
                        <span className="text-xs text-emerald-400/70">{day.displayStatus}</span>
                      </div>
                      <h3 className="text-lg font-semibold text-white mt-1">{day.dayTitle}</h3>
                      <p className="text-sm text-slate-400 mt-1 leading-tight">{day.daySummary}</p>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      <div className="font-medium text-white">{day.overnightCity || '—'}</div>
                      <div>{day.items.length} sections • {day.derivedRegions.join(', ') || '—'}</div>
                    </div>
                  </div>

                  {/* Ordered editorial sections - reduced nesting, clear hierarchy, 8px spacing */}
                  <div className="space-y-3">
                    {day.items.map((item, itemIndex) => (
                      <div key={item.id} className="group rounded-xl border border-white/10 bg-white/[0.02] p-4 hover:border-white/20 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center text-[10px] font-mono text-slate-400">{item.order}</div>
                            <div>
                              <div className="font-medium text-white text-sm">{item.displayTitle}</div>
                              <div className="text-[10px] uppercase tracking-widest text-slate-500">{item.itemType} • {item.sourceMode}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleMoveDayItem(day.id, item.id, 'up'); }}
                              disabled={itemIndex === 0}
                              className="p-1.5 hover:bg-white/10 rounded text-slate-400 hover:text-white disabled:opacity-30"
                            >
                              <ArrowUp className="size-3" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleMoveDayItem(day.id, item.id, 'down'); }}
                              disabled={itemIndex === day.items.length - 1}
                              className="p-1.5 hover:bg-white/10 rounded text-slate-400 hover:text-white disabled:opacity-30"
                            >
                              <ArrowDown className="size-3" />
                            </button>
                          </div>
                        </div>
                        <p className="mt-3 text-sm text-slate-300 pl-9">{item.shortDescription || 'No editorial description yet. This is an ordered editorial section.'}</p>
                        {item.internalNotes && <div className="mt-2 pl-9 text-xs text-amber-300/70 italic">Note: {item.internalNotes}</div>}
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 pt-4 border-t border-white/10 flex gap-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleFocusPoiForDay(day.id); }}
                      className="flex-1 min-h-9 rounded-xl border border-white/10 bg-white/[0.04] text-xs hover:bg-white/[0.08] hover:border-sky-400/30 text-slate-300 transition-colors"
                    >
                      + Add POI to day
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAddTransport(day.id); }}
                      className="flex-1 min-h-9 rounded-xl border border-white/10 bg-white/[0.04] text-xs hover:bg-white/[0.08] hover:border-amber-400/30 text-slate-300 transition-colors"
                    >
                      + Add Transport
                    </button>
                  </div>
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
