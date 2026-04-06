'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, useTransition, type Dispatch, type SetStateAction } from 'react'
import { CheckCircle2, CloudUpload, FileText, LogOut, Sparkles, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatAdminCityLabel } from '@/lib/admin-city-label'
import type { SeoWorkspaceDraft, WorkspaceStatus } from '@/lib/admin-seo-llm-storage'
import {
  POI_ADMIN_TEXT_BUDGET_FIELDS,
  analyzeTextBudget,
  formatTextBudgetGuidance,
  type TextBudgetFieldConfig,
  type TextBudgetStatus,
} from '@/lib/text-budgets'

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
  generatedDraftRu?: string
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

const textBudgetStateLabels: Record<TextBudgetStatus, string> = {
  ok: 'OK',
  warning: 'Long / Near limit',
  unsafe: 'Too long / Unsafe',
}

const textBudgetStateStyles: Record<TextBudgetStatus, string> = {
  ok: 'border-emerald-300/12 bg-emerald-300/10 text-emerald-100',
  warning: 'border-amber-300/12 bg-amber-300/10 text-amber-100',
  unsafe: 'border-orange-300/16 bg-orange-300/12 text-orange-50',
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
  const [workspaceItems, setWorkspaceItems] = useState(items)

  useEffect(() => {
    setWorkspaceItems(items)
  }, [items])

  const stats = useMemo(() => {
    const drafts = workspaceItems.filter((item) => getEffectiveStatus(item) === 'draft').length
    const approved = workspaceItems.filter((item) => getEffectiveStatus(item) === 'approved').length
    const synced = workspaceItems.filter((item) => getEffectiveStatus(item) === 'synced').length
    const cities = new Set(workspaceItems.map((item) => item.siteCity).filter(Boolean)).size

    return {
      total: workspaceItems.length,
      drafts,
      approved,
      synced,
      cities,
    }
  }, [workspaceItems])

  return (
    <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-4 px-4 py-4 md:px-6 md:py-5">
      <UtilityBar currentPath={currentPath} />
      <StatusStrip stats={stats} routeCount={routeCount} />

      {currentPath === '/admin' ? <AdminLanding stats={stats} /> : <PoiTextWorkspace items={workspaceItems} onItemsChange={setWorkspaceItems} />}
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
    <main>
      <section className="rounded-2xl border border-white/10 bg-[#08111d]/92 p-4 shadow-[0_18px_45px_rgba(3,8,20,0.3)]">
        <div className="flex flex-col gap-3 text-sm text-slate-200 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-medium text-white">POI text</span>
            <span>{stats.total} records across {stats.cities} cities</span>
            <span className="text-slate-400">Live</span>
          </div>
          <Link href="/admin/seo-llm" className="text-sky-100 underline underline-offset-4">
            Open editor
          </Link>
        </div>
      </section>
    </main>
  )
}

function PoiTextWorkspace({
  items,
  onItemsChange,
}: {
  items: WorkspaceItem[]
  onItemsChange: Dispatch<SetStateAction<WorkspaceItem[]>>
}) {
  const workspaceItems = items
  const setWorkspaceItems = onItemsChange
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | WorkspaceStatus>('all')
  const [cityFilter, setCityFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? '')
  const [isSyncing, startSyncTransition] = useTransition()
  const [isGenerating, startGenerateTransition] = useTransition()
  const [generationMode, setGenerationMode] = useState<'rewrite' | null>(null)
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

  function handleGenerate() {
    if (!selectedItem) return

    const existingDraft = getWorkingDraftRu(selectedItem).trim() || getWorkingDraftEn(selectedItem).trim()
    if (existingDraft) {
      const confirmed = window.confirm('Draft already has text. Replace it with a rewritten draft from the current source?')
      if (!confirmed) return
    }

    setGenerationMode('rewrite')
    startGenerateTransition(async () => {
      try {
        const data = await postWorkspaceAction({
          action: 'generateDraft',
          generationMode: 'rewrite',
          recordId: selectedItem.id,
          poiId: selectedItem.poiId,
          nameRu: selectedItem.nameRu,
          nameEn: selectedItem.nameEn,
          siteCity: selectedItem.siteCity,
          category: selectedItem.category,
          workingHours: selectedItem.workingHours,
          website: selectedItem.website,
          sourceRu: selectedItem.descriptionRu,
          sourceEn: selectedItem.descriptionEn,
          workingDraftRu: getWorkingDraftRu(selectedItem),
          approvedRu: getApprovedRu(selectedItem),
          workingDraftEn: getWorkingDraftEn(selectedItem),
          approvedEn: getApprovedEn(selectedItem),
        })

        updateItem(selectedItem.id, (item) => ({ ...item, draft: data.draft }))
        setFlashMessage('Source rewritten into draft')
      } catch (error) {
        setFlashMessage(error instanceof Error ? error.message : 'Could not rewrite source')
      } finally {
        setGenerationMode(null)
      }
    })
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
            options={[
              { value: 'all', label: 'All cities' },
              ...cityOptions.map((city) => ({ value: city, label: formatAdminCityLabel(city) })),
            ]}
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
                        {formatAdminCityLabel(item.siteCity) || 'No city'}{item.category[0] ? ` • ${item.category[0]}` : ''}
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
              <MetaCell label="City" value={formatAdminCityLabel(selectedItem.siteCity) || '—'} />
              <MetaCell label="Updated" value={formatTimestamp(selectedItem.draft?.updatedAt)} />
              <MetaCell label="Last sync" value={formatTimestamp(selectedItem.draft?.syncedAt)} />
            </div>

            <section className="rounded-2xl border border-white/10 bg-[#08111d]/92 p-4 shadow-[0_18px_45px_rgba(3,8,20,0.3)]">
              <div className="grid gap-4 xl:grid-cols-2">
                <TextPanel
                  title="Source"
                  description="Current Airtable text"
                  value={selectedItem.descriptionRu}
                  secondaryValue={selectedItem.descriptionEn}
                  readOnly
                  tone="reference"
                  badge="Read only"
                  primaryBudget={POI_ADMIN_TEXT_BUDGET_FIELDS.sourceRu}
                  secondaryBudget={POI_ADMIN_TEXT_BUDGET_FIELDS.sourceEn}
                  helper={
                    hasSourceText
                      ? sourceReviewed
                        ? 'Source reviewed for this record.'
                        : 'Review the current text before moving changes downstream.'
                      : 'No source text stored for this record.'
                  }
                />
                <TextPanel
                  title="Draft"
                  description="Working draft"
                  value={getWorkingDraftRu(selectedItem)}
                  secondaryValue={getWorkingDraftEn(selectedItem)}
                  tone="editable"
                  badge={isGenerating ? 'Generating…' : 'Autosave'}
                  primaryBudget={POI_ADMIN_TEXT_BUDGET_FIELDS.workingDraftRu}
                  secondaryBudget={POI_ADMIN_TEXT_BUDGET_FIELDS.workingDraftEn}
                  helper="Use this space for active editing and experimentation before approval. Rewrite source now aims for a safe default length with room before the warning range."
                  onChange={(value) => void mutateDraft(selectedItem.id, { workingDraftRu: value })}
                  onSecondaryChange={(value) => void mutateDraft(selectedItem.id, { workingDraftEn: value })}
                />
                <div className="xl:col-span-2">
                  <TextPanel
                    title="Approved"
                    description="Sync target"
                    value={getApprovedRu(selectedItem)}
                    secondaryValue={getApprovedEn(selectedItem)}
                    tone="approved"
                    badge="Ready for sync"
                    primaryBudget={POI_ADMIN_TEXT_BUDGET_FIELDS.approvedRu}
                    secondaryBudget={POI_ADMIN_TEXT_BUDGET_FIELDS.approvedEn}
                    helper="Final reviewed text that will be pushed back to Airtable when synced. Budgets stay advisory here so normal editing is not blocked."
                    onChange={(value) => void mutateDraft(selectedItem.id, { approvedRu: value })}
                    onSecondaryChange={(value) => void mutateDraft(selectedItem.id, { approvedEn: value })}
                  />
                </div>
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
                  disabled={isGenerating}
                >
                  <FileText className="size-4" />
                  Use current as draft
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 rounded-full border-white/12 bg-white/[0.04] px-4 text-white hover:border-white/22 hover:bg-white/[0.08]"
                  onClick={handleGenerate}
                  disabled={isGenerating || isSyncing}
                >
                  <Sparkles className="size-4" />
                  {isGenerating && generationMode === 'rewrite' ? 'Rewriting source…' : 'Rewrite source'}
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
                  disabled={!draftReady || isGenerating}
                >
                  <CheckCircle2 className="size-4" />
                  Promote draft to approved
                </Button>
                <Button
                  type="button"
                  className="min-h-11 rounded-full border border-sky-300/16 bg-sky-300/14 px-4 text-sky-50 hover:bg-sky-300/20"
                  onClick={handleSync}
                  disabled={isSyncing || isGenerating || !syncReady}
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
  tone?: 'reference' | 'editable' | 'approved'
  badge?: string
  helper?: string
  primaryBudget?: TextBudgetFieldConfig
  secondaryBudget?: TextBudgetFieldConfig
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
  badge,
  helper,
  primaryBudget,
  secondaryBudget,
  onChange,
  onSecondaryChange,
}: TextPanelProps) {
  const panelToneStyles: Record<NonNullable<TextPanelProps['tone']>, { shell: string; badge: string; field: string }> = {
    reference: {
      shell: 'border-white/10 bg-white/[0.03]',
      badge: 'border-white/10 bg-white/[0.04] text-slate-300',
      field: 'border-white/8 bg-[#07101b] read-only:bg-[#09121d]',
    },
    editable: {
      shell: 'border-white/10 bg-white/[0.04]',
      badge: 'border-sky-300/16 bg-sky-300/10 text-sky-100',
      field: 'border-white/10 bg-[#030914] focus:border-sky-300/25 read-only:bg-[#0a1422]',
    },
    approved: {
      shell: 'border-white/10 bg-white/[0.04]',
      badge: 'border-emerald-300/16 bg-emerald-300/10 text-emerald-100',
      field: 'border-white/10 bg-[#030914] focus:border-emerald-300/25 read-only:bg-[#0a1422]',
    },
  }

  const toneStyles = panelToneStyles[tone]

  return (
    <div className={cn('flex h-full flex-col overflow-hidden rounded-2xl border', toneStyles.shell)}>
      <div className="flex min-h-16 items-start justify-between gap-3 border-b border-white/8 px-5 py-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <p className="text-xs leading-5 text-slate-400">{description}</p>
        </div>
        {badge ? <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em]', toneStyles.badge)}>{badge}</span> : null}
      </div>

      <div className="flex flex-1 flex-col gap-4 px-5 py-5">
        <TextAreaField
          label="RU"
          value={value}
          readOnly={readOnly}
          emptyLabel={readOnly ? 'No source RU text' : 'Start the RU text here'}
          fieldClassName={toneStyles.field}
          budget={primaryBudget}
          onChange={onChange}
        />

        <TextAreaField
          label="EN"
          value={secondaryValue}
          readOnly={readOnly}
          emptyLabel={readOnly ? 'No source EN text' : 'Add the EN text here'}
          fieldClassName={toneStyles.field}
          budget={secondaryBudget}
          onChange={onSecondaryChange}
        />
      </div>

      <div className="min-h-12 border-t border-white/8 px-5 py-3 text-xs leading-5 text-slate-400">{helper ?? (readOnly ? 'Read-only reference surface.' : 'Editable text surface.')}</div>
    </div>
  )
}

function TextAreaField({
  label,
  value,
  readOnly,
  emptyLabel,
  fieldClassName,
  budget,
  onChange,
}: {
  label: string
  value: string
  readOnly: boolean
  emptyLabel: string
  fieldClassName: string
  budget?: TextBudgetFieldConfig
  onChange?: (value: string) => void
}) {
  // Local state keeps typing smooth — parent is only notified on blur to avoid
  // re-render-on-every-keystroke cursor-jump issues.
  const [localValue, setLocalValue] = useState(value)

  // Sync external updates (e.g. after generation) into local state.
  useEffect(() => {
    setLocalValue(value)
  }, [value])

  const hasValue = localValue.trim().length > 0
  const budgetAnalysis = budget ? analyzeTextBudget(localValue, budget.profile) : null

  return (
    <label className="block space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">{label}</span>

        {budgetAnalysis ? (
          <div className="flex flex-wrap items-center justify-end gap-2 text-right">
            <span className="text-[11px] text-slate-500">{hasValue ? `${budgetAnalysis.chars} chars` : 'Empty'}</span>
            <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium', textBudgetStateStyles[budgetAnalysis.status])}>
              {textBudgetStateLabels[budgetAnalysis.status]}
            </span>
          </div>
        ) : (
          <span className="text-[11px] text-slate-500">{hasValue ? `${localValue.trim().length} chars` : 'Empty'}</span>
        )}
      </div>

      {budgetAnalysis ? (
        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-[11px] leading-5 text-slate-400">
          <div>{formatTextBudgetGuidance(budgetAnalysis.profile)}</div>
          <div className="text-slate-500">Soft editorial guidance for card-safe POI copy.</div>
        </div>
      ) : null}

      <textarea
        value={localValue}
        onChange={(event) => setLocalValue(event.target.value)}
        onBlur={() => {
          if (localValue !== value) onChange?.(localValue)
        }}
        readOnly={readOnly}
        placeholder={emptyLabel}
        className={cn(
          'min-h-[220px] w-full rounded-xl border px-4 py-3 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500',
          fieldClassName,
        )}
      />
    </label>
  )
}
