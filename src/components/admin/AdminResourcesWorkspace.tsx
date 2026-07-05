'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CalendarRange, ExternalLink, Filter, Hotel, Layers3, Save, Search, Sparkles, UtensilsCrossed } from 'lucide-react'

import {
  ADMIN_RESOURCE_HOTEL_TIER_VALUES,
  ADMIN_RESOURCE_REGION_KEY_VALUES,
  ADMIN_RESOURCE_STATUS_FILTER_VALUES,
  ADMIN_RESOURCE_TYPE_FILTER_VALUES,
  RESOURCE_EVENT_LIFECYCLE_VALUES,
  eventCategories,
  type AdminEventLikeResourceItem,
  type AdminHotelResourceItem,
  type AdminResourceItem,
  type AdminResourcesSummary,
  type AdminResourceTypeFilter,
  type AdminRestaurantResourceItem,
  type AdminServiceResourceItem,
} from '@/lib/admin-resources'
import {
  ADMIN_SERVICE_FORMAT_VALUES,
  ADMIN_SERVICE_REGION_VALUES,
  ADMIN_SERVICE_SUBCATEGORY_VALUES,
  ADMIN_SERVICE_TAG_VALUES,
  type AdminServiceFormat,
  type ExperienceSubcategory,
  type ServiceTag,
} from '@/lib/admin-services'
import { AdminShell } from '@/components/admin/AdminShell'
import { adminInputClass } from '@/components/admin/ui'
import { cn } from '@/lib/utils'

type AdminResourcesWorkspaceProps = {
  items: AdminResourceItem[]
  summary: AdminResourcesSummary
  initialTypeFilter?: AdminResourceTypeFilter
  initialSelectedRecordId?: string
}

type ResourcesPatchResponse = {
  ok: boolean
  items?: AdminResourceItem[]
  saved?: number
  skipped?: number
  error?: string
}

type OverviewFilter = 'all' | 'services' | 'hotels' | 'restaurants' | 'timeAware' | 'draft' | 'archived' | 'missingDescriptions' | 'missingPrimaryUrl'

const typeMeta: Record<AdminResourceItem['type'], { label: string; icon: typeof Sparkles }> = {
  service: { label: 'Услуга', icon: Sparkles },
  hotel: { label: 'Отель', icon: Hotel },
  restaurant: { label: 'Ресторан', icon: UtensilsCrossed },
  event: { label: 'Событие', icon: CalendarRange },
  exhibition: { label: 'Выставка', icon: Layers3 },
  concert: { label: 'Концерт', icon: CalendarRange },
}

const resourceTypeSelectorOptions: Record<AdminResourceItem['type'], readonly AdminResourceItem['type'][]> = {
  service: ['service'],
  hotel: ['hotel'],
  restaurant: ['restaurant'],
  event: ['event', 'exhibition', 'concert'],
  exhibition: ['event', 'exhibition', 'concert'],
  concert: ['event', 'exhibition', 'concert'],
}

function buildComparableItem(item: AdminResourceItem) {
  if (item.type === 'service') {
    return JSON.stringify({
      ...item,
      tags: [...item.tags].sort(),
      service: {
        ...item.service,
        tags: [...item.service.tags].sort(),
        subcategory: [...item.service.subcategory].sort(),
      },
    })
  }

  return JSON.stringify({ ...item, tags: [...item.tags].sort() })
}

function isItemDirty(original: AdminResourceItem | undefined, current: AdminResourceItem | undefined) {
  if (!original || !current) return false
  return buildComparableItem(original) !== buildComparableItem(current)
}

function isHotelResource(item: AdminResourceItem): item is AdminHotelResourceItem {
  return item.type === 'hotel'
}

function isServiceResource(item: AdminResourceItem): item is AdminServiceResourceItem {
  return item.type === 'service'
}

function isEventLikeResource(item: AdminResourceItem): item is AdminEventLikeResourceItem {
  return item.type === 'event' || item.type === 'exhibition' || item.type === 'concert'
}

function isRestaurantResource(item: AdminResourceItem): item is AdminRestaurantResourceItem {
  return item.type === 'restaurant'
}

function normalizeServiceItemForKind(item: AdminServiceResourceItem, kind: AdminServiceResourceItem['service']['kind']): AdminServiceResourceItem {
  if (kind === 'practical') {
    return {
      ...item,
      primaryUrl: item.service.externalUrl,
      service: {
        ...item.service,
        kind: 'practical',
        format: '',
        subcategory: [],
        priceFrom: null,
        currency: '',
        durationMin: null,
        bookingUrl: null,
      },
    }
  }

  return {
    ...item,
    primaryUrl: item.service.bookingUrl,
    service: {
      ...item.service,
      kind: 'experience',
      format: item.service.kind === 'experience' && item.service.format ? item.service.format : ADMIN_SERVICE_FORMAT_VALUES[0],
      subcategory:
        item.service.kind === 'experience' && item.service.subcategory.length > 0 ? item.service.subcategory : [ADMIN_SERVICE_SUBCATEGORY_VALUES[0]],
      currency: item.service.kind === 'experience' && item.service.currency ? item.service.currency : 'JPY',
      bookingUrl: item.service.kind === 'experience' ? item.service.bookingUrl : null,
      priceFrom: item.service.kind === 'experience' ? item.service.priceFrom : null,
      durationMin: item.service.kind === 'experience' ? item.service.durationMin : null,
    },
  }
}

function toDateTimeLocalValue(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromDateTimeLocalValue(value: string) {
  if (!value.trim()) return ''
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : value
}

export function AdminResourcesWorkspace({
  items,
  summary,
  initialTypeFilter = 'all',
  initialSelectedRecordId = '',
}: AdminResourcesWorkspaceProps) {
  const [draftItems, setDraftItems] = useState(items)
  const [savedItems, setSavedItems] = useState(items)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<AdminResourceTypeFilter>(initialTypeFilter)
  const [statusFilter, setStatusFilter] = useState<(typeof ADMIN_RESOURCE_STATUS_FILTER_VALUES)[number]>('all')
  const [overviewFilter, setOverviewFilter] = useState<OverviewFilter>('all')
  const [selectedRecordId, setSelectedRecordId] = useState(initialSelectedRecordId || (items[0]?.recordId ?? ''))
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    setDraftItems(items)
    setSavedItems(items)
    setTypeFilter(initialTypeFilter)
    setOverviewFilter('all')
    setSelectedRecordId(initialSelectedRecordId || items[0]?.recordId || '')
  }, [initialSelectedRecordId, initialTypeFilter, items])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(timeout)
  }, [toast])

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams.toString())

    if (typeFilter === 'all') nextParams.delete('type')
    else nextParams.set('type', typeFilter)

    if (selectedRecordId) nextParams.set('recordId', selectedRecordId)
    else nextParams.delete('recordId')

    const nextUrl = nextParams.toString() ? `${pathname}?${nextParams.toString()}` : pathname
    router.replace(nextUrl, { scroll: false })
  }, [pathname, router, searchParams, selectedRecordId, typeFilter])

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return draftItems.filter((item) => {
      if (overviewFilter === 'services' && item.type !== 'service') return false
      if (overviewFilter === 'hotels' && item.type !== 'hotel') return false
      if (overviewFilter === 'restaurants' && item.type !== 'restaurant') return false
      if (overviewFilter === 'timeAware' && !isEventLikeResource(item)) return false
      if (overviewFilter === 'draft' && item.status !== 'draft') return false
      if (overviewFilter === 'archived' && item.status !== 'archived') return false
      if (overviewFilter === 'missingDescriptions' && item.description.trim()) return false
      if (overviewFilter === 'missingPrimaryUrl' && item.primaryUrl) return false
      if (typeFilter !== 'all' && item.type !== typeFilter) return false
      if (statusFilter !== 'all' && item.status !== statusFilter) return false
      if (!normalizedQuery) return true

      const haystack = [
        item.resourceId,
        item.slug,
        item.title,
        item.city,
        item.regionLabel,
        item.summary,
        item.description,
        item.tags.join(' '),
        item.type,
        isServiceResource(item)
          ? [
              item.service.kind,
              item.service.partner,
              item.service.venue,
              item.service.partnerUrl,
              item.service.bookingUrl,
              item.service.externalUrl,
              item.service.agentNotes,
              item.service.subcategory.join(' '),
            ].join(' ')
          : '',
        isHotelResource(item) ? [item.hotel.tier, item.hotel.regionKey].join(' ') : '',
        isRestaurantResource(item)
          ? [item.restaurant.cuisine, item.restaurant.area, item.restaurant.lunchPrice, item.restaurant.dinnerPrice, item.restaurant.pocketConciergeUrl].join(' ')
          : '',
        isEventLikeResource(item)
          ? [item.event.titleJa, item.event.venue, item.event.venueJa, item.event.neighborhood, item.event.priceLabel].join(' ')
          : '',
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(normalizedQuery)
    })
  }, [draftItems, overviewFilter, query, statusFilter, typeFilter])

  useEffect(() => {
    if (!filteredItems.some((item) => item.recordId === selectedRecordId)) {
      setSelectedRecordId(filteredItems[0]?.recordId ?? '')
    }
  }, [filteredItems, selectedRecordId])

  const selectedItem = draftItems.find((item) => item.recordId === selectedRecordId) ?? filteredItems[0] ?? null
  const savedSelectedItem = savedItems.find((item) => item.recordId === selectedRecordId)

  const dirtyRecordIds = new Set(
    draftItems
      .filter((item) => isItemDirty(savedItems.find((saved) => saved.recordId === item.recordId), item))
      .map((item) => item.recordId),
  )
  const dirtyItems = draftItems.filter((item) => dirtyRecordIds.has(item.recordId))
  const dirtyCount = dirtyItems.length

  const currentSummary = useMemo(
    () => ({
      ...summary,
      total: draftItems.length,
      services: draftItems.filter((item) => item.type === 'service').length,
      hotels: draftItems.filter((item) => item.type === 'hotel').length,
      restaurants: draftItems.filter((item) => item.type === 'restaurant').length,
      events: draftItems.filter((item) => item.type === 'event' || item.type === 'exhibition' || item.type === 'concert').length,
      draft: draftItems.filter((item) => item.status === 'draft').length,
      archived: draftItems.filter((item) => item.status === 'archived').length,
      missingDescriptions: draftItems.filter((item) => !item.description.trim()).length,
      missingPrimaryUrl: draftItems.filter((item) => !item.primaryUrl).length,
    }),
    [draftItems, summary],
  )

  function handleOverviewFilter(nextFilter: OverviewFilter) {
    setOverviewFilter(nextFilter)

    if (nextFilter === 'all') {
      setTypeFilter('all')
      setStatusFilter('all')
      return
    }

    if (nextFilter === 'services') {
      setTypeFilter('service')
      setStatusFilter('all')
      return
    }

    if (nextFilter === 'hotels') {
      setTypeFilter('hotel')
      setStatusFilter('all')
      return
    }

    if (nextFilter === 'restaurants') {
      setTypeFilter('restaurant')
      setStatusFilter('all')
      return
    }

    if (nextFilter === 'draft' || nextFilter === 'archived') {
      setTypeFilter('all')
      setStatusFilter(nextFilter)
      return
    }

    setTypeFilter('all')
    setStatusFilter('all')
  }

  function updateSelectedItem(updater: (item: AdminResourceItem) => AdminResourceItem) {
    if (!selectedItem) return
    setDraftItems((currentItems) => currentItems.map((item) => (item.recordId === selectedItem.recordId ? updater(item) : item)))
  }

  function updateSelectedTags(value: string) {
    updateSelectedItem((item) => ({
      ...item,
      tags: value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    }))
  }

  function toggleServiceTag(tag: ServiceTag) {
    updateSelectedItem((item) => {
      if (!isServiceResource(item)) return item
      const nextTags = item.service.tags.includes(tag) ? item.service.tags.filter((value) => value !== tag) : [...item.service.tags, tag]
      return { ...item, tags: nextTags, service: { ...item.service, tags: nextTags } }
    })
  }

  function toggleServiceSubcategory(subcategory: ExperienceSubcategory) {
    updateSelectedItem((item) => {
      if (!isServiceResource(item) || item.service.kind !== 'experience') return item
      const nextSubcategory = item.service.subcategory.includes(subcategory)
        ? item.service.subcategory.filter((value) => value !== subcategory)
        : [...item.service.subcategory, subcategory]
      return { ...item, service: { ...item.service, subcategory: nextSubcategory } }
    })
  }

  async function handleSave() {
    if (dirtyItems.length === 0) return

    const records = dirtyItems.map((item) => {
      if (isServiceResource(item)) {
        return {
          id: item.recordId,
          fields: {
            'Service ID': item.resourceId,
            'Service Slug': item.slug,
            'Service Name': item.title,
            'Service Kind': item.service.kind,
            Status: item.status,
            City: item.city,
            Region: item.regionLabel,
            Summary: item.summary,
            Description: item.description,
            Tags: item.tags,
            Partner: item.service.partner,
            Venue: item.service.venue,
            'Partner URL': item.service.partnerUrl,
            'Booking URL': item.service.kind === 'experience' ? item.service.bookingUrl : null,
            'External URL': item.service.externalUrl,
            'Experience Format': item.service.kind === 'experience' ? item.service.format : '',
            'Experience Subcategory': item.service.kind === 'experience' ? item.service.subcategory : [],
            'Price From': item.service.kind === 'experience' ? item.service.priceFrom : null,
            Currency: item.service.kind === 'experience' ? item.service.currency : '',
            'Duration Minutes': item.service.kind === 'experience' ? item.service.durationMin : null,
            'Agent Notes': item.service.agentNotes,
          },
        }
      }

      if (isHotelResource(item)) {
        return {
          id: item.recordId,
          fields: {
            'Resource ID': item.resourceId,
            'Resource Slug': item.slug,
            'Resource Type': item.type,
            Status: item.status,
            Title: item.title,
            City: item.city,
            'Region Label': item.regionLabel,
            Summary: item.summary,
            Description: item.description,
            Tags: item.tags,
            'Primary URL': item.primaryUrl,
            Tier: item.hotel.tier,
            'Region Key': item.hotel.regionKey,
            'Trip URL': item.hotel.tripUrl,
            'Booking URL': item.hotel.bookingUrl,
            'Is Ryokan': item.hotel.ryokan,
          },
        }
      }

      if (isRestaurantResource(item)) {
        return {
          id: item.recordId,
          fields: {
            'Resource ID': item.resourceId,
            'Resource Slug': item.slug,
            'Resource Type': item.type,
            Status: item.status,
            Title: item.title,
            City: item.city,
            'Region Label': item.regionLabel,
            Summary: item.summary,
            Description: item.description,
            Tags: item.tags,
            'Primary URL': item.primaryUrl,
            Cuisine: item.restaurant.cuisine,
            Area: item.restaurant.area,
            'Lunch Price': item.restaurant.lunchPrice,
            'Dinner Price': item.restaurant.dinnerPrice,
            'Pocket Concierge URL': item.restaurant.pocketConciergeUrl,
            'Google Maps URL': item.restaurant.googleMapsUrl,
            'Michelin Stars': item.restaurant.michelinStars,
          },
        }
      }

      return {
        id: item.recordId,
        fields: {
          'Resource ID': item.resourceId,
          'Resource Slug': item.slug,
          'Resource Type': item.type,
          Status: item.status,
          Title: item.title,
          City: item.city,
          'Region Label': item.regionLabel,
          Summary: item.summary,
          Description: item.description,
          Tags: item.tags,
          'Primary URL': item.primaryUrl,
          'Event Category': item.event.category,
          'Title JA': item.event.titleJa,
          Venue: item.event.venue,
          'Venue JA': item.event.venueJa,
          Neighborhood: item.event.neighborhood,
          'Starts At': item.event.startsAt,
          'Ends At': item.event.endsAt,
          'Price Label': item.event.priceLabel,
          'Source URL': item.event.sourceUrl,
          Featured: item.event.featured,
          Lifecycle: item.event.lifecycle,
        },
      }
    })

    setSaving(true)
    setToast(null)

    try {
      const response = await fetch('/api/admin/resources', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records }),
      })

      const data = (await response.json()) as ResourcesPatchResponse
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? 'Failed to save resources')
      }

      const updatedItems = data.items ?? []
      const updatedMap = new Map(updatedItems.map((item) => [item.recordId, item]))
      setDraftItems((currentItems) => currentItems.map((item) => updatedMap.get(item.recordId) ?? item))
      setSavedItems((currentItems) => currentItems.map((item) => updatedMap.get(item.recordId) ?? item))

      const savedCount = Number(data.saved ?? updatedItems.length)
      const skippedCount = Number(data.skipped ?? 0)
      const message = skippedCount > 0 ? `Saved ${savedCount} resource(s), skipped ${skippedCount} unchanged.` : `Saved ${savedCount} resource(s) to Airtable.`
      setToast({ type: 'ok', msg: message })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save resources'
      setToast({ type: 'err', msg: message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdminShell
      currentPath="/admin/resources"
      title="Ресурсы"
      subtitle="POI, отели, транспорт"
      maxWidth="max-w-7xl"
      actions={
        <a
          href={
            typeFilter === 'hotel'
              ? '/resources/hotels'
              : typeFilter === 'restaurant'
                ? '/resources/restaurants'
                : typeFilter === 'service'
                  ? '/resources/services'
                  : typeFilter === 'event' || typeFilter === 'exhibition' || typeFilter === 'concert'
                    ? '/resources/events'
                    : '/resources'
          }
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center rounded-full border border-[var(--adm-border)] bg-[var(--adm-hover)] px-3 text-sm text-[var(--adm-text-2)] transition hover:border-[var(--adm-border-strong)] hover:text-[var(--adm-text)]"
          title="Открыть соответствующий раздел на сайте"
        >
          На сайте ↗
        </a>
      }
    >
      <section className="grid gap-2 rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)] px-4 py-3 text-sm text-[var(--adm-text-2)] md:grid-cols-5 xl:grid-cols-9">
        <StatusCell label="Все ресурсы" value={String(currentSummary.total)} active={overviewFilter === 'all' && typeFilter === 'all' && statusFilter === 'all'} onClick={() => handleOverviewFilter('all')} />
        <StatusCell label="Услуги" value={String(currentSummary.services)} active={overviewFilter === 'services'} onClick={() => handleOverviewFilter('services')} />
        <StatusCell label="Отели" value={String(currentSummary.hotels)} active={overviewFilter === 'hotels'} onClick={() => handleOverviewFilter('hotels')} />
        <StatusCell label="Рестораны" value={String(currentSummary.restaurants)} active={overviewFilter === 'restaurants'} onClick={() => handleOverviewFilter('restaurants')} />
        <StatusCell label="События" value={String(currentSummary.events)} active={overviewFilter === 'timeAware'} onClick={() => handleOverviewFilter('timeAware')} />
        <StatusCell label="Черновики" value={String(currentSummary.draft)} active={overviewFilter === 'draft'} onClick={() => handleOverviewFilter('draft')} />
        <StatusCell label="Архив" value={String(currentSummary.archived)} active={overviewFilter === 'archived'} onClick={() => handleOverviewFilter('archived')} />
        <StatusCell label="Без описания" value={String(currentSummary.missingDescriptions)} active={overviewFilter === 'missingDescriptions'} onClick={() => handleOverviewFilter('missingDescriptions')} />
        <StatusCell label="Без ссылки" value={String(currentSummary.missingPrimaryUrl)} active={overviewFilter === 'missingPrimaryUrl'} onClick={() => handleOverviewFilter('missingPrimaryUrl')} />
      </section>

      {toast ? (
        <section
          className={cn(
            'rounded-2xl px-4 py-3 text-sm',
            toast.type === 'ok'
              ? 'border border-emerald-400/18 bg-[var(--adm-ok-bg)] text-[var(--adm-ok-text)]'
              : 'border border-red-400/18 bg-[var(--adm-danger-bg)] text-red-100',
          )}
        >
          {toast.msg}
        </section>
      ) : null}

      <section className="rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)] p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_12rem_auto]">
          <label className="flex min-h-11 items-center gap-3 rounded-xl border border-[var(--adm-border)] bg-[var(--adm-hover)] px-3 focus-within:border-[var(--adm-accent-border)]">
            <Search className="size-4 text-[var(--adm-text-3)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск: название, город, площадка, теги"
              className="w-full bg-transparent text-sm text-[var(--adm-text)] outline-none placeholder:text-[var(--adm-text-3)]"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[11px] font-medium text-[var(--adm-text-3)]">Тип</span>
            <select
              value={typeFilter}
              onChange={(event) => {
                setOverviewFilter('all')
                setTypeFilter(event.target.value as AdminResourceTypeFilter)
              }}
              className={inputClass}
            >
              {ADMIN_RESOURCE_TYPE_FILTER_VALUES.map((type) => (
                <option key={type} value={type} className="bg-[var(--adm-popover)] text-[var(--adm-text)]">
                  {type}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-[11px] font-medium text-[var(--adm-text-3)]">Статус</span>
            <select
              value={statusFilter}
              onChange={(event) => {
                setOverviewFilter('all')
                setStatusFilter(event.target.value as (typeof ADMIN_RESOURCE_STATUS_FILTER_VALUES)[number])
              }}
              className={inputClass}
            >
              {ADMIN_RESOURCE_STATUS_FILTER_VALUES.map((status) => (
                <option key={status} value={status} className="bg-[var(--adm-popover)] text-[var(--adm-text)]">
                  {status}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={handleSave}
            disabled={dirtyCount === 0 || saving}
            className={cn(
              'inline-flex min-h-11 items-center justify-center rounded-xl border px-4 text-sm font-medium transition',
              dirtyCount > 0
                ? 'border-[var(--adm-ok-border)] bg-[var(--adm-ok-bg)] text-[var(--adm-ok-text)] hover:border-[var(--adm-ok-border)] hover:bg-[var(--adm-ok-bg)]'
                : 'cursor-not-allowed border-[var(--adm-border)] bg-[var(--adm-hover)] text-[var(--adm-text-3)]',
            )}
          >
            <Save className="mr-2 size-4" />
            {saving ? 'Сохраняю…' : dirtyCount > 0 ? `Сохранить (${dirtyCount})` : 'Нет изменений'}
          </button>
        </div>

        <div className="mt-3 flex items-center gap-3 text-sm text-[var(--adm-text-3)]">
          <Filter className="size-4" />
          <span>{filteredItems.length} записей</span>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)]">
          <div className="max-h-[72vh] overflow-auto">
            {filteredItems.length === 0 ? (
              <div className="p-4 text-sm text-[var(--adm-text-2)]">No resources match this search.</div>
            ) : (
              <div className="divide-y divide-[var(--adm-border)]">
                {filteredItems.map((item) => {
                  const meta = typeMeta[item.type]
                  const Icon = meta.icon
                  const isActive = item.recordId === selectedItem?.recordId
                  const isDirty = dirtyRecordIds.has(item.recordId)

                  return (
                    <button
                      key={item.recordId}
                      type="button"
                      onClick={() => setSelectedRecordId(item.recordId)}
                      className={cn(
                        'grid w-full gap-1 px-4 py-3 text-left transition',
                        isActive ? 'bg-[var(--adm-active)]' : 'hover:bg-[var(--adm-hover)]',
                        isDirty && 'border-l-2 border-amber-300',
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="truncate text-sm font-medium text-[var(--adm-text)]">{item.title}</div>
                        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--adm-border)] bg-[var(--adm-hover)] px-2 py-0.5 text-[10px] tracking-[0.02em] text-[var(--adm-text-2)]">
                          <Icon className="size-3" />
                          {meta.label}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="truncate text-[var(--adm-text-3)]">{item.resourceId}</span>
                        <span className="truncate text-[var(--adm-text-3)]">{item.status}</span>
                      </div>
                      <div className="truncate text-xs text-[var(--adm-text-3)]">
                        {item.city || '—'} · {item.regionLabel || '—'}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)] p-4">
          {!selectedItem ? (
            <div className="text-sm text-[var(--adm-text-2)]">No resource selected.</div>
          ) : (
            <>
              <div className="grid gap-2 md:grid-cols-4">
                <MetaCell label="Тип" value={selectedItem.type} />
                <MetaCell label="Статус" value={selectedItem.status} />
                <MetaCell label="Модуль" value={selectedItem.editorModule} />
                <MetaCell label="Основная ссылка" value={selectedItem.primaryUrl ? 'есть' : 'нет'} />
              </div>

              {isServiceResource(selectedItem) ? (
                <div className="rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-hover)] px-4 py-4 text-sm text-[var(--adm-text-2)]">
                  <p className="font-medium text-[var(--adm-text)]">Service module inside Resources</p>
                  <p className="mt-1 text-[var(--adm-text-3)]">
                    You are editing the service slice inline inside the canonical Resources workspace. Shared core fields stay above; service-specific fields continue below.
                  </p>
                </div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-2">
                <Field label="Resource ID" required>
                  <input
                    value={selectedItem.resourceId}
                    onChange={(event) =>
                      updateSelectedItem((item) =>
                        isServiceResource(item)
                          ? { ...item, resourceId: event.target.value }
                          : { ...item, resourceId: event.target.value },
                      )
                    }
                    className={inputClass}
                  />
                </Field>
                <Field label="Slug" required>
                  <input
                    value={selectedItem.slug}
                    onChange={(event) => updateSelectedItem((item) => ({ ...item, slug: event.target.value }))}
                    className={inputClass}
                  />
                </Field>
                <Field label="Тип ресурса" required>
                  <select
                    value={selectedItem.type}
                    onChange={(event) =>
                      updateSelectedItem((item) => {
                        if (isEventLikeResource(item)) {
                          return { ...item, type: event.target.value as AdminEventLikeResourceItem['type'] }
                        }
                        return item
                      })
                    }
                    className={inputClass}
                    disabled={selectedItem.type === 'service' || selectedItem.type === 'hotel' || selectedItem.type === 'restaurant'}
                  >
                    {resourceTypeSelectorOptions[selectedItem.type].map((type) => (
                      <option key={type} value={type} className="bg-[var(--adm-popover)] text-[var(--adm-text)]">
                        {type}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Статус" required>
                  <select
                    value={selectedItem.status}
                    onChange={(event) => updateSelectedItem((item) => ({ ...item, status: event.target.value as AdminResourceItem['status'] }))}
                    className={inputClass}
                  >
                    {ADMIN_RESOURCE_STATUS_FILTER_VALUES.filter((value) => value !== 'all').map((status) => (
                      <option key={status} value={status} className="bg-[var(--adm-popover)] text-[var(--adm-text)]">
                        {status}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Название" required>
                  <input
                    value={selectedItem.title}
                    onChange={(event) => updateSelectedItem((item) => ({ ...item, title: event.target.value }))}
                    className={inputClass}
                  />
                </Field>
                <Field label="Город" required>
                  <input
                    value={selectedItem.city}
                    onChange={(event) => updateSelectedItem((item) => ({ ...item, city: event.target.value }))}
                    className={inputClass}
                  />
                </Field>
                <Field label="Район / метка региона">
                  {isServiceResource(selectedItem) ? (
                    <select
                      value={selectedItem.regionLabel}
                      onChange={(event) =>
                        updateSelectedItem((item) =>
                          isServiceResource(item)
                            ? { ...item, regionLabel: event.target.value, service: { ...item.service, region: event.target.value as AdminServiceResourceItem['service']['region'] } }
                            : item,
                        )
                      }
                      className={inputClass}
                    >
                      <option value="" className="bg-[var(--adm-popover)] text-[var(--adm-text)]">
                        —
                      </option>
                      {ADMIN_SERVICE_REGION_VALUES.map((region) => (
                        <option key={region} value={region} className="bg-[var(--adm-popover)] text-[var(--adm-text)]">
                          {region}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={selectedItem.regionLabel}
                      onChange={(event) => updateSelectedItem((item) => ({ ...item, regionLabel: event.target.value }))}
                      className={inputClass}
                    />
                  )}
                </Field>
                <Field label="Primary URL">
                  <input
                    value={selectedItem.primaryUrl ?? ''}
                    onChange={(event) =>
                      updateSelectedItem((item) => {
                        if (isRestaurantResource(item)) {
                          return {
                            ...item,
                            primaryUrl: event.target.value || null,
                            restaurant: { ...item.restaurant, pocketConciergeUrl: event.target.value || '' },
                          }
                        }
                        if (!isServiceResource(item)) return { ...item, primaryUrl: event.target.value || null }
                        return item.service.kind === 'experience'
                          ? { ...item, primaryUrl: event.target.value || null, service: { ...item.service, bookingUrl: event.target.value || null } }
                          : { ...item, primaryUrl: event.target.value || null, service: { ...item.service, externalUrl: event.target.value || null } }
                      })
                    }
                    className={inputClass}
                  />
                </Field>
              </div>

              <Field label="Кратко (одной строкой)">
                <textarea
                  value={selectedItem.summary}
                  onChange={(event) => updateSelectedItem((item) => ({ ...item, summary: event.target.value }))}
                  rows={3}
                  className={inputClass}
                />
              </Field>

              <Field label="Описание">
                <textarea
                  value={selectedItem.description}
                  onChange={(event) => updateSelectedItem((item) => ({ ...item, description: event.target.value }))}
                  rows={5}
                  className={inputClass}
                />
              </Field>

              <Field label="Теги (через запятую)">
                <input value={selectedItem.tags.join(', ')} onChange={(event) => updateSelectedTags(event.target.value)} className={inputClass} />
              </Field>

              {isServiceResource(selectedItem) ? (
                <>
                  <div className="rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-hover)] px-4 py-3">
                    <div className="text-[11px] font-medium text-[var(--adm-text-3)]">Поля услуги</div>
                    <div className="mt-1 text-sm text-[var(--adm-text-3)]">Typed details for the service branch, kept inside the parent Resources editor.</div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <Field label="Вид услуги" required>
                      <select
                        value={selectedItem.service.kind}
                        onChange={(event) => updateSelectedItem((item) => (isServiceResource(item) ? normalizeServiceItemForKind(item, event.target.value as AdminServiceResourceItem['service']['kind']) : item))}
                        className={inputClass}
                      >
                        <option value="experience" className="bg-[var(--adm-popover)] text-[var(--adm-text)]">experience</option>
                        <option value="practical" className="bg-[var(--adm-popover)] text-[var(--adm-text)]">practical</option>
                      </select>
                    </Field>
                    <Field label="Партнёр">
                      <input
                        value={selectedItem.service.partner}
                        onChange={(event) => updateSelectedItem((item) => (isServiceResource(item) ? { ...item, service: { ...item.service, partner: event.target.value } } : item))}
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Площадка">
                      <input
                        value={selectedItem.service.venue}
                        onChange={(event) => updateSelectedItem((item) => (isServiceResource(item) ? { ...item, service: { ...item.service, venue: event.target.value } } : item))}
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Partner URL">
                      <input
                        value={selectedItem.service.partnerUrl}
                        onChange={(event) => updateSelectedItem((item) => (isServiceResource(item) ? { ...item, service: { ...item.service, partnerUrl: event.target.value } } : item))}
                        className={inputClass}
                      />
                    </Field>
                    {selectedItem.service.kind === 'experience' ? (
                      <Field label="Booking URL" required>
                        <input
                          value={selectedItem.service.bookingUrl ?? ''}
                          onChange={(event) => updateSelectedItem((item) => (isServiceResource(item) && item.service.kind === 'experience' ? { ...item, primaryUrl: event.target.value || null, service: { ...item.service, bookingUrl: event.target.value || null } } : item))}
                          className={inputClass}
                        />
                      </Field>
                    ) : (
                      <Field label="External URL" required>
                        <input
                          value={selectedItem.service.externalUrl ?? ''}
                          onChange={(event) => updateSelectedItem((item) => (isServiceResource(item) ? { ...item, primaryUrl: event.target.value || null, service: { ...item.service, externalUrl: event.target.value || null } } : item))}
                          className={inputClass}
                        />
                      </Field>
                    )}
                  </div>

                  {selectedItem.service.kind === 'experience' ? (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <Field label="Формат" required>
                        <select
                          value={selectedItem.service.format}
                          onChange={(event) => updateSelectedItem((item) => (isServiceResource(item) && item.service.kind === 'experience' ? { ...item, service: { ...item.service, format: event.target.value as AdminServiceFormat } } : item))}
                          className={inputClass}
                        >
                          {ADMIN_SERVICE_FORMAT_VALUES.map((format) => (
                            <option key={format} value={format} className="bg-[var(--adm-popover)] text-[var(--adm-text)]">
                              {format}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Валюта">
                        <input value={selectedItem.service.currency || 'JPY'} readOnly className={cn(inputClass, 'text-[var(--adm-text-3)]')} />
                      </Field>
                      <Field label="Цена от">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={selectedItem.service.priceFrom ?? ''}
                          onChange={(event) => updateSelectedItem((item) => (isServiceResource(item) && item.service.kind === 'experience' ? { ...item, service: { ...item.service, priceFrom: event.target.value ? Number(event.target.value) : null } } : item))}
                          className={inputClass}
                        />
                      </Field>
                      <Field label="Длительность, мин">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={selectedItem.service.durationMin ?? ''}
                          onChange={(event) => updateSelectedItem((item) => (isServiceResource(item) && item.service.kind === 'experience' ? { ...item, service: { ...item.service, durationMin: event.target.value ? Number(event.target.value) : null } } : item))}
                          className={inputClass}
                        />
                      </Field>
                    </div>
                  ) : null}

                  {selectedItem.service.kind === 'experience' ? (
                    <Field label="Подкатегория" required>
                      <div className="flex flex-wrap gap-2">
                        {ADMIN_SERVICE_SUBCATEGORY_VALUES.map((subcategory) => {
                          const active = selectedItem.service.subcategory.includes(subcategory)
                          return (
                            <button
                              key={subcategory}
                              type="button"
                              onClick={() => toggleServiceSubcategory(subcategory)}
                              className={cn(
                                pillClass,
                                active
                                  ? 'border-[var(--adm-accent-border)] bg-[var(--adm-accent-bg)] text-[var(--adm-on-accent)]'
                                  : 'border-[var(--adm-border)] bg-[var(--adm-hover)] text-[var(--adm-text-2)] hover:border-[var(--adm-border-strong)] hover:text-[var(--adm-text)]',
                              )}
                            >
                              {subcategory}
                            </button>
                          )
                        })}
                      </div>
                    </Field>
                  ) : null}

                  <Field label="Теги услуги">
                    <div className="flex flex-wrap gap-2">
                      {ADMIN_SERVICE_TAG_VALUES.map((tag) => {
                        const active = selectedItem.service.tags.includes(tag)
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => toggleServiceTag(tag)}
                            className={cn(
                              pillClass,
                              active
                                ? 'border-[var(--adm-ok-border)] bg-[var(--adm-ok-bg)] text-[var(--adm-ok-text)]'
                                : 'border-[var(--adm-border)] bg-[var(--adm-hover)] text-[var(--adm-text-2)] hover:border-[var(--adm-border-strong)] hover:text-[var(--adm-text)]',
                            )}
                          >
                            {tag}
                          </button>
                        )
                      })}
                    </div>
                  </Field>

                  <Field label="Заметки для агента">
                    <textarea
                      value={selectedItem.service.agentNotes}
                      onChange={(event) => updateSelectedItem((item) => (isServiceResource(item) ? { ...item, service: { ...item.service, agentNotes: event.target.value } } : item))}
                      rows={4}
                      className={inputClass}
                    />
                  </Field>
                </>
              ) : null}

              {isRestaurantResource(selectedItem) ? (
                <>
                  <div className="rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-hover)] px-4 py-3">
                    <div className="text-[11px] font-medium text-[var(--adm-text-3)]">Поля ресторана</div>
                    <div className="mt-1 text-sm text-[var(--adm-text-3)]">Правки сохраняются в Airtable и попадают на публичную страницу ресторанов.</div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <Field label="Кухня">
                      <input
                        value={selectedItem.restaurant.cuisine}
                        onChange={(event) =>
                          updateSelectedItem((item) =>
                            isRestaurantResource(item) ? { ...item, restaurant: { ...item.restaurant, cuisine: event.target.value } } : item,
                          )
                        }
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Район">
                      <input
                        value={selectedItem.restaurant.area}
                        onChange={(event) =>
                          updateSelectedItem((item) =>
                            isRestaurantResource(item)
                              ? {
                                  ...item,
                                  regionLabel: event.target.value,
                                  restaurant: { ...item.restaurant, area: event.target.value },
                                }
                              : item,
                          )
                        }
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Обед, цена">
                      <input
                        value={selectedItem.restaurant.lunchPrice}
                        onChange={(event) =>
                          updateSelectedItem((item) =>
                            isRestaurantResource(item) ? { ...item, restaurant: { ...item.restaurant, lunchPrice: event.target.value } } : item,
                          )
                        }
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Ужин, цена">
                      <input
                        value={selectedItem.restaurant.dinnerPrice}
                        onChange={(event) =>
                          updateSelectedItem((item) =>
                            isRestaurantResource(item) ? { ...item, restaurant: { ...item.restaurant, dinnerPrice: event.target.value } } : item,
                          )
                        }
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Pocket Concierge URL" required>
                      <input
                        value={selectedItem.restaurant.pocketConciergeUrl}
                        onChange={(event) =>
                          updateSelectedItem((item) =>
                            isRestaurantResource(item)
                              ? {
                                  ...item,
                                  primaryUrl: event.target.value || null,
                                  restaurant: { ...item.restaurant, pocketConciergeUrl: event.target.value },
                                }
                              : item,
                          )
                        }
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Google Maps URL">
                      <input
                        value={selectedItem.restaurant.googleMapsUrl ?? ''}
                        onChange={(event) =>
                          updateSelectedItem((item) =>
                            isRestaurantResource(item)
                              ? { ...item, restaurant: { ...item.restaurant, googleMapsUrl: event.target.value || null } }
                              : item,
                          )
                        }
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Звёзды Michelin">
                      <input
                        type="number"
                        min={0}
                        max={3}
                        step={1}
                        value={selectedItem.restaurant.michelinStars}
                        onChange={(event) =>
                          updateSelectedItem((item) =>
                            isRestaurantResource(item)
                              ? {
                                  ...item,
                                  restaurant: { ...item.restaurant, michelinStars: event.target.value ? Number(event.target.value) : 0 },
                                }
                              : item,
                          )
                        }
                        className={inputClass}
                      />
                    </Field>
                  </div>
                </>
              ) : null}

              {isHotelResource(selectedItem) ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <Field label="Уровень" required>
                    <select
                      value={selectedItem.hotel.tier}
                      onChange={(event) =>
                        updateSelectedItem((item) => (isHotelResource(item) ? { ...item, hotel: { ...item.hotel, tier: event.target.value } } : item))
                      }
                      className={inputClass}
                    >
                      {ADMIN_RESOURCE_HOTEL_TIER_VALUES.map((tier) => (
                        <option key={tier} value={tier} className="bg-[var(--adm-popover)] text-[var(--adm-text)]">
                          {tier}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Ключ региона" required>
                    <select
                      value={selectedItem.hotel.regionKey}
                      onChange={(event) =>
                        updateSelectedItem((item) =>
                          isHotelResource(item) ? { ...item, hotel: { ...item.hotel, regionKey: event.target.value } } : item,
                        )
                      }
                      className={inputClass}
                    >
                      {ADMIN_RESOURCE_REGION_KEY_VALUES.map((regionKey) => (
                        <option key={regionKey} value={regionKey} className="bg-[var(--adm-popover)] text-[var(--adm-text)]">
                          {regionKey}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Trip URL">
                    <input
                      value={selectedItem.hotel.tripUrl ?? ''}
                      onChange={(event) =>
                        updateSelectedItem((item) =>
                          isHotelResource(item) ? { ...item, hotel: { ...item.hotel, tripUrl: event.target.value || null } } : item,
                        )
                      }
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Booking URL">
                    <input
                      value={selectedItem.hotel.bookingUrl ?? ''}
                      onChange={(event) =>
                        updateSelectedItem((item) =>
                          isHotelResource(item) ? { ...item, hotel: { ...item.hotel, bookingUrl: event.target.value || null } } : item,
                        )
                      }
                      className={inputClass}
                    />
                  </Field>
                  <label className="flex min-h-11 items-center gap-3 rounded-xl border border-[var(--adm-border)] bg-[var(--adm-hover)] px-3 text-sm text-[var(--adm-text)] lg:col-span-2">
                    <input
                      type="checkbox"
                      checked={selectedItem.hotel.ryokan}
                      onChange={(event) =>
                        updateSelectedItem((item) =>
                          isHotelResource(item) ? { ...item, hotel: { ...item.hotel, ryokan: event.target.checked } } : item,
                        )
                      }
                      className="size-4"
                    />
                    Mark as ryokan
                  </label>
                </div>
              ) : null}

              {isEventLikeResource(selectedItem) ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <Field label="Категория события" required>
                    <select
                      value={selectedItem.event.category}
                      onChange={(event) =>
                        updateSelectedItem((item) =>
                          isEventLikeResource(item)
                            ? { ...item, event: { ...item.event, category: event.target.value as AdminEventLikeResourceItem['event']['category'] } }
                            : item,
                        )
                      }
                      className={inputClass}
                    >
                      {eventCategories.map((category) => (
                        <option key={category} value={category} className="bg-[var(--adm-popover)] text-[var(--adm-text)]">
                          {category}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Жизненный цикл" required>
                    <select
                      value={selectedItem.event.lifecycle}
                      onChange={(event) =>
                        updateSelectedItem((item) =>
                          isEventLikeResource(item)
                            ? { ...item, event: { ...item.event, lifecycle: event.target.value as AdminEventLikeResourceItem['event']['lifecycle'] } }
                            : item,
                        )
                      }
                      className={inputClass}
                    >
                      {RESOURCE_EVENT_LIFECYCLE_VALUES.map((lifecycle) => (
                        <option key={lifecycle} value={lifecycle} className="bg-[var(--adm-popover)] text-[var(--adm-text)]">
                          {lifecycle}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Название (яп.)" required>
                    <input
                      value={selectedItem.event.titleJa}
                      onChange={(event) =>
                        updateSelectedItem((item) =>
                          isEventLikeResource(item) ? { ...item, event: { ...item.event, titleJa: event.target.value } } : item,
                        )
                      }
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Площадка" required>
                    <input
                      value={selectedItem.event.venue}
                      onChange={(event) =>
                        updateSelectedItem((item) =>
                          isEventLikeResource(item) ? { ...item, event: { ...item.event, venue: event.target.value } } : item,
                        )
                      }
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Площадка (яп.)">
                    <input
                      value={selectedItem.event.venueJa}
                      onChange={(event) =>
                        updateSelectedItem((item) =>
                          isEventLikeResource(item) ? { ...item, event: { ...item.event, venueJa: event.target.value } } : item,
                        )
                      }
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Neighborhood">
                    <input
                      value={selectedItem.event.neighborhood}
                      onChange={(event) =>
                        updateSelectedItem((item) =>
                          isEventLikeResource(item) ? { ...item, event: { ...item.event, neighborhood: event.target.value } } : item,
                        )
                      }
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Starts at" required>
                    <input
                      type="datetime-local"
                      value={toDateTimeLocalValue(selectedItem.event.startsAt)}
                      onChange={(event) =>
                        updateSelectedItem((item) =>
                          isEventLikeResource(item)
                            ? { ...item, event: { ...item.event, startsAt: fromDateTimeLocalValue(event.target.value) } }
                            : item,
                        )
                      }
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Ends at" required>
                    <input
                      type="datetime-local"
                      value={toDateTimeLocalValue(selectedItem.event.endsAt)}
                      onChange={(event) =>
                        updateSelectedItem((item) =>
                          isEventLikeResource(item)
                            ? { ...item, event: { ...item.event, endsAt: fromDateTimeLocalValue(event.target.value) } }
                            : item,
                        )
                      }
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Price label">
                    <input
                      value={selectedItem.event.priceLabel}
                      onChange={(event) =>
                        updateSelectedItem((item) =>
                          isEventLikeResource(item) ? { ...item, event: { ...item.event, priceLabel: event.target.value } } : item,
                        )
                      }
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Source URL" required>
                    <input
                      value={selectedItem.event.sourceUrl}
                      onChange={(event) =>
                        updateSelectedItem((item) =>
                          isEventLikeResource(item) ? { ...item, event: { ...item.event, sourceUrl: event.target.value } } : item,
                        )
                      }
                      className={inputClass}
                    />
                  </Field>
                  <label className="flex min-h-11 items-center gap-3 rounded-xl border border-[var(--adm-border)] bg-[var(--adm-hover)] px-3 text-sm text-[var(--adm-text)] lg:col-span-2">
                    <input
                      type="checkbox"
                      checked={selectedItem.event.featured}
                      onChange={(event) =>
                        updateSelectedItem((item) =>
                          isEventLikeResource(item) ? { ...item, event: { ...item.event, featured: event.target.checked } } : item,
                        )
                      }
                      className="size-4"
                    />
                    Featured event
                  </label>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {selectedItem.primaryUrl ? (
                  <a
                    href={selectedItem.primaryUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--adm-border)] bg-[var(--adm-hover)] px-4 text-sm text-[var(--adm-text)] transition hover:border-[var(--adm-border-strong)] hover:bg-[var(--adm-active)]"
                  >
                    <ExternalLink className="mr-2 size-4" />
                    Open primary link
                  </a>
                ) : null}

                {isServiceResource(selectedItem) && selectedItem.service.partnerUrl ? (
                  <a
                    href={selectedItem.service.partnerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--adm-border)] bg-[var(--adm-hover)] px-4 text-sm text-[var(--adm-text)] transition hover:border-[var(--adm-border-strong)] hover:bg-[var(--adm-active)]"
                  >
                    <ExternalLink className="mr-2 size-4" />
                    Open partner link
                  </a>
                ) : null}

                {isHotelResource(selectedItem) && selectedItem.hotel.tripUrl ? (
                  <a
                    href={selectedItem.hotel.tripUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--adm-border)] bg-[var(--adm-hover)] px-4 text-sm text-[var(--adm-text)] transition hover:border-[var(--adm-border-strong)] hover:bg-[var(--adm-active)]"
                  >
                    <ExternalLink className="mr-2 size-4" />
                    Open trip link
                  </a>
                ) : null}

                {isEventLikeResource(selectedItem) && selectedItem.event.sourceUrl ? (
                  <a
                    href={selectedItem.event.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--adm-border)] bg-[var(--adm-hover)] px-4 text-sm text-[var(--adm-text)] transition hover:border-[var(--adm-border-strong)] hover:bg-[var(--adm-active)]"
                  >
                    <ExternalLink className="mr-2 size-4" />
                    Open source
                  </a>
                ) : null}

                {isRestaurantResource(selectedItem) && selectedItem.restaurant.googleMapsUrl ? (
                  <a
                    href={selectedItem.restaurant.googleMapsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--adm-border)] bg-[var(--adm-hover)] px-4 text-sm text-[var(--adm-text)] transition hover:border-[var(--adm-border-strong)] hover:bg-[var(--adm-active)]"
                  >
                    <ExternalLink className="mr-2 size-4" />
                    Open maps
                  </a>
                ) : null}
              </div>

              {savedSelectedItem && isItemDirty(savedSelectedItem, selectedItem) ? (
                <div className="rounded-2xl border border-amber-400/18 bg-[var(--adm-warn-bg)] px-4 py-3 text-sm text-amber-50">
                  Unsaved changes for <span className="font-medium">{selectedItem.title}</span>.
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </AdminShell>
  )
}

const inputClass = cn(adminInputClass, 'min-h-11 disabled:cursor-not-allowed disabled:text-[var(--adm-text-3)]')
const pillClass = 'inline-flex min-h-9 items-center justify-center rounded-full border px-3 text-xs transition'

function StatusCell({
  label,
  value,
  active = false,
  onClick,
}: {
  label: string
  value: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-start justify-center gap-1.5 rounded-lg px-3 py-2.5 text-left transition',
        active ? 'bg-[var(--adm-active)]' : 'hover:bg-[var(--adm-hover)]',
      )}
    >
      <span className={cn('w-full truncate text-sm leading-tight', active ? 'text-[var(--adm-text)]' : 'text-[var(--adm-text-2)]')}>
        {label}
      </span>
      <span
        className={cn(
          'rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
          active ? 'bg-[var(--adm-accent-bg)] text-[var(--adm-accent-text)]' : 'bg-[var(--adm-active)] text-[var(--adm-text-2)]',
        )}
      >
        {value}
      </span>
    </button>
  )
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--adm-border)] bg-[var(--adm-hover)] px-3 py-2">
      <div className="text-[11px] font-medium text-[var(--adm-text-3)]">{label}</div>
      <div className="mt-1 truncate text-sm text-[var(--adm-text)]">{value}</div>
    </div>
  )
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-medium text-[var(--adm-text-3)]">
        {label}
        {required ? <span className="text-[var(--adm-danger-text)]"> *</span> : null}
      </span>
      {children}
    </label>
  )
}
