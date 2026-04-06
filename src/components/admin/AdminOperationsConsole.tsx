'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CloudUpload,
  FileText,
  Layers3,
  Map,
  MapPinned,
  Search,
  Sparkles,
} from 'lucide-react'

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
  initialSection: AdminSection
  currentPath: '/admin' | '/admin/seo-llm'
}

const statusStyles: Record<WorkspaceStatus, string> = {
  draft: 'bg-amber-100 text-amber-900',
  approved: 'bg-blue-100 text-blue-900',
  synced: 'bg-emerald-100 text-emerald-900',
}

const sectionMeta: Array<{
  id: AdminSection
  label: string
  shortLabel: string
  description: string
  href: string
  icon: typeof Layers3
}> = [
  {
    id: 'overview',
    label: 'Overview',
    shortLabel: 'Home',
    description: 'Start here for the current content workflow and what is coming next.',
    href: '/admin',
    icon: Layers3,
  },
  {
    id: 'poi-text',
    label: 'POI text',
    shortLabel: 'POI',
    description: 'Edit and sync generic place descriptions.',
    href: '/admin/seo-llm',
    icon: MapPinned,
  },
  {
    id: 'route-text',
    label: 'Route text',
    shortLabel: 'Routes',
    description: 'Reserved for route-level narrative and SEO copy.',
    href: '/admin?section=route-text',
    icon: Map,
  },
  {
    id: 'route-stops',
    label: 'Route stops',
    shortLabel: 'Stops',
    description: 'Contextual copy for stops, moments, and transitions.',
    href: '/admin?section=route-stops',
    icon: FileText,
  },
  {
    id: 'integrations',
    label: 'Integrations',
    shortLabel: 'Integrations',
    description: 'A home for future internal tools and APIs.',
    href: '/admin?section=integrations',
    icon: Sparkles,
  },
]

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

export function AdminOperationsConsole({ items, initialSection, currentPath }: AdminOperationsConsoleProps) {
  const [activeSection, setActiveSection] = useState<AdminSection>(initialSection)

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

  const activeMeta = sectionMeta.find((section) => section.id === activeSection) ?? sectionMeta[0]

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
      <header className="rounded-[2rem] border border-black/10 bg-white px-5 py-6 shadow-sm md:px-8 md:py-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-black/45">Internal operations</p>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-[-0.03em] text-black md:text-4xl">
                Editorial workspace for content operations
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-black/68 md:text-[15px]">
                A calm internal tool for shaping destination copy, approving text, and leaving clean space for the next
                wave of integrations.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:w-[24rem]">
            <div className="flex justify-end">
              <a
                href="/api/admin/auth/logout"
                className="inline-flex min-h-10 items-center rounded-full border border-black/10 px-4 py-2 text-sm text-black/65 transition hover:border-black/25 hover:text-black"
              >
                Sign out
              </a>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[1.5rem] border border-black/10 bg-black/[0.025] px-4 py-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-black/45">Current focus</div>
                <div className="mt-1 text-base font-medium text-black">POI text workflow is live</div>
                <div className="mt-1 text-sm leading-6 text-black/60">Draft → approve → sync back to Airtable.</div>
              </div>
              <div className="rounded-[1.5rem] border border-dashed border-black/12 bg-black/[0.02] px-4 py-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-black/45">Protection</div>
                <div className="mt-1 text-base font-medium text-black">Private and blocked from indexing</div>
                <div className="mt-1 text-sm leading-6 text-black/60">Google login and robots blocking protect the workspace.</div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="rounded-[2rem] border border-black/10 bg-white p-3 shadow-sm lg:sticky lg:top-6 lg:h-fit">
          <nav className="space-y-1" aria-label="Admin sections">
            {sectionMeta.map((section) => {
              const Icon = section.icon
              const isActive = section.id === activeSection

              return (
                <Link
                  key={section.id}
                  href={section.href}
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    'flex min-h-11 items-start gap-3 rounded-[1.4rem] px-3 py-3 transition',
                    isActive ? 'bg-black text-white' : 'text-black hover:bg-black/[0.04]',
                  )}
                >
                  <Icon className={cn('mt-0.5 size-4 shrink-0', isActive ? 'text-white' : 'text-black/55')} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{section.label}</span>
                    <span className={cn('mt-1 block text-xs leading-5', isActive ? 'text-white/72' : 'text-black/55')}>
                      {section.description}
                    </span>
                  </span>
                </Link>
              )
            })}
          </nav>

          <div className="mt-4 rounded-[1.5rem] border border-black/10 bg-black/[0.025] p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-black/45">Live scope</div>
            <dl className="mt-3 space-y-2 text-sm text-black/70">
              <div className="flex items-center justify-between gap-3">
                <dt>POIs</dt>
                <dd className="font-medium text-black">{stats.total}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>Drafts</dt>
                <dd className="font-medium text-black">{stats.drafts}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>Approved</dt>
                <dd className="font-medium text-black">{stats.approved}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>Synced</dt>
                <dd className="font-medium text-black">{stats.synced}</dd>
              </div>
            </dl>
          </div>
        </aside>

        <main className="min-w-0 space-y-6">
          <SectionHeading
            eyebrow={activeMeta.shortLabel}
            title={activeMeta.label}
            description={activeMeta.description}
            currentPath={currentPath}
          />

          {activeSection === 'overview' ? <OverviewPanel stats={stats} /> : null}
          {activeSection === 'poi-text' ? <PoiTextWorkspace items={items} /> : null}
          {activeSection === 'route-text' ? <FutureSection kind="route-text" /> : null}
          {activeSection === 'route-stops' ? <FutureSection kind="route-stops" /> : null}
          {activeSection === 'integrations' ? <FutureSection kind="integrations" /> : null}
        </main>
      </div>
    </div>
  )
}

function SectionHeading({
  eyebrow,
  title,
  description,
  currentPath,
}: {
  eyebrow: string
  title: string
  description: string
  currentPath: string
}) {
  return (
    <div className="rounded-[2rem] border border-black/10 bg-white px-5 py-5 shadow-sm md:px-6 md:py-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-black/45">{eyebrow}</p>
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.03em] text-black">{title}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-black/62">{description}</p>
          </div>
        </div>

        {currentPath === '/admin/seo-llm' ? (
          <div className="rounded-[1.25rem] border border-black/10 bg-black/[0.03] px-4 py-3 text-sm leading-6 text-black/60">
            Legacy direct route preserved for the POI workflow.
          </div>
        ) : null}
      </div>
    </div>
  )
}

function OverviewPanel({
  stats,
}: {
  stats: { total: number; drafts: number; approved: number; synced: number; cities: number }
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.9fr)]">
      <section className="rounded-[2rem] border border-black/10 bg-white p-6 shadow-sm md:p-7">
        <div className="space-y-5">
          <div>
            <h3 className="text-xl font-semibold tracking-[-0.02em] text-black">How the workspace is organised</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-black/62">
              The tool is split into plain-language work areas so it stays understandable now and scalable later.
            </p>
          </div>

          <div className="space-y-3">
            <OverviewRow
              title="POI text"
              description="Fully working today. Review current Airtable copy, draft edits, approve final text, then sync it back."
              href="/admin/seo-llm"
              cta="Open live workflow"
            />
            <OverviewRow
              title="Route text"
              description="Planned area for route-level intros, summaries, and other copy attached to a whole itinerary."
            />
            <OverviewRow
              title="Route stops"
              description="Planned area for stop descriptions, contextual microcopy, and editing copy with more narrative structure."
            />
            <OverviewRow
              title="Integrations"
              description="A reserved home for future API-assisted tasks, publishing helpers, and internal automations."
            />
          </div>
        </div>
      </section>

      <aside className="space-y-6">
        <section className="rounded-[2rem] border border-black/10 bg-white p-6 shadow-sm">
          <div className="text-[11px] uppercase tracking-[0.18em] text-black/45">Current inventory</div>
          <dl className="mt-4 space-y-4">
            <StatLine label="POIs loaded" value={String(stats.total)} />
            <StatLine label="Cities represented" value={String(stats.cities)} />
            <StatLine label="Working drafts" value={String(stats.drafts)} />
            <StatLine label="Approved items" value={String(stats.approved)} />
            <StatLine label="Synced back to Airtable" value={String(stats.synced)} />
          </dl>
        </section>

        <section className="rounded-[2rem] border border-dashed border-black/12 bg-white p-6 shadow-sm">
          <div className="text-[11px] uppercase tracking-[0.18em] text-black/45">Design direction</div>
          <div className="mt-3 space-y-2 text-sm leading-6 text-black/62">
            <p>Minimal navigation. Clear work areas. No dashboard theatre.</p>
            <p>Useful empty states now, without pretending unfinished modules are live.</p>
            <p>Room to expand into operations and promotion tooling without reworking the IA again.</p>
          </div>
        </section>
      </aside>
    </div>
  )
}

function OverviewRow({
  title,
  description,
  href,
  cta,
}: {
  title: string
  description: string
  href?: string
  cta?: string
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[1.5rem] border border-black/10 bg-black/[0.02] p-4 md:flex-row md:items-center md:justify-between">
      <div className="max-w-2xl">
        <h4 className="text-base font-medium text-black">{title}</h4>
        <p className="mt-1 text-sm leading-6 text-black/62">{description}</p>
      </div>
      {href && cta ? (
        <Link
          href={href}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-black/10 px-4 py-2 text-sm font-medium text-black transition hover:border-black/25 hover:bg-white"
        >
          {cta}
          <ArrowRight className="size-4" />
        </Link>
      ) : (
        <span className="inline-flex min-h-11 items-center rounded-full border border-dashed border-black/12 px-4 py-2 text-sm text-black/50">
          Planned next
        </span>
      )}
    </div>
  )
}

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-black/8 pb-3 last:border-b-0 last:pb-0">
      <dt className="text-sm text-black/60">{label}</dt>
      <dd className="text-sm font-medium text-black">{value}</dd>
    </div>
  )
}

function FutureSection({ kind }: { kind: 'route-text' | 'route-stops' | 'integrations' }) {
  const content = {
    'route-text': {
      title: 'Route-level copy will live here',
      body:
        'This section is reserved for text attached to a whole route: overview copy, route summaries, search-facing intros, and higher-level editorial notes.',
      modules: ['Route overview copy', 'SEO summaries', 'Editorial notes and approvals'],
    },
    'route-stops': {
      title: 'Stop-by-stop narrative editing will live here',
      body:
        'This section is intended for contextual copy around individual route stops, transitions, and explanatory notes that need more nuance than generic POI text.',
      modules: ['Stop descriptions', 'Contextual helper copy', 'Sequence-aware review flow'],
    },
    integrations: {
      title: 'Future internal tools and APIs will live here',
      body:
        'The IA now has an explicit home for future integrations so the content workspace can grow without becoming one giant page.',
      modules: ['Publishing helpers', 'LLM-assisted drafting tools', 'Operations and promotion APIs'],
    },
  }[kind]

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.85fr)]">
      <section className="rounded-[2rem] border border-black/10 bg-white p-6 shadow-sm md:p-7">
        <div className="max-w-2xl space-y-4">
          <div>
            <h3 className="text-xl font-semibold tracking-[-0.02em] text-black">{content.title}</h3>
            <p className="mt-2 text-sm leading-6 text-black/62">{content.body}</p>
          </div>

          <div className="rounded-[1.5rem] border border-dashed border-black/12 bg-black/[0.02] p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-black/45">Planned modules</div>
            <ul className="mt-3 space-y-3 text-sm text-black/70">
              {content.modules.map((module) => (
                <li key={module} className="flex items-start gap-3">
                  <ChevronRight className="mt-0.5 size-4 text-black/35" />
                  <span>{module}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <aside className="rounded-[2rem] border border-black/10 bg-white p-6 shadow-sm">
        <div className="text-[11px] uppercase tracking-[0.18em] text-black/45">Current status</div>
        <div className="mt-3 space-y-3 text-sm leading-6 text-black/62">
          <p>This area is intentionally a placeholder in this pass.</p>
          <p>
            The live editing workflow remains in <Link href="/admin/seo-llm" className="font-medium text-black underline underline-offset-4">POI text</Link>,
            where draft, approval, and sync already work.
          </p>
          <p>Keeping these sections visible now makes the information architecture clear before the next integrations are wired.</p>
        </div>
      </aside>
    </div>
  )
}

function PoiTextWorkspace({ items }: { items: WorkspaceItem[] }) {
  const [workspaceItems, setWorkspaceItems] = useState(items)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? '')
  const [isSyncing, startSyncTransition] = useTransition()
  const [flashMessage, setFlashMessage] = useState<string | null>(null)

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    if (!normalizedQuery) return workspaceItems

    return workspaceItems.filter((item) => {
      const haystack = [item.poiId, item.nameRu, item.nameEn, item.siteCity, item.category.join(' ')].join(' ').toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [query, workspaceItems])

  const selectedItem = workspaceItems.find((item) => item.id === selectedId) ?? filteredItems[0] ?? null

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
    <div className="space-y-6">
      {flashMessage ? (
        <div className="rounded-[1.5rem] border border-black/10 bg-black px-4 py-3 text-sm text-white">{flashMessage}</div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded-[2rem] border border-black/10 bg-white shadow-sm">
          <div className="border-b border-black/10 p-4">
            <label className="flex items-center gap-3 rounded-[1.2rem] border border-black/10 bg-black/[0.03] px-3 py-2.5">
              <Search className="size-4 text-black/45" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, POI ID, city"
                className="w-full bg-transparent text-sm outline-none placeholder:text-black/35"
              />
            </label>
          </div>

          <div className="max-h-[72vh] overflow-y-auto p-2">
            {filteredItems.length === 0 ? (
              <div className="rounded-[1.3rem] border border-dashed border-black/10 p-4 text-sm text-black/55">
                No POIs match this search.
              </div>
            ) : (
              filteredItems.map((item) => {
                const status = getEffectiveStatus(item)
                const isActive = item.id === selectedId

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={cn(
                      'mb-2 flex w-full flex-col gap-2 rounded-[1.4rem] border p-4 text-left transition',
                      isActive
                        ? 'border-black bg-black text-white shadow-sm'
                        : 'border-black/10 bg-white hover:border-black/25 hover:bg-black/[0.02]',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] uppercase tracking-[0.16em] opacity-55">{item.poiId || 'No POI ID'}</div>
                        <div className="truncate text-sm font-medium">{item.nameRu || item.nameEn || 'Untitled POI'}</div>
                        <div className="truncate text-xs opacity-70">{item.nameEn || '—'}</div>
                      </div>
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium capitalize',
                          isActive ? 'bg-white/15 text-white' : statusStyles[status],
                        )}
                      >
                        {status}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs opacity-75">
                      <span>{item.siteCity || 'no city'}</span>
                      {item.category[0] ? <span>• {item.category[0]}</span> : null}
                      {item.draft?.syncedAt ? <span>• synced</span> : null}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        <section className="rounded-[2rem] border border-black/10 bg-white shadow-sm">
          {!selectedItem ? (
            <div className="p-8 text-sm text-black/60">No POI selected.</div>
          ) : (
            <div className="space-y-6 p-5 md:p-6">
              <div className="flex flex-col gap-5 border-b border-black/10 pb-6">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-black px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white">
                      {selectedItem.poiId || 'No POI ID'}
                    </span>
                    <span className={cn('rounded-full px-3 py-1 text-[11px] font-medium capitalize', statusStyles[getEffectiveStatus(selectedItem)])}>
                      {getEffectiveStatus(selectedItem)}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-2xl font-semibold tracking-[-0.02em] text-black">
                      {selectedItem.nameRu || selectedItem.nameEn || 'Untitled POI'}
                    </h3>
                    <p className="mt-1 text-sm text-black/58">{selectedItem.nameEn || 'No English title'}</p>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-black/55">
                    <span>City: {selectedItem.siteCity || '—'}</span>
                    <span>Category: {selectedItem.category.join(', ') || '—'}</span>
                    <span>Hours: {selectedItem.workingHours || '—'}</span>
                    <span>Website: {selectedItem.website || '—'}</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      mutateDraft(selectedItem.id, {
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
                    onClick={() =>
                      mutateDraft(selectedItem.id, {
                        approvedRu: getWorkingDraftRu(selectedItem),
                        approvedEn: getWorkingDraftEn(selectedItem),
                      })
                    }
                  >
                    <CheckCircle2 className="size-4" />
                    Copy draft to approved
                  </Button>
                  <Button type="button" onClick={handleSync} disabled={isSyncing || !getApprovedRu(selectedItem)}>
                    <CloudUpload className="size-4" />
                    {isSyncing ? 'Syncing…' : 'Sync approved text to Airtable'}
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-3">
                <TextPanel
                  title="Current Airtable text"
                  description="Read-only source text currently stored in Airtable."
                  value={selectedItem.descriptionRu}
                  secondaryValue={selectedItem.descriptionEn}
                  readOnly
                />
                <TextPanel
                  title="Working draft"
                  description="Your editable draft space for exploration and revision."
                  value={getWorkingDraftRu(selectedItem)}
                  secondaryValue={getWorkingDraftEn(selectedItem)}
                  onChange={(value) => void mutateDraft(selectedItem.id, { workingDraftRu: value })}
                  onSecondaryChange={(value) => void mutateDraft(selectedItem.id, { workingDraftEn: value })}
                />
                <TextPanel
                  title="Approved text"
                  description="Final version ready to sync back to Airtable."
                  value={getApprovedRu(selectedItem)}
                  secondaryValue={getApprovedEn(selectedItem)}
                  onChange={(value) => void mutateDraft(selectedItem.id, { approvedRu: value })}
                  onSecondaryChange={(value) => void mutateDraft(selectedItem.id, { approvedEn: value })}
                />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
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
    <div className="space-y-4 rounded-[1.7rem] border border-black/10 bg-black/[0.02] p-4">
      <div>
        <h4 className="text-base font-medium text-black">{title}</h4>
        <p className="mt-1 text-sm leading-6 text-black/60">{description}</p>
      </div>

      <div className="space-y-3">
        <label className="block space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-black/45">RU description</span>
          <textarea
            value={value}
            onChange={(event) => onChange?.(event.target.value)}
            readOnly={readOnly}
            className="min-h-[280px] w-full rounded-[1.25rem] border border-black/10 bg-white px-4 py-3 text-sm leading-6 text-black outline-none placeholder:text-black/30 read-only:bg-black/[0.03]"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-black/45">EN description</span>
          <textarea
            value={secondaryValue}
            onChange={(event) => onSecondaryChange?.(event.target.value)}
            readOnly={readOnly}
            className="min-h-[200px] w-full rounded-[1.25rem] border border-black/10 bg-white px-4 py-3 text-sm leading-6 text-black outline-none placeholder:text-black/30 read-only:bg-black/[0.03]"
          />
        </label>
      </div>
    </div>
  )
}
