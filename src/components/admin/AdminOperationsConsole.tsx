'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CloudUpload,
  Compass,
  FileText,
  Layers3,
  Map,
  MapPinned,
  Orbit,
  Search,
  ShieldCheck,
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
  draft: 'border border-amber-400/20 bg-amber-500/10 text-amber-100',
  approved: 'border border-sky-400/20 bg-sky-500/10 text-sky-100',
  synced: 'border border-emerald-400/20 bg-emerald-500/10 text-emerald-100',
}

const statusLabels: Record<WorkspaceStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
  synced: 'Synced',
}

const sectionMeta: Array<{
  id: AdminSection
  label: string
  shortLabel: string
  description: string
  href: string
  icon: typeof Layers3
  tone: string
}> = [
  {
    id: 'overview',
    label: 'Overview',
    shortLabel: 'Deck',
    description: 'Mission status, structure, and the live editorial landscape.',
    href: '/admin',
    icon: Layers3,
    tone: 'from-sky-400/20 via-cyan-400/10 to-transparent',
  },
  {
    id: 'poi-text',
    label: 'POI text',
    shortLabel: 'POI',
    description: 'Draft, approve, and sync evergreen place descriptions.',
    href: '/admin/seo-llm',
    icon: MapPinned,
    tone: 'from-indigo-400/20 via-sky-400/10 to-transparent',
  },
  {
    id: 'route-text',
    label: 'Route text',
    shortLabel: 'Routes',
    description: 'Reserved for itinerary-level narrative and search-facing copy.',
    href: '/admin?section=route-text',
    icon: Map,
    tone: 'from-violet-400/20 via-fuchsia-400/10 to-transparent',
  },
  {
    id: 'route-stops',
    label: 'Route stops',
    shortLabel: 'Stops',
    description: 'A future surface for stop-by-stop editorial sequencing.',
    href: '/admin?section=route-stops',
    icon: FileText,
    tone: 'from-amber-400/18 via-orange-400/10 to-transparent',
  },
  {
    id: 'integrations',
    label: 'Integrations',
    shortLabel: 'Systems',
    description: 'Future automations, publishing links, and assistant workflows.',
    href: '/admin?section=integrations',
    icon: Sparkles,
    tone: 'from-emerald-400/18 via-teal-400/10 to-transparent',
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
    <div className="mx-auto flex w-full max-w-[92rem] flex-col gap-6 px-4 py-4 md:px-6 md:py-6">
      <header className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#07111f]/95 shadow-[0_30px_80px_rgba(3,8,20,0.45)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(125,211,252,0.16),transparent_32%),radial-gradient(circle_at_80%_0%,rgba(129,140,248,0.16),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent_38%)]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent" />

        <div className="relative grid gap-6 px-5 py-6 md:px-7 md:py-7 xl:grid-cols-[minmax(0,1.35fr)_24rem] xl:items-end">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex min-h-9 items-center rounded-full border border-sky-300/18 bg-sky-300/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-100/88">
                Jumbo internal command deck
              </span>
              <span className="inline-flex min-h-9 items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-slate-300">
                Protected workspace
              </span>
            </div>

            <div className="max-w-4xl space-y-3">
              <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white md:text-[3.35rem] md:leading-[1.02]">
                Editorial operations, designed like a calm flight deck.
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-slate-300 md:text-[15px] md:leading-7">
                A private workspace for shaping destination copy, reviewing approved language, and preparing the next
                layer of internal publishing systems without making the tool feel technical or intimidating.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <HeroMetric label="POIs online" value={String(stats.total)} detail="Live records available for editorial work" />
              <HeroMetric label="Cities mapped" value={String(stats.cities)} detail="Coverage currently represented in the console" />
              <HeroMetric label="Ready to sync" value={String(stats.approved + stats.synced)} detail="Approved or already pushed back to Airtable" />
            </div>
          </div>

          <div className="grid gap-3">
            <div className="rounded-[1.6rem] border border-white/10 bg-white/6 p-4 backdrop-blur-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">System posture</div>
                  <div className="mt-2 text-base font-medium text-white">Quiet, private, ready for expansion</div>
                </div>
                <ShieldCheck className="mt-0.5 size-5 text-sky-200" />
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Google auth stays in place, robots are blocked, and the IA now leaves room for future internal tools.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-[1.6rem] border border-white/10 bg-[#0b1728]/88 p-4">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Operator actions</div>
                <div className="mt-1 text-sm text-slate-200">Use POI text for the live workflow. Everything else is staged cleanly for next modules.</div>
              </div>
              <a
                href="/api/admin/auth/logout"
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/12 bg-white/6 px-4 py-2 text-sm font-medium text-white transition hover:border-white/25 hover:bg-white/10"
              >
                Sign out
              </a>
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="space-y-4 xl:sticky xl:top-6 xl:h-fit">
          <div className="overflow-hidden rounded-[1.85rem] border border-white/10 bg-[#081220]/92 shadow-[0_24px_60px_rgba(3,8,20,0.35)]">
            <div className="border-b border-white/8 px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Navigation</div>
              <p className="mt-2 text-sm leading-6 text-slate-300">Each bay has a clear purpose so the system stays understandable as operations expand.</p>
            </div>

            <nav className="space-y-2 p-3" aria-label="Admin sections">
              {sectionMeta.map((section) => {
                const Icon = section.icon
                const isActive = section.id === activeSection

                return (
                  <Link
                    key={section.id}
                    href={section.href}
                    onClick={() => setActiveSection(section.id)}
                    className={cn(
                      'group relative flex min-h-14 items-start gap-3 overflow-hidden rounded-[1.35rem] border px-3 py-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/50',
                      isActive
                        ? 'border-white/14 bg-white/[0.085] text-white'
                        : 'border-transparent bg-transparent text-slate-300 hover:border-white/10 hover:bg-white/[0.04] hover:text-white',
                    )}
                  >
                    <div className={cn('absolute inset-0 bg-gradient-to-r opacity-0 transition', section.tone, isActive && 'opacity-100')} />
                    <div className={cn('relative flex size-10 shrink-0 items-center justify-center rounded-2xl border', isActive ? 'border-white/12 bg-white/10' : 'border-white/8 bg-white/[0.03]')}>
                      <Icon className={cn('size-4', isActive ? 'text-white' : 'text-slate-300')} />
                    </div>
                    <span className="relative min-w-0 flex-1">
                      <span className="block text-sm font-medium">{section.label}</span>
                      <span className={cn('mt-1 block text-xs leading-5', isActive ? 'text-slate-200' : 'text-slate-400')}>
                        {section.description}
                      </span>
                    </span>
                  </Link>
                )
              })}
            </nav>
          </div>

          <div className="rounded-[1.85rem] border border-white/10 bg-[#081220]/92 p-4 shadow-[0_24px_60px_rgba(3,8,20,0.35)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Live scope</div>
                <div className="mt-1 text-sm font-medium text-white">Current editorial inventory</div>
              </div>
              <Orbit className="size-5 text-sky-200/85" />
            </div>
            <dl className="mt-4 space-y-3">
              <StatRail label="Drafting" value={String(stats.drafts)} tone="text-amber-100" />
              <StatRail label="Approved" value={String(stats.approved)} tone="text-sky-100" />
              <StatRail label="Synced" value={String(stats.synced)} tone="text-emerald-100" />
              <StatRail label="Cities" value={String(stats.cities)} tone="text-white" />
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

function HeroMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[1.5rem] border border-white/10 bg-white/6 p-4 backdrop-blur-sm">
      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white">{value}</div>
      <div className="mt-2 text-sm leading-6 text-slate-300">{detail}</div>
    </div>
  )
}

function StatRail({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[1.2rem] border border-white/8 bg-white/[0.035] px-3 py-3">
      <dt className="text-sm text-slate-300">{label}</dt>
      <dd className={cn('text-sm font-semibold', tone ?? 'text-white')}>{value}</dd>
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
    <div className="relative overflow-hidden rounded-[1.85rem] border border-white/10 bg-[#081220]/92 p-5 shadow-[0_24px_60px_rgba(3,8,20,0.35)] md:p-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(125,211,252,0.14),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent_40%)]" />
      <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">{eyebrow}</p>
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white md:text-[2rem]">{title}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{description}</p>
          </div>
        </div>

        {currentPath === '/admin/seo-llm' ? (
          <div className="rounded-[1.25rem] border border-sky-300/14 bg-sky-300/8 px-4 py-3 text-sm leading-6 text-sky-100/90">
            Legacy direct route preserved for the live POI workflow.
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
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(19rem,0.9fr)]">
      <section className="rounded-[1.9rem] border border-white/10 bg-[#081220]/92 p-6 shadow-[0_24px_60px_rgba(3,8,20,0.35)] md:p-7">
        <div className="space-y-6">
          <div>
            <h3 className="text-xl font-semibold tracking-[-0.02em] text-white">How the workspace is organised</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
              The system is arranged like a clear command deck: one live operational bay today, with future modules
              visible but deliberately staged so nothing feels fake or premature.
            </p>
          </div>

          <div className="space-y-3">
            <OverviewRow
              title="POI text"
              description="Operational now. Review Airtable source text, create a working draft, approve the final version, then sync it back."
              href="/admin/seo-llm"
              cta="Open live workflow"
              icon={MapPinned}
            />
            <OverviewRow
              title="Route text"
              description="Planned bay for route-level narrative, SEO intros, and higher-level editorial framing across a full itinerary."
              icon={Compass}
            />
            <OverviewRow
              title="Route stops"
              description="Reserved for narrative handoffs between stops, transitions, and sequencing-aware copy that needs richer context."
              icon={FileText}
            />
            <OverviewRow
              title="Integrations"
              description="A holding zone for future publishing helpers, AI-assisted drafting, and back-office operations tools."
              icon={Sparkles}
            />
          </div>
        </div>
      </section>

      <aside className="space-y-6">
        <section className="rounded-[1.9rem] border border-white/10 bg-[#081220]/92 p-6 shadow-[0_24px_60px_rgba(3,8,20,0.35)]">
          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Current inventory</div>
          <dl className="mt-4 space-y-3">
            <InventoryCard label="POIs loaded" value={String(stats.total)} detail="Records accessible to the console right now" />
            <InventoryCard label="Cities represented" value={String(stats.cities)} detail="Geographic spread of loaded destination data" />
            <InventoryCard label="Working drafts" value={String(stats.drafts)} detail="Items still in active editorial revision" />
            <InventoryCard label="Approved or synced" value={String(stats.approved + stats.synced)} detail="Material closest to publication readiness" />
          </dl>
        </section>

        <section className="rounded-[1.9rem] border border-dashed border-white/12 bg-[#0b1728]/88 p-6 shadow-[0_24px_60px_rgba(3,8,20,0.35)]">
          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Design direction</div>
          <div className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
            <p>Deep-toned, composed, and tactile rather than generic SaaS white boxes.</p>
            <p>Editorial work feels important without turning the interface into dashboard theatre.</p>
            <p>Future integrations are framed as credible system bays, not decorative placeholders.</p>
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
  icon: Icon,
}: {
  title: string
  description: string
  href?: string
  cta?: string
  icon: typeof MapPinned
}) {
  return (
    <div className="flex flex-col gap-4 rounded-[1.55rem] border border-white/10 bg-white/[0.045] p-4 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
          <Icon className="size-4 text-sky-100" />
        </div>
        <div className="max-w-2xl">
          <h4 className="text-base font-medium text-white">{title}</h4>
          <p className="mt-1 text-sm leading-6 text-slate-300">{description}</p>
        </div>
      </div>
      {href && cta ? (
        <Link
          href={href}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/12 bg-white/8 px-4 py-2 text-sm font-medium text-white transition hover:border-white/25 hover:bg-white/12"
        >
          {cta}
          <ArrowRight className="size-4" />
        </Link>
      ) : (
        <span className="inline-flex min-h-11 items-center justify-center rounded-full border border-dashed border-white/14 px-4 py-2 text-sm text-slate-300">
          Planned next
        </span>
      )}
    </div>
  )
}

function InventoryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[1.35rem] border border-white/8 bg-white/[0.035] p-4">
      <div className="flex items-end justify-between gap-3">
        <dt className="text-sm text-slate-300">{label}</dt>
        <dd className="text-2xl font-semibold tracking-[-0.03em] text-white">{value}</dd>
      </div>
      <div className="mt-2 text-sm leading-6 text-slate-400">{detail}</div>
    </div>
  )
}

function FutureSection({ kind }: { kind: 'route-text' | 'route-stops' | 'integrations' }) {
  const content = {
    'route-text': {
      title: 'Route-level copy will dock here',
      body:
        'This section is reserved for writing attached to an entire route: overview copy, SEO summaries, campaign-friendly intros, and higher-level editorial framing.',
      modules: ['Route overview copy', 'SEO summaries and route intros', 'Editorial notes and approval states'],
    },
    'route-stops': {
      title: 'Stop-by-stop narrative editing will dock here',
      body:
        'This area is designed for more granular storytelling around stops, transitions, and moments where sequence matters more than a standalone POI description.',
      modules: ['Stop descriptions', 'Contextual helper copy', 'Sequence-aware review flow'],
    },
    integrations: {
      title: 'Future internal systems will dock here',
      body:
        'The IA now includes a dedicated systems bay, so publishing helpers, LLM tooling, and operations connectors can arrive without turning the admin area into one overloaded screen.',
      modules: ['Publishing helpers', 'AI-assisted drafting tools', 'Operations and promotion APIs'],
    },
  }[kind]

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.86fr)]">
      <section className="rounded-[1.9rem] border border-white/10 bg-[#081220]/92 p-6 shadow-[0_24px_60px_rgba(3,8,20,0.35)] md:p-7">
        <div className="max-w-2xl space-y-5">
          <div>
            <h3 className="text-xl font-semibold tracking-[-0.02em] text-white">{content.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">{content.body}</p>
          </div>

          <div className="rounded-[1.55rem] border border-dashed border-white/12 bg-white/[0.035] p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Planned modules</div>
            <ul className="mt-3 space-y-3 text-sm text-slate-200">
              {content.modules.map((module) => (
                <li key={module} className="flex items-start gap-3">
                  <ChevronRight className="mt-0.5 size-4 text-slate-500" />
                  <span>{module}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <aside className="rounded-[1.9rem] border border-white/10 bg-[#081220]/92 p-6 shadow-[0_24px_60px_rgba(3,8,20,0.35)]">
        <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Current status</div>
        <div className="mt-3 space-y-3 text-sm leading-6 text-slate-300">
          <p>This surface is intentionally honest about being staged, not yet operational.</p>
          <p>
            The live workflow remains in{' '}
            <Link href="/admin/seo-llm" className="font-medium text-white underline underline-offset-4">
              POI text
            </Link>
            , where draft, approval, and sync already work.
          </p>
          <p>Keeping these bays visible now makes the system architecture feel deliberate before the next integrations land.</p>
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

  useEffect(() => {
    if (!filteredItems.some((item) => item.id === selectedId)) {
      setSelectedId(filteredItems[0]?.id ?? '')
    }
  }, [filteredItems, selectedId])

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
    <div className="space-y-6">
      {flashMessage ? (
        <div className="rounded-[1.4rem] border border-sky-300/16 bg-sky-300/10 px-4 py-3 text-sm text-sky-50 shadow-[0_12px_30px_rgba(10,40,80,0.2)]">
          {flashMessage}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[21rem_minmax(0,1fr)]">
        <aside className="overflow-hidden rounded-[1.9rem] border border-white/10 bg-[#081220]/92 shadow-[0_24px_60px_rgba(3,8,20,0.35)]">
          <div className="border-b border-white/8 p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">POI registry</div>
                <div className="mt-1 text-sm text-slate-300">Search places and move between records without leaving the deck.</div>
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] text-slate-300">
                {filteredItems.length}
              </div>
            </div>

            <label className="flex items-center gap-3 rounded-[1.2rem] border border-white/10 bg-white/[0.04] px-3 py-2.5 focus-within:border-sky-300/30 focus-within:bg-white/[0.06]">
              <Search className="size-4 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, POI ID, city"
                className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
              />
            </label>
          </div>

          <div className="max-h-[72vh] overflow-y-auto p-2">
            {filteredItems.length === 0 ? (
              <div className="m-2 rounded-[1.3rem] border border-dashed border-white/12 bg-white/[0.035] p-4 text-sm text-slate-300">
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
                      'mb-2 flex w-full flex-col gap-2 rounded-[1.45rem] border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/50',
                      isActive
                        ? 'border-sky-300/18 bg-[linear-gradient(180deg,rgba(21,38,61,0.98),rgba(10,22,38,0.98))] text-white shadow-[0_20px_35px_rgba(3,8,20,0.35)]'
                        : 'border-white/8 bg-white/[0.035] text-slate-200 hover:border-white/14 hover:bg-white/[0.06]',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">{item.poiId || 'No POI ID'}</div>
                        <div className="truncate text-sm font-medium">{item.nameRu || item.nameEn || 'Untitled POI'}</div>
                        <div className="truncate text-xs text-slate-400">{item.nameEn || '—'}</div>
                      </div>
                      <span className={cn('inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium', statusStyles[status])}>{statusLabels[status]}</span>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                      <span>{item.siteCity || 'No city'}</span>
                      {item.category[0] ? <span>• {item.category[0]}</span> : null}
                      {item.draft?.syncedAt ? <span>• synced</span> : null}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        <section className="overflow-hidden rounded-[1.9rem] border border-white/10 bg-[#081220]/92 shadow-[0_24px_60px_rgba(3,8,20,0.35)]">
          {!selectedItem ? (
            <div className="p-8 text-sm text-slate-300">No POI selected.</div>
          ) : (
            <div className="space-y-6 p-5 md:p-6">
              <div className="flex flex-col gap-5 border-b border-white/8 pb-6">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-white/10 bg-white/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
                        {selectedItem.poiId || 'No POI ID'}
                      </span>
                      <span className={cn('rounded-full px-3 py-1 text-[11px] font-medium', statusStyles[getEffectiveStatus(selectedItem)])}>
                        {statusLabels[getEffectiveStatus(selectedItem)]}
                      </span>
                    </div>
                    <div>
                      <h3 className="text-2xl font-semibold tracking-[-0.03em] text-white md:text-[2rem]">
                        {selectedItem.nameRu || selectedItem.nameEn || 'Untitled POI'}
                      </h3>
                      <p className="mt-1 text-sm text-slate-400">{selectedItem.nameEn || 'No English title'}</p>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-400">
                      <span>City: {selectedItem.siteCity || '—'}</span>
                      <span>Category: {selectedItem.category.join(', ') || '—'}</span>
                      <span>Hours: {selectedItem.workingHours || '—'}</span>
                      <span className="max-w-full truncate">Website: {selectedItem.website || '—'}</span>
                    </div>
                  </div>

                  <div className="rounded-[1.45rem] border border-white/10 bg-white/[0.04] p-4">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Record activity</div>
                    <dl className="mt-3 space-y-3 text-sm text-slate-300">
                      <CompactStat label="Draft updated" value={formatTimestamp(selectedItem.draft?.updatedAt)} />
                      <CompactStat label="Last sync" value={formatTimestamp(selectedItem.draft?.syncedAt)} />
                      <CompactStat label="Source" value="Airtable → Admin deck" />
                    </dl>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 rounded-full border-white/12 bg-white/[0.05] px-4 text-white hover:border-white/22 hover:bg-white/[0.09]"
                    onClick={() =>
                      void mutateDraft(selectedItem.id, {
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
                    className="min-h-11 rounded-full border-white/12 bg-white/[0.05] px-4 text-white hover:border-white/22 hover:bg-white/[0.09]"
                    onClick={() =>
                      void mutateDraft(selectedItem.id, {
                        approvedRu: getWorkingDraftRu(selectedItem),
                        approvedEn: getWorkingDraftEn(selectedItem),
                      })
                    }
                  >
                    <CheckCircle2 className="size-4" />
                    Copy draft to approved
                  </Button>
                  <Button
                    type="button"
                    className="min-h-11 rounded-full border border-sky-300/16 bg-sky-300/12 px-4 text-sky-50 hover:bg-sky-300/18"
                    onClick={handleSync}
                    disabled={isSyncing || !getApprovedRu(selectedItem)}
                  >
                    <CloudUpload className="size-4" />
                    {isSyncing ? 'Syncing…' : 'Sync approved text to Airtable'}
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-3">
                <TextPanel
                  title="Current Airtable text"
                  description="Read-only source text currently stored in Airtable. This is your reference layer."
                  value={selectedItem.descriptionRu}
                  secondaryValue={selectedItem.descriptionEn}
                  readOnly
                />
                <TextPanel
                  title="Working draft"
                  description="Your editable drafting bay for revisions, alternatives, and structure changes."
                  value={getWorkingDraftRu(selectedItem)}
                  secondaryValue={getWorkingDraftEn(selectedItem)}
                  onChange={(value) => void mutateDraft(selectedItem.id, { workingDraftRu: value })}
                  onSecondaryChange={(value) => void mutateDraft(selectedItem.id, { workingDraftEn: value })}
                />
                <TextPanel
                  title="Approved text"
                  description="Final version ready to send back upstream once editorial review is complete."
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

function CompactStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[1rem] border border-white/8 bg-white/[0.035] px-3 py-2.5">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right text-white">{value}</dd>
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
    <div className="space-y-4 rounded-[1.65rem] border border-white/10 bg-white/[0.04] p-4">
      <div>
        <h4 className="text-base font-medium text-white">{title}</h4>
        <p className="mt-1 text-sm leading-6 text-slate-300">{description}</p>
      </div>

      <div className="space-y-3">
        <label className="block space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">RU description</span>
          <textarea
            value={value}
            onChange={(event) => onChange?.(event.target.value)}
            readOnly={readOnly}
            className="min-h-[280px] w-full rounded-[1.25rem] border border-white/10 bg-[#030914] px-4 py-3 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-300/25 read-only:bg-[#0a1422]"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">EN description</span>
          <textarea
            value={secondaryValue}
            onChange={(event) => onSecondaryChange?.(event.target.value)}
            readOnly={readOnly}
            className="min-h-[200px] w-full rounded-[1.25rem] border border-white/10 bg-[#030914] px-4 py-3 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-300/25 read-only:bg-[#0a1422]"
          />
        </label>
      </div>
    </div>
  )
}
