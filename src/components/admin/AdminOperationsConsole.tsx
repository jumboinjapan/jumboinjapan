'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { CheckCircle2, CloudUpload, FileText, LogOut, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { SeoWorkspaceDraft, WorkspaceStatus } from '@/lib/admin-seo-llm-storage'

export type AdminSection = 'overview' | 'poi-text' | 'route-text' | 'route-stops' | 'integrations'

export interface WorkspaceItem {
  id: string
  poiId: string
  nameRu: string
  nameEn: string
  descriptionRu: string
  descriptionEn: string
  category: string[]
  siteCity: string
  workingHours: string
  website: string
  draft: SeoWorkspaceDraft | null
}

interface WorkspaceResponse {
  ok: boolean
  draft: SeoWorkspaceDraft
  syncedFields?: {
    descriptionRu: string
    descriptionEn?: string
  }
  error?: string
}

interface AdminOperationsConsoleProps {
  items: WorkspaceItem[]
  routeCount: number
  initialSection: AdminSection
  currentPath: '/admin' | '/admin/seo-llm'
}

const statusStyles: Record<WorkspaceStatus, string> = {
  draft: 'border border-amber-400/20 bg-amber-500/10 text-amber-100',
  approved: 'border border-sky-400/20 bg-sky-500/10 text-sky-100',
  synced: 'border border-emerald-400/20 bg-emerald-500/10 text-emerald-100',
}

const statusLabels: Record<WorkspaceStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
  synced: 'Synced',
}

function getEffectiveStatus(item: WorkspaceItem): WorkspaceStatus {
  return item.draft?.status ?? 'draft'
}

function getWorkingDraftRu(item: WorkspaceItem) {
  return item.draft?.workingDraftRu ?? ''
}

function getWorkingDraftEn(item: WorkspaceItem) {
  return item.draft?.workingDraftEn ?? ''
}

function getApprovedRu(item: WorkspaceItem) {
  return item.draft?.approvedRu ?? ''
}

function getApprovedEn(item: WorkspaceItem) {
  return item.draft?.approvedEn ?? ''
}

function formatTimestamp(value?: string | null) {
  if (!value) return 'Not yet'

  try {
    return new Date(value).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return 'Not yet'
  }
}

async function postWorkspaceAction(payload: Record<string, unknown>) {
  const response = await fetch('/api/admin/seo-llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const data = (await response.json()) as WorkspaceResponse

  if (!response.ok || !data.ok) {
    throw new Error(data.error ?? 'Request failed')
  }

  return data
}

export function AdminOperationsConsole({ items, routeCount, currentPath }: AdminOperationsConsoleProps) {
  const stats = useMemo(() => {
    const drafts = items.filter((item) => getEffectiveStatus(item) === 'draft').length
    const approved = items.filter((item) => getEffectiveStatus(item) === 'approved').length
    const synced = items.filter((item) => getEffectiveStatus(item) === 'synced').length
    const cities = new Set(items.map((item) => item.siteCity).filter(Boolean)).size

    return {
      total: items.length,
      drafts,
      approved,
      synced,
      cities,
    }
  }, [items])

  return (
    <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-4 px-4 py-4 md:px-6 md:py-5">
      <UtilityBar currentPath={currentPath} />
      <StatusStrip stats={stats} routeCount={routeCount} />

      {currentPath === '/admin' ? <AdminLanding stats={stats} /> : <PoiTextWorkspace items={items} />}
    </div>
  )
}

function UtilityBar({ currentPath }: { currentPath: '/admin' | '/admin/seo-llm' }) {
  return (
    <header className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#08111d]/94 px-4 py-3 shadow-[0_18px_45px_rgba(3,8,20,0.32)] md:flex-row md:items-center md:justify-between">
      <div>
        <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Admin</div>
        <h1 className="text-lg font-semibold text-white">Editorial workspace</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SectionLink href="/admin" active={currentPath === '/admin'}>
          Overview
        </SectionLink>
        <SectionLink href="/admin/seo-llm" active={currentPath === '/admin/seo-llm'}>
          POI text
        </SectionLink>
        <a
          href="/api/admin/auth/logout"
          className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-3.5 text-sm text-slate-200 transition hover:border-white/18 hover:bg-white/[0.08] hover:text-white"
        >
          <LogOut className="mr-2 size-4" />
          Sign out
        </a>
      </div>
    </header>
  )
}

function SectionLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
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
      {children}
    </Link>
  )
}

function StatusStrip({
  stats,
  routeCount,
}: {
  stats: { total: number; drafts: number; approved: number; synced: number; cities: number }
  routeCount: number
}) {
  return (
    <section className="grid gap-2 rounded-2xl border border-white/10 bg-[#08111d]/88 px-4 py-3 text-sm text-slate-300 shadow-[0_16px_40px_rgba(3,8,20,0.24)] md:grid-cols-5">
      <StatusCell label="POIs" value={String(stats.total)} />
      <StatusCell label="Drafts" value={String(stats.drafts)} />
      <StatusCell label="Approved" value={String(stats.approved)} />
      <StatusCell label="Synced" value={String(stats.synced)} />
      <StatusCell label="Routes" value={String(routeCount)} />
    </section>
  )
}

function StatusCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-white">{value}</span>
    </div>
  )
}

function AdminLanding({
  stats,
}: {
  stats: { total: number; drafts: number; approved: number; synced: number; cities: number }
}) {
  return (
    <main className="space-y-3">
      <section className="rounded-2xl border border-white/10 bg-[#08111d]/92 p-4 shadow-[0_18px_45px_rgba(3,8,20,0.3)]">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Live module</div>
            <h2 className="text-base font-semibold text-white">POI text</h2>
            <p className="mt-1 text-sm text-slate-300">Find a POI, review source, write draft, approve, sync.</p>
          </div>
          <Link
            href="/admin/seo-llm"
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-sky-300/18 bg-sky-300/12 px-4 text-sm font-medium text-sky-50 transition hover:bg-sky-300/18"
          >
            Open workspace
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#08111d]/92 p-4 shadow-[0_18px_45px_rgba(3,8,20,0.3)]">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="pb-2 pr-4 font-medium">Module</th>
                <th className="pb-2 pr-4 font-medium">Scope</th>
                <th className="pb-2 pr-4 font-medium">Available</th>
                <th className="pb-2 font-medium">Next action</th>
              </tr>
            </thead>
            <tbody className="text-slate-200">
              <tr className="border-t border-white/8">
                <td className="py-3 pr-4 font-medium text-white">POI text</td>
                <td className="py-3 pr-4">{stats.total} records across {stats.cities} cities</td>
                <td className="py-3 pr-4">Live</td>
                <td className="py-3">
                  <Link href="/admin/seo-llm" className="text-sky-100 underline underline-offset-4">
                    Open editor
                  </Link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

function PoiTextWorkspace({ items }: { items: WorkspaceItem[] }) {
  const [workspaceItems, setWorkspaceItems] = useState(items)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | WorkspaceStatus>('all')
  const [cityFilter, setCityFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? '')
  const [isSyncing, startSyncTransition] = useTransition()
  const [flashMessage, setFlashMessage] = useState<string | null>(null)
  const [reviewedSourceById, setReviewedSourceById] = useState<Record<string, boolean>>({})

  const cityOptions = useMemo(
    () => Array.from(new Set(workspaceItems.map((item) => item.siteCity).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [workspaceItems],
  )

  const categoryOptions = useMemo(
    () => Array.from(new Set(workspaceItems.flatMap((item) => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [workspaceItems],
  )

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return workspaceItems.filter((item) => {
      const haystack = [item.poiId, item.nameRu, item.nameEn, item.siteCity, item.category.join(' ')].join(' ').toLowerCase()
      const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery)
      const matchesStatus = statusFilter === 'all' || getEffectiveStatus(item) === statusFilter
      const matchesCity = cityFilter === 'all' || item.siteCity === cityFilter
      const matchesCategory = categoryFilter === 'all' || item.category.includes(categoryFilter)
      return matchesQuery && matchesStatus && matchesCity && matchesCategory
    })
  }, [categoryFilter, cityFilter, query, statusFilter, workspaceItems])

  useEffect(() => {
    if (!filteredItems.some((item) => item.id === selectedId)) {
      setSelectedId(filteredItems[0]?.id ?? '')
    }
  }, [filteredItems, selectedId])

  const selectedItem = workspaceItems.find((item) => item.id === selectedId) ?? filteredItems[0] ?? null
  const sourceReviewed = selectedItem ? reviewedSourceById[selectedItem.id] ?? false : false
  const hasSourceText = selectedItem ? Boolean(selectedItem.descriptionRu.trim() || selectedItem.descriptionEn.trim()) : false
  const draftReady = selectedItem ? Boolean(getWorkingDraftRu(selectedItem).trim() || getWorkingDraftEn(selectedItem).trim()) : false
  const approvedReady = selectedItem ? Boolean(getApprovedRu(selectedItem).trim()) : false
  const syncReady = Boolean(selectedItem && (!hasSourceText || sourceReviewed) && draftReady && approvedReady)
  const syncComplete = selectedItem ? getEffectiveStatus(selectedItem) === 'synced' : false
  const selectedStatus = selectedItem ? getEffectiveStatus(selectedItem) : null

  const blockerHints = [
    hasSourceText && !sourceReviewed ? 'Review the current source text.' : null,
    !draftReady ? 'Write or seed the working draft.' : null,
    !approvedReady ? 'Set approved RU text before syncing.' : null,
    syncComplete ? 'Already synced upstream.' : null,
  ].filter(Boolean) as string[]

  function updateItem(recordId: string, updater: (item: WorkspaceItem) => WorkspaceItem) {
    setWorkspaceItems((currentItems) => currentItems.map((item) => (item.id === recordId ? updater(item) : item)))
  }

  async function saveDraft(recordId: string, nextItem: WorkspaceItem) {
    try {
      const data = await postWorkspaceAction({
        action: 'saveDraft',
        recordId: nextItem.id,
        poiId: nextItem.poiId,
        workingDraftRu: getWorkingDraftRu(nextItem),
        approvedRu: getApprovedRu(nextItem),
        workingDraftEn: getWorkingDraftEn(nextItem),
        approvedEn: getApprovedEn(nextItem),
      })

      updateItem(recordId, (item) => ({ ...item, draft: data.draft }))
      setFlashMessage('Draft saved')
    } catch (error) {
      setFlashMessage(error instanceof Error ? error.message : 'Could not save draft')
    }
  }

  async function mutateDraft(recordId: string, fields: Partial<SeoWorkspaceDraft>) {
    const currentItem = workspaceItems.find((item) => item.id === recordId)
    if (!currentItem) return

    const nextItem: WorkspaceItem = {
      ...currentItem,
      draft: {
        recordId: currentItem.id,
        poiId: currentItem.poiId,
        workingDraftRu: fields.workingDraftRu ?? getWorkingDraftRu(currentItem),
        approvedRu: fields.approvedRu ?? getApprovedRu(currentItem),
        workingDraftEn: fields.workingDraftEn ?? getWorkingDraftEn(currentItem),
        approvedEn: fields.approvedEn ?? getApprovedEn(currentItem),
        status:
          (fields.approvedRu ?? getApprovedRu(currentItem)) || (fields.approvedEn ?? getApprovedEn(currentItem))
            ? 'approved'
            : 'draft',
        updatedAt: new Date().toISOString(),
        syncedAt: currentItem.draft?.syncedAt ?? null,
      },
    }

    updateItem(recordId, () => nextItem)
    await saveDraft(recordId, nextItem)
  }

  function handleSync() {
    if (!selectedItem) return

    startSyncTransition(async () => {
      try {
        const data = await postWorkspaceAction({
          action: 'syncApproved',
          recordId: selectedItem.id,
          poiId: selectedItem.poiId,
          workingDraftRu: getWorkingDraftRu(selectedItem),
          approvedRu: getApprovedRu(selectedItem),
          workingDraftEn: getWorkingDraftEn(selectedItem),
          approvedEn: getApprovedEn(selectedItem),
        })

        setWorkspaceItems((currentItems) =>
          currentItems.map((item) =>
            item.id === selectedItem.id
              ? {
                  ...item,
                  descriptionRu: data.syncedFields?.descriptionRu ?? item.descriptionRu,
                  descriptionEn: data.syncedFields?.descriptionEn ?? item.descriptionEn,
                  draft: data.draft,
                }
              : item,
          ),
        )
        setFlashMessage('Approved text synced to Airtable')
      } catch (error) {
        setFlashMessage(error instanceof Error ? error.message : 'Could not sync to Airtable')
      }
    })
  }

  return (
    <main className="space-y-4 pb-28">
      {flashMessage ? (
        <div className="rounded-xl border border-sky-300/16 bg-sky-300/10 px-4 py-3 text-sm text-sky-50">{flashMessage}</div>
      ) : null}

      <section className="rounded-2xl border border-white/10 bg-[#08111d]/92 p-4 shadow-[0_18px_45px_rgba(3,8,20,0.3)]">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.8fr)_repeat(3,minmax(0,0.72fr))]">
          <label className="flex min-h-11 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 focus-within:border-sky-300/30">
            <Search className="size-4 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by POI, city, category"
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
            />
          </label>

          <FilterSelect
            label="Status"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as 'all' | WorkspaceStatus)}
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'draft', label: 'Draft' },
              { value: 'approved', label: 'Approved' },
              { value: 'synced', label: 'Synced' },
            ]}
          />
          <FilterSelect
            label="City"
            value={cityFilter}
            onChange={setCityFilter}
            options={[{ value: 'all', label: 'All cities' }, ...cityOptions.map((city) => ({ value: city, label: city }))]}
          />
          <FilterSelect
            label="Category"
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={[
              { value: 'all', label: 'All categories' },
              ...categoryOptions.map((category) => ({ value: category, label: category })),
            ]}
          />
        </div>

        <div className="mt-3 text-sm text-slate-400">{filteredItems.length} results</div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#08111d]/92 shadow-[0_18px_45px_rgba(3,8,20,0.3)]">
          <div className="max-h-[70vh] overflow-auto">
            {filteredItems.length === 0 ? (
              <div className="p-4 text-sm text-slate-300">No POIs match this search.</div>
            ) : (
              <div className="divide-y divide-white/8">
                {filteredItems.map((item) => {
                  const isActive = item.id === selectedId
                  const status = getEffectiveStatus(item)

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className={cn(
                        'grid w-full gap-1 px-4 py-3 text-left transition',
                        isActive ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]',
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="truncate text-sm font-medium text-white">{item.nameRu || item.nameEn || 'Untitled POI'}</div>
                        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium', statusStyles[status])}>
                          {statusLabels[status]}
                        </span>
                      </div>
                      <div className="truncate text-xs uppercase tracking-[0.14em] text-slate-500">{item.poiId || 'No POI ID'}</div>
                      <div className="truncate text-xs text-slate-400">
                        {item.siteCity || 'No city'}{item.category[0] ? ` • ${item.category[0]}` : ''}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        {!selectedItem ? (
          <section className="rounded-2xl border border-white/10 bg-[#08111d]/92 p-4 text-sm text-slate-300 shadow-[0_18px_45px_rgba(3,8,20,0.3)]">
            No POI selected.
          </section>
        ) : (
          <section className="space-y-4">
            <div className="grid gap-2 rounded-2xl border border-white/10 bg-[#08111d]/92 p-3 text-sm shadow-[0_18px_45px_rgba(3,8,20,0.3)] md:grid-cols-5">
              <MetaCell label="Status" value={selectedStatus ? statusLabels[selectedStatus] : 'Draft'} tone={selectedStatus ? statusStyles[selectedStatus] : statusStyles.draft} />
              <MetaCell label="POI" value={selectedItem.poiId || '—'} />
              <MetaCell label="City" value={selectedItem.siteCity || '—'} />
              <MetaCell label="Updated" value={formatTimestamp(selectedItem.draft?.updatedAt)} />
              <MetaCell label="Last sync" value={formatTimestamp(selectedItem.draft?.syncedAt)} />
            </div>

            <section className="rounded-2xl border border-white/10 bg-[#08111d]/92 p-4 shadow-[0_18px_45px_rgba(3,8,20,0.3)]">
              <div className="grid gap-4 xl:grid-cols-2">
                <TextPanel
                  title="Source"
                  description="Read only"
                  value={selectedItem.descriptionRu}
                  secondaryValue={selectedItem.descriptionEn}
                  readOnly
                  tone="reference"
                />
                <TextPanel
                  title="Draft"
                  description="Working text"
                  value={getWorkingDraftRu(selectedItem)}
                  secondaryValue={getWorkingDraftEn(selectedItem)}
                  tone="editable"
                  onChange={(value) => void mutateDraft(selectedItem.id, { workingDraftRu: value })}
                  onSecondaryChange={(value) => void mutateDraft(selectedItem.id, { workingDraftEn: value })}
                />
              </div>

              <div className="mt-4">
                <TextPanel
                  title="Approved"
                  description="Sync target"
                  value={getApprovedRu(selectedItem)}
                  secondaryValue={getApprovedEn(selectedItem)}
                  tone="editable"
                  onChange={(value) => void mutateDraft(selectedItem.id, { approvedRu: value })}
                  onSecondaryChange={(value) => void mutateDraft(selectedItem.id, { approvedEn: value })}
                />
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-[#08111d]/92 p-4 shadow-[0_18px_45px_rgba(3,8,20,0.3)]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Blockers</span>
                {blockerHints.length === 0 ? (
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-100">
                    Ready to sync
                  </span>
                ) : (
                  blockerHints.map((hint) => (
                    <span key={hint} className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-100">
                      {hint}
                    </span>
                  ))
                )}
              </div>
            </section>

            <CollapsiblePanel title="Change history">
              <div className="grid gap-2 md:grid-cols-2">
                <CompactStat label="Draft updated" value={formatTimestamp(selectedItem.draft?.updatedAt)} />
                <CompactStat label="Last sync" value={formatTimestamp(selectedItem.draft?.syncedAt)} />
                <CompactStat label="Source review" value={!hasSourceText ? 'Not needed' : sourceReviewed ? 'Reviewed' : 'Pending'} />
                <CompactStat label="Sync state" value={syncComplete ? 'Synced' : 'Pending'} />
              </div>
            </CollapsiblePanel>

            <CollapsiblePanel title="Supporting record context">
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                <CompactStat label="Name RU" value={selectedItem.nameRu || '—'} />
                <CompactStat label="Name EN" value={selectedItem.nameEn || '—'} />
                <CompactStat label="Category" value={selectedItem.category.join(', ') || '—'} />
                <CompactStat label="Hours" value={selectedItem.workingHours || '—'} />
              </div>
            </CollapsiblePanel>

            <CollapsiblePanel title="Related links">
              {selectedItem.website ? (
                <a href={selectedItem.website} target="_blank" rel="noreferrer" className="text-sm text-sky-100 underline underline-offset-4">
                  {selectedItem.website}
                </a>
              ) : (
                <div className="text-sm text-slate-400">No external website stored.</div>
              )}
            </CollapsiblePanel>
          </section>
        )}
      </div>

      {selectedItem ? (
        <div className="fixed inset-x-0 bottom-0 z-30 px-4 pb-4 md:px-6">
          <div className="mx-auto w-full max-w-[96rem] rounded-2xl border border-white/10 bg-[#08111e]/94 p-3 shadow-[0_-18px_50px_rgba(3,8,20,0.42)] backdrop-blur-xl">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 text-sm text-slate-300">
                <div className="truncate text-white">{selectedItem.nameRu || selectedItem.nameEn || 'No record selected'}</div>
              </div>

              <div className="flex flex-wrap gap-2">
                {hasSourceText ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 rounded-full border-white/12 bg-white/[0.04] px-4 text-white hover:border-white/22 hover:bg-white/[0.08]"
                    onClick={() => setReviewedSourceById((current) => ({ ...current, [selectedItem.id]: true }))}
                  >
                    <CheckCircle2 className="size-4" />
                    Mark source reviewed
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 rounded-full border-white/12 bg-white/[0.04] px-4 text-white hover:border-white/22 hover:bg-white/[0.08]"
                  onClick={() =>
                    void mutateDraft(selectedItem.id, {
                      workingDraftRu: selectedItem.descriptionRu,
                      workingDraftEn: selectedItem.descriptionEn,
                    })
                  }
                >
                  <FileText className="size-4" />
                  Use current as draft
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 rounded-full border-white/12 bg-white/[0.04] px-4 text-white hover:border-white/22 hover:bg-white/[0.08]"
                  onClick={() =>
                    void mutateDraft(selectedItem.id, {
                      approvedRu: getWorkingDraftRu(selectedItem),
                      approvedEn: getWorkingDraftEn(selectedItem),
                    })
                  }
                  disabled={!draftReady}
                >
                  <CheckCircle2 className="size-4" />
                  Copy draft to approved
                </Button>
                <Button
                  type="button"
                  className="min-h-11 rounded-full border border-sky-300/16 bg-sky-300/14 px-4 text-sky-50 hover:bg-sky-300/20"
                  onClick={handleSync}
                  disabled={isSyncing || !syncReady}
                >
                  <CloudUpload className="size-4" />
                  {isSyncing ? 'Syncing…' : syncComplete ? 'Synced to Airtable' : 'Sync approved text'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none transition focus:border-sky-300/30"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-[#081220] text-white">
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function MetaCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm text-white">
        {tone ? <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium', tone)}>{value}</span> : value}
      </div>
    </div>
  )
}

function CollapsiblePanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-2xl border border-white/10 bg-[#08111d]/92 shadow-[0_18px_45px_rgba(3,8,20,0.3)]">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-white">{title}</summary>
      <div className="border-t border-white/8 px-4 py-4">{children}</div>
    </details>
  )
}

function CompactStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-sm">
      <div className="text-slate-500">{label}</div>
      <div className="truncate text-white">{value}</div>
    </div>
  )
}

interface TextPanelProps {
  title: string
  description: string
  value: string
  secondaryValue?: string
  readOnly?: boolean
  tone?: 'reference' | 'editable'
  onChange?: (value: string) => void
  onSecondaryChange?: (value: string) => void
}

function TextPanel({
  title,
  description,
  value,
  secondaryValue = '',
  readOnly = false,
  tone = 'editable',
  onChange,
  onSecondaryChange,
}: TextPanelProps) {
  const isReference = tone === 'reference'

  return (
    <div
      className={cn(
        'space-y-3 rounded-2xl border p-4',
        isReference ? 'border-white/8 bg-white/[0.025]' : 'border-white/10 bg-white/[0.045]',
      )}
    >
      <div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="text-xs text-slate-400">{description}</p>
      </div>

      <label className="block space-y-2">
        <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">RU</span>
        <textarea
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          readOnly={readOnly}
          className={cn(
            'w-full rounded-xl border px-3 py-3 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500',
            isReference
              ? 'min-h-[220px] border-white/8 bg-[#07101b] read-only:bg-[#09121d]'
              : 'min-h-[280px] border-white/10 bg-[#030914] focus:border-sky-300/25 read-only:bg-[#0a1422]',
          )}
        />
      </label>

      <label className="block space-y-2">
        <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">EN</span>
        <textarea
          value={secondaryValue}
          onChange={(event) => onSecondaryChange?.(event.target.value)}
          readOnly={readOnly}
          className={cn(
            'w-full rounded-xl border px-3 py-3 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500',
            isReference
              ? 'min-h-[160px] border-white/8 bg-[#07101b] read-only:bg-[#09121d]'
              : 'min-h-[220px] border-white/10 bg-[#030914] focus:border-sky-300/25 read-only:bg-[#0a1422]',
          )}
        />
      </label>
    </div>
  )
}
