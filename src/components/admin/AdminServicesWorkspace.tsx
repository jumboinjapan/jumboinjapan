'use client'

import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, LogOut, Save, Search } from 'lucide-react'

import {
  ADMIN_SERVICE_FORMAT_VALUES,
  ADMIN_SERVICE_REGION_VALUES,
  ADMIN_SERVICE_STATUS_VALUES,
  ADMIN_SERVICE_SUBCATEGORY_VALUES,
  ADMIN_SERVICE_TAG_VALUES,
  type AdminServiceFormat,
  type AdminServiceItem,
  type AdminServiceStatus,
  type ExperienceSubcategory,
  type ServiceTag,
} from '@/lib/admin-services'
import { AdminWorkspaceNav } from '@/components/admin/AdminWorkspaceNav'
import { cn } from '@/lib/utils'

interface AdminServicesSummary {
  total: number
  experience: number
  practical: number
  cities: number
  withMissingDescription: number
  withMissingLink: number
}

interface AdminServicesWorkspaceProps {
  items: AdminServiceItem[]
  summary: AdminServicesSummary
  error?: string | null
}

interface ServicesPatchResponse {
  ok: boolean
  items?: AdminServiceItem[]
  saved?: number
  skipped?: number
  error?: string
}

function buildComparableItem(item: AdminServiceItem) {
  return JSON.stringify({
    ...item,
    tags: [...item.tags].sort(),
    subcategory: item.kind === 'experience' ? [...item.subcategory].sort() : [],
  })
}

function isItemDirty(original: AdminServiceItem | undefined, current: AdminServiceItem | undefined) {
  if (!original || !current) return false
  return buildComparableItem(original) !== buildComparableItem(current)
}

function getPrimaryUrl(item: AdminServiceItem) {
  return item.kind === 'experience' ? item.bookingUrl : item.externalUrl
}

function normalizeItemForKind(item: AdminServiceItem, kind: AdminServiceItem['kind']): AdminServiceItem {
  if (kind === 'practical') {
    return {
      ...item,
      kind: 'practical',
      region: item.region,
      format: '',
      subcategory: [],
      priceFrom: null,
      currency: '',
      durationMin: null,
      bookingUrl: null,
    }
  }

  return {
    ...item,
    kind: 'experience',
    format: item.kind === 'experience' && item.format ? item.format : ADMIN_SERVICE_FORMAT_VALUES[0],
    subcategory: item.kind === 'experience' && item.subcategory.length > 0 ? item.subcategory : [ADMIN_SERVICE_SUBCATEGORY_VALUES[0]],
    currency: item.kind === 'experience' && item.currency ? item.currency : 'JPY',
    bookingUrl: item.kind === 'experience' ? item.bookingUrl : null,
    priceFrom: item.kind === 'experience' ? item.priceFrom : null,
    durationMin: item.kind === 'experience' ? item.durationMin : null,
  }
}

export function AdminServicesWorkspace({ items, summary, error }: AdminServicesWorkspaceProps) {
  const [draftItems, setDraftItems] = useState(items)
  const [savedItems, setSavedItems] = useState(items)
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | AdminServiceItem['kind']>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | AdminServiceStatus>('all')
  const [selectedRecordId, setSelectedRecordId] = useState(items[0]?.recordId ?? '')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  useEffect(() => {
    setDraftItems(items)
    setSavedItems(items)
    setSelectedRecordId((current) => current || items[0]?.recordId || '')
  }, [items])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return draftItems.filter((item) => {
      if (kindFilter !== 'all' && item.kind !== kindFilter) return false
      if (statusFilter !== 'all' && item.status !== statusFilter) return false

      if (!normalizedQuery) return true

      const haystack = [
        item.id,
        item.name,
        item.city,
        item.description,
        item.kind,
        item.status,
        item.region,
        item.tags.join(' '),
        item.partner,
        item.venue,
        item.agentNotes,
        item.kind === 'experience' ? item.subcategory.join(' ') : '',
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(normalizedQuery)
    })
  }, [draftItems, kindFilter, query, statusFilter])

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
  const dirtyCount = dirtyRecordIds.size

  const currentSummary = useMemo(() => {
    return {
      ...summary,
      total: draftItems.length,
      experience: draftItems.filter((item) => item.kind === 'experience').length,
      practical: draftItems.filter((item) => item.kind === 'practical').length,
      cities: new Set(draftItems.map((item) => item.city.trim()).filter(Boolean)).size,
      withMissingDescription: draftItems.filter((item) => !item.description.trim()).length,
      withMissingLink: draftItems.filter((item) => !getPrimaryUrl(item)).length,
    }
  }, [draftItems, summary])

  function updateSelectedItem(updater: (item: AdminServiceItem) => AdminServiceItem) {
    if (!selectedItem) return

    setDraftItems((currentItems) =>
      currentItems.map((item) => (item.recordId === selectedItem.recordId ? updater(item) : item)),
    )
  }

  function toggleTag(tag: ServiceTag) {
    updateSelectedItem((item) => {
      const nextTags = item.tags.includes(tag) ? item.tags.filter((value) => value !== tag) : [...item.tags, tag]
      return { ...item, tags: nextTags }
    })
  }

  function toggleSubcategory(subcategory: ExperienceSubcategory) {
    updateSelectedItem((item) => {
      if (item.kind !== 'experience') return item
      const nextSubcategory = item.subcategory.includes(subcategory)
        ? item.subcategory.filter((value) => value !== subcategory)
        : [...item.subcategory, subcategory]
      return { ...item, subcategory: nextSubcategory }
    })
  }

  async function handleSave() {
    const dirtyItems = draftItems.filter((item) => dirtyRecordIds.has(item.recordId))
    if (dirtyItems.length === 0) return

    setSaving(true)
    setToast(null)

    try {
      const response = await fetch('/api/admin/services', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          records: dirtyItems.map((item) => ({
            id: item.recordId,
            fields: {
              'Service ID': item.id,
              'Service Name': item.name,
              'Service Kind': item.kind,
              Status: item.status,
              City: item.city,
              Region: item.region,
              Description: item.description,
              Tags: item.tags,
              Partner: item.partner,
              Venue: item.venue,
              'Partner URL': item.partnerUrl,
              'Booking URL': item.kind === 'experience' ? item.bookingUrl : null,
              'External URL': item.externalUrl,
              'Experience Format': item.kind === 'experience' ? item.format : '',
              'Experience Subcategory': item.kind === 'experience' ? item.subcategory : [],
              'Price From': item.kind === 'experience' ? item.priceFrom : null,
              Currency: item.kind === 'experience' ? item.currency : '',
              'Duration Minutes': item.kind === 'experience' ? item.durationMin : null,
              'Agent Notes': item.agentNotes,
            },
          })),
        }),
      })

      const data = (await response.json()) as ServicesPatchResponse
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? 'Failed to save services')
      }

      const updatedItems = data.items ?? []
      const updatedMap = new Map(updatedItems.map((item) => [item.recordId, item]))

      setDraftItems((currentItems) => currentItems.map((item) => updatedMap.get(item.recordId) ?? item))
      setSavedItems((currentItems) => currentItems.map((item) => updatedMap.get(item.recordId) ?? item))

      const savedCount = Number(data.saved ?? updatedItems.length)
      const skippedCount = Number(data.skipped ?? 0)
      const message = skippedCount > 0 ? `Saved ${savedCount} service(s), skipped ${skippedCount} unchanged.` : `Saved ${savedCount} service(s) to Airtable.`
      setToast({ type: 'ok', msg: message })
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Failed to save services'
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
          <h1 className="text-lg font-semibold text-white">Services</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Focused editor for the Services slice inside the canonical Resources workspace.
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

      <section className="grid gap-2 rounded-2xl border border-white/10 bg-[#08111d]/88 px-4 py-3 text-sm text-slate-300 shadow-[0_16px_40px_rgba(3,8,20,0.24)] md:grid-cols-6">
        <StatusCell label="Services" value={String(currentSummary.total)} />
        <StatusCell label="Experience" value={String(currentSummary.experience)} />
        <StatusCell label="Practical" value={String(currentSummary.practical)} />
        <StatusCell label="Cities" value={String(currentSummary.cities)} />
        <StatusCell label="Missing descriptions" value={String(currentSummary.withMissingDescription)} />
        <StatusCell label="Missing links" value={String(currentSummary.withMissingLink)} />
      </section>

      <section className="rounded-2xl border border-emerald-300/14 bg-emerald-300/10 px-4 py-3 text-sm text-emerald-50">
        <strong>Module inside Resources:</strong> this is the focused editor for the Services slice of the canonical <code className="rounded bg-black/20 px-1.5 py-0.5 text-xs">Resources</code> workspace. Service edits validate on save and write back to the shared <code className="rounded bg-black/20 px-1.5 py-0.5 text-xs">Resources</code> core plus <code className="rounded bg-black/20 px-1.5 py-0.5 text-xs">Resource Service Details</code>.
      </section>

      {error ? (
        <section className="rounded-2xl border border-red-400/18 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </section>
      ) : null}

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
              placeholder="Search by service, city, partner, subcategory"
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Type</span>
            <select
              value={kindFilter}
              onChange={(event) => setKindFilter(event.target.value as 'all' | AdminServiceItem['kind'])}
              className="min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none transition focus:border-sky-300/30"
            >
              <option value="all" className="bg-[#081220] text-white">All services</option>
              <option value="experience" className="bg-[#081220] text-white">Experience</option>
              <option value="practical" className="bg-[#081220] text-white">Practical</option>
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'all' | AdminServiceStatus)}
              className="min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none transition focus:border-sky-300/30"
            >
              <option value="all" className="bg-[#081220] text-white">All statuses</option>
              {ADMIN_SERVICE_STATUS_VALUES.map((status) => (
                <option key={status} value={status} className="bg-[#081220] text-white">{status}</option>
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
            {saving ? 'Saving…' : dirtyCount > 0 ? `Save ${dirtyCount} change${dirtyCount === 1 ? '' : 's'}` : 'No changes'}
          </button>
        </div>

        <div className="mt-3 text-sm text-slate-400">{filteredItems.length} results</div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#08111d]/92 shadow-[0_18px_45px_rgba(3,8,20,0.3)]">
          <div className="max-h-[70vh] overflow-auto">
            {filteredItems.length === 0 ? (
              <div className="p-4 text-sm text-slate-300">No services match this search.</div>
            ) : (
              <div className="divide-y divide-white/8">
                {filteredItems.map((item) => {
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
                        <div className="truncate text-sm font-medium text-white">{item.name}</div>
                        <span
                          className={cn(
                            'inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium',
                            item.kind === 'experience'
                              ? 'border border-sky-400/20 bg-sky-500/10 text-sky-100'
                              : 'border border-emerald-400/20 bg-emerald-500/10 text-emerald-100',
                          )}
                        >
                          {item.kind}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-xs">
                        <span className="truncate uppercase tracking-[0.14em] text-slate-500">{item.id}</span>
                        <span className="truncate text-slate-500">{item.status}</span>
                      </div>
                      <div className="truncate text-xs text-slate-400">{item.city}</div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-white/10 bg-[#08111d]/92 p-4 shadow-[0_18px_45px_rgba(3,8,20,0.3)]">
          {!selectedItem ? (
            <div className="text-sm text-slate-300">No service selected.</div>
          ) : (
            <>
              <div className="grid gap-2 md:grid-cols-4">
                <MetaCell label="Type" value={selectedItem.kind} />
                <MetaCell label="Status" value={selectedItem.status} />
                <MetaCell label="City" value={selectedItem.city || '—'} />
                <MetaCell label="Primary link" value={getPrimaryUrl(selectedItem) ? 'Present' : 'Missing'} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Field label="Service ID" required>
                  <input
                    value={selectedItem.id}
                    onChange={(event) => updateSelectedItem((item) => ({ ...item, id: event.target.value }))}
                    className={inputClass}
                  />
                </Field>

                <Field label="Service Name" required>
                  <input
                    value={selectedItem.name}
                    onChange={(event) => updateSelectedItem((item) => ({ ...item, name: event.target.value }))}
                    className={inputClass}
                  />
                </Field>

                <Field label="Service Kind" required>
                  <select
                    value={selectedItem.kind}
                    onChange={(event) => updateSelectedItem((item) => normalizeItemForKind(item, event.target.value as AdminServiceItem['kind']))}
                    className={inputClass}
                  >
                    <option value="experience" className="bg-[#081220] text-white">experience</option>
                    <option value="practical" className="bg-[#081220] text-white">practical</option>
                  </select>
                </Field>

                <Field label="Status" required>
                  <select
                    value={selectedItem.status}
                    onChange={(event) => updateSelectedItem((item) => ({ ...item, status: event.target.value as AdminServiceStatus }))}
                    className={inputClass}
                  >
                    {ADMIN_SERVICE_STATUS_VALUES.map((status) => (
                      <option key={status} value={status} className="bg-[#081220] text-white">{status}</option>
                    ))}
                  </select>
                </Field>

                <Field label="City" required>
                  <input
                    value={selectedItem.city}
                    onChange={(event) => updateSelectedItem((item) => ({ ...item, city: event.target.value }))}
                    className={inputClass}
                  />
                </Field>

                <Field label="Region">
                  <select
                    value={selectedItem.region}
                    onChange={(event) => updateSelectedItem((item) => ({ ...item, region: event.target.value as AdminServiceItem['region'] }))}
                    className={inputClass}
                  >
                    <option value="" className="bg-[#081220] text-white">—</option>
                    {ADMIN_SERVICE_REGION_VALUES.map((region) => (
                      <option key={region} value={region} className="bg-[#081220] text-white">{region}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Description">
                <textarea
                  value={selectedItem.description}
                  onChange={(event) => updateSelectedItem((item) => ({ ...item, description: event.target.value }))}
                  rows={5}
                  className={inputClass}
                />
              </Field>

              <div className="grid gap-4 lg:grid-cols-2">
                <Field label="Partner">
                  <input
                    value={selectedItem.partner}
                    onChange={(event) => updateSelectedItem((item) => ({ ...item, partner: event.target.value }))}
                    className={inputClass}
                  />
                </Field>

                <Field label="Venue">
                  <input
                    value={selectedItem.venue}
                    onChange={(event) => updateSelectedItem((item) => ({ ...item, venue: event.target.value }))}
                    className={inputClass}
                  />
                </Field>

                <Field label="Partner URL">
                  <input
                    value={selectedItem.partnerUrl}
                    onChange={(event) => updateSelectedItem((item) => ({ ...item, partnerUrl: event.target.value }))}
                    className={inputClass}
                  />
                </Field>

                {selectedItem.kind === 'experience' ? (
                  <Field label="Booking URL" required>
                    <input
                      value={selectedItem.bookingUrl ?? ''}
                      onChange={(event) => updateSelectedItem((item) => (item.kind === 'experience' ? { ...item, bookingUrl: event.target.value || null } : item))}
                      className={inputClass}
                    />
                  </Field>
                ) : (
                  <Field label="External URL" required>
                    <input
                      value={selectedItem.externalUrl ?? ''}
                      onChange={(event) => updateSelectedItem((item) => ({ ...item, externalUrl: event.target.value || null }))}
                      className={inputClass}
                    />
                  </Field>
                )}
              </div>

              {selectedItem.kind === 'experience' ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <Field label="Experience Format" required>
                    <select
                      value={selectedItem.format}
                      onChange={(event) => updateSelectedItem((item) => (item.kind === 'experience' ? { ...item, format: event.target.value as AdminServiceFormat } : item))}
                      className={inputClass}
                    >
                      {ADMIN_SERVICE_FORMAT_VALUES.map((format) => (
                        <option key={format} value={format} className="bg-[#081220] text-white">{format}</option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Currency">
                    <input value={selectedItem.currency || 'JPY'} readOnly className={cn(inputClass, 'text-slate-400')} />
                  </Field>

                  <Field label="Price From">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={selectedItem.priceFrom ?? ''}
                      onChange={(event) => updateSelectedItem((item) => (item.kind === 'experience' ? { ...item, priceFrom: event.target.value ? Number(event.target.value) : null } : item))}
                      className={inputClass}
                    />
                  </Field>

                  <Field label="Duration Minutes">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={selectedItem.durationMin ?? ''}
                      onChange={(event) => updateSelectedItem((item) => (item.kind === 'experience' ? { ...item, durationMin: event.target.value ? Number(event.target.value) : null } : item))}
                      className={inputClass}
                    />
                  </Field>
                </div>
              ) : null}

              {selectedItem.kind === 'experience' ? (
                <Field label="Experience Subcategory" required>
                  <div className="flex flex-wrap gap-2">
                    {ADMIN_SERVICE_SUBCATEGORY_VALUES.map((subcategory) => {
                      const active = selectedItem.subcategory.includes(subcategory)
                      return (
                        <button
                          key={subcategory}
                          type="button"
                          onClick={() => toggleSubcategory(subcategory)}
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

              <Field label="Tags">
                <div className="flex flex-wrap gap-2">
                  {ADMIN_SERVICE_TAG_VALUES.map((tag) => {
                    const active = selectedItem.tags.includes(tag)
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
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
                  value={selectedItem.agentNotes}
                  onChange={(event) => updateSelectedItem((item) => ({ ...item, agentNotes: event.target.value }))}
                  rows={4}
                  className={inputClass}
                />
              </Field>

              <div className="flex flex-wrap gap-2">
                {getPrimaryUrl(selectedItem) ? (
                  <a
                    href={getPrimaryUrl(selectedItem) ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm text-white transition hover:border-white/18 hover:bg-white/[0.08]"
                  >
                    <ExternalLink className="mr-2 size-4" />
                    Open primary link
                  </a>
                ) : null}

                {selectedItem.partnerUrl ? (
                  <a
                    href={selectedItem.partnerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm text-white transition hover:border-white/18 hover:bg-white/[0.08]"
                  >
                    <ExternalLink className="mr-2 size-4" />
                    Open partner link
                  </a>
                ) : null}
              </div>

              {selectedItem && savedSelectedItem && isItemDirty(savedSelectedItem, selectedItem) ? (
                <div className="rounded-2xl border border-amber-400/18 bg-amber-500/10 px-4 py-3 text-sm text-amber-50">
                  Unsaved changes for <span className="font-medium">{selectedItem.name}</span>.
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
  'min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none transition focus:border-sky-300/30'
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
