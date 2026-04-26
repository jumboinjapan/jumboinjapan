'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, BedDouble, BookOpen, Bus, Footprints, Plane, Plus, Printer, Save, Sparkles, X } from 'lucide-react'

import { AdminShell } from '@/components/admin/AdminShell'
import { CityAutocomplete } from '@/components/admin/CityAutocomplete'
import type { MultiDayBuilderPoiOption } from '@/lib/multi-day-builder-data'
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
  independent: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
}

const dayTypeLabel: Record<MultiDayBuilderDay['dayType'], string> = {
  arrival: 'прилёт',
  touring: 'экскурсия',
  departure: 'отлёт',
  independent: 'самостоятельно',
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
  setRoute: (value: MultiDayBuilderRoute) => void,
  setSelectedDayId: (value: string) => void,
) {
  setTitleRu(nextRoute.title)
  setTitleEn(nextRoute.titleEn)
  setDayCount(String(nextRoute.dayCount))
  setRoute(nextRoute)
  setSelectedDayId(nextRoute.days[0]?.id ?? '')
}

// ─── DayCard sub-component with its own POI search state ───────────────────

interface DayBlock {
  id: string
  nameRu: string
  nameEn: string
  type: string
  icon: string
}

interface DayCardProps {
  day: MultiDayBuilderDay
  isSelected: boolean
  onSelect: (dayId: string) => void
  onAddPoi: (dayId: string, poi: MultiDayBuilderPoiOption) => void
  onAddTransport: (dayId: string) => void
  onAddDayBlock: (dayId: string, block: DayBlock) => void
  onMoveDayItem: (dayId: string, itemId: string, direction: 'up' | 'down') => void
  onDeleteItem: (dayId: string, itemId: string) => void
  onUpdateField: (dayId: string, field: 'overnightCity' | 'startLocation' | 'endLocation', value: string) => void
  onUpdateDayType: (dayId: string, dayType: MultiDayBuilderDay['dayType']) => void
}

function DayCard({
  day,
  isSelected,
  onSelect,
  onAddPoi,
  onAddTransport,
  onAddDayBlock,
  onMoveDayItem,
  onDeleteItem,
  onUpdateField,
  onUpdateDayType,
}: DayCardProps) {
  const [localPoiQuery, setLocalPoiQuery] = useState('')
  const [localPoiResults, setLocalPoiResults] = useState<MultiDayBuilderPoiOption[]>([])
  const [localPoiLoading, setLocalPoiLoading] = useState(false)
  const [showBlockPicker, setShowBlockPicker] = useState(false)
  const [showTransportPicker, setShowTransportPicker] = useState(false)
  const [dayBlocks, setDayBlocks] = useState<DayBlock[]>([])
  const [dayBlocksLoading, setDayBlocksLoading] = useState(false)

  useEffect(() => {
    let alive = true
    const query = localPoiQuery.trim()

    if (query.length < 1) {
      setLocalPoiResults([])
      setLocalPoiLoading(false)
      return () => {
        alive = false
      }
    }

    setLocalPoiLoading(true)
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/multi-day/pois?query=${encodeURIComponent(query)}`, { cache: 'no-store' })
        const data = (await response.json()) as MultiDayBuilderPoiOption[] | { error?: string }
        if (!response.ok || !Array.isArray(data)) {
          throw new Error(Array.isArray(data) ? 'Failed to load POI suggestions' : (data as { error?: string }).error || 'Failed to load POI suggestions')
        }
        if (alive) setLocalPoiResults(data)
      } catch (error) {
        console.error(error)
        if (alive) setLocalPoiResults([])
      } finally {
        if (alive) setLocalPoiLoading(false)
      }
    }, 180)

    return () => {
      alive = false
      window.clearTimeout(timeout)
    }
  }, [localPoiQuery])

  function handlePoiSelect(poi: MultiDayBuilderPoiOption) {
    onAddPoi(day.id, poi)
    setLocalPoiQuery('')
    setLocalPoiResults([])
  }

  async function loadDayBlocksIfNeeded() {
    if (dayBlocks.length === 0) {
      setDayBlocksLoading(true)
      try {
        const res = await fetch('/api/airtable/day-blocks', { cache: 'no-store' })
        const data = (await res.json()) as DayBlock[] | { error?: string }
        if (res.ok && Array.isArray(data)) setDayBlocks(data)
      } catch (err) {
        console.error(err)
      } finally {
        setDayBlocksLoading(false)
      }
    }
  }

  async function handleOpenBlockPicker() {
    setShowTransportPicker(false)
    setShowBlockPicker(true)
    await loadDayBlocksIfNeeded()
  }

  async function handleOpenTransportPicker() {
    setShowBlockPicker(false)
    setShowTransportPicker(true)
    await loadDayBlocksIfNeeded()
  }

  function handleBlockSelect(block: DayBlock) {
    onAddDayBlock(day.id, block)
    setShowBlockPicker(false)
    setShowTransportPicker(false)
  }

  return (
    <article
      className={cn(
        panelClass,
        'transition-all',
        isSelected ? 'ring-1 ring-sky-400/30 bg-[#0a1422]' : '',
      )}
      onClick={() => onSelect(day.id)}
    >
      {/* Zone 1 — Day header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/8 px-5 py-4">
        {/* Left: badge + type selector + status */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-mono text-xs tracking-widest rounded bg-white/5 px-2 py-0.5 text-slate-400">
            ДЕНЬ {day.dayNumber}
          </div>
          <select
            value={day.dayType}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              e.stopPropagation()
              onUpdateDayType(day.id, e.target.value as MultiDayBuilderDay['dayType'])
            }}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-xs outline-none bg-transparent cursor-pointer',
              dayTypeTone[day.dayType],
            )}
          >
            <option value="arrival">прилёт</option>
            <option value="touring">экскурсия</option>
            <option value="departure">отлёт</option>
            <option value="independent">самостоятельно</option>
          </select>
          <span className="text-xs text-emerald-400/70">{day.displayStatus}</span>
        </div>

        {/* Center: title + summary */}
        <div className="flex-1 min-w-[200px]">
          <h3 className="text-base font-semibold text-white leading-tight">{day.dayTitle}</h3>
          <p className="mt-0.5 text-sm text-slate-400 leading-snug">{day.daySummary}</p>
        </div>

        {/* Right: inline editable fields */}
        <div
          className="flex shrink flex-wrap gap-3"
          onClick={(e) => e.stopPropagation()}
        >
          <CityAutocomplete
            value={day.startLocation}
            onChange={(v) => onUpdateField(day.id, 'startLocation', v)}
            placeholder="Старт"
            icon={day.dayType === 'arrival' || day.dayType === 'departure' ? <Plane className="size-3.5 shrink-0 text-slate-500" /> : <Footprints className="size-3.5 shrink-0 text-slate-500" />}
          />
          <span className="text-white/20 text-xs select-none">────</span>
          <CityAutocomplete
            value={day.overnightCity}
            onChange={(v) => onUpdateField(day.id, 'overnightCity', v)}
            placeholder="Ночёвка"
            icon={<BedDouble className="size-3.5 shrink-0 text-slate-500" />}
          />
        </div>
      </div>

      {/* Zone 2 — Items list */}
      <div className="space-y-2 px-5 py-4">
        {day.items.length === 0 ? (
          <div className="py-4 text-center text-sm text-slate-500">Нет блоков — добавьте POI или транспорт ниже.</div>
        ) : (
          day.items.map((item, itemIndex) => (
            <div
              key={item.id}
              className={cn(
                'group flex items-start gap-3 rounded-xl border p-4 transition-colors',
                item.itemType === 'day_block'
                  ? 'border-amber-400/20 bg-amber-400/8 hover:border-amber-400/30'
                  : 'border-white/10 bg-white/[0.02] hover:border-white/20',
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Order badge */}
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/5 font-mono text-[10px] text-slate-400">
                {item.order}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className={cn('font-medium text-sm', item.itemType === 'day_block' ? 'text-amber-100' : 'text-white')}>{item.displayTitle}</div>
                <div className="text-[10px] uppercase tracking-widest text-slate-500 mt-0.5">
                  {item.itemType} · {item.sourceMode}
                </div>
                {item.shortDescription && (
                  <p className="mt-1.5 text-sm text-slate-300 leading-snug">{item.shortDescription}</p>
                )}
                {item.internalNotes && (
                  <div className="mt-1 text-xs text-amber-300/70 italic">Заметка: {item.internalNotes}</div>
                )}
              </div>

              {/* Controls */}
              <div className="flex shrink-0 items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => onMoveDayItem(day.id, item.id, 'up')}
                  disabled={itemIndex === 0}
                  className="rounded p-1.5 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-30"
                  aria-label="Move up"
                >
                  <ArrowUp className="size-3" />
                </button>
                <button
                  onClick={() => onMoveDayItem(day.id, item.id, 'down')}
                  disabled={itemIndex === day.items.length - 1}
                  className="rounded p-1.5 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-30"
                  aria-label="Move down"
                >
                  <ArrowDown className="size-3" />
                </button>
                <button
                  onClick={() => onDeleteItem(day.id, item.id)}
                  className="rounded p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-400"
                  aria-label="Delete item"
                >
                  <X className="size-3" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Zone 3 — Add controls (inline POI search + transport) */}
      <div
        className="border-t border-white/8 px-5 py-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          {/* POI search */}
          <div className="relative flex-1">
            <input
              value={localPoiQuery}
              onChange={(e) => setLocalPoiQuery(e.target.value)}
              placeholder="Поиск POI для этого дня…"
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition focus:border-sky-500/40 placeholder:text-slate-500"
            />
            {localPoiLoading && (
              <div className="absolute right-3 top-2.5 text-xs text-slate-500">…</div>
            )}
            {localPoiResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-52 overflow-auto rounded-xl border border-white/10 bg-[#0d1929] shadow-xl">
                {localPoiResults.map((poi) => (
                  <button
                    key={poi.poiId}
                    onClick={() => handlePoiSelect(poi)}
                    className="w-full px-3 py-2.5 text-left text-sm hover:bg-white/[0.05] transition-colors border-b border-white/5 last:border-0"
                  >
                    <div className="font-medium text-white">{poi.nameRu || poi.nameEn}</div>
                    <div className="text-xs text-slate-500">{poi.siteCity}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Transport picker button */}
          <div className="relative shrink-0">
            <button
              onClick={handleOpenTransportPicker}
              className="inline-flex min-h-9 items-center rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm text-slate-300 transition hover:border-amber-400/30 hover:bg-white/[0.08] hover:text-white"
            >
              <Bus className="mr-1.5 size-3.5" />
              Транспорт
            </button>
            {showTransportPicker && (
              <div className="absolute left-0 top-full z-30 mt-1 min-w-48 overflow-auto rounded-xl border border-white/10 bg-[#0d1929] shadow-xl">
                <div className="flex items-center justify-between border-b border-white/8 px-3 py-2">
                  <span className="text-xs text-slate-400">Транспорт</span>
                  <button onClick={() => setShowTransportPicker(false)} className="text-slate-500 hover:text-white">
                    <X className="size-3.5" />
                  </button>
                </div>
                {dayBlocksLoading ? (
                  <div className="px-3 py-3 text-xs text-slate-500">Загрузка…</div>
                ) : dayBlocks.filter((b) => b.type === 'transfer').length === 0 ? (
                  <div className="px-3 py-3 text-xs text-slate-500">Нет вариантов</div>
                ) : (
                  dayBlocks
                    .filter((b) => b.type === 'transfer')
                    .map((block) => (
                      <button
                        key={block.id}
                        onClick={() => handleBlockSelect(block)}
                        className="flex w-full items-center gap-2 border-b border-white/5 px-3 py-2.5 text-left text-sm text-slate-200 transition hover:bg-white/[0.05] last:border-0"
                      >
                        <span>{block.icon}</span>
                        <span>{block.nameRu}</span>
                      </button>
                    ))
                )}
              </div>
            )}
          </div>

          {/* Day Block button (non-transfer) */}
          <div className="relative shrink-0">
            <button
              onClick={handleOpenBlockPicker}
              className="inline-flex min-h-9 items-center rounded-xl border border-amber-400/20 bg-amber-400/8 px-4 text-sm text-amber-200 transition hover:border-amber-400/40 hover:bg-amber-400/12 hover:text-amber-100"
            >
              <Plus className="mr-1.5 size-3.5" />
              Добавить блок
            </button>
            {showBlockPicker && (
              <div className="absolute left-0 top-full z-30 mt-1 min-w-48 overflow-auto rounded-xl border border-white/10 bg-[#0d1929] shadow-xl">
                <div className="flex items-center justify-between border-b border-white/8 px-3 py-2">
                  <span className="text-xs text-slate-400">Day Blocks</span>
                  <button onClick={() => setShowBlockPicker(false)} className="text-slate-500 hover:text-white">
                    <X className="size-3.5" />
                  </button>
                </div>
                {dayBlocksLoading ? (
                  <div className="px-3 py-3 text-xs text-slate-500">Загрузка…</div>
                ) : dayBlocks.filter((b) => b.type !== 'transfer').length === 0 ? (
                  <div className="px-3 py-3 text-xs text-slate-500">Нет блоков</div>
                ) : (
                  dayBlocks
                    .filter((b) => b.type !== 'transfer')
                    .map((block) => (
                      <button
                        key={block.id}
                        onClick={() => handleBlockSelect(block)}
                        className="flex w-full items-center gap-2 border-b border-white/5 px-3 py-2.5 text-left text-sm text-slate-200 transition hover:bg-white/[0.05] last:border-0"
                      >
                        <span>{block.icon}</span>
                        <span>{block.nameRu}</span>
                      </button>
                    ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

// ─── Main workspace ─────────────────────────────────────────────────────────

export function MultiDayBuilderWorkspace() {
  const [titleRu, setTitleRu] = useState('Классическая Япония')
  const [titleEn, setTitleEn] = useState('classic-japan')
  const [dayCount, setDayCount] = useState('7')
  const [route, setRoute] = useState<MultiDayBuilderRoute>(() => createInitialRoute())
  const [selectedDayId, setSelectedDayId] = useState(route.days[0]?.id ?? '')
  const [previewMode, setPreviewMode] = useState<'internal' | 'client' | 'print'>('internal')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveMessage, setSaveMessage] = useState('')
  const [savedRoutes, setSavedRoutes] = useState<SavedMultiDayRouteSummary[]>([])
  const [savedRoutesLoading, setSavedRoutesLoading] = useState(true)
  const [selectedSavedSlug, setSelectedSavedSlug] = useState('')
  const [routeLoadMessage, setRouteLoadMessage] = useState('')

  async function refreshSavedRoutes(preferredSlug?: string) {
    try {
      const response = await fetch('/api/admin/multi-day/route', { cache: 'no-store' })
      const data = (await response.json()) as SavedMultiDayRouteSummary[] | { error?: string }
      if (!response.ok || !Array.isArray(data)) {
        throw new Error(Array.isArray(data) ? 'Failed to load saved routes' : (data as { error?: string }).error || 'Failed to load saved routes')
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
      setRouteLoadMessage('Загрузка маршрута…')
    }

    const response = await fetch(`/api/admin/multi-day/route?slug=${encodeURIComponent(slug)}`, { cache: 'no-store' })
    const data = (await response.json()) as MultiDayBuilderRoute | { error?: string }
    if (!response.ok || Array.isArray(data) || !('slug' in data)) {
      throw new Error(!Array.isArray(data) && 'error' in data ? (data as { error?: string }).error || 'Failed to load route' : 'Failed to load route')
    }

    applyLoadedRouteState(data, setTitleRu, setTitleEn, setDayCount, setRoute, setSelectedDayId)
    setSelectedSavedSlug(data.slug)
    setSaveState('idle')
    setSaveMessage('')
    setRouteLoadMessage(options?.silent ? '' : `Загружен: ${data.title}`)
  }

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
        if (alive) setRouteLoadMessage('Не удалось загрузить список маршрутов.')
      })

    return () => {
      alive = false
    }
  }, [])

  const selectedDay = useMemo(() => route.days.find((day) => day.id === selectedDayId) ?? route.days[0], [route.days, selectedDayId])
  const liveDayCount = useMemo(() => Math.min(Math.max(Math.round(Number(dayCount)) || 2, 2), 21), [dayCount])

  useEffect(() => {
    const draft = buildMultiDaySkeleton({
      titleRu,
      titleEn,
      dayCount: liveDayCount,
      startCityId: route.startCityId,
      startCityLabel: route.startCity,
      endCityId: route.endCityId,
      endCityLabel: route.endCity,
    })

    setRoute((prev) => ({
      ...prev,
      title: draft.title,
      titleEn: draft.titleEn,
      slug: draft.slug,
      previewTitle: draft.previewTitle,
    }))
  }, [titleRu, titleEn, liveDayCount])

  function buildNextRouteState() {
    return reconcileMultiDayRoute(route, {
      titleRu,
      titleEn,
      dayCount: liveDayCount,
      startCityId: route.startCityId,
      startCityLabel: route.startCity,
      endCityId: route.endCityId,
      endCityLabel: route.endCity,
    })
  }

  function handleGenerate() {
    const next = buildNextRouteState()

    setRoute(next)
    setSelectedDayId((current) => (next.days.some((day) => day.id === current) ? current : next.days[0]?.id ?? ''))
    setSaveState('idle')
    setSaveMessage('')
  }

  async function handleSave() {
    const nextRoute = buildNextRouteState()

    setSaveState('saving')
    setSaveMessage(liveDayCount !== route.days.length ? 'Применяем новую структуру и сохраняем…' : 'Сохраняем в Airtable…')

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
          ? `Структура применена, сохранено в ${new Date(data.savedAt || Date.now()).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
          : `Сохранено в ${new Date(data.savedAt || Date.now()).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`,
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
      startCityId: '',
      startCityLabel: '',
      endCityId: '',
      endCityLabel: '',
    })

    setTitleRu('Новый маршрут')
    setTitleEn('new-route')
    setDayCount('2')
    setRoute(next)
    setSelectedDayId(next.days[0]?.id ?? '')
    setSelectedSavedSlug('')
    setRouteLoadMessage('')
    setSaveState('idle')
    setSaveMessage('')
  }

  function handleAddPoiToDay(dayId: string, poi: MultiDayBuilderPoiOption) {
    setRoute((prev) => ({
      ...prev,
      days: prev.days.map((day) => {
        if (day.id !== dayId) return day
        const newItem = {
          id: `item-${dayId}-poi-${Math.random().toString(36).slice(2, 8)}`,
          order: day.items.length + 1,
          itemType: 'poi' as const,
          displayTitle: poi.nameRu || poi.nameEn || poi.poiId,
          shortDescription: '',
          sourceMode: 'manual' as const,
          locked: false,
          poiTitle: poi.nameRu || poi.nameEn || poi.poiId,
          transportSegmentId: null,
          internalNotes: '',
        }
        return { ...day, items: normalizeDayItems([...day.items, newItem]) }
      }),
    }))
  }

  function handleAddDayBlock(dayId: string, block: DayBlock) {
    setRoute((prev) => ({
      ...prev,
      days: prev.days.map((day) => {
        if (day.id !== dayId) return day
        const newItem = {
          id: `item-${dayId}-block-${Math.random().toString(36).slice(2, 8)}`,
          order: day.items.length + 1,
          itemType: 'day_block' as const,
          displayTitle: `${block.icon} ${block.nameRu}`,
          shortDescription: '',
          sourceMode: 'manual' as const,
          locked: false,
          poiTitle: '',
          transportSegmentId: null,
          internalNotes: '',
        }
        return { ...day, items: normalizeDayItems([...day.items, newItem]) }
      }),
    }))
  }

  function handleAddTransport(dayId: string) {
    setRoute((prev) => ({
      ...prev,
      days: prev.days.map((day) => {
        if (day.id !== dayId) return day
        const newItem = {
          id: `item-${dayId}-transport-${Math.random().toString(36).slice(2, 8)}`,
          order: day.items.length + 1,
          itemType: 'transport' as const,
          displayTitle: 'Транспорт',
          shortDescription: '',
          sourceMode: 'manual' as const,
          locked: false,
          poiTitle: '',
          transportSegmentId: null,
          internalNotes: '',
        }
        return { ...day, items: normalizeDayItems([...day.items, newItem]) }
      }),
    }))
  }

  function handleMoveDayItem(dayId: string, itemId: string, direction: 'up' | 'down') {
    setRoute((prev) => ({
      ...prev,
      days: prev.days.map((day) => {
        if (day.id !== dayId) return day
        const idx = day.items.findIndex((item) => item.id === itemId)
        if (idx < 0) return day
        const next = [...day.items]
        if (direction === 'up' && idx > 0) {
          ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
        } else if (direction === 'down' && idx < next.length - 1) {
          ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
        }
        return { ...day, items: normalizeDayItems(next) }
      }),
    }))
  }

  function handleDeleteDayItem(dayId: string, itemId: string) {
    setRoute((prev) => ({
      ...prev,
      days: prev.days.map((day) => {
        if (day.id !== dayId) return day
        return { ...day, items: normalizeDayItems(day.items.filter((item) => item.id !== itemId)) }
      }),
    }))
  }

  function handleUpdateDayField(
    dayId: string,
    field: 'overnightCity' | 'startLocation' | 'endLocation',
    value: string,
  ) {
    setRoute((prev) => {
      const idx = prev.days.findIndex((d) => d.id === dayId)
      return {
        ...prev,
        days: prev.days.map((day, i) => {
          if (day.id === dayId) return { ...day, [field]: value }
          // when overnightCity of day idx changes — auto-set startLocation of day idx+1
          if (field === 'overnightCity' && i === idx + 1) return { ...day, startLocation: value }
          return day
        }),
      }
    })
  }

  function handleUpdateDayType(dayId: string, dayType: MultiDayBuilderDay['dayType']) {
    setRoute((prev) => ({
      ...prev,
      days: prev.days.map((day) => (day.id === dayId ? { ...day, dayType } : day)),
    }))
  }

  const RouteActions = () => (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={selectedSavedSlug}
        onChange={(event) => setSelectedSavedSlug(event.target.value)}
        disabled={savedRoutesLoading}
        className="h-9 w-64 rounded-lg border border-white/12 bg-white/[0.06] px-3 text-sm text-white outline-none transition focus:border-sky-500/50 disabled:opacity-50 cursor-pointer"
      >
        <option value="">{savedRoutesLoading ? 'Загрузка…' : 'Выбрать маршрут…'}</option>
        {savedRoutes.map((savedRoute) => (
          <option key={savedRoute.slug} value={savedRoute.slug}>
            {savedRoute.title} · {savedRoute.dayCount}д
          </option>
        ))}
      </select>

      <button
        onClick={() => void handleLoadSavedRoute(selectedSavedSlug).catch(console.error)}
        disabled={!selectedSavedSlug || savedRoutesLoading}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm text-slate-200 transition hover:border-white/14 hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        <BookOpen className="size-3.5" />
        Открыть
      </button>

      <button
        type="button"
        onClick={handleGenerate}
        className="inline-flex size-9 items-center justify-center rounded-full bg-sky-600 text-white transition hover:bg-sky-500"
        title="Генерировать"
      >
        <Sparkles className="size-4" />
      </button>

      <button
        type="button"
        onClick={handleSave}
        disabled={saveState === 'saving'}
        className={cn(
          'inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium transition',
          saveState === 'saving'
            ? 'cursor-wait bg-emerald-700/70 text-white'
            : 'bg-emerald-700 text-white hover:bg-emerald-600',
        )}
      >
        <Save className="size-4" />
        Сохранить
      </button>

      <button
        type="button"
        onClick={handleCreateNewRoute}
        className="inline-flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-200 transition hover:border-white/14 hover:bg-white/[0.07] hover:text-white"
        title="Новый"
      >
        <Plus className="size-4" />
      </button>

      <button
        type="button"
        disabled
        className="inline-flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-500 opacity-30"
        title="PDF"
      >
        <Printer className="size-4" />
      </button>

      {(saveMessage || routeLoadMessage) && (
        <span className={cn(
          'ml-3 text-xs',
          saveState === 'saved' ? 'text-emerald-400' : saveState === 'error' ? 'text-red-400' : 'text-slate-400',
        )}>
          {saveMessage || routeLoadMessage}
        </span>
      )}
    </div>
  )

  return (
    <AdminShell 
      currentPath="/admin/multi-day" 
      title="Конструктор маршрутов" 
      actions={<RouteActions />}
      maxWidth="max-w-7xl"
    >
      {/* ── Builder inputs + route state ── */}
      <section>
        <article className={cn(panelClass, 'p-4 md:p-5')}>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Параметры маршрута</div>
              <h2 className="text-base font-semibold text-white">Сначала сгенерируйте скелет маршрута</h2>

            </div>

            <div className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] p-1">
              {(['internal', 'client', 'print'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPreviewMode(mode)}
                  className={cn(
                    'inline-flex h-7 items-center rounded-full px-3 text-sm transition',
                    previewMode === mode ? 'bg-white/[0.1] text-white' : 'text-slate-400 hover:text-white',
                  )}
                >
                  {mode === 'internal' ? 'Внутренний' : mode === 'client' ? 'Для клиента' : 'Печать'}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="space-y-2 xl:col-span-2">
              <span className="text-sm text-slate-300">Название маршрута (RU)</span>
              <input value={titleRu} onChange={(event) => setTitleRu(event.target.value)} className={inputClass} />
            </label>
            <label className="space-y-2 xl:col-span-2">
              <span className="text-sm text-slate-300">Название (EN, источник slug)</span>
              <input value={titleEn} onChange={(event) => setTitleEn(event.target.value)} className={inputClass} />
            </label>
            <label className="space-y-2">
              <span className="text-sm text-slate-300">Дней</span>
              <input value={dayCount} onChange={(event) => setDayCount(event.target.value)} className={inputClass} inputMode="numeric" />
              <span className="block text-xs text-slate-500">Slug обновляется сразу. Нажмите «Генерировать» чтобы применить новую структуру дней.</span>
            </label>
          </div>


        </article>
      </section>

      {/* ── Route matrix table ── */}
      <section className={cn(panelClass, 'overflow-hidden')}>
        <div className="border-b border-white/10 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Матрица маршрута</div>
          <h2 className="mt-1 text-base font-semibold text-white">Обзор всего маршрута перед детальной правкой</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-white/[0.03] text-left text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">День</th>
                <th className="px-4 py-3 font-medium">Тип</th>
                <th className="px-4 py-3 font-medium">Старт</th>
                <th className="px-4 py-3 font-medium">Ночёвка</th>
                <th className="px-4 py-3 font-medium">Блоки</th>
                <th className="px-4 py-3 font-medium">Статус</th>
                <th className="px-4 py-3 font-medium">Регионы</th>
              </tr>
            </thead>
            <tbody>
              {route.days.map((day) => (
                <tr
                  key={`row-${day.id}`}
                  onClick={() => {
                    setSelectedDayId(day.id)
                    document.getElementById(`day-card-${day.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                  className={cn(
                    'cursor-pointer border-t border-white/8 text-slate-200 transition hover:bg-white/[0.03]',
                    selectedDay?.id === day.id ? 'bg-sky-400/8' : '',
                  )}
                >
                  <td className="px-4 py-3 font-medium text-white">День {day.dayNumber}</td>
                  <td className="px-4 py-3">{dayTypeLabel[day.dayType]}</td>
                  <td className="px-4 py-3">{day.startLocation || '—'}</td>
                  <td className="px-4 py-3">{day.overnightCity || '—'}</td>
                  <td className="px-4 py-3">{day.items.length}</td>
                  <td className="px-4 py-3">{day.displayStatus}</td>
                  <td className="px-4 py-3">{day.derivedRegions.length > 0 ? day.derivedRegions.join(', ') : 'Определится позже'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Full-width day cards ── */}
      <section className="space-y-4">
        {route.days.map((day) => (
          <div key={day.id} id={`day-card-${day.id}`}>
            <DayCard
              day={day}
              isSelected={selectedDay?.id === day.id}
              onSelect={setSelectedDayId}
              onAddPoi={handleAddPoiToDay}
              onAddTransport={handleAddTransport}
              onAddDayBlock={handleAddDayBlock}
              onMoveDayItem={handleMoveDayItem}
              onDeleteItem={handleDeleteDayItem}
              onUpdateField={handleUpdateDayField}
              onUpdateDayType={handleUpdateDayType}
            />
          </div>
        ))}
      </section>

      {/* ── Floating Save button — mobile only ── */}
      <div className="fixed bottom-6 left-0 right-0 flex justify-center z-50 md:hidden px-4">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saveState === 'saving'}
          className="flex items-center gap-2 rounded-2xl bg-sky-600 hover:bg-sky-500 active:bg-sky-700 disabled:opacity-50 px-8 py-4 text-sm font-semibold text-white shadow-2xl shadow-sky-900/50 transition-all"
        >
          {saveState === 'saving' ? (
            <>
              <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Сохраняю...
            </>
          ) : saveState === 'saved' ? (
            <>✓ Сохранено</>
          ) : saveState === 'error' ? (
            <>✗ Ошибка</>
          ) : (
            <>
              <Save className="size-4" />
              Сохранить маршрут
            </>
          )}
        </button>
      </div>
    </AdminShell>
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
