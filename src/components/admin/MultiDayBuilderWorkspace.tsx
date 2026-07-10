'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, BedDouble, BookOpen, ChevronDown, Footprints, Lock, LockOpen, MoreHorizontal, Plane, Plus, Printer, RefreshCw, Save, Search, Sparkles, X } from 'lucide-react'

import { AdminShell } from '@/components/admin/AdminShell'
import { CityAutocomplete } from '@/components/admin/CityAutocomplete'
import { TouristProfilePanel } from '@/components/admin/TouristProfilePanel'
import { getAirportLabel, getAirportLabelEn, isKnownAirportCode, JAPAN_INTERNATIONAL_AIRPORTS } from '@/lib/airports'
import type { MultiDayBuilderHotelOption, MultiDayBuilderPoiOption } from '@/lib/multi-day-builder-data'
import type { SavedMultiDayRouteSummary } from '@/lib/multi-day-builder-storage'
import type { TouristProfilePayload } from '@/lib/tourist-profile'
import {
  buildMultiDaySkeleton,
  reconcileMultiDayRoute,
  type MultiDayBuilderDay,
  type MultiDayBuilderRoute,
} from '@/lib/multi-day-builder'
import { cn } from '@/lib/utils'
import { adminInputClass, adminPanelClass, adminSecondaryButtonClass } from '@/components/admin/ui'

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

// Русские подписи вместо машинных значений: itemType/sourceMode/displayStatus —
// служебные поля базы, владельцу они нужны по-русски и без дев-жаргона.
const ITEM_TYPE_LABELS: Record<string, string> = {
  poi: 'точка',
  transport: 'транспорт',
  hotel: 'отель',
  meal: 'еда',
  note: 'заметка',
  arrival: 'прилёт',
  departure: 'вылет',
  day_block: 'служебный блок',
}

const DAY_STATUS_LABELS: Record<string, string> = {
  Generated: 'сгенерирован',
  Edited: 'изменён',
  Locked: 'заперт',
}

// Старые сгенерированные описания склеивали три разных действия (прилёт +
// трансфер + заселение) в один блок. Владелец: это разные действия, у групп
// они настраиваются по-разному (после прилёта может быть экскурсия,
// самостоятельный или заказной трансфер). Точные совпадения с этими
// заготовками вычищаются при синхронизации; свои тексты не трогаются.
const LEGACY_BUNDLED_DESCRIPTIONS = new Set([
  'Трансфер из аэропорта, заселение в отель и отдых после перелёта.',
  'Airport transfer, hotel check-in and rest after the flight.',
  'Трансфер в аэропорт и вылет.',
  'Airport transfer and departure.',
  'Прибытие, трансфер и мягкий старт поездки.',
  'Вылет/отъезд и финальная логистика.',
])

// Служебные POI аэропортовых трансферов: их заголовки тоже подтягивают
// имя аэропорта дня («Трансфер в аэропорт Нарита»). Определяем по POI ID
// из internalNotes — он переживает сохранение в Airtable (Day Items.POI ID).
const AIRPORT_TRANSFER_TITLES: Record<string, { ru: string; en: string }> = {
  'POI-000438': { ru: 'Трансфер в аэропорт', en: 'Transfer to' },
  'POI-000440': { ru: 'Самостоятельный трансфер в аэропорт', en: 'Self-guided transfer to' },
}

// Заголовки пунктов «прилёт»/«вылет» — переменные от аэропорта дня
// (прилёт: startLocation, вылет: endLocation; IATA-код), а не
// зафиксированный текст: «Прибытие в аэропорт Нарита» / «Вылет из
// аэропорта Нарита». Синхронизируется при каждой загрузке маршрута и при
// смене аэропорта, независимо от sourceMode — владелец считает заголовок
// производным от аэропорта, а не самостоятельным полем.
function syncFlightItemTitles(route: MultiDayBuilderRoute): MultiDayBuilderRoute {
  let changed = false
  const days = route.days.map((day) => {
    const isDeparture = day.dayType === 'departure'
    const airportCode = isDeparture ? day.endLocation : day.startLocation
    if (!airportCode || !isKnownAirportCode(airportCode)) return day
    const targetType = isDeparture ? ('departure' as const) : ('arrival' as const)
    const displayTitle = isDeparture
      ? `Вылет из аэропорта ${getAirportLabel(airportCode)}`
      : `Прибытие в аэропорт ${getAirportLabel(airportCode)}`
    const displayTitleEn = isDeparture
      ? `Departure from ${getAirportLabelEn(airportCode)} Airport`
      : `Arrival at ${getAirportLabelEn(airportCode)} Airport`
    let dayChanged = false
    let items = day.items.map((item) => {
      if (item.itemType === targetType) {
        // Заодно вычищаем старое склеенное описание («трансфер + заселение +
        // отдых») — блок прилёта/вылета описывает только сам прилёт/вылет.
        const shortDescription = LEGACY_BUNDLED_DESCRIPTIONS.has(item.shortDescription.trim()) ? '' : item.shortDescription
        const shortDescriptionEn = LEGACY_BUNDLED_DESCRIPTIONS.has(item.shortDescriptionEn.trim()) ? '' : item.shortDescriptionEn
        if (
          item.displayTitle === displayTitle &&
          item.displayTitleEn === displayTitleEn &&
          item.shortDescription === shortDescription &&
          item.shortDescriptionEn === shortDescriptionEn
        )
          return item
        dayChanged = true
        return { ...item, displayTitle, displayTitleEn, shortDescription, shortDescriptionEn }
      }
      // Аэропортовые трансферы («Трансфер в аэропорт», «Самостоятельный
      // трансфер в аэропорт») подтягивают имя аэропорта дня в конец записи.
      const poiId = item.internalNotes?.match(/POI-\d{6}/)?.[0]
      const transfer = poiId ? AIRPORT_TRANSFER_TITLES[poiId] : undefined
      if (transfer) {
        const transferTitle = `${transfer.ru} ${getAirportLabel(airportCode)}`
        const transferTitleEn = `${transfer.en} ${getAirportLabelEn(airportCode)} Airport`
        if (item.displayTitle === transferTitle && item.displayTitleEn === transferTitleEn) return item
        dayChanged = true
        return { ...item, displayTitle: transferTitle, displayTitleEn: transferTitleEn }
      }
      return item
    })
    // Самовосстановление: у дня прилёта/вылета с выбранным аэропортом
    // профильный пункт обязателен. Если его удалили — пересоздаём (прилёт
    // первым в списке, вылет последним): вернуть его из UI иначе
    // невозможно — «Добавить блок» создаёт только обычные POI-блоки.
    if ((day.dayType === 'arrival' || day.dayType === 'departure') && !items.some((item) => item.itemType === targetType)) {
      const restored = {
        id: `item-${day.id}-${targetType}-${Math.random().toString(36).slice(2, 8)}`,
        order: 0,
        itemType: targetType,
        displayTitle,
        displayTitleEn,
        // Только сам прилёт/вылет: трансфер и заселение — отдельные блоки
        shortDescription: '',
        shortDescriptionEn: '',
        sourceMode: 'generated' as const,
        locked: false,
        poiTitle: '',
        transportSegmentId: null,
        internalNotes: '',
      }
      items = normalizeDayItems(isDeparture ? [...items, restored] : [restored, ...items])
      dayChanged = true
    }
    if (!dayChanged) return day
    changed = true
    return { ...day, items }
  })
  return changed ? { ...route, days } : route
}

// Физические даты дней: день N = startDate + (N-1). Данные, а не текст в
// заголовках — при сдвиге начала тура все даты пересчитываются сами.
// Вся арифметика в чистом UTC: локальная полночь + toISOString() в
// поясах восточнее UTC (Япония +9) сдвигала дату на день назад
// («17 окт» при выбранном 18-м).
function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function formatDayDate(startDate: string, dayNumber: number): string {
  if (!startDate) return ''
  const iso = addDaysIso(startDate, dayNumber - 1)
  if (!iso) return ''
  return new Date(`${iso}T00:00:00Z`)
    .toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .replace(/\./g, '')
}

// Датные префиксы, вбитые руками в заголовки дней до появления дат-данных
// («19 окт — Прибытие в Токио»), при генерации/сохранении синхронизируются
// с вычисленной датой дня: устаревшая дата заменяется на актуальную, чтобы
// сдвиг «Начала тура» не оставлял в заголовках старое расписание.
const DAY_TITLE_DATE_PREFIX =
  /^\s*\d{1,2}\s+(янв|фев|мар|апр|мая|май|июн|июл|авг|сен|окт|ноя|дек)[а-яё]*\.?\s*[—–-]\s*/i

function syncDayTitleDates(route: MultiDayBuilderRoute): MultiDayBuilderRoute {
  if (!route.startDate) return route
  let changed = false
  const days = route.days.map((day) => {
    if (!DAY_TITLE_DATE_PREFIX.test(day.dayTitle)) return day
    const actual = formatDayDate(route.startDate, day.dayNumber)
    const nextTitle = day.dayTitle.replace(DAY_TITLE_DATE_PREFIX, actual ? `${actual} — ` : '')
    if (nextTitle === day.dayTitle) return day
    changed = true
    return { ...day, dayTitle: nextTitle }
  })
  return changed ? { ...route, days } : route
}

// Селектор аэропорта (IATA), сгруппированный по регионам — общий для дня
// прилёта (startLocation) и дня вылета (endLocation).
function AirportSelect({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (code: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-[var(--adm-border)] bg-[var(--adm-hover)] px-2 py-1.5 text-xs text-[var(--adm-text)] outline-none focus:border-[var(--adm-accent-border)]"
    >
      <option value="">{placeholder}</option>
      {Object.entries(
        JAPAN_INTERNATIONAL_AIRPORTS.reduce<Record<string, typeof JAPAN_INTERNATIONAL_AIRPORTS>>((groups, airport) => {
          ;(groups[airport.regionRu] ??= []).push(airport)
          return groups
        }, {}),
      ).map(([regionRu, airports]) => (
        <optgroup key={regionRu} label={regionRu}>
          {airports.map((airport) => (
            <option key={airport.code} value={airport.code}>
              {airport.code} — {airport.nameRu}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

function applyLoadedRouteState(
  nextRoute: MultiDayBuilderRoute,
  setTitleRu: (value: string) => void,
  setTitleEn: (value: string) => void,
  setDayCount: (value: string) => void,
  setRoute: (value: MultiDayBuilderRoute) => void,
  setSelectedDayId: (value: string) => void,
) {
  const synced = syncFlightItemTitles(nextRoute)
  setTitleRu(synced.title)
  setTitleEn(synced.titleEn)
  setDayCount(String(synced.dayCount))
  setRoute(synced)
  setSelectedDayId(synced.days[0]?.id ?? '')
}

// ─── Черновик несохранённых правок (переживает перезагрузку страницы) ──────
// Ключ на slug: правки каждого маршрута кэшируются отдельно. Черновик
// пишется дебаунсом при любом изменении и стирается, когда состояние
// совпадает с серверной версией (после загрузки/сохранения).

interface UnsavedBuilderDraft {
  titleRu: string
  titleEn: string
  dayCount: string
  route: MultiDayBuilderRoute
  savedAt: number
}

function unsavedDraftKey(slug: string): string {
  return `multiday-unsaved:${slug}`
}

function serializeBuilderState(titleRu: string, titleEn: string, dayCount: string, route: MultiDayBuilderRoute): string {
  return JSON.stringify({ titleRu, titleEn, dayCount, route })
}

function readUnsavedDraft(slug: string): UnsavedBuilderDraft | null {
  try {
    const raw = localStorage.getItem(unsavedDraftKey(slug))
    if (!raw) return null
    const parsed = JSON.parse(raw) as UnsavedBuilderDraft
    if (!parsed || typeof parsed !== 'object' || !parsed.route || !Array.isArray(parsed.route.days)) return null
    return parsed
  } catch {
    return null
  }
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
  /** Вычисленная дата дня («19 окт») из startDate маршрута; '' если даты не заданы */
  dayDate: string
  isSelected: boolean
  onSelect: (dayId: string) => void
  onAddPoi: (dayId: string, poi: MultiDayBuilderPoiOption) => void
  onAddHotel: (dayId: string, hotel: MultiDayBuilderHotelOption) => void
  onAddTransport: (dayId: string) => void
  onAddDayBlock: (dayId: string, block: DayBlock) => void
  onMoveDayItem: (dayId: string, itemId: string, direction: 'up' | 'down') => void
  onDeleteItem: (dayId: string, itemId: string) => void
  onUpdateField: (dayId: string, field: 'overnightCity' | 'startLocation' | 'endLocation' | 'printLead' | 'printFooterNote' | 'arrivalFlightNumber' | 'departureFlightNumber', value: string) => void
  onUpdateDayType: (dayId: string, dayType: MultiDayBuilderDay['dayType']) => void
  onSelectArrivalAirport: (dayId: string, code: string) => void
  onSelectDepartureAirport: (dayId: string, code: string) => void
  /** Готовые дневные туры (Route Stops: city-tour/intercity) — макеты контента дня */
  dayTemplates: { slug: string; title: string; routeType: string }[]
  onApplyDayTemplate: (dayId: string, templateRouteSlug: string) => void
}

function DayCard({
  day,
  dayDate,
  isSelected,
  onSelect,
  onAddPoi,
  onAddHotel,
  onAddDayBlock,
  onMoveDayItem,
  onDeleteItem,
  onUpdateField,
  onUpdateDayType,
  onSelectArrivalAirport,
  onSelectDepartureAirport,
  dayTemplates,
  onApplyDayTemplate,
}: DayCardProps) {
  const [localPoiQuery, setLocalPoiQuery] = useState('')
  const [localPoiResults, setLocalPoiResults] = useState<MultiDayBuilderPoiOption[]>([])
  const [localPoiLoading, setLocalPoiLoading] = useState(false)
  const [localHotelQuery, setLocalHotelQuery] = useState('')
  const [localHotelResults, setLocalHotelResults] = useState<MultiDayBuilderHotelOption[]>([])
  const [localHotelLoading, setLocalHotelLoading] = useState(false)
  const [showBlockPicker, setShowBlockPicker] = useState(false)
  const [dayBlocks, setDayBlocks] = useState<DayBlock[]>([])
  const [dayBlocksLoading, setDayBlocksLoading] = useState(false)
  const [servicePois, setServicePois] = useState<MultiDayBuilderPoiOption[]>([])
  const [servicePoisLoading, setServicePoisLoading] = useState(false)

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

  // Отели: поиск только по существующим записям в базе (Resources,
  // Resource Type = hotel), включая владельческое решение — свободный ввод
  // здесь не допускается. Если отеля нет — ссылка на создание уводит в
  // /admin/resources (там же сразу заводится партнёрская ссылка Trip.com).
  useEffect(() => {
    let alive = true
    const query = localHotelQuery.trim()

    if (query.length < 1) {
      setLocalHotelResults([])
      setLocalHotelLoading(false)
      return () => {
        alive = false
      }
    }

    setLocalHotelLoading(true)
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/multi-day/hotels?query=${encodeURIComponent(query)}`, { cache: 'no-store' })
        const data = (await response.json()) as MultiDayBuilderHotelOption[] | { error?: string }
        if (alive) setLocalHotelResults(Array.isArray(data) ? data : [])
      } catch (error) {
        console.error(error)
        if (alive) setLocalHotelResults([])
      } finally {
        if (alive) setLocalHotelLoading(false)
      }
    }, 180)

    return () => {
      alive = false
      window.clearTimeout(timeout)
    }
  }, [localHotelQuery])

  function handleHotelSelect(hotel: MultiDayBuilderHotelOption) {
    onAddHotel(day.id, hotel)
    setLocalHotelQuery('')
    setLocalHotelResults([])
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

  // «Добавить блок» показывает весь набор служебных POI (Is System = true
  // в таблице POI — Свободное время, Заселение, трансферы и т.п.) сразу
  // списком, без набора текста — решение владельца. Выбор добавляет
  // обычный POI-элемент (handlePoiSelect), как и поиск выше.
  async function loadServicePoisIfNeeded() {
    if (servicePois.length === 0) {
      setServicePoisLoading(true)
      try {
        const res = await fetch('/api/admin/multi-day/pois/service', { cache: 'no-store' })
        const data = (await res.json()) as MultiDayBuilderPoiOption[] | { error?: string }
        if (res.ok && Array.isArray(data)) setServicePois(data)
      } catch (err) {
        console.error(err)
      } finally {
        setServicePoisLoading(false)
      }
    }
  }

  async function handleOpenBlockPicker() {
    setShowBlockPicker(true)
    await Promise.all([loadServicePoisIfNeeded(), loadDayBlocksIfNeeded()])
  }

  function handleBlockSelect(block: DayBlock) {
    onAddDayBlock(day.id, block)
    setShowBlockPicker(false)
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
          {/* Есть даты — в бейдже дата, номер дня уходит в подпись */}
          {dayDate ? (
            <>
              <div className="font-mono text-xs tabular-nums rounded bg-[var(--adm-hover)] px-2 py-0.5 font-medium text-[var(--adm-text)]">
                {dayDate}
              </div>
              <div className="text-xs text-[var(--adm-text-3)]">день {day.dayNumber}</div>
            </>
          ) : (
            <div className="font-mono text-xs tracking-widest rounded bg-[var(--adm-hover)] px-2 py-0.5 text-[var(--adm-text-3)]">
              ДЕНЬ {day.dayNumber}
            </div>
          )}
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
          {/* Готовый маршрут для дня: выбрал «Хаконэ» — день заполнился его
              стандартной программой (точки из Route Stops, заголовок дня). */}
          {dayTemplates.length > 0 && (
            <select
              value=""
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                e.stopPropagation()
                if (e.target.value) onApplyDayTemplate(day.id, e.target.value)
              }}
              className="max-w-40 cursor-pointer rounded-full border border-[var(--adm-border)] bg-transparent px-2.5 py-0.5 text-xs text-[var(--adm-text-2)] outline-none transition hover:border-[var(--adm-accent-border)] hover:text-[var(--adm-text)]"
              title="Заполнить день стандартной программой готового маршрута"
            >
              <option value="">маршрут…</option>
              <optgroup label="Городские">
                {dayTemplates
                  .filter((t) => t.slug.startsWith('city-tour/'))
                  .map((t) => (
                    <option key={t.slug} value={t.slug}>
                      {t.title}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Выездные">
                {dayTemplates
                  .filter((t) => t.slug.startsWith('intercity/'))
                  .map((t) => (
                    <option key={t.slug} value={t.slug}>
                      {t.title}
                    </option>
                  ))}
              </optgroup>
            </select>
          )}
          <span className="text-xs text-[var(--adm-ok-text)]">{DAY_STATUS_LABELS[day.displayStatus] ?? day.displayStatus}</span>
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
          {day.dayType === 'arrival' ? (
            <div className="flex items-center gap-1.5">
              <Plane className="size-3.5 shrink-0 text-[var(--adm-text-3)]" />
              <AirportSelect
                value={day.startLocation}
                placeholder="Аэропорт прилёта…"
                onChange={(code) => onSelectArrivalAirport(day.id, code)}
              />
              <input
                type="text"
                value={day.arrivalFlightNumber ?? ''}
                onChange={(e) => onUpdateField(day.id, 'arrivalFlightNumber', e.target.value)}
                placeholder="Рейс, напр. SU262"
                className="w-32 rounded-lg border border-[var(--adm-border)] bg-[var(--adm-hover)] px-2 py-1.5 text-xs text-[var(--adm-text)] outline-none focus:border-[var(--adm-accent-border)]"
              />
              {(day.arrivalFlightNumber ?? '').trim() !== '' && (
                <a
                  href={`https://www.google.com/search?q=${encodeURIComponent(`flight ${day.arrivalFlightNumber.trim()}`)}`}
                  target="_blank"
                  rel="noreferrer"
                  title={`Статус рейса ${day.arrivalFlightNumber.trim()} в Google`}
                  className="rounded p-1.5 text-[var(--adm-accent-text)] hover:bg-[var(--adm-active)]"
                >
                  <Search className="size-3.5" />
                </a>
              )}
            </div>
          ) : day.dayType === 'departure' ? (
            <>
              <CityAutocomplete
                value={day.startLocation}
                onChange={(v) => onUpdateField(day.id, 'startLocation', v)}
                placeholder="Старт"
                icon={<Footprints className="size-3.5 shrink-0 text-[var(--adm-text-3)]" />}
              />
              <div className="flex items-center gap-1.5">
                <Plane className="size-3.5 shrink-0 text-[var(--adm-text-3)]" />
                <AirportSelect
                  value={day.endLocation}
                  placeholder="Аэропорт вылета…"
                  onChange={(code) => onSelectDepartureAirport(day.id, code)}
                />
                <input
                  type="text"
                  value={day.departureFlightNumber ?? ''}
                  onChange={(e) => onUpdateField(day.id, 'departureFlightNumber', e.target.value)}
                  placeholder="Рейс, напр. SU263"
                  className="w-32 rounded-lg border border-[var(--adm-border)] bg-[var(--adm-hover)] px-2 py-1.5 text-xs text-[var(--adm-text)] outline-none focus:border-[var(--adm-accent-border)]"
                />
                {(day.departureFlightNumber ?? '').trim() !== '' && (
                  <a
                    href={`https://www.google.com/search?q=${encodeURIComponent(`flight ${day.departureFlightNumber.trim()}`)}`}
                    target="_blank"
                    rel="noreferrer"
                    title={`Статус рейса ${day.departureFlightNumber.trim()} в Google`}
                    className="rounded p-1.5 text-[var(--adm-accent-text)] hover:bg-[var(--adm-active)]"
                  >
                    <Search className="size-3.5" />
                  </a>
                )}
              </div>
            </>
          ) : (
            <CityAutocomplete
              value={day.startLocation}
              onChange={(v) => onUpdateField(day.id, 'startLocation', v)}
              placeholder="Старт"
              icon={<Footprints className="size-3.5 shrink-0 text-[var(--adm-text-3)]" />}
            />
          )}
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
                <div className="mt-0.5 text-[10px] text-[var(--adm-text-3)]">
                  {ITEM_TYPE_LABELS[item.itemType] ?? item.itemType}
                </div>
                {item.shortDescription && (
                  <p className="mt-1.5 text-sm text-[var(--adm-text-2)] leading-snug">{item.shortDescription}</p>
                )}
                {/* Блоки прилёта/вылета подтягивают известные детали дня:
                    номер рейса (поле в шапке дня) и отель прилёта
                    (добавленный через поиск отеля). */}
                {(item.itemType === 'arrival' || item.itemType === 'departure') &&
                  (() => {
                    const flight = (item.itemType === 'arrival' ? day.arrivalFlightNumber : day.departureFlightNumber)?.trim() ?? ''
                    const hotelTitle =
                      item.itemType === 'arrival' ? day.items.find((i) => i.itemType === 'hotel')?.displayTitle : undefined
                    if (!flight && !hotelTitle) return null
                    return (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--adm-text-2)]">
                        {flight && (
                          <span className="inline-flex items-center gap-1.5">
                            <Plane className="size-3 text-[var(--adm-text-3)]" />
                            Рейс {flight}
                            <a
                              href={`https://www.google.com/search?q=${encodeURIComponent(`flight ${flight}`)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[var(--adm-accent-text)] hover:underline"
                            >
                              статус ↗
                            </a>
                          </span>
                        )}
                        {hotelTitle && (
                          <span className="inline-flex items-center gap-1.5">
                            <BedDouble className="size-3 text-[var(--adm-text-3)]" />
                            Отель: {hotelTitle}
                          </span>
                        )}
                      </div>
                    )
                  })()}
                {/* POI ID в заметке — машинный клей (связь с базой), не показываем */}
                {item.internalNotes && !item.internalNotes.startsWith('POI ID:') && (
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

          {/* Hotel search — только существующие записи; новый отель через
              /admin/resources, чтобы сразу оформить партнёрскую ссылку */}
          <div className="relative flex-1">
            <input
              value={localHotelQuery}
              onChange={(e) => setLocalHotelQuery(e.target.value)}
              placeholder="Поиск отеля для ночёвки…"
              className="w-full rounded-xl border border-[var(--adm-border)] bg-[var(--adm-hover)] px-3 py-2 text-sm text-[var(--adm-text)] outline-none transition focus:border-[var(--adm-accent-border)] placeholder:text-[var(--adm-text-3)]"
            />
            {localHotelLoading && (
              <div className="absolute right-3 top-2.5 text-xs text-[var(--adm-text-3)]">…</div>
            )}
            {localHotelResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-52 overflow-auto rounded-xl border border-[var(--adm-border)] bg-[var(--adm-popover)] shadow-xl">
                {localHotelResults.map((hotel) => (
                  <button
                    key={hotel.resourceId}
                    onClick={() => handleHotelSelect(hotel)}
                    className="w-full px-3 py-2.5 text-left text-sm hover:bg-[var(--adm-active)] transition-colors border-b border-[var(--adm-border)] last:border-0"
                  >
                    <div className="font-medium text-[var(--adm-text)]">{hotel.title}</div>
                    <div className="text-xs text-[var(--adm-text-3)]">
                      {[hotel.city, hotel.ryokan ? 'рёкан' : null].filter(Boolean).join(' · ')}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {!localHotelLoading && localHotelQuery.trim().length > 0 && localHotelResults.length === 0 && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-[var(--adm-border)] bg-[var(--adm-popover)] p-3 shadow-xl">
                <p className="text-xs text-[var(--adm-text-3)]">Такого отеля в базе нет.</p>
                <a
                  href={`/admin/resources?new=hotel&title=${encodeURIComponent(localHotelQuery.trim())}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-block text-xs text-[var(--adm-accent-text)] hover:underline"
                >
                  + Добавить новый отель «{localHotelQuery.trim()}» ↗
                </a>
              </div>
            )}
          </div>

          {/* Один «+ Блок»: транспорт и служебные точки в одном меню —
              раньше это были два соседних попапа одинаковой природы. */}
          <div className="relative shrink-0">
            <button
              onClick={handleOpenBlockPicker}
              className="inline-flex min-h-9 items-center rounded-xl border border-amber-400/20 bg-[var(--adm-warn-text)]/8 px-4 text-sm text-[var(--adm-warn-text)] transition hover:border-[var(--adm-warn-border)] hover:bg-[var(--adm-warn-bg)] hover:text-[var(--adm-warn-text)]"
            >
              <Plus className="mr-1.5 size-3.5" />
              Блок
            </button>
            {showBlockPicker && (
              <div className="absolute right-0 top-full z-30 mt-1 max-h-80 min-w-60 overflow-auto rounded-xl border border-[var(--adm-border)] bg-[var(--adm-popover)] shadow-xl">
                <div className="flex items-center justify-between border-b border-[var(--adm-border)] px-3 py-2">
                  <span className="text-xs text-[var(--adm-text-3)]">Добавить блок</span>
                  <button onClick={() => setShowBlockPicker(false)} className="text-[var(--adm-text-3)] hover:text-[var(--adm-text)]">
                    <X className="size-3.5" />
                  </button>
                </div>
                <div className="px-3 pb-1 pt-2 text-[10px] font-medium text-[var(--adm-text-3)]">Транспорт</div>
                {dayBlocksLoading ? (
                  <div className="px-3 py-2 text-xs text-[var(--adm-text-3)]">Загрузка…</div>
                ) : (
                  dayBlocks
                    .filter((b) => b.type === 'transfer')
                    .map((block) => (
                      <button
                        key={block.id}
                        onClick={() => {
                          handleBlockSelect(block)
                          setShowBlockPicker(false)
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--adm-text-2)] transition hover:bg-[var(--adm-active)]"
                      >
                        <span>{block.icon}</span>
                        <span>{block.nameRu}</span>
                      </button>
                    ))
                )}
                <div className="border-t border-[var(--adm-border)] px-3 pb-1 pt-2 text-[10px] font-medium text-[var(--adm-text-3)]">
                  Служебные точки
                </div>
                {servicePoisLoading ? (
                  <div className="px-3 py-2 text-xs text-[var(--adm-text-3)]">Загрузка…</div>
                ) : servicePois.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-[var(--adm-text-3)]">Нет служебных точек</div>
                ) : (
                  servicePois.map((poi) => (
                    <button
                      key={poi.poiId}
                      onClick={() => {
                        handlePoiSelect(poi)
                        setShowBlockPicker(false)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--adm-text-2)] transition hover:bg-[var(--adm-active)]"
                    >
                      <span>{poi.nameRu || poi.nameEn || poi.poiId}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Zone 4 — печатная программа (Print Lead / Footer) */}
      <details className="border-t border-[var(--adm-border)] px-5 py-3" onClick={(e) => e.stopPropagation()}>
        <summary className="cursor-pointer text-xs font-medium text-[var(--adm-text-3)] transition hover:text-[var(--adm-text-2)]">
          Для печатной программы {day.printLead || day.printFooterNote ? '· заполнено' : ''}
        </summary>
        <div className="mt-3 space-y-2">
          <textarea
            value={day.printLead}
            onChange={(e) => onUpdateField(day.id, 'printLead', e.target.value)}
            placeholder="Вводный абзац дня — как вы рассказали бы клиенту, что его ждёт"
            rows={3}
            className={inputClass}
          />
          <textarea
            value={day.printFooterNote}
            onChange={(e) => onUpdateField(day.id, 'printFooterNote', e.target.value)}
            placeholder="Примечание в подвале дня (необязательно)"
            rows={2}
            className={inputClass}
          />
        </div>
      </details>
    </article>
  )
}

// ─── Main workspace ─────────────────────────────────────────────────────────

export interface BuilderClientContext {
  /** Airtable record id prospect'а, к которому привязываются сохранённые маршруты. */
  recordId: string
  /** Имя клиента для баннера. */
  name: string
  /** Профиль туриста (JSON-ответы опросника) — рендерится сквозной шторкой
   * поверх билдера, чтобы состав группы и пожелания были под рукой при
   * сборке дней. null, если анкета не заполнена. */
  profile: TouristProfilePayload | null
  factFindCompletedAt: string | null
  factFindUrl: string | null
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
  // Параметры маршрута — выдвижная шторка над программой (Задание владельца):
  // закреплена наверху скролла вместе с профилем туриста, сворачивается в
  // одну строку, когда нужно освободить место под днями.
  const [paramsExpanded, setParamsExpanded] = useState(true)
  // Пока не восстановлен рабочий маршрут, конструктор не рендерим — иначе
  // при жёсткой перезагрузке мигает дефолтный скелет, поверх которого затем
  // прогружается настоящий тур («несколько вариантов сайта» у владельца).
  const [booting, setBooting] = useState(true)
  // EDIT LOCK: публичные (Published) маршруты открываются заблокированными —
  // это живой фронтенд, случайная правка в конструкторе видна клиентам.
  // Разблокировка через предохранитель: два клика по кнопке замка.
  const [editLocked, setEditLocked] = useState(false)
  const [unlockArmed, setUnlockArmed] = useState(false)
  // Макеты: создание нового тура копией существующего (Параметры маршрута)
  // и дневные туры Route Stops как контент-макеты для отдельного дня.
  const [templateSlug, setTemplateSlug] = useState('')
  const [dayTemplates, setDayTemplates] = useState<{ slug: string; title: string; routeType: string }[]>([])
  // Предохранитель кнопки «Опубликовать» (Promote to Public)
  const [promoteArmed, setPromoteArmed] = useState(false)
  // Есть ли несохранённые правки (состояние != серверный снапшот) — маркер
  // на кнопке «Сохранить». Выставляется в debounce-эффекте кэша черновиков.
  const [hasUnsaved, setHasUnsaved] = useState(false)
  // Меню «⋯» в шапке (редкие действия: на сайте, печать, новый, статус)
  const [moreOpen, setMoreOpen] = useState(false)
  // Серверная версия текущего маршрута (сериализованная) — эталон для
  // определения «есть несохранённые правки» в кэше черновиков.
  const serverSnapshotRef = useRef('')

  useEffect(() => {
    fetch('/api/admin/route-stops/routes')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setDayTemplates(data)
      })
      .catch(() => {})
  }, [])

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
    serverSnapshotRef.current = serializeBuilderState(data.title, data.titleEn, String(data.dayCount), data)

    // Несохранённые правки этого маршрута, пережившие перезагрузку страницы,
    // важнее серверной версии — восстанавливаем их поверх.
    let restoredNote = ''
    const draft = data.slug ? readUnsavedDraft(data.slug) : null
    if (draft && serializeBuilderState(draft.titleRu, draft.titleEn, draft.dayCount, draft.route) !== serverSnapshotRef.current) {
      setTitleRu(draft.titleRu)
      setTitleEn(draft.titleEn)
      setDayCount(draft.dayCount)
      setRoute(syncFlightItemTitles(draft.route))
      setSelectedDayId(draft.route.days[0]?.id ?? '')
      const time = new Date(draft.savedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      restoredNote = ` — восстановлены несохранённые изменения (${time}); «Сохранить» отправит их в Airtable`
    }

    setSelectedSavedSlug(data.slug)
    // Публичная программа — готовый макет: открывается под замком.
    setEditLocked(data.status === 'Published')
    setUnlockArmed(false)
    setSaveState('idle')
    setSaveMessage('')
    setRouteLoadMessage(options?.silent && !restoredNote ? '' : `Загружен: ${data.title}${restoredNote}`)
    // Открытие маршрута (не только сохранение) должно запоминаться как
    // «последний открытый» — иначе перезагрузка страницы (Cmd/Ctrl+R) до
    // первого сохранения отбрасывает на дефолтный черновик «Классическая
    // Япония», а не на тур, с которым реально работали.
    if (data.slug) {
      localStorage.setItem('multiday-last-slug', data.slug)
    }
  }

  // Единый детерминированный старт. Раньше здесь были ДВА mount-эффекта,
  // грузившие маршрут параллельно: восстановление последнего открытого из
  // localStorage и «есть ли сохранённый маршрут с текущим slug» (а текущий
  // slug на старте — всегда дефолтная «Классическая Япония», которая есть
  // среди сохранённых). Побеждал тот fetch, что финишировал последним, —
  // поэтому жёсткая перезагрузка часто уводила с рабочего тура на «Классику».
  // Теперь один эффект с явным приоритетом:
  //   ?route= (карточка клиента) → последний открытый (localStorage) →
  //   сохранённый маршрут с текущим slug → пустой черновик.
  useEffect(() => {
    let alive = true

    void refreshSavedRoutes()
      .then((routes) => {
        if (!alive) return
        const targetSlug = initialRouteSlug
          ? initialRouteSlug
          : (() => {
              const lastSlug = localStorage.getItem('multiday-last-slug')
              return (
                (lastSlug && routes.some((savedRoute) => savedRoute.slug === lastSlug) && lastSlug) ||
                routes.find((savedRoute) => savedRoute.slug === route.slug)?.slug
              )
            })()
        if (!targetSlug) {
          setBooting(false)
          return
        }
        void handleLoadSavedRoute(targetSlug, initialRouteSlug ? undefined : { silent: true })
          .catch((error) => {
            console.error(error)
            if (alive && initialRouteSlug) setRouteLoadMessage(`Маршрут «${initialRouteSlug}» не найден среди сохранённых.`)
          })
          .finally(() => {
            if (alive) setBooting(false)
          })
      })
      .catch((error) => {
        console.error(error)
        if (alive) {
          setRouteLoadMessage('Не удалось загрузить список маршрутов.')
          setBooting(false)
        }
      })

    return () => {
      alive = false
    }
    // Intentionally mount-only: checks once whether a saved route matches the
    // initial slug. Adding refreshSavedRoutes/route.slug would re-run this on
    // every keystroke that changes the title (slug is title-derived).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Кэш несохранённых правок: дебаунс-запись в localStorage при любом
  // изменении состояния конструктора. Когда состояние совпадает с серверной
  // версией (только что загрузили/сохранили) — черновик стирается, чтобы не
  // «восстанавливать» то, что и так сохранено.
  useEffect(() => {
    // Ключ — серверный slug маршрута (selectedSavedSlug), а не производный от
    // заголовка route.slug: иначе переименование тура пишет черновик под
    // новым ключом, а восстановление после перезагрузки ищет по старому.
    const draftKey = selectedSavedSlug || route.slug
    if (!draftKey) return
    const timer = setTimeout(() => {
      const snapshot = serializeBuilderState(titleRu, titleEn, dayCount, route)
      setHasUnsaved(snapshot !== serverSnapshotRef.current)
      try {
        if (snapshot === serverSnapshotRef.current) {
          localStorage.removeItem(unsavedDraftKey(draftKey))
        } else {
          const draft: UnsavedBuilderDraft = { titleRu, titleEn, dayCount, route, savedAt: Date.now() }
          localStorage.setItem(unsavedDraftKey(draftKey), JSON.stringify(draft))
        }
      } catch {
        // localStorage переполнен/недоступен — черновик не критичен, работаем дальше
      }
    }, 700)
    return () => clearTimeout(timer)
  }, [titleRu, titleEn, dayCount, route, selectedSavedSlug])

  const selectedDay = useMemo(() => route.days.find((day) => day.id === selectedDayId) ?? route.days[0], [route.days, selectedDayId])
  // Колонки-пустышки в матрице скрываем: колонка без различающихся данных —
  // не информация, а шум (19 × «Определится позже», 19 × «изменён»).
  const showRegionsColumn = useMemo(() => route.days.some((day) => day.derivedRegions.length > 0), [route.days])
  const showDayStatusColumn = useMemo(() => new Set(route.days.map((day) => day.displayStatus)).size > 1, [route.days])
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
    // syncDayTitleDates: даты в заголовках дней подтягиваются к startDate
    // при каждой генерации/сохранении (владелец: «матрица должна подтянуть
    // даты и обновить маршрут по дням»).
    return syncDayTitleDates(
      reconcileMultiDayRoute(route, {
        titleRu,
        titleEn,
        dayCount: liveDayCount,
        startCityId: route.startCityId,
        startCityLabel: route.startCity,
        endCityId: route.endCityId,
        endCityLabel: route.endCity,
      }),
    )
  }

  // Новый тур из макета: копия выбранного маршрута открывается черновиком,
  // публичный оригинал не меняется (slug выводится из нового titleEn).
  async function handleCreateFromTemplate() {
    if (!templateSlug) return
    try {
      const response = await fetch(`/api/admin/multi-day/route?slug=${encodeURIComponent(templateSlug)}`, { cache: 'no-store' })
      const data = (await response.json()) as MultiDayBuilderRoute | { error?: string }
      if (!response.ok || Array.isArray(data) || !('slug' in data)) throw new Error('Failed to load template route')
      applyLoadedRouteState(
        { ...data, title: `${data.title} (копия)`, titleEn: `${data.titleEn}-copy`, status: 'Draft' },
        setTitleRu,
        setTitleEn,
        setDayCount,
        setRoute,
        setSelectedDayId,
      )
      serverSnapshotRef.current = ''
      setSelectedSavedSlug('')
      setTemplateSlug('')
      setEditLocked(false)
      setUnlockArmed(false)
      setSaveState('idle')
      setSaveMessage('')
      setRouteLoadMessage(`Создан черновик из макета «${data.title}» — сохраните, чтобы он появился в списке маршрутов.`)
    } catch (error) {
      console.error(error)
      setRouteLoadMessage('Не удалось создать копию из макета.')
    }
  }

  // Контент-макет дня: программа дня заменяется точками готового дневного
  // тура (Route Stops), например «Токио. Первый день». POI ID сохраняются,
  // так что описания на сайте наследуются из первоисточников.
  async function handleApplyDayTemplate(dayId: string, templateRouteSlug: string) {
    const template = dayTemplates.find((t) => t.slug === templateRouteSlug)
    if (!window.confirm(`Заменить программу дня контентом макета «${template?.title ?? templateRouteSlug}»?`)) return
    try {
      const response = await fetch(`/api/admin/route-stops/stops?routeSlug=${encodeURIComponent(templateRouteSlug)}`, { cache: 'no-store' })
      const stops = (await response.json()) as Array<{
        id: string
        fields: Record<string, unknown>
        poi?: { approvedRu: string; descriptionRu: string } | null
      }>
      if (!response.ok || !Array.isArray(stops)) throw new Error('Failed to load template stops')
      const text = (fields: Record<string, unknown>, key: string) => (typeof fields[key] === 'string' ? (fields[key] as string) : '')
      const items = stops
        .filter((s) => {
          const status = s.fields['Status'] as { name?: string } | string | undefined
          const statusName = typeof status === 'string' ? status : status?.name
          return s.fields['Is Helper'] !== true && statusName !== 'Inactive'
        })
        .map((s, index) => ({
          id: `item-${dayId}-tpl-${index}-${Math.random().toString(36).slice(2, 6)}`,
          order: index + 1,
          itemType: 'poi' as const,
          displayTitle: text(s.fields, 'Stop Title Override') || text(s.fields, 'POI Name Snapshot'),
          displayTitleEn: '',
          shortDescription: text(s.fields, 'Stop Description Override Approved (RU)') || s.poi?.approvedRu || s.poi?.descriptionRu || '',
          shortDescriptionEn: '',
          sourceMode: 'manual' as const,
          locked: false,
          poiTitle: text(s.fields, 'POI Name Snapshot'),
          transportSegmentId: null,
          internalNotes: text(s.fields, 'POI ID') ? `POI ID: ${text(s.fields, 'POI ID')}` : '',
        }))
      if (items.length === 0) {
        setRouteLoadMessage('В этом макете нет активных точек.')
        return
      }
      setRoute((prev) =>
        syncFlightItemTitles({
          ...prev,
          days: prev.days.map((day) => {
            if (day.id !== dayId) return day
            // Дефолтный заголовок («День 5», в т.ч. с датой «22 окт — День 5»)
            // заменяем названием маршрута; свой заголовок не трогаем.
            const isDefaultTitle = /^([\d]{1,2}\s+[а-яё]+\.?\s*[—–-]\s*)?День (\d+|прилёта|отъезда)$/iu.test(day.dayTitle.trim())
            return {
              ...day,
              items: normalizeDayItems(items),
              dayTitle: isDefaultTitle && template?.title ? day.dayTitle.replace(/День (\d+|прилёта|отъезда)$/iu, template.title) : day.dayTitle,
              displayStatus: 'Edited' as const,
            }
          }),
        }),
      )
      setRouteLoadMessage(`День заполнен из маршрута «${template?.title ?? templateRouteSlug}» (${items.length} точек) — не забудьте сохранить.`)
    } catch (error) {
      console.error(error)
      setRouteLoadMessage('Не удалось загрузить макет дня.')
    }
  }

  function handleGenerate() {
    if (editLocked) {
      setSaveState('error')
      setSaveMessage('Публичная программа под замком — снимите EDIT LOCK, чтобы менять структуру.')
      return
    }
    const next = buildNextRouteState()

    setRoute(next)
    setSelectedDayId((current) => (next.days.some((day) => day.id === current) ? current : next.days[0]?.id ?? ''))
    setSaveState('idle')
    setSaveMessage('')
  }

  async function handleSave() {
    if (editLocked) {
      setSaveState('error')
      setSaveMessage('Публичная программа под замком — снимите EDIT LOCK двойным кликом по замку, чтобы сохранить изменения.')
      return
    }
    await saveRoute(buildNextRouteState())
  }

  // Promote to Public: публикация с предохранителем (два клика). Маршрут
  // сохраняется со статусом Published, появляется на /multi-day/[slug]
  // и сразу запирается как публичный макет.
  async function handlePromoteToPublic() {
    if (editLocked || saveState === 'saving') return
    if (!promoteArmed) {
      setPromoteArmed(true)
      window.setTimeout(() => setPromoteArmed(false), 5000)
      return
    }
    setPromoteArmed(false)
    const published = { ...buildNextRouteState(), status: 'Published' as const }
    setRoute(published)
    await saveRoute(published)
    setEditLocked(true)
    setUnlockArmed(false)
    setRouteLoadMessage(`Опубликован и заперт — живёт на /${published.slug}`)
  }

  async function saveRoute(nextRoute: MultiDayBuilderRoute) {
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
      // Сохранено в Airtable — серверный эталон обновился, кэш несохранённых
      // правок этого маршрута больше не нужен (под старым и новым slug).
      serverSnapshotRef.current = serializeBuilderState(titleRu, titleEn, dayCount, nextRoute)
      try {
        if (selectedSavedSlug) localStorage.removeItem(unsavedDraftKey(selectedSavedSlug))
        if (nextRoute.slug) localStorage.removeItem(unsavedDraftKey(nextRoute.slug))
      } catch {}
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
    setRoute((prev) => syncFlightItemTitles({
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

  function handleAddHotelToDay(dayId: string, hotel: MultiDayBuilderHotelOption) {
    setRoute((prev) => ({
      ...prev,
      days: prev.days.map((day) => {
        if (day.id !== dayId) return day
        const newItem = {
          id: `item-${dayId}-hotel-${Math.random().toString(36).slice(2, 8)}`,
          order: day.items.length + 1,
          itemType: 'hotel' as const,
          displayTitle: hotel.title,
          displayTitleEn: hotel.title,
          shortDescription: hotel.ryokan ? 'Рёкан' : '',
          shortDescriptionEn: '',
          sourceMode: 'manual' as const,
          locked: false,
          poiTitle: hotel.title,
          transportSegmentId: null,
          internalNotes: `Resource ID: ${hotel.resourceId}`,
        }
        return { ...day, items: normalizeDayItems([...day.items, newItem]) }
      }),
    }))
  }

  function handleAddDayBlock(dayId: string, block: DayBlock) {
    setRoute((prev) => syncFlightItemTitles({
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
    field: 'overnightCity' | 'startLocation' | 'endLocation' | 'printLead' | 'printFooterNote' | 'arrivalFlightNumber' | 'departureFlightNumber',
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

  // Выбор аэропорта прилёта: код (NRT/HND/...) становится значением поля
  // «Старт» этого дня, а заголовок сгенерированного пункта «День прилёта»
  // (item.itemType === 'arrival', ещё не отредактированный вручную)
  // переписывается на «Прибытие в {Аэропорт}» — по просьбе владельца,
  // чтобы у гидов не было путаницы с абстрактным «Прилёт в Токио».
  function handleSelectArrivalAirport(dayId: string, code: string) {
    setRoute((prev) =>
      syncFlightItemTitles({
        ...prev,
        days: prev.days.map((day) => (day.id === dayId ? { ...day, startLocation: code } : day)),
      }),
    )
  }

  // Аэропорт вылета живёт в endLocation дня отъезда — симметрично прилёту.
  function handleSelectDepartureAirport(dayId: string, code: string) {
    setRoute((prev) =>
      syncFlightItemTitles({
        ...prev,
        days: prev.days.map((day) => (day.id === dayId ? { ...day, endLocation: code } : day)),
      }),
    )
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

      {/* «Применить структуру» появляется только когда «Дней» разошлось с
          фактической структурой — постоянный ритуал «Генерировать» убран:
          «Сохранить» и так пересобирает структуру перед записью. */}
      {liveDayCount !== route.days.length && (
        <button
          type="button"
          onClick={handleGenerate}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--adm-accent-border)] bg-[var(--adm-accent-bg)] px-3 text-sm text-[var(--adm-accent-text)] transition hover:bg-[var(--adm-active)]"
          title="Пересобрать дни маршрута под новое количество"
        >
          <RefreshCw className="size-3.5" />
          Применить структуру ({liveDayCount} дн.)
        </button>
      )}

      {/* Promote to Public: публикация нового маршрута с предохранителем —
          первый клик взводит, второй подтверждает. После публикации
          маршрут появляется на сайте и сразу встаёт под EDIT LOCK. */}
      {route.status !== 'Published' && (
        <button
          type="button"
          onClick={handlePromoteToPublic}
          disabled={saveState === 'saving'}
          title={`Сохранить со статусом «Опубликован» — маршрут появится на сайте на /${route.slug}`}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition',
            promoteArmed
              ? 'border-[var(--adm-ok-border)] bg-[var(--adm-ok-bg)] text-[var(--adm-ok-text)]'
              : 'border-[var(--adm-border)] bg-[var(--adm-hover)] text-[var(--adm-text-2)] hover:border-[var(--adm-ok-border)] hover:text-[var(--adm-ok-text)]',
          )}
        >
          <Sparkles className="size-3.5" />
          {promoteArmed ? 'Точно опубликовать?' : 'Опубликовать'}
        </button>
      )}

      {/* EDIT LOCK: публичная программа — готовый макет. Разблокировка с
          предохранителем: первый клик взводит, второй (в течение 5 сек)
          снимает замок. Обратно запирается одним кликом. */}
      {(route.status === 'Published' || editLocked) && (
        <button
          type="button"
          onClick={() => {
            if (!editLocked) {
              setEditLocked(true)
              setUnlockArmed(false)
              return
            }
            if (!unlockArmed) {
              setUnlockArmed(true)
              window.setTimeout(() => setUnlockArmed(false), 5000)
              return
            }
            setEditLocked(false)
            setUnlockArmed(false)
          }}
          title={
            editLocked
              ? 'Программа опубликована на сайте и защищена от правок. Два клика — снять замок.'
              : 'Запереть публичную программу от случайных правок'
          }
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition',
            editLocked
              ? unlockArmed
                ? 'border-[var(--adm-danger-border)] bg-[var(--adm-danger-bg)] text-[var(--adm-danger-text)]'
                : 'border-[var(--adm-warn-border)] bg-[var(--adm-warn-bg)] text-[var(--adm-warn-text)]'
              : 'border-[var(--adm-border)] bg-[var(--adm-hover)] text-[var(--adm-text-2)] hover:border-[var(--adm-warn-border)] hover:text-[var(--adm-warn-text)]',
          )}
        >
          {editLocked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
          {editLocked ? (unlockArmed ? 'Точно снять замок?' : 'EDIT LOCK') : 'Запереть'}
        </button>
      )}

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
        {hasUnsaved && !editLocked && (
          <span
            className="size-1.5 rounded-full bg-[var(--adm-on-accent)]"
            title="Есть несохранённые правки"
            aria-label="Есть несохранённые правки"
          />
        )}
      </button>

      {/* Редкие действия — в меню «⋯», чтобы не раздувать шапку */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          className="inline-flex size-9 items-center justify-center rounded-full border border-[var(--adm-border)] bg-[var(--adm-hover)] text-[var(--adm-text-2)] transition hover:border-[var(--adm-border-strong)] hover:bg-[var(--adm-active)] hover:text-[var(--adm-text)]"
          title="Ещё действия"
        >
          <MoreHorizontal className="size-4" />
        </button>
        {moreOpen && (
          <div className="absolute right-0 top-full z-40 mt-1 min-w-60 rounded-xl border border-[var(--adm-border)] bg-[var(--adm-popover)] p-1 shadow-xl">
            {route.status === 'Published' && route.slug && (
              <a
                href={`/${route.slug}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => setMoreOpen(false)}
                className="block rounded-lg px-3 py-2 text-sm text-[var(--adm-text-2)] transition hover:bg-[var(--adm-active)] hover:text-[var(--adm-text)]"
              >
                На сайте ↗
              </a>
            )}
            <a
              href={`/admin/print/${route.slug}`}
              target="_blank"
              rel="noreferrer"
              onClick={() => setMoreOpen(false)}
              className="block rounded-lg px-3 py-2 text-sm text-[var(--adm-text-2)] transition hover:bg-[var(--adm-active)] hover:text-[var(--adm-text)]"
            >
              <Printer className="mr-2 inline size-3.5 align-[-2px]" />
              Печатная программа ↗
            </a>
            <button
              type="button"
              onClick={() => {
                handleCreateNewRoute()
                setMoreOpen(false)
              }}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--adm-text-2)] transition hover:bg-[var(--adm-active)] hover:text-[var(--adm-text)]"
            >
              <Plus className="mr-2 inline size-3.5 align-[-2px]" />
              Новый маршрут
            </button>
            <div className="my-1 border-t border-[var(--adm-border)]" />
            <label className="block px-3 py-2">
              <span className="mb-1 block text-xs text-[var(--adm-text-3)]">Статус публикации</span>
              <select
                value={route.status}
                onChange={(event) => handleUpdateRouteStatus(event.target.value as MultiDayBuilderRoute['status'])}
                disabled={editLocked}
                className="w-full rounded-lg border border-[var(--adm-border)] bg-[var(--adm-active)] px-2 py-1.5 text-sm text-[var(--adm-text)] outline-none disabled:opacity-50"
              >
                {(['Draft', 'Review', 'Published', 'Archived'] as const).map((status) => (
                  <option key={status} value={status}>
                    {routeStatusLabel[status]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

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

  if (booting) {
    return (
      <AdminShell currentPath="/admin/multi-day" title="Конструктор маршрутов" maxWidth="max-w-7xl">
        <div className="flex h-64 items-center justify-center text-sm text-[var(--adm-text-3)]">
          Загрузка маршрута…
        </div>
      </AdminShell>
    )
  }

  return (
    <AdminShell
      currentPath="/admin/multi-day"
      title="Конструктор маршрутов"
      actions={<RouteActions />}
      maxWidth="max-w-7xl"
    >
      {/* ── Профиль туриста + параметры маршрута — сквозная шторка над программой:
          закреплена наверху скролла (sticky), под ней прокручиваются матрица
          маршрута и карточки дней. Каждый блок сворачивается независимо. ── */}
      <div className="sticky top-0 z-20 space-y-3 bg-[var(--adm-bg)] pb-3">
        {clientContext && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--adm-accent-border)] bg-[var(--adm-accent-bg)] px-4 py-3">
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

            <TouristProfilePanel
              profile={clientContext.profile}
              factFindUrl={clientContext.factFindUrl}
              factFindCompletedAt={clientContext.factFindCompletedAt}
              defaultExpanded={false}
              className="static shadow-none"
            />
          </>
        )}

        {/* ── Builder inputs + route state ── */}
        <article className={cn(panelClass, 'p-4 md:p-5')}>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--adm-text-3)]">Параметры маршрута</div>
              <h2 className="text-base font-semibold text-[var(--adm-text)]">
                {`${titleRu || 'Без названия'} · ${liveDayCount} дн. · ${route.startCity || '—'} → ${route.endCity || '—'}`}
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
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

              <button
                type="button"
                onClick={() => setParamsExpanded((v) => !v)}
                aria-expanded={paramsExpanded}
                className={cn(adminSecondaryButtonClass, 'gap-1.5')}
              >
                {paramsExpanded ? 'Свернуть' : 'Развернуть'}
                <ChevronDown className={cn('size-3.5 transition-transform', paramsExpanded && 'rotate-180')} />
              </button>
            </div>
          </div>

          {paramsExpanded && (
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {/* Поля параметров запираются вместе с программой; блок «Новый
                  тур из макета» ниже остаётся активным и под замком. */}
              <fieldset disabled={editLocked} className="contents">
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
                <span className="block text-xs text-[var(--adm-text-3)]">Смена числа дней предложит «Применить структуру» в шапке; «Сохранить» применяет её сам.</span>
              </label>
              {/* Физические даты тура: начало задаёт дату дня 1, конец
                  пересчитывает «Дней». Даты в карточках дней вычисляются,
                  вбивать их в заголовки вручную больше не нужно. */}
              <label className="space-y-2 xl:col-span-2">
                <span className="text-sm text-[var(--adm-text-2)]">Начало тура</span>
                <input
                  type="date"
                  value={route.startDate}
                  onChange={(event) => setRoute((prev) => ({ ...prev, startDate: event.target.value }))}
                  className={inputClass}
                />
              </label>
              <label className="space-y-2 xl:col-span-2">
                <span className="text-sm text-[var(--adm-text-2)]">Конец тура</span>
                <input
                  type="date"
                  value={route.startDate ? addDaysIso(route.startDate, liveDayCount - 1) : ''}
                  min={route.startDate || undefined}
                  disabled={!route.startDate}
                  onChange={(event) => {
                    if (!route.startDate || !event.target.value) return
                    const diff = Math.round(
                      (Date.parse(`${event.target.value}T00:00:00Z`) - Date.parse(`${route.startDate}T00:00:00Z`)) / 86_400_000,
                    )
                    if (diff >= 1 && diff <= 20) setDayCount(String(diff + 1))
                  }}
                  className={inputClass}
                />
                <span className="block text-xs text-[var(--adm-text-3)]">Выбор конца диапазона пересчитывает «Дней» (2–21).</span>
              </label>
              </fieldset>
              <div className="space-y-2 md:col-span-2 xl:col-span-3">
                <span className="text-sm text-[var(--adm-text-2)]">Новый тур из макета</span>
                <div className="flex gap-2">
                  <select value={templateSlug} onChange={(event) => setTemplateSlug(event.target.value)} className={inputClass}>
                    <option value="">Выбрать макет…</option>
                    {savedRoutes.map((savedRoute) => (
                      <option key={savedRoute.slug} value={savedRoute.slug}>
                        {savedRoute.title} · {savedRoute.dayCount}д · {routeStatusLabel[savedRoute.status]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleCreateFromTemplate}
                    disabled={!templateSlug}
                    className="shrink-0 rounded-lg border border-[var(--adm-border)] bg-[var(--adm-hover)] px-3 text-sm text-[var(--adm-text-2)] transition hover:border-[var(--adm-border-strong)] hover:text-[var(--adm-text)] disabled:opacity-40"
                  >
                    Создать копию
                  </button>
                </div>
                <span className="block text-xs text-[var(--adm-text-3)]">
                  Копия открывается черновиком; публичный оригинал не меняется.
                </span>
              </div>
            </div>
          )}
        </article>
      </div>

      {editLocked && (
        <div className="flex items-center gap-2 rounded-xl border border-[var(--adm-warn-border)] bg-[var(--adm-warn-bg)] px-4 py-2.5 text-sm text-[var(--adm-warn-text)]">
          <Lock className="size-3.5 shrink-0" />
          Публичная программа — готовый макет, редактирование заперто. Нужна версия под клиента — создайте копию из макета в параметрах маршрута.
        </div>
      )}

      {/* Замок отключает все нативные контролы матрицы и карточек дней
          (display:contents — layout не меняется). */}
      <fieldset disabled={editLocked} className="contents">

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
                {showDayStatusColumn && <th className="px-4 py-3 font-medium">Статус</th>}
                {showRegionsColumn && <th className="px-4 py-3 font-medium">Регионы</th>}
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
                  <td className="px-4 py-3">
                    {/* Есть даты — дата первична, порядковый номер вторичен */}
                    {route.startDate ? (
                      <>
                        <div className="font-medium tabular-nums leading-tight text-[var(--adm-text)]">
                          {formatDayDate(route.startDate, day.dayNumber)}
                        </div>
                        <div className="mt-0.5 text-[11px] leading-tight text-[var(--adm-text-3)]">День {day.dayNumber}</div>
                      </>
                    ) : (
                      <span className="font-medium text-[var(--adm-text)]">День {day.dayNumber}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{dayTypeLabel[day.dayType]}</td>
                  <td className="px-4 py-3">{day.startLocation || '—'}</td>
                  <td className="px-4 py-3">{day.overnightCity || '—'}</td>
                  <td className="px-4 py-3">{day.items.length}</td>
                  {showDayStatusColumn && <td className="px-4 py-3">{DAY_STATUS_LABELS[day.displayStatus] ?? day.displayStatus}</td>}
                  {showRegionsColumn && (
                    <td className="px-4 py-3">{day.derivedRegions.length > 0 ? day.derivedRegions.join(', ') : '—'}</td>
                  )}
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
              dayDate={formatDayDate(route.startDate, day.dayNumber)}
              isSelected={selectedDay?.id === day.id}
              onSelect={setSelectedDayId}
              onAddPoi={handleAddPoiToDay}
              onAddHotel={handleAddHotelToDay}
              onAddTransport={handleAddTransport}
              onAddDayBlock={handleAddDayBlock}
              onMoveDayItem={handleMoveDayItem}
              onDeleteItem={handleDeleteDayItem}
              onUpdateField={handleUpdateDayField}
              onUpdateDayType={handleUpdateDayType}
              onSelectArrivalAirport={handleSelectArrivalAirport}
              onSelectDepartureAirport={handleSelectDepartureAirport}
              dayTemplates={dayTemplates}
              onApplyDayTemplate={handleApplyDayTemplate}
            />
          </div>
        ))}
      </section>

      </fieldset>

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
