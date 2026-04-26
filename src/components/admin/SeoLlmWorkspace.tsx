'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { CheckCircle2, CloudUpload, FileText, Search } from 'lucide-react'

import { AdminShell } from '@/components/admin/AdminShell'
import { Button } from '@/components/ui/button'
import { formatAdminCityLabel } from '@/lib/admin-city-label'
import { cn } from '@/lib/utils'
import type { SeoWorkspaceDraft, WorkspaceStatus } from '@/lib/admin-seo-llm-storage'

interface WorkspaceItem {
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
    descriptionEn: string
  }
  error?: string
}

const statusStyles: Record<WorkspaceStatus, string> = {
  draft: 'bg-amber-100 text-amber-900',
  approved: 'bg-blue-100 text-blue-900',
  synced: 'bg-emerald-100 text-emerald-900',
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

export function SeoLlmWorkspace({ items }: { items: WorkspaceItem[] }) {
  const [workspaceItems, setWorkspaceItems] = useState(items)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? '')
  const [isSyncing, startSyncTransition] = useTransition()
  const [flashMessage, setFlashMessage] = useState<string | null>(null)
  const saveTimerRef = useRef<number | null>(null)

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    if (!normalizedQuery) return workspaceItems

    return workspaceItems.filter((item) => {
      const haystack = [
        item.poiId,
        item.nameRu,
        item.nameEn,
        item.siteCity,
        item.category.join(' '),
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(normalizedQuery)
    })
  }, [query, workspaceItems])

  useEffect(() => {
    if (!filteredItems.some((item) => item.id === selectedId)) {
      setSelectedId(filteredItems[0]?.id ?? '')
    }
  }, [filteredItems, selectedId])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  const selectedItem = workspaceItems.find((item) => item.id === selectedId) ?? filteredItems[0] ?? null

  function updateSelectedItem(updater: (item: WorkspaceItem) => WorkspaceItem) {
    setWorkspaceItems((currentItems) =>
      currentItems.map((item) => (item.id === selectedId ? updater(item) : item)),
    )
  }

  function scheduleSave(nextItem: WorkspaceItem) {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = window.setTimeout(async () => {
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

        setWorkspaceItems((currentItems) =>
          currentItems.map((item) =>
            item.id === nextItem.id
              ? {
                  ...item,
                  draft: data.draft,
                }
              : item,
          ),
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not save draft'
        setFlashMessage(message)
      }
    }, 600)
  }

  function mutateDraft(fields: Partial<SeoWorkspaceDraft>) {
    if (!selectedItem) return

    const nextItem: WorkspaceItem = {
      ...selectedItem,
      draft: {
        recordId: selectedItem.id,
        poiId: selectedItem.poiId,
        workingDraftRu: fields.workingDraftRu ?? getWorkingDraftRu(selectedItem),
        approvedRu: fields.approvedRu ?? getApprovedRu(selectedItem),
        workingDraftEn: fields.workingDraftEn ?? getWorkingDraftEn(selectedItem),
        approvedEn: fields.approvedEn ?? getApprovedEn(selectedItem),
        status:
          (fields.approvedRu ?? getApprovedRu(selectedItem)) || (fields.approvedEn ?? getApprovedEn(selectedItem))
            ? 'approved'
            : 'draft',
        updatedAt: new Date().toISOString(),
        syncedAt: selectedItem.draft?.syncedAt ?? null,
      },
    }

    updateSelectedItem(() => nextItem)
    scheduleSave(nextItem)
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
        const message = error instanceof Error ? error.message : 'Could not sync to Airtable'
        setFlashMessage(message)
      }
    })
  }

  return (
    <AdminShell currentPath="/admin/seo-llm" title="SEO / LLM">
      {flashMessage ? (
        <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white">
          {flashMessage}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="rounded-3xl border border-white/10 bg-[#0b1623]/90 p-1 shadow-sm">
          <div className="border-b border-white/10 p-4">
            <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
              <Search className="size-4 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by POI name, ID, city"
                className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
              />
            </label>
          </div>

          <div className="max-h-[70vh] overflow-y-auto p-2">
            {filteredItems.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
                No POIs match this search.
              </div>
            ) : (
              filteredItems.map((item) => {
                const status = getEffectiveStatus(item)
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={cn(
                      'mb-2 flex w-full flex-col gap-2 rounded-2xl border p-4 text-left transition',
                      item.id === selectedId
                        ? 'border-white/30 bg-white/[0.1] text-white shadow-sm'
                        : 'border-white/10 bg-[#0b1623]/60 hover:border-white/20 hover:bg-white/[0.05]',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-[0.14em] text-slate-400">{item.poiId || 'No POI ID'}</div>
                        <div className="text-sm font-semibold text-white">{item.nameRu || item.nameEn || 'Untitled POI'}</div>
                        <div className="text-xs text-slate-400">{item.nameEn || '—'}</div>
                      </div>
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2 py-1 text-[11px] font-medium capitalize',
                          item.id === selectedId ? 'bg-white/20 text-white' : statusStyles[status],
                        )}
                      >
                        {status}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                      <span>{formatAdminCityLabel(item.siteCity) || 'no city'}</span>
                      {item.category[0] ? <span>• {item.category[0]}</span> : null}
                      {item.draft?.syncedAt ? <span>• synced {new Date(item.draft.syncedAt).toLocaleString()}</span> : null}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        <section className="rounded-3xl border border-white/10 bg-[#0b1623]/90 p-6 shadow-sm text-white">
          {!selectedItem ? (
            <div className="p-8 text-sm text-slate-400">No POI selected.</div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-white">
                      {selectedItem.poiId || 'No POI ID'}
                    </span>
                    <span className={cn('rounded-full px-3 py-1 text-xs font-medium capitalize', statusStyles[getEffectiveStatus(selectedItem)])}>
                      {getEffectiveStatus(selectedItem)}
                    </span>
                  </div>
                  <div>
                    <h2 className="text-2xl font-semibold text-white">{selectedItem.nameRu || selectedItem.nameEn || 'Untitled POI'}</h2>
                    <p className="text-sm text-slate-400">{selectedItem.nameEn || 'No English title'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                    <span>City: {formatAdminCityLabel(selectedItem.siteCity) || '—'}</span>
                    <span>Category: {selectedItem.category.join(', ') || '—'}</span>
                    <span>Hours: {selectedItem.workingHours || '—'}</span>
                    <span>Website: {selectedItem.website || '—'}</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-white/20 text-white hover:bg-white/10"
                    onClick={() =>
                      mutateDraft({
                        workingDraftRu: selectedItem.descriptionRu,
                        workingDraftEn: selectedItem.descriptionEn,
                      })
                    }
                  >
                    <FileText className="size-4" />
                    Use current text as draft
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-white/20 text-white hover:bg-white/10"
                    onClick={() =>
                      mutateDraft({
                        approvedRu: getWorkingDraftRu(selectedItem),
                        approvedEn: getWorkingDraftEn(selectedItem),
                      })
                    }
                  >
                    <CheckCircle2 className="size-4" />
                    Copy draft to approved
                  </Button>
                  <Button type="button" onClick={handleSync} disabled={isSyncing || !getApprovedRu(selectedItem)} className="bg-white text-black hover:bg-white/90">
                    <CloudUpload className="size-4" />
                    {isSyncing ? 'Syncing…' : 'Sync approved text to Airtable'}
                  </Button>
                </div>
              </div>

              <div className="grid gap-6 xl:grid-cols-3">
                <TextPanel
                  title="Current Airtable text"
                  description="Read-only current source of truth from Airtable."
                  value={selectedItem.descriptionRu}
                  secondaryValue={selectedItem.descriptionEn}
                  readOnly
                />
                <TextPanel
                  title="Working draft"
                  description="Autosaved internal draft for editing and experimentation."
                  value={getWorkingDraftRu(selectedItem)}
                  secondaryValue={getWorkingDraftEn(selectedItem)}
                  onChange={(value) => mutateDraft({ workingDraftRu: value })}
                  onSecondaryChange={(value) => mutateDraft({ workingDraftEn: value })}
                />
                <TextPanel
                  title="Approved text"
                  description="Final reviewed text that can be synced back to Airtable."
                  value={getApprovedRu(selectedItem)}
                  secondaryValue={getApprovedEn(selectedItem)}
                  onChange={(value) => mutateDraft({ approvedRu: value })}
                  onSecondaryChange={(value) => mutateDraft({ approvedEn: value })}
                />
              </div>
            </div>
          )}
        </section>
      </div>
    </AdminShell>
  )
}

interface TextPanelProps {
  title: string
  description: string
  value: string
  secondaryValue?: string
  readOnly?: boolean
  onChange?: (value: string) => void
  onSecondaryChange?: (value: string) => void
}

function TextPanel({
  title,
  description,
  value,
  secondaryValue = '',
  readOnly = false,
  onChange,
  onSecondaryChange,
}: TextPanelProps) {
  return (
    <div className="space-y-4 rounded-3xl border border-black/10 bg-black/[0.02] p-4">
      <div>
        <h3 className="text-base font-semibold text-black">{title}</h3>
        <p className="text-sm leading-6 text-black/60">{description}</p>
      </div>

      <div className="space-y-3">
        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-black/50">RU description</span>
          <textarea
            value={value}
            onChange={(event) => onChange?.(event.target.value)}
            readOnly={readOnly}
            className="min-h-[280px] w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm leading-6 text-black outline-none ring-0 placeholder:text-black/30 read-only:bg-black/[0.03]"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-black/50">EN description</span>
          <textarea
            value={secondaryValue}
            onChange={(event) => onSecondaryChange?.(event.target.value)}
            readOnly={readOnly}
            className="min-h-[180px] w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm leading-6 text-black outline-none ring-0 placeholder:text-black/30 read-only:bg-black/[0.03]"
          />
        </label>
      </div>
    </div>
  )
}
