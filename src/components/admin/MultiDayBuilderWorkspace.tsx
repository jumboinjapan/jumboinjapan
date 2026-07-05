'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, BedDouble, BookOpen, Bus, Footprints, Plane, Plus, Printer, RefreshCw, Save, Sparkles, X } from 'lucide-react'

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
import { adminInputClass, adminPanelClass } from '@/components/admin/ui'

const panelClass = adminPanelClass

const inputClass = adminInputClass

const dayTypeTone: Record<MultiDayBuilderDay['dayType'], string> = {
  arrival: 'border-[var(--adm-accent-border)] bg-[var(--adm-accent-bg)] text-[var(--adm-on-accent)]',
  touring: 'border-[var(--adm-border)] bg-[var(--adm-hover)] text-[var(--adm-text)]',
  departure: 'border-[var(--adm-warn-border)] bg-[var(--adm-warn-bg)] text-[var(--adm-warn-text)]',
  independent: 'border-[var(--adm-warn-border)] bg-[var(--adm-warn-bg)] text-[var(--adm-warn-text)]',
}

const dayTypeLabel: Record<MultiDayBuilderDay['dayType'], string> = {
  arrival: 'прилёт',
  touring: 'экскурсия',
  departure: 'отлёт',
  independent: 'самостоятельно',
}

const routeStatusLabel: Record<MultiDayBuilderRoute['status'], string> = {
  Draft: 'Черновик',
  Review: 'На проверке',
  Published: 'Опубликован',
  Archived: 'В архиве',
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
        const res = await fetch('/api/admin/airtable/day-blocks', { cache: 'no-store' })
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
        isSelected ? 'ring-1 ring-[var(--adm-accent-border)] bg-[var(--adm-active)]' : '',
      )}
      onClick={() => onSelect(day.id)}
    >
      {/* Zone 1 — Day header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--adm-border)] px-5 py-4">
        {/* Left: badge + type selector + status */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-mono text-xs tracking-widest rounded bg-[var(--adm-hover)] px-2 py-0.5 text-[var(--adm-text-3)]">
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
          <span className="text-xs text-[var(--adm-ok-text)]">{day.displayStatus}</span>
        </div>

        {/* Center: title + summary */}
        <div className="flex-1 min-w-[200px]">
          <h3 className="text-base font-semibold text-[var(--adm-text)] leading-tight">{day.dayTitle}</h3>
          <p className="mt-0.5 text-sm text-[var(--adm-text-3)] leading-snug">{day.daySummary}</p>
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
            icon={day.dayType === 'arrival' || day.dayType === 'departure' ? <Plane className="size-3.5 shrink-0 text-[var(--adm-text-3)]" /> : <Footprints className="size-3.5 shrink-0 text-[var(--adm-text-3)]" />}
          />
          <span className="text-[var(--adm-text)]/20 text-xs select-none">────</span>
          <CityAutocomplete
            value={day.overnightCity}
            onChange={(v) => onUpdateField(day.id, 'overnightCity', v)}
            placeholder="Ночёвка"
            icon={<BedDouble className="size-3.5 shrink-0 text-[var(--adm-text-3)]" />}
          />
        </div>
      </div>

      {/* Zone 2 — Items list */}
      <div className="space-y-2 px-5 py-4">
        {day.items.length === 0 ? (
          <div className="py-4 text-center text-sm text-[var(--adm-text-3)]">Нет блоков — добавьте POI или транспорт ниже.</div>
        ) : (
          day.items.map((item, itemIndex) => (
            <div
              key={item.id}
              className={cn(
                'group flex items-start gap-3 rounded-xl border p-4 transition-colors',
                item.itemType === 'day_block'
                  ? 'border-amber-400/20 bg-[var(--adm-warn-text)]/8 hover:border-[var(--adm-warn-border)]'
                  : 'border-[var(--adm-border)] bg-[var(--adm-hover)] hover:border-[var(--adm-border-strong)]',
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Order badge */}
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--adm-hover)] font-mono text-[10px] text-[var(--adm-text-3)]">
                {item.order}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className={cn('font-medium text-sm', item.itemType === 'day_block' ? 'text-[var(--adm-warn-text)]' : 'text-[var(--adm-text)]')}>{item.displayTitle}</div>
                <div className="text-[10px] uppercase tracking-widest text-[var(--adm-text-3)] mt-0.5">
                  {item.itemType} · {item.sourceMode}
                </div>
                {item.shortDescription && (
                  <p className="mt-1.5 text-sm text-[var(--adm-text-2)] leading-snug">{item.shortDescription}</p>
                )}
                {item.internalNotes && (
                  <div className="mt-1 text-xs text-[var(--adm-warn-text)]/70 italic">Заметка: {item.internalNotes}</div>
                )}
              </div>

              {/* Controls */}
              <div className="flex shrink-0 items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => onMoveDayItem(day.id, item.id, 'up')}
                  disabled={itemIndex === 0}
                  className="rounded p-1.5 text-[var(--adm-text-3)] hover:bg-[var(--adm-active)] hover:text-[var(--adm-text)] disabled:opacity-30"
                  aria-label="Вверх"
                >
                  <ArrowUp className="size-3" />
                </button>
                <button
                  onClick={() => onMoveDayItem(day.id, item.id, 'down')}
                  disabled={itemIndex === day.items.length - 1}
                  className="rounded p-1.5 text-[var(--adm-text-3)] hover:bg-[var(--adm-active)] hover:text-[var(--adm-text)] disabled:opacity-30"
                  aria-label="Вниз"
                >
                  <ArrowDown className="size-3" />
                </button>
                <button
                  onClick={() => onDeleteItem(day.id, item.id)}
                  className="rounded p-1.5 text-[var(--adm-text-3)] hover:bg-[var(--adm-danger-bg)] hover:text-[var(--adm-danger-text)]"
                  aria-label="Удалить"
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
        className="border-t border-[var(--adm-border)] px-5 py-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          {/* POI search */}
          <div className="relative flex-1">
            <input
              value={localPoiQuery}
              onChange={(e) => setLocalPoiQuery(e.target.value)}
              placeholder="Поиск POI для этого дня…"
              className="w-full rounded-xl border border-[var(--adm-border)] bg-[var(--adm-hover)] px-3 py-2 text-sm text-[var(--adm-text)] outline-none transition focus:border-[var(--adm-accent-border)] placeholder:text-[var(--adm-text-3)]"
            />
            {localPoiLoading && (
              <div className="absolute right-3 top-2.5 text-xs text-[var(--adm-text-3)]">…</div>
            )}
            {localPoiResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-52 overflow-auto rounded-xl border border-[var(--adm-border)] bg-[var(--adm-popover)] shadow-xl">
                {localPoiResults.map((poi) => (
                  <button
                    key={poi.poiId}
                    onClick={() => handlePoiSelect(poi)}
                    className="w-full px-3 py-2.5 text-left text-sm hover:bg-[var(--adm-active)] transition-colors border-b border-[var(--adm-border)] last:border-0"
                  >
                    <div className="font-medium text-[var(--adm-text)]">{poi.nameRu || poi.poiId}</div>
                    <div className="text-xs text-[var(--adm-text-3)]">{poi.siteCity}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Transport picker button */}
          <div className="relative shrink-0">
            <button
              onClick={handleOpenTransportPicker}
              className="inline-flex min-h-9 items-center rounded-xl border border-[var(--adm-border)] bg-[var(--adm-hover)] px-4 text-sm text-[var(--adm-text-2)] transition hover:border-[var(--adm-warn-border)] hover:bg-[var(--adm-active)] hover:text-[var(--adm-text)]"
            >
              <Bus className="mr-1.5 size-3.5" />
              Транспорт
            </button>
            {showTransportPicker && (
              <div className="absolute left-0 top-full z-30 mt-1 min-w-48 overflow-auto rounded-xl border border-[var(--adm-border)] bg-[var(--adm-popover)] shadow-xl">
                <div className="flex items-center justify-between border-b border-[var(--adm-border)] px-3 py-2">
                  <span className="text-xs text-[var(--adm-text-3)]">Транспорт</span>
                  <button onClick={() => setShowTransportPicker(false)} className="text-[var(--adm-text-3)] hover:text-[var(--adm-text)]">
                    <X className="size-3.5" />
                  </button>
                </div>
                {dayBlocksLoading ? (
                  <div className="px-3 py-3 text-xs text-[var(--adm-text-3)]">Загрузка…</div>
                ) : dayBlocks.filter((b) => b.type === 'transfer').length === 0 ? (
                  <div className="px-3 py-3 text-xs text-[var(--adm-text-3)]">Нет вариантов</div>
                ) : (
                  dayBlocks
                    .filter((b) => b.type === 'transfer')
                    .map((block) => (
                      <button
                        key={block.id}
                        onClick={() => handleBlockSelect(block)}
                        className="flex w-full items-center gap-2 border-b border-[var(--adm-border)] px-3 py-2.5 text-left text-sm text-[var(--adm-text-2)] transition hover:bg-[var(--adm-active)] last:border-0"
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
              className="inline-flex min-h-9 items-center rounded-xl border border-amber-400/20 bg-[var(--adm-warn-text)]/8 px-4 text-sm text-[var(--adm-warn-text)] transition hover:border-[var(--adm-warn-border)] hover:bg-[var(--adm-warn-bg)] hover:text-[var(--adm-warn-text)]"
            >
              <Plus className="mr-1.5 size-3.5" />
              Добавить блок
            </button>
            {showBlockPicker && (
              <div className="absolute left-0 top-full z-30 mt-1 min-w-48 overflow-auto rounded-xl border border-[var(--adm-border)] bg-[var(--adm-popover)] shadow-xl">
                <div className="flex items-center justify-between border-b border-[var(--adm-border)] px-3 py-2">
                  <span className="text-xs text-[var(--adm-text-3)]">Блоки дня</span>
                  <button onClick={() => setShowBlockPicker(false)} className="text-[var(--adm-text-3)] hover:text-[var(--adm-text)]">
                    <X className="size-3.5" />
                  </button>
                </div>
                {dayBlocksLoading ? (
                  <div className="px-3 py-3 text-xs text-[var(--adm-text-3)]">Загрузка…</div>
                ) : dayBlocks.filter((b) => b.type !== 'transfer').length === 0 ? (
                  <div className="px-3 py-3 text-xs text-[var(--adm-text-3)]">Нет блоков</div>
                ) : (
                  dayBlocks
                    .filter((b) => b.type !== 'transfer')
                    .map((block) => (
                      <button
                        key={block.id}
                        onClick={() => handleBlockSelect(block)}
                        className="flex w-full items-center gap-2 border-b border-[var(--adm-border)] px-3 py-2.5 text-left text-sm text-[var(--adm-text-2)] transition hover:bg-[var(--adm-active)] last:border-0"
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

export interface BuilderClientContext {
  /** Airtable record id prospect'а, к которому привязываются сохранённые маршруты. */
  recordId: string
  /** Имя клиента для баннера. */
  name: string
}

export function MultiDayBuilderWorkspace({
  clientContext = null,
  initialRouteSlug = null,
}: {
  /** Клиентский контекст из client workshop (?client=): сохранённый маршрут привязывается к карточке. */
  clientContext?: BuilderClientContext | null
  /** Маршрут для автозагрузки (?route=): открытие привязанного маршрута из карточки клиента. */
  initialRouteSlug?: string | null
} = {}) {
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
        // ?route= из карточки клиента имеет приоритет над «продолжить с того же места».
        if (initialRouteSlug) {
          void handleLoadSavedRoute(initialRouteSlug).catch((error) => {
            console.error(error)
            if (alive) setRouteLoadMessage(`Маршрут «${initialRouteSlug}» не найден среди сохранённых.`)
          })
          return
        }
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
    // Intentionally mount-only: checks once whether a saved route matches the
    // initial slug. Adding refreshSavedRoutes/route.slug would re-run this on
    // every keystroke that changes the title (slug is title-derived).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load last saved route from localStorage on mount (Bug 1 fix)
  useEffect(() => {
    if (initialRouteSlug) return // явный ?route= важнее последнего открытого
    const lastSlug = localStorage.getItem('multiday-last-slug')
    if (lastSlug) {
      void handleLoadSavedRoute(lastSlug, { silent: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // only on mount

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
    // Intentionally excludes route.startCity(Id)/endCity(Id): this effect only
    // regenerates title/slug from the title fields + day count. City changes
    // are applied by the reconcileMultiDayRoute effect below (liveDayCount) and
    // by direct route updates elsewhere; re-running here on every city edit
    // would fight those updates and reset the title-derived slug mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleRu, titleEn, liveDayCount])

  // Auto-apply day count changes immediately without requiring Save
  const prevDayCountRef = useRef(liveDayCount)
  useEffect(() => {
    if (prevDayCountRef.current === liveDayCount) return
    prevDayCountRef.current = liveDayCount
    const next = reconcileMultiDayRoute(route, {
      titleRu,
      titleEn,
      dayCount: liveDayCount,
      startCityId: route.startCityId,
      startCityLabel: route.startCity,
      endCityId: route.endCityId,
      endCityLabel: route.endCity,
    })
    setRoute(next)
    setSelectedDayId((current) => (next.days.some((day) => day.id === current) ? current : next.days[0]?.id ?? ''))
    // Intentionally keyed on liveDayCount only (guarded by prevDayCountRef):
    // this effect's whole purpose is "re-run only when day count changes".
    // Adding route/titleRu/titleEn would break the guard and reconcile on
    // every unrelated edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveDayCount])

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
      if (nextRoute.slug) {
        localStorage.setItem('multiday-last-slug', nextRoute.slug)
      }

      // Клиентский контекст: сохранённый маршрут привязывается к карточке
      // клиента (Linked Routes) без ручного копирования slug.
      let clientLinkNote = ''
      if (clientContext && nextRoute.slug) {
        try {
          const linkResponse = await fetch(`/api/admin/clients/${clientContext.recordId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appendLinkedRoute: `multi-day/${nextRoute.slug}` }),
          })
          clientLinkNote = linkResponse.ok
            ? ` · привязан к клиенту ${clientContext.name}`
            : ' · не удалось привязать к клиенту — привяжите slug из карточки'
        } catch {
          clientLinkNote = ' · не удалось привязать к клиенту — привяжите slug из карточки'
        }
      }

      setSaveState('saved')
      setSaveMessage(
        (liveDayCount !== route.days.length
          ? `Структура применена, сохранено в ${new Date(data.savedAt || Date.now()).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
          : `Сохранено в ${new Date(data.savedAt || Date.now()).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`) +
          clientLinkNote,
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
          displayTitle: poi.nameRu || poi.poiId,
          displayTitleEn: poi.nameEn || poi.poiId,
          shortDescription: '',
          shortDescriptionEn: '',
          sourceMode: 'manual' as const,
          locked: false,
          poiTitle: poi.nameRu || poi.poiId,
          transportSegmentId: null,
          internalNotes: `POI ID: ${poi.poiId}`,
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
          displayTitle: `${block.icon} ${block.nameRu}`, // RU-only (blocks are RU-defined)
          displayTitleEn: block.nameEn ? `${block.icon} ${block.nameEn}` : '',
          shortDescription: '',
          shortDescriptionEn: '',
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
          displayTitleEn: 'Transport',
          shortDescription: '',
          shortDescriptionEn: '',
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

  function handleUpdateRouteStatus(status: MultiDayBuilderRoute['status']) {
    setRoute((prev) => ({ ...prev, status }))
  }

  const RouteActions = () => (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={selectedSavedSlug}
        onChange={(event) => setSelectedSavedSlug(event.target.value)}
        disabled={savedRoutesLoading}
        className="h-9 w-64 rounded-lg border border-[var(--adm-border)] bg-[var(--adm-active)] px-3 text-sm text-[var(--adm-text)] outline-none transition focus:border-[var(--adm-accent-border)] disabled:opacity-50 cursor-pointer"
      >
        <option value="">{savedRoutesLoading ? 'Загрузка…' : 'Выбрать маршрут…'}</option>
        {savedRoutes.map((savedRoute) => (
          <option key={savedRoute.slug} value={savedRoute.slug}>
            {savedRoute.title} · {savedRoute.dayCount}д · {routeStatusLabel[savedRoute.status]}
          </option>
        ))}
      </select>

      <button
        onClick={() => void handleLoadSavedRoute(selectedSavedSlug).catch(console.error)}
        disabled={!selectedSavedSlug || savedRoutesLoading}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--adm-border)] bg-[var(--adm-hover)] px-4 text-sm text-[var(--adm-text-2)] transition hover:border-[var(--adm-border-strong)] hover:bg-[var(--adm-active)] hover:text-[var(--adm-text)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <BookOpen className="size-3.5" />
        Открыть
      </button>

      <button
        type="button"
        onClick={handleGenerate}
        className="inline-flex size-9 items-center justify-center rounded-full bg-[var(--adm-accent)] text-[var(--adm-on-accent)] transition hover:bg-[var(--adm-accent-hover)]"
        title="Генерировать"
      >
        <Sparkles className="size-4" />
      </button>

      {route.status === 'Published' && route.slug && (
        <a
          href={`/${route.slug}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center rounded-full border border-[var(--adm-border)] bg-[var(--adm-hover)] px-3 text-sm text-[var(--adm-text-2)] transition hover:border-[var(--adm-border-strong)] hover:text-[var(--adm-text)]"
          title="Открыть опубликованную страницу маршрута"
        >
          На сайте ↗
        </a>
      )}

      <select
        value={route.status}
        onChange={(event) => handleUpdateRouteStatus(event.target.value as MultiDayBuilderRoute['status'])}
        title="Публикация: только «Опубликован» показывается на сайте, на /multi-day/[slug]"
        className={cn(
          'h-9 rounded-lg border px-3 text-sm outline-none transition cursor-pointer',
          route.status === 'Published'
            ? 'border-[var(--adm-ok-border)] bg-[var(--adm-ok-bg)] text-[var(--adm-ok-text)]'
            : 'border-[var(--adm-border)] bg-[var(--adm-active)] text-[var(--adm-text-2)]',
        )}
      >
        {(['Draft', 'Review', 'Published', 'Archived'] as const).map((status) => (
          <option key={status} value={status}>
            {routeStatusLabel[status]}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={handleSave}
        disabled={saveState === 'saving'}
        className={cn(
          'inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium transition',
          saveState === 'saving'
            ? 'cursor-wait bg-[var(--adm-accent)] text-[var(--adm-on-accent)]'
            : 'bg-[var(--adm-accent)] text-[var(--adm-on-accent)] hover:bg-[var(--adm-accent-hover)]',
        )}
      >
        <Save className="size-4" />
        Сохранить
      </button>

      <button
        type="button"
        onClick={handleCreateNewRoute}
        className="inline-flex size-9 items-center justify-center rounded-full border border-[var(--adm-border)] bg-[var(--adm-hover)] text-[var(--adm-text-2)] transition hover:border-[var(--adm-border-strong)] hover:bg-[var(--adm-active)] hover:text-[var(--adm-text)]"
        title="Новый"
      >
        <Plus className="size-4" />
      </button>

      <button
        type="button"
        disabled
        className="inline-flex size-9 items-center justify-center rounded-full border border-[var(--adm-border)] bg-[var(--adm-hover)] text-[var(--adm-text-3)] opacity-30"
        title="PDF"
      >
        <Printer className="size-4" />
      </button>

      {(saveMessage || routeLoadMessage) && (
        <span className={cn(
          'ml-3 text-xs',
          saveState === 'saved' ? 'text-[var(--adm-ok-text)]' : saveState === 'error' ? 'text-[var(--adm-danger-text)]' : 'text-[var(--adm-text-3)]',
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
      {/* ── Клиентский контекст из client workshop ── */}
      {clientContext && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--adm-accent-border)] bg-[var(--adm-accent-bg)] px-4 py-3">
          <span className="text-sm text-[var(--adm-accent-text)]">
            Маршрут собирается для клиента <span className="font-medium text-[var(--adm-text)]">{clientContext.name}</span> —
            после сохранения он привяжется к карточке.
          </span>
          <a
            href={`/admin/clients/${clientContext.recordId}`}
            className="shrink-0 text-sm text-[var(--adm-accent-text)] transition hover:text-[var(--adm-accent-text)]"
          >
            ← Вернуться в карточку
          </a>
        </div>
      )}

      {/* ── Builder inputs + route state ── */}
      <section>
        <article className={cn(panelClass, 'p-4 md:p-5')}>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--adm-text-3)]">Параметры маршрута</div>
              <h2 className="text-base font-semibold text-[var(--adm-text)]">Сначала сгенерируйте скелет маршрута</h2>

            </div>

            <div className="inline-flex items-center rounded-full border border-[var(--adm-border)] bg-[var(--adm-hover)] p-1">
              {(['internal', 'client', 'print'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPreviewMode(mode)}
                  className={cn(
                    'inline-flex h-7 items-center rounded-full px-3 text-sm transition',
                    previewMode === mode ? 'bg-[var(--adm-active)] text-[var(--adm-text)]' : 'text-[var(--adm-text-3)] hover:text-[var(--adm-text)]',
                  )}
                >
                  {mode === 'internal' ? 'Внутренний' : mode === 'client' ? 'Для клиента' : 'Печать'}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="space-y-2 xl:col-span-2">
              <span className="text-sm text-[var(--adm-text-2)]">Название маршрута (RU)</span>
              <input value={titleRu} onChange={(event) => setTitleRu(event.target.value)} className={inputClass} />
            </label>
            <label className="space-y-2 xl:col-span-2">
              <span className="text-sm text-[var(--adm-text-2)]">Название (EN, источник slug)</span>
              <input value={titleEn} onChange={(event) => setTitleEn(event.target.value)} className={inputClass} />
            </label>
            <label className="space-y-2">
              <span className="text-sm text-[var(--adm-text-2)]">Дней</span>
              <input value={dayCount} onChange={(event) => setDayCount(event.target.value)} className={inputClass} inputMode="numeric" />
              <span className="block text-xs text-[var(--adm-text-3)]">Slug обновляется сразу. Нажмите «Генерировать» чтобы применить новую структуру дней.</span>
            </label>
          </div>


        </article>
      </section>

      {/* ── Route matrix table ── */}
      <section className={cn(panelClass, 'overflow-hidden')}>
        <div className="border-b border-[var(--adm-border)] px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--adm-text-3)]">Матрица маршрута</div>
          <h2 className="mt-1 text-base font-semibold text-[var(--adm-text)]">Обзор всего маршрута перед детальной правкой</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--adm-hover)] text-left text-[var(--adm-text-3)]">
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
                    'cursor-pointer border-t border-[var(--adm-border)] text-[var(--adm-text-2)] transition hover:bg-[var(--adm-hover)]',
                    selectedDay?.id === day.id ? 'bg-[var(--adm-accent-bg)]' : '',
                  )}
                >
                  <td className="px-4 py-3 font-medium text-[var(--adm-text)]">День {day.dayNumber}</td>
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

      {/* ── Floating Save + Refresh buttons — mobile only ── */}
      <div className="fixed bottom-6 left-0 right-0 flex justify-center z-50 md:hidden px-4 gap-3">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="flex items-center justify-center size-14 rounded-2xl bg-[var(--adm-active)] hover:bg-[var(--adm-border-strong)] active:bg-[var(--adm-active)] text-[var(--adm-text)] shadow-2xl  transition-all"
          aria-label="Обновить страницу"
        >
          <RefreshCw className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saveState === 'saving'}
          className="flex items-center gap-2 rounded-2xl bg-[var(--adm-accent)] hover:bg-[var(--adm-accent-hover)] active:bg-[var(--adm-accent)] disabled:opacity-50 px-8 py-4 text-sm font-semibold text-[var(--adm-on-accent)] shadow-2xl transition-all"
        >
          {saveState === 'saving' ? (
            <>
              <span className="size-4 animate-spin rounded-full border-2 border-[var(--adm-border-strong)] border-t-white" />
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
