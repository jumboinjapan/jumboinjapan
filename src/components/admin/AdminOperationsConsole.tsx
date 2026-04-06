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
  LogOut,
  Map,
  MapPinned,
  Search,
  ShieldCheck,
  Sparkles,
  Wand2,
  X,
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

interface WorkflowStepState {
  id: 1 | 2 | 3 | 4
  label: string
  summary: string
  complete: boolean
  unlocked: boolean
}

function getSuggestedStep(steps: WorkflowStepState[]) {
  return steps.find((step) => step.unlocked && !step.complete)?.id ?? 4
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

export function AdminOperationsConsole({ items, routeCount, initialSection, currentPath }: AdminOperationsConsoleProps) {
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

            <div className="space-y-3 rounded-[1.6rem] border border-white/10 bg-[#0b1728]/88 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Navigation</div>
                  <div className="mt-1 text-sm text-slate-300">Top-level orientation stays shallow so the body can stay focused on editing.</div>
                </div>
                {currentPath === '/admin/seo-llm' ? (
                  <div className="rounded-full border border-sky-300/14 bg-sky-300/8 px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-sky-100/90">
                    Live POI workflow
                  </div>
                ) : null}
              </div>

              <nav className="flex flex-wrap gap-2" aria-label="Admin sections">
                {sectionMeta.map((section) => {
                  const Icon = section.icon
                  const isActive = section.id === activeSection

                  return (
                    <Link
                      key={section.id}
                      href={section.href}
                      onClick={() => setActiveSection(section.id)}
                      className={cn(
                        'inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/40',
                        isActive
                          ? 'border-white/14 bg-white/[0.085] text-white'
                          : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/16 hover:bg-white/[0.05] hover:text-white',
                      )}
                    >
                      <Icon className="size-3.5" />
                      <span>{section.label}</span>
                    </Link>
                  )
                })}
              </nav>

              <div className="flex flex-wrap gap-2.5">
                <TopScopePill label="Live pages" value={String(routeCount)} />
                <TopScopePill label="Drafts" value={String(stats.drafts)} />
                <TopScopePill label="Cities" value={String(stats.cities)} />
                <TopScopePill label="POIs" value={String(stats.total)} />
              </div>
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
              <UtilityLink href="/api/admin/auth/logout" label="Sign out">
                <LogOut className="size-3.5" />
              </UtilityLink>
            </div>
          </div>
        </div>
      </header>

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

function TopScopePill({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3.5 py-2 text-sm text-slate-200">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-white">{value}</span>
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
  const [statusFilter, setStatusFilter] = useState<'all' | WorkspaceStatus>('all')
  const [cityFilter, setCityFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? '')
  const [isSyncing, startSyncTransition] = useTransition()
  const [flashMessage, setFlashMessage] = useState<string | null>(null)
  const [reviewedSourceById, setReviewedSourceById] = useState<Record<string, boolean>>({})
  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4>(1)
  const [isWizardOpen, setIsWizardOpen] = useState(false)

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
  const approvedRuReady = selectedItem ? Boolean(getApprovedRu(selectedItem).trim()) : false
  const syncComplete = selectedItem ? getEffectiveStatus(selectedItem) === 'synced' : false

  const workflowSteps = useMemo<WorkflowStepState[]>(() => {
    const sourceComplete = !hasSourceText || sourceReviewed

    return [
      {
        id: 1,
        label: 'Review source',
        summary: hasSourceText ? 'Confirm the current Airtable text before editing.' : 'No source text is stored, so you can continue.',
        complete: sourceComplete,
        unlocked: true,
      },
      {
        id: 2,
        label: 'Write draft',
        summary: 'Shape the working version without touching the live source.',
        complete: draftReady,
        unlocked: sourceComplete,
      },
      {
        id: 3,
        label: 'Finalize approved',
        summary: 'Confirm the reviewed copy that should go back upstream.',
        complete: approvedRuReady,
        unlocked: sourceComplete && draftReady,
      },
      {
        id: 4,
        label: 'Sync to Airtable',
        summary: syncComplete ? 'Approved text is already synced upstream.' : 'Push the approved text back to Airtable when ready.',
        complete: syncComplete,
        unlocked: sourceComplete && draftReady && approvedRuReady,
      },
    ]
  }, [approvedRuReady, draftReady, hasSourceText, sourceReviewed, syncComplete])

  const completedSteps = workflowSteps.filter((step) => step.complete).length
  const progressPercent = Math.round((completedSteps / workflowSteps.length) * 100)
  const selectedStatus = selectedItem ? getEffectiveStatus(selectedItem) : null

  const validationItems = [
    {
      label: 'Source review',
      state: hasSourceText ? (workflowSteps[0]?.complete ? 'done' : 'warning') : 'neutral',
      message: hasSourceText ? (workflowSteps[0]?.complete ? 'Current Airtable text reviewed.' : 'Review the current Airtable text before drafting.') : 'No source text stored for this POI.',
    },
    {
      label: 'Working draft',
      state: draftReady ? 'done' : 'warning',
      message: draftReady ? 'Draft content is present.' : 'Draft is still empty.',
    },
    {
      label: 'Approved text',
      state: approvedRuReady ? 'done' : 'warning',
      message: approvedRuReady ? 'Approved RU text is ready for sync.' : 'Approved RU text is required before sync.',
    },
    {
      label: 'Publish readiness',
      state: workflowSteps[3]?.unlocked ? 'done' : 'warning',
      message: workflowSteps[3]?.unlocked ? 'Ready to sync to Airtable.' : 'Sync stays blocked until review, draft, and approval are complete.',
    },
  ] as const

  useEffect(() => {
    setActiveStep(getSuggestedStep(workflowSteps))
  }, [selectedId, workflowSteps])

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
        setIsWizardOpen(false)
      } catch (error) {
        setFlashMessage(error instanceof Error ? error.message : 'Could not sync to Airtable')
      }
    })
  }

  function openWizard(step?: 1 | 2 | 3 | 4) {
    if (step) {
      setActiveStep(step)
    }
    setIsWizardOpen(true)
  }

  function handleWizardPrimaryAction() {
    if (!selectedItem) return

    if (activeStep === 1) {
      if (hasSourceText) {
        setReviewedSourceById((current) => ({ ...current, [selectedItem.id]: true }))
      }
      setActiveStep(2)
      return
    }

    if (activeStep === 2) {
      setActiveStep(3)
      return
    }

    if (activeStep === 3) {
      if (!draftReady) return
      void mutateDraft(selectedItem.id, {
        approvedRu: getWorkingDraftRu(selectedItem),
        approvedEn: getWorkingDraftEn(selectedItem),
      })
      setActiveStep(4)
      return
    }

    handleSync()
  }

  return (
    <div className="space-y-6 pb-32">
      {flashMessage ? (
        <div className="rounded-[1.4rem] border border-sky-300/16 bg-sky-300/10 px-4 py-3 text-sm text-sky-50 shadow-[0_12px_30px_rgba(10,40,80,0.2)]">
          {flashMessage}
        </div>
      ) : null}

      <section className="rounded-[1.85rem] border border-white/10 bg-[#081220]/92 p-5 shadow-[0_24px_60px_rgba(3,8,20,0.35)] md:p-6">
        <div className="flex flex-col gap-5 border-b border-white/8 pb-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="max-w-3xl space-y-2">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Search and selection</div>
              <h3 className="text-2xl font-semibold tracking-[-0.03em] text-white">POI editor</h3>
              <p className="text-sm leading-6 text-slate-300">
                Search, switch records, and move straight into writing. Passive inventory stays in the top chrome so this band can stay operational.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 self-start">
              <Button
                type="button"
                variant="outline"
                className="min-h-10 rounded-full border-white/12 bg-white/[0.04] px-3.5 text-white hover:border-white/22 hover:bg-white/[0.08]"
                onClick={() => openWizard()}
                disabled={!selectedItem}
              >
                <Wand2 className="size-4" />
                Guided flow
              </Button>
              <UtilityLink href="/api/admin/auth/logout" label="Sign out">
                <LogOut className="size-3.5" />
              </UtilityLink>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1.7fr)_repeat(3,minmax(0,0.72fr))]">
          <label className="flex min-h-12 items-center gap-3 rounded-[1.2rem] border border-white/10 bg-white/[0.04] px-4 focus-within:border-sky-300/30 focus-within:bg-white/[0.06]">
            <Search className="size-4 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, POI ID, city, or category"
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
            />
          </label>

          <FilterSelect
            label="Status"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as 'all' | WorkspaceStatus)}
            options={[{ value: 'all', label: 'All statuses' }, { value: 'draft', label: 'Draft' }, { value: 'approved', label: 'Approved' }, { value: 'synced', label: 'Synced' }]}
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
            options={[{ value: 'all', label: 'All categories' }, ...categoryOptions.map((category) => ({ value: category, label: category }))]}
          />
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-slate-400">
          <span>{filteredItems.length} matching record{filteredItems.length === 1 ? '' : 's'}</span>
          <span>{selectedItem?.nameRu || selectedItem?.nameEn || 'No record selected'}</span>
        </div>

        <div className="mt-4 overflow-x-auto pb-1">
          <div className="flex min-w-max gap-3">
            {filteredItems.length === 0 ? (
              <div className="rounded-[1.3rem] border border-dashed border-white/12 bg-white/[0.035] px-4 py-5 text-sm text-slate-300">
                No POIs match this search.
              </div>
            ) : (
              filteredItems.slice(0, 10).map((item) => {
                const status = getEffectiveStatus(item)
                const isActive = item.id === selectedId

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={cn(
                      'w-[17.5rem] shrink-0 rounded-[1.35rem] border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/50',
                      isActive
                        ? 'border-sky-300/18 bg-[linear-gradient(180deg,rgba(21,38,61,0.98),rgba(10,22,38,0.98))] text-white shadow-[0_20px_35px_rgba(3,8,20,0.35)]'
                        : 'border-white/8 bg-white/[0.035] text-slate-200 hover:border-white/14 hover:bg-white/[0.06]',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">{item.poiId || 'No POI ID'}</div>
                        <div className="truncate text-sm font-medium">{item.nameRu || item.nameEn || 'Untitled POI'}</div>
                        <div className="mt-1 truncate text-xs text-slate-400">{item.siteCity || 'No city'}{item.category[0] ? ` • ${item.category[0]}` : ''}</div>
                      </div>
                      <span className={cn('inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium', statusStyles[status])}>{statusLabels[status]}</span>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </section>

      {!selectedItem ? (
        <div className="rounded-[1.85rem] border border-white/10 bg-[#081220]/92 p-8 text-sm text-slate-300 shadow-[0_24px_60px_rgba(3,8,20,0.35)]">
          No POI selected.
        </div>
      ) : (
        <>
          <section className="rounded-[1.85rem] border border-white/10 bg-[#081220]/92 p-4 shadow-[0_24px_60px_rgba(3,8,20,0.35)] md:p-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <MetaStripItem label="Status" value={selectedStatus ? statusLabels[selectedStatus] : 'Draft'} detail={syncComplete ? 'Synced upstream' : 'Local workspace state'} tone={selectedStatus ? statusStyles[selectedStatus] : statusStyles.draft} />
              <MetaStripItem label="POI ID" value={selectedItem.poiId || '—'} detail="Record identifier" />
              <MetaStripItem label="City" value={selectedItem.siteCity || '—'} detail={selectedItem.category.join(', ') || 'No category'} />
              <MetaStripItem label="Draft updated" value={formatTimestamp(selectedItem.draft?.updatedAt)} detail="Autosave on" />
              <MetaStripItem label="Last sync" value={formatTimestamp(selectedItem.draft?.syncedAt)} detail="Airtable remains source of truth" />
            </div>
          </section>

          <div className="space-y-5">
            <EditorSection
              eyebrow="Description / editorial content"
              title="Editorial text"
              description="Main writing surface: source reference, working draft, and approved copy."
            >
              <div className="grid gap-4 xl:grid-cols-2">
                <TextPanel
                  title="Current Airtable text"
                  description="Reference only. Review what is live upstream before rewriting or approving anything."
                  value={selectedItem.descriptionRu}
                  secondaryValue={selectedItem.descriptionEn}
                  stepLabel="Source"
                  readOnly
                  tone="reference"
                />
                <TextPanel
                  title="Working draft"
                  description="Autosaved internal draft. This is the main editable surface for active writing."
                  value={getWorkingDraftRu(selectedItem)}
                  secondaryValue={getWorkingDraftEn(selectedItem)}
                  stepLabel="Draft"
                  tone="editable"
                  onChange={(value) => void mutateDraft(selectedItem.id, { workingDraftRu: value })}
                  onSecondaryChange={(value) => void mutateDraft(selectedItem.id, { workingDraftEn: value })}
                />
              </div>

              <div className="mt-4">
                <TextPanel
                  title="Approved text"
                  description="Final reviewed copy. This is what gets pushed back to Airtable when you publish."
                  value={getApprovedRu(selectedItem)}
                  secondaryValue={getApprovedEn(selectedItem)}
                  stepLabel="Approved"
                  tone="editable"
                  onChange={(value) => void mutateDraft(selectedItem.id, { approvedRu: value })}
                  onSecondaryChange={(value) => void mutateDraft(selectedItem.id, { approvedEn: value })}
                />
              </div>
            </EditorSection>
          </div>

          <div className="space-y-4">
            <SupportPanel
              eyebrow="Validation / issues"
              title="Validation and blockers"
              description="Always-visible only when it helps the next action."
              defaultOpen
            >
              <div className="space-y-3">
                {validationItems.map((item) => (
                  <div key={item.label} className="rounded-[1rem] border border-white/8 bg-white/[0.03] px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm font-medium text-white">{item.label}</div>
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium',
                          item.state === 'done'
                            ? 'border border-emerald-400/20 bg-emerald-500/12 text-emerald-100'
                            : item.state === 'warning'
                              ? 'border border-amber-400/20 bg-amber-500/12 text-amber-100'
                              : 'border border-white/10 bg-white/[0.05] text-slate-300',
                        )}
                      >
                        {item.state === 'done' ? 'OK' : item.state === 'warning' ? 'Needs attention' : 'Info'}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-300">{item.message}</p>
                  </div>
                ))}
              </div>
            </SupportPanel>

            <SupportPanel
              eyebrow="Change history / audit"
              title="Change history"
              description="Collapsed by default so low-value audit data stays secondary."
            >
              <div className="grid gap-3 md:grid-cols-2">
                <CompactStat label="Draft updated" value={formatTimestamp(selectedItem.draft?.updatedAt)} />
                <CompactStat label="Last sync" value={formatTimestamp(selectedItem.draft?.syncedAt)} />
                <CompactStat label="Autosave" value="Enabled" />
                <CompactStat label="Source review" value={workflowSteps[0]?.complete ? 'Reviewed' : hasSourceText ? 'Pending' : 'Not needed'} />
              </div>
            </SupportPanel>

            <SupportPanel
              eyebrow="Record support / metadata"
              title="Supporting record context"
              description="Secondary record details stay collapsed so the editorial body remains primary."
            >
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <WorkbenchMeta label="POI ID" value={selectedItem.poiId || '—'} detail="Stable record identifier" />
                  <WorkbenchMeta label="Name (RU)" value={selectedItem.nameRu || '—'} detail="Primary editorial label" />
                  <WorkbenchMeta label="Name (EN)" value={selectedItem.nameEn || '—'} detail="Secondary label" />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <WorkbenchMeta label="City" value={selectedItem.siteCity || '—'} detail="Site city mapping" />
                  <WorkbenchMeta label="Region context" value={selectedItem.siteCity || '—'} detail="No finer-grained location fields are connected in this workspace yet" />
                </div>

                <div>
                  <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">Classification</div>
                  <div className="flex flex-wrap gap-2">
                    {selectedItem.category.length > 0 ? (
                      selectedItem.category.map((entry) => (
                        <span key={entry} className="inline-flex min-h-10 items-center rounded-full border border-white/10 bg-white/[0.05] px-4 text-sm text-slate-100">
                          {entry}
                        </span>
                      ))
                    ) : (
                      <div className="rounded-[1.2rem] border border-dashed border-white/12 bg-white/[0.03] px-4 py-3 text-sm text-slate-400">
                        No category connected for this record.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </SupportPanel>

            <SupportPanel
              eyebrow="Related entities / links"
              title="Related links"
              description="Compressed secondary references for faster editorial context."
            >
              <div className="space-y-3">
                <div className="rounded-[1rem] border border-white/8 bg-white/[0.03] px-4 py-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Website</div>
                  {selectedItem.website ? (
                    <a
                      href={selectedItem.website}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-sky-100 underline underline-offset-4"
                    >
                      {selectedItem.website}
                    </a>
                  ) : (
                    <p className="mt-2 text-sm text-slate-400">No external website stored.</p>
                  )}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <CompactStat label="Working hours" value={selectedItem.workingHours || '—'} />
                  <CompactStat label="Workspace status" value={selectedStatus ? statusLabels[selectedStatus] : 'Draft'} />
                  <CompactStat label="Visibility" value="Internal only" />
                  <CompactStat label="Sync state" value={syncComplete ? 'Synced' : 'Pending'} />
                </div>
                <MutedPlaceholder
                  title="Media"
                  body="No media fields are connected in this workspace yet. Media stays collapsed until a dedicated workflow is wired in."
                />
              </div>
            </SupportPanel>
          </div>

          <div className="fixed inset-x-0 bottom-0 z-30 px-4 pb-4 md:left-[18rem] md:px-6">
            <div className="mx-auto w-full max-w-[74rem] rounded-[1.5rem] border border-white/10 bg-[#08111e]/92 p-3 shadow-[0_-18px_50px_rgba(3,8,20,0.42)] backdrop-blur-xl">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Sticky action bar</div>
                  <div className="truncate text-sm text-slate-200">{selectedItem.nameRu || selectedItem.nameEn || 'No record selected'}</div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 rounded-full border-white/12 bg-white/[0.04] px-4 text-white hover:border-white/22 hover:bg-white/[0.08]"
                    onClick={() => openWizard()}
                  >
                    <Wand2 className="size-4" />
                    Open guided flow
                  </Button>
                  {hasSourceText ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 rounded-full border-white/12 bg-white/[0.04] px-4 text-white hover:border-white/22 hover:bg-white/[0.08]"
                      onClick={() => {
                        setReviewedSourceById((current) => ({ ...current, [selectedItem.id]: true }))
                      }}
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
                    disabled={isSyncing || !workflowSteps[3]?.unlocked}
                  >
                    <CloudUpload className="size-4" />
                    {isSyncing ? 'Syncing…' : syncComplete ? 'Synced to Airtable' : 'Sync approved text'}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {isWizardOpen ? (
            <WizardOverlay
              selectedItem={selectedItem}
              activeStep={activeStep}
              setActiveStep={setActiveStep}
              workflowSteps={workflowSteps}
              progressPercent={progressPercent}
              hasSourceText={hasSourceText}
              draftReady={draftReady}
              approvedRuReady={approvedRuReady}
              syncComplete={syncComplete}
              isSyncing={isSyncing}
              onClose={() => setIsWizardOpen(false)}
              onPrimaryAction={handleWizardPrimaryAction}
              onUseCurrentAsDraft={() =>
                void mutateDraft(selectedItem.id, {
                  workingDraftRu: selectedItem.descriptionRu,
                  workingDraftEn: selectedItem.descriptionEn,
                })
              }
              onCopyDraftToApproved={() =>
                void mutateDraft(selectedItem.id, {
                  approvedRu: getWorkingDraftRu(selectedItem),
                  approvedEn: getWorkingDraftEn(selectedItem),
                })
              }
              onSync={handleSync}
            />
          ) : null}
        </>
      )}
    </div>
  )
}

function WizardOverlay({
  selectedItem,
  activeStep,
  setActiveStep,
  workflowSteps,
  progressPercent,
  hasSourceText,
  draftReady,
  approvedRuReady,
  syncComplete,
  isSyncing,
  onClose,
  onPrimaryAction,
  onUseCurrentAsDraft,
  onCopyDraftToApproved,
  onSync,
}: {
  selectedItem: WorkspaceItem
  activeStep: 1 | 2 | 3 | 4
  setActiveStep: (step: 1 | 2 | 3 | 4) => void
  workflowSteps: WorkflowStepState[]
  progressPercent: number
  hasSourceText: boolean
  draftReady: boolean
  approvedRuReady: boolean
  syncComplete: boolean
  isSyncing: boolean
  onClose: () => void
  onPrimaryAction: () => void
  onUseCurrentAsDraft: () => void
  onCopyDraftToApproved: () => void
  onSync: () => void
}) {
  const step = workflowSteps.find((entry) => entry.id === activeStep) ?? workflowSteps[0]
  const canGoBack = activeStep > 1
  const canGoNext = activeStep < 4 && workflowSteps[activeStep]?.unlocked

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-[#020611]/75 p-4 backdrop-blur-sm md:items-center">
      <div className="w-full max-w-3xl overflow-hidden rounded-[1.9rem] border border-white/10 bg-[#07111f] shadow-[0_30px_90px_rgba(2,6,18,0.65)]">
        <div className="border-b border-white/8 px-5 py-4 md:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Wizard overlay</div>
              <h3 className="mt-1 text-xl font-semibold text-white">Guided flow for {selectedItem.nameRu || selectedItem.nameEn || selectedItem.poiId}</h3>
              <p className="mt-1 text-sm leading-6 text-slate-300">Temporary task mode. Close it any time to return to the standard editor.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex size-10 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] text-slate-200 transition hover:border-white/20 hover:bg-white/[0.08]"
              aria-label="Close wizard"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="space-y-5 px-5 py-5 md:px-6 md:py-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-slate-300">Step {step.id} of 4</div>
              <div className="text-sm text-slate-400">{progressPercent}% complete</div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/8">
              <div className="h-full rounded-full bg-gradient-to-r from-sky-300 via-cyan-300 to-indigo-300" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              {workflowSteps.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => entry.unlocked && setActiveStep(entry.id)}
                  disabled={!entry.unlocked}
                  className={cn(
                    'rounded-[1rem] border px-3 py-3 text-left transition',
                    entry.id === activeStep ? 'border-sky-300/24 bg-sky-300/10' : 'border-white/8 bg-white/[0.03]',
                    !entry.unlocked && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Step {entry.id}</div>
                  <div className="mt-1 text-sm font-medium text-white">{entry.label}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[1.4rem] border border-white/8 bg-white/[0.03] p-4 md:p-5">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Instructions</div>
            <h4 className="mt-2 text-lg font-semibold text-white">{step.label}</h4>
            <p className="mt-1 text-sm leading-6 text-slate-300">{step.summary}</p>

            <div className="mt-4 space-y-3">
              {activeStep === 1 ? (
                <>
                  <CompactStat label="Source text" value={hasSourceText ? 'Available' : 'Empty'} />
                  {!step.complete ? (
                    <div className="rounded-[1rem] border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                      Review the source panel in the editor, then mark it reviewed to unlock the next stage.
                    </div>
                  ) : null}
                </>
              ) : null}

              {activeStep === 2 ? (
                <>
                  <CompactStat label="Draft status" value={draftReady ? 'Present' : 'Missing'} />
                  {!draftReady ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11 rounded-full border-white/12 bg-white/[0.04] px-4 text-white hover:border-white/22 hover:bg-white/[0.08]"
                        onClick={onUseCurrentAsDraft}
                      >
                        <FileText className="size-4" />
                        Use current text as draft
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : null}

              {activeStep === 3 ? (
                <>
                  <CompactStat label="Approved text" value={approvedRuReady ? 'Ready' : 'Pending'} />
                  {!approvedRuReady ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11 rounded-full border-white/12 bg-white/[0.04] px-4 text-white hover:border-white/22 hover:bg-white/[0.08]"
                        onClick={onCopyDraftToApproved}
                        disabled={!draftReady}
                      >
                        <CheckCircle2 className="size-4" />
                        Copy draft to approved
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : null}

              {activeStep === 4 ? (
                <>
                  <CompactStat label="Upstream state" value={syncComplete ? 'Synced' : 'Awaiting publish'} />
                  {!workflowSteps[3]?.unlocked ? (
                    <div className="rounded-[1rem] border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                      Sync is blocked until source review, draft, and approved text are all complete.
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-white/8 px-5 py-4 md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 rounded-full border-white/12 bg-white/[0.04] px-4 text-white hover:border-white/22 hover:bg-white/[0.08]"
              onClick={() => canGoBack && setActiveStep((activeStep - 1) as 1 | 2 | 3 | 4)}
              disabled={!canGoBack}
            >
              Back
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 rounded-full border-white/12 bg-white/[0.04] px-4 text-white hover:border-white/22 hover:bg-white/[0.08]"
              onClick={onClose}
            >
              Exit guided flow
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {activeStep === 4 ? (
              <Button
                type="button"
                className="min-h-11 rounded-full border border-sky-300/16 bg-sky-300/14 px-4 text-sky-50 hover:bg-sky-300/20"
                onClick={onSync}
                disabled={isSyncing || !workflowSteps[3]?.unlocked}
              >
                <CloudUpload className="size-4" />
                {isSyncing ? 'Syncing…' : syncComplete ? 'Synced to Airtable' : 'Sync approved text'}
              </Button>
            ) : (
              <Button
                type="button"
                className="min-h-11 rounded-full border border-sky-300/16 bg-sky-300/14 px-4 text-sky-50 hover:bg-sky-300/20"
                onClick={onPrimaryAction}
                disabled={activeStep === 2 ? false : activeStep === 3 ? !draftReady : false}
              >
                <ArrowRight className="size-4" />
                {activeStep === 1
                  ? hasSourceText
                    ? 'Mark reviewed and continue'
                    : 'Continue to draft'
                  : activeStep === 2
                    ? canGoNext
                      ? 'Continue to approval'
                      : 'Stay on draft'
                    : 'Copy draft and continue'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function UtilityLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      className="inline-flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-white/18 hover:bg-white/[0.07] hover:text-white"
    >
      {children}
    </a>
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
        className="min-h-12 w-full rounded-[1.1rem] border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none transition focus:border-sky-300/30"
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

function MetaStripItem({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: string }) {
  return (
    <div className="rounded-[1.25rem] border border-white/8 bg-white/[0.035] px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="mt-1">
        {tone ? (
          <span className={cn('inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium', tone)}>{value}</span>
        ) : (
          <div className="truncate text-sm font-medium text-white">{value}</div>
        )}
      </div>
      <div className="mt-1 truncate text-xs text-slate-400">{detail}</div>
    </div>
  )
}

function EditorSection({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-[1.85rem] border border-white/10 bg-[#081220]/92 p-5 shadow-[0_24px_60px_rgba(3,8,20,0.35)] md:p-6">
      <div className="mb-4 border-b border-white/8 pb-4">
        <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{eyebrow}</div>
        <h3 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-white">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-slate-300">{description}</p>
      </div>
      {children}
    </section>
  )
}

function SupportPanel({
  eyebrow,
  title,
  description,
  children,
  defaultOpen = false,
}: {
  eyebrow: string
  title: string
  description: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-[1.55rem] border border-white/10 bg-[#081220]/92 shadow-[0_20px_50px_rgba(3,8,20,0.3)]"
    >
      <summary className="cursor-pointer list-none px-5 py-4 md:px-6 md:py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{eyebrow}</div>
            <h3 className="mt-1 text-lg font-semibold text-white">{title}</h3>
            <p className="mt-1 text-sm leading-6 text-slate-300">{description}</p>
          </div>
          <span className="mt-1 text-sm text-slate-400 transition group-open:rotate-90">›</span>
        </div>
      </summary>
      <div className="border-t border-white/8 px-5 py-4 md:px-6 md:py-5">{children}</div>
    </details>
  )
}

function MutedPlaceholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[1.3rem] border border-dashed border-white/12 bg-white/[0.03] px-4 py-4">
      <div className="text-sm font-medium text-white">{title}</div>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{body}</p>
    </div>
  )
}

function WorkbenchMeta({ label, value, detail, compact = false }: { label: string; value: string; detail: string; compact?: boolean }) {
  return (
    <div className="rounded-[1.25rem] border border-white/8 bg-white/[0.035] px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className={cn('mt-1 font-medium text-white', compact ? 'truncate text-sm' : 'text-sm')}>{value}</div>
      <div className="mt-1 truncate text-xs text-slate-400">{detail}</div>
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
  tone?: 'reference' | 'editable'
  stepLabel?: string
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
  stepLabel,
  onChange,
  onSecondaryChange,
}: TextPanelProps) {
  const isReference = tone === 'reference'

  return (
    <div
      className={cn(
        'space-y-4 rounded-[1.65rem] border p-4',
        isReference
          ? 'border-white/8 bg-white/[0.025]'
          : 'border-white/10 bg-white/[0.045] shadow-[0_18px_40px_-30px_rgba(56,189,248,0.45)]',
      )}
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {stepLabel ? (
            <span
              className={cn(
                'rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em]',
                isReference ? 'border border-white/10 bg-white/[0.05] text-slate-400' : 'border border-sky-300/16 bg-sky-300/10 text-sky-100',
              )}
            >
              {stepLabel}
            </span>
          ) : null}
          {!isReference ? <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Editorial workspace</span> : null}
        </div>
        <div>
          <h4 className={cn('text-white', isReference ? 'text-[15px] font-medium' : 'text-base font-semibold')}>{title}</h4>
          <p className={cn('mt-1 text-sm leading-6', isReference ? 'text-slate-400' : 'text-slate-300')}>{description}</p>
        </div>
      </div>

      <div className="space-y-3">
        <label className="block space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">RU description</span>
          <textarea
            value={value}
            onChange={(event) => onChange?.(event.target.value)}
            readOnly={readOnly}
            className={cn(
              'w-full rounded-[1.25rem] border px-4 py-3 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500',
              isReference
                ? 'min-h-[240px] border-white/8 bg-[#07101b] read-only:bg-[#09121d]'
                : 'min-h-[320px] border-white/10 bg-[#030914] focus:border-sky-300/25 read-only:bg-[#0a1422]',
            )}
          />
        </label>

        <label className="block space-y-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">EN description</span>
          <textarea
            value={secondaryValue}
            onChange={(event) => onSecondaryChange?.(event.target.value)}
            readOnly={readOnly}
            className={cn(
              'w-full rounded-[1.25rem] border px-4 py-3 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-500',
              isReference
                ? 'min-h-[160px] border-white/8 bg-[#07101b] read-only:bg-[#09121d]'
                : 'min-h-[220px] border-white/10 bg-[#030914] focus:border-sky-300/25 read-only:bg-[#0a1422]',
            )}
          />
        </label>
      </div>
    </div>
  )
}
