'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { CalendarRange, ExternalLink, Filter, Hotel, Layers3, LogOut, Save, Search, Sparkles } from 'lucide-react'

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
import { AdminWorkspaceNav } from '@/components/admin/AdminWorkspaceNav'
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

const typeMeta: Record<AdminResourceItem['type'], { label: string; icon: typeof Sparkles }> = {
  service: { label: 'Services', icon: Sparkles },
  hotel: { label: 'Hotels', icon: Hotel },
  event: { label: 'Events', icon: CalendarRange },
  exhibition: { label: 'Exhibitions', icon: Layers3 },
  concert: { label: 'Concerts', icon: CalendarRange },
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

function getServicePrimaryUrl(item: AdminServiceResourceItem) {
  return item.service.kind === 'experience' ? item.service.bookingUrl : item.service.externalUrl
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
        isEventLikeResource(item)
          ? [item.event.titleJa, item.event.venue, item.event.venueJa, item.event.neighborhood, item.event.priceLabel].join(' ')
          : '',
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(normalizedQuery)
    })
  }, [draftItems, query, statusFilter, typeFilter])

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
      events: draftItems.filter((item) => item.type === 'event' || item.type === 'exhibition' || item.type === 'concert').length,
      draft: draftItems.filter((item) => item.status === 'draft').length,
      archived: draftItems.filter((item) => item.status === 'archived').length,
      missingDescriptions: draftItems.filter((item) => !item.description.trim()).length,
      missingPrimaryUrl: draftItems.filter((item) => !item.primaryUrl).length,
    }),
    [draftItems, summary],
  )

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
    <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-4 px-4 py-4 md:px-6 md:py-5">
      <header className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#08111d]/94 px-4 py-3 shadow-[0_18px_45px_rgba(3,8,20,0.32)] md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Admin</div>
          <h1 className="text-lg font-semibold text-white">Resources</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Canonical typed workspace across services, hotels, exhibitions, events, and concerts. Services now edit inline here as a typed module lens inside the parent resources surface.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <AdminWorkspaceNav currentPath="/admin/resources" />
          <a
            href="/api/admin/auth/logout"
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-3.5 text-sm text-slate-200 transition hover:border-white/18 hover:bg-white/[0.08] hover:text-white"
          >
            <LogOut className="mr-2 size-4" />
            Sign out
          </a>
        </div>
      </header>

      <section className="grid gap-2 rounded-2xl border border-white/10 bg-[#08111d]/88 px-4 py-3 text-sm text-slate-300 shadow-[0_16px_40px_rgba(3,8,20,0.24)] md:grid-cols-4 xl:grid-cols-8">
        <StatusCell label="Resources" value={String(currentSummary.total)} />
        <StatusCell label="Services" value={String(currentSummary.services)} />
        <StatusCell label="Hotels" value={String(currentSummary.hotels)} />
        <StatusCell label="Time-aware" value={String(currentSummary.events)} />
        <StatusCell label="Draft" value={String(currentSummary.draft)} />
        <StatusCell label="Archived" value={String(currentSummary.archived)} />
        <StatusCell label="Missing descriptions" value={String(currentSummary.missingDescriptions)} />
        <StatusCell label="Missing links" value={String(currentSummary.missingPrimaryUrl)} />
      </section>

      <section className="rounded-2xl border border-sky-300/14 bg-sky-300/10 px-4 py-3 text-sm text-sky-50">
        <strong>Canonical model:</strong> shared core fields live in <code className="rounded bg-black/20 px-1.5 py-0.5 text-xs">Resources</code>; service-specific fields write to <code className="rounded bg-black/20 px-1.5 py-0.5 text-xs">Resource Service Details</code>; hotels write to <code className="rounded bg-black/20 px-1.5 py-0.5 text-xs">Resource Hotel Details</code>; events / exhibitions / concerts write to <code className="rounded bg-black/20 px-1.5 py-0.5 text-xs">Resource Event Details</code>.
      </section>

      {toast ? (
        <section
          className={cn(
            'rounded-2xl px-4 py-3 text-sm',
            toast.type === 'ok'
              ? 'border border-emerald-400/18 bg-emerald-500/10 text-emerald-100'
              : 'border border-red-400/18 bg-red-500/10 text-red-100',
          )}
        >
          {toast.msg}
        </section>
      ) : null}

      <section className="rounded-2xl border border-white/10 bg-[#08111d]/92 p-4 shadow-[0_18px_45px_rgba(3,8,20,0.3)]">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_12rem_auto]">
          <label className="flex min-h-11 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 focus-within:border-sky-300/30">
            <Search className="size-4 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by title, city, venue, tags"
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Type</span>
            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as AdminResourceTypeFilter)}
              className={inputClass}
            >
              {ADMIN_RESOURCE_TYPE_FILTER_VALUES.map((type) => (
                <option key={type} value={type} className="bg-[#081220] text-white">
                  {type}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as (typeof ADMIN_RESOURCE_STATUS_FILTER_VALUES)[number])}
              className={inputClass}
            >
              {ADMIN_RESOURCE_STATUS_FILTER_VALUES.map((status) => (
                <option key={status} value={status} className="bg-[#081220] text-white">
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
                ? 'border-emerald-400/24 bg-emerald-500/14 text-emerald-50 hover:border-emerald-300/28 hover:bg-emerald-500/18'
                : 'cursor-not-allowed border-white/10 bg-white/[0.04] text-slate-500',
            )}
          >
            <Save className="mr-2 size-4" />
            {saving ? 'Saving…' : dirtyCount > 0 ? `Save ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}` : 'No editable changes'}
          </button>
        </div>

        <div className="mt-3 flex items-center gap-3 text-sm text-slate-400">
          <Filter className="size-4" />
          <span>{filteredItems.length} results</span>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#08111d]/92 shadow-[0_18px_45px_rgba(3,8,20,0.3)]">
          <div className="max-h-[72vh] overflow-auto">
            {filteredItems.length === 0 ? (
              <div className="p-4 text-sm text-slate-300">No resources match this search.</div>
            ) : (
              <div className="divide-y divide-white/8">
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
                        isActive ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]',
                        isDirty && 'border-l-2 border-amber-300',
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="truncate text-sm font-medium text-white">{item.title}</div>
                        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                          <Icon className="size-3" />
                          {meta.label}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="truncate uppercase tracking-[0.14em] text-slate-500">{item.resourceId}</span>
                        <span className="truncate text-slate-500">{item.status}</span>
                      </div>
                      <div className="truncate text-xs text-slate-400">
                        {item.city || '—'} · {item.regionLabel || '—'}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-white/10 bg-[#08111d]/92 p-4 shadow-[0_18px_45px_rgba(3,8,20,0.3)]">
          {!selectedItem ? (
            <div className="text-sm text-slate-300">No resource selected.</div>
          ) : (
            <>
              <div className="grid gap-2 md:grid-cols-4">
                <MetaCell label="Type" value={selectedItem.type} />
                <MetaCell label="Status" value={selectedItem.status} />
                <MetaCell label="Module" value={selectedItem.editorModule} />
                <MetaCell label="Primary link" value={selectedItem.primaryUrl ? 'Present' : 'Missing'} />
              </div>

              {isServiceResource(selectedItem) ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-slate-200">
                  <p className="font-medium text-white">Service module inside Resources</p>
                  <p className="mt-1 text-slate-400">
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
                <Field label="Resource Slug" required>
                  <input
                    value={selectedItem.slug}
                    onChange={(event) => updateSelectedItem((item) => ({ ...item, slug: event.target.value }))}
                    className={inputClass}
                  />
                </Field>
                <Field label="Resource Type" required>
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
                    disabled={selectedItem.type === 'service' || selectedItem.type === 'hotel'}
                  >
                    {selectedItem.type === 'service' ? (
                      <option value="service" className="bg-[#081220] text-white">
                        service
                      </option>
                    ) : isHotelResource(selectedItem) ? (
                      <option value="hotel" className="bg-[#081220] text-white">
                        hotel
                      </option>
                    ) : (
                      ['event', 'exhibition', 'concert'].map((type) => (
                        <option key={type} value={type} className="bg-[#081220] text-white">
                          {type}
                        </option>
                      ))
                    )}
                  </select>
                </Field>
                <Field label="Status" required>
                  <select
                    value={selectedItem.status}
                    onChange={(event) => updateSelectedItem((item) => ({ ...item, status: event.target.value as AdminResourceItem['status'] }))}
                    className={inputClass}
                  >
                    {ADMIN_RESOURCE_STATUS_FILTER_VALUES.filter((value) => value !== 'all').map((status) => (
                      <option key={status} value={status} className="bg-[#081220] text-white">
                        {status}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Title" required>
                  <input
                    value={selectedItem.title}
                    onChange={(event) => updateSelectedItem((item) => ({ ...item, title: event.target.value }))}
                    className={inputClass}
                  />
                </Field>
                <Field label="City" required>
                  <input
                    value={selectedItem.city}
                    onChange={(event) => updateSelectedItem((item) => ({ ...item, city: event.target.value }))}
                    className={inputClass}
                  />
                </Field>
                <Field label="Region label">
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
                      <option value="" className="bg-[#081220] text-white">
                        —
                      </option>
                      {ADMIN_SERVICE_REGION_VALUES.map((region) => (
                        <option key={region} value={region} className="bg-[#081220] text-white">
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

              <Field label="Summary">
                <textarea
                  value={selectedItem.summary}
                  onChange={(event) => updateSelectedItem((item) => ({ ...item, summary: event.target.value }))}
                  rows={3}
                  className={inputClass}
                />
              </Field>

              <Field label="Description">
                <textarea
                  value={selectedItem.description}
                  onChange={(event) => updateSelectedItem((item) => ({ ...item, description: event.target.value }))}
                  rows={5}
                  className={inputClass}
                />
              </Field>

              <Field label="Tags (comma separated)">
                <input value={selectedItem.tags.join(', ')} onChange={(event) => updateSelectedTags(event.target.value)} className={inputClass} />
              </Field>

              {isServiceResource(selectedItem) ? (
                <>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.025] px-4 py-3">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Service-specific fields</div>
                    <div className="mt-1 text-sm text-slate-400">Typed details for the service branch, kept inside the parent Resources editor.</div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <Field label="Kind" required>
                      <select
                        value={selectedItem.service.kind}
                        onChange={(event) => updateSelectedItem((item) => (isServiceResource(item) ? normalizeServiceItemForKind(item, event.target.value as AdminServiceResourceItem['service']['kind']) : item))}
                        className={inputClass}
                      >
                        <option value="experience" className="bg-[#081220] text-white">experience</option>
                        <option value="practical" className="bg-[#081220] text-white">practical</option>
                      </select>
                    </Field>
                    <Field label="Partner">
                      <input
                        value={selectedItem.service.partner}
                        onChange={(event) => updateSelectedItem((item) => (isServiceResource(item) ? { ...item, service: { ...item.service, partner: event.target.value } } : item))}
                        className={inputClass}
                      />
                    </Field>
                    <Field label="Venue">
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
                      <Field label="Format" required>
                        <select
                          value={selectedItem.service.format}
                          onChange={(event) => updateSelectedItem((item) => (isServiceResource(item) && item.service.kind === 'experience' ? { ...item, service: { ...item.service, format: event.target.value as AdminServiceFormat } } : item))}
                          className={inputClass}
                        >
                          {ADMIN_SERVICE_FORMAT_VALUES.map((format) => (
                            <option key={format} value={format} className="bg-[#081220] text-white">
                              {format}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Currency">
                        <input value={selectedItem.service.currency || 'JPY'} readOnly className={cn(inputClass, 'text-slate-400')} />
                      </Field>
                      <Field label="Price From">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={selectedItem.service.priceFrom ?? ''}
                          onChange={(event) => updateSelectedItem((item) => (isServiceResource(item) && item.service.kind === 'experience' ? { ...item, service: { ...item.service, priceFrom: event.target.value ? Number(event.target.value) : null } } : item))}
                          className={inputClass}
                        />
                      </Field>
                      <Field label="Duration Minutes">
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
                    <Field label="Subcategory" required>
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
                                  ? 'border-sky-300/28 bg-sky-500/18 text-sky-50'
                                  : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:text-white',
                              )}
                            >
                              {subcategory}
                            </button>
                          )
                        })}
                      </div>
                    </Field>
                  ) : null}

                  <Field label="Service tags">
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
                                ? 'border-emerald-300/28 bg-emerald-500/18 text-emerald-50'
                                : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:text-white',
                            )}
                          >
                            {tag}
                          </button>
                        )
                      })}
                    </div>
                  </Field>

                  <Field label="Agent Notes">
                    <textarea
                      value={selectedItem.service.agentNotes}
                      onChange={(event) => updateSelectedItem((item) => (isServiceResource(item) ? { ...item, service: { ...item.service, agentNotes: event.target.value } } : item))}
                      rows={4}
                      className={inputClass}
                    />
                  </Field>
                </>
              ) : null}

              {isHotelResource(selectedItem) ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <Field label="Tier" required>
                    <select
                      value={selectedItem.hotel.tier}
                      onChange={(event) =>
                        updateSelectedItem((item) => (isHotelResource(item) ? { ...item, hotel: { ...item.hotel, tier: event.target.value } } : item))
                      }
                      className={inputClass}
                    >
                      {ADMIN_RESOURCE_HOTEL_TIER_VALUES.map((tier) => (
                        <option key={tier} value={tier} className="bg-[#081220] text-white">
                          {tier}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Region key" required>
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
                        <option key={regionKey} value={regionKey} className="bg-[#081220] text-white">
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
                  <label className="flex min-h-11 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white lg:col-span-2">
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
                  <Field label="Event category" required>
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
                        <option key={category} value={category} className="bg-[#081220] text-white">
                          {category}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Lifecycle" required>
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
                        <option key={lifecycle} value={lifecycle} className="bg-[#081220] text-white">
                          {lifecycle}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Title JA" required>
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
                  <Field label="Venue" required>
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
                  <Field label="Venue JA">
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
                  <label className="flex min-h-11 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white lg:col-span-2">
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
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm text-white transition hover:border-white/18 hover:bg-white/[0.08]"
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
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm text-white transition hover:border-white/18 hover:bg-white/[0.08]"
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
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm text-white transition hover:border-white/18 hover:bg-white/[0.08]"
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
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm text-white transition hover:border-white/18 hover:bg-white/[0.08]"
                  >
                    <ExternalLink className="mr-2 size-4" />
                    Open source
                  </a>
                ) : null}
              </div>

              {savedSelectedItem && isItemDirty(savedSelectedItem, selectedItem) ? (
                <div className="rounded-2xl border border-amber-400/18 bg-amber-500/10 px-4 py-3 text-sm text-amber-50">
                  Unsaved changes for <span className="font-medium">{selectedItem.title}</span>.
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

const inputClass =
  'min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition focus:border-sky-300/30 disabled:cursor-not-allowed disabled:text-slate-500'
const pillClass = 'inline-flex min-h-9 items-center justify-center rounded-full border px-3 text-xs transition'

function StatusCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-white">{value}</span>
    </div>
  )
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm text-white">{value}</div>
    </div>
  )
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
        {label}
        {required ? <span className="text-red-300"> *</span> : null}
      </span>
      {children}
    </label>
  )
}
