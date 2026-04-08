import Link from 'next/link'
import { CalendarRange, Hotel, Layers3, LogOut, Sparkles } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { ResourceHydrated } from '@/lib/resources'

type AdminResourcesWorkspaceProps = {
  resources: ResourceHydrated[]
}

const typeMeta: Record<ResourceHydrated['type'], { label: string; icon: typeof Sparkles }> = {
  service: { label: 'Services', icon: Sparkles },
  hotel: { label: 'Hotels', icon: Hotel },
  event: { label: 'Events', icon: CalendarRange },
  exhibition: { label: 'Exhibitions', icon: Layers3 },
  concert: { label: 'Concerts', icon: CalendarRange },
}

export function AdminResourcesWorkspace({ resources }: AdminResourcesWorkspaceProps) {
  const counts = {
    total: resources.length,
    services: resources.filter((item) => item.type === 'service').length,
    hotels: resources.filter((item) => item.type === 'hotel').length,
    events: resources.filter((item) => item.type === 'event' || item.type === 'exhibition' || item.type === 'concert').length,
  }

  return (
    <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-4 px-4 py-4 md:px-6 md:py-5">
      <header className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#08111d]/94 px-4 py-3 shadow-[0_18px_45px_rgba(3,8,20,0.32)] md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Admin</div>
          <h1 className="text-lg font-semibold text-white">Resources workspace</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Canonical resource backbone for services, hotels, exhibitions, events, concerts, and future resource types.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <NavPill href="/admin" label="Overview" />
          <NavPill href="/admin/resources" label="Resources" active />
          <NavPill href="/admin/services" label="Services compatibility view" />
          <a
            href="/api/admin/auth/logout"
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-3.5 text-sm text-slate-200 transition hover:border-white/18 hover:bg-white/[0.08] hover:text-white"
          >
            <LogOut className="mr-2 size-4" />
            Sign out
          </a>
        </div>
      </header>

      <section className="grid gap-2 rounded-2xl border border-white/10 bg-[#08111d]/88 px-4 py-3 text-sm text-slate-300 shadow-[0_16px_40px_rgba(3,8,20,0.24)] md:grid-cols-4">
        <StatusCell label="Resources" value={String(counts.total)} />
        <StatusCell label="Services" value={String(counts.services)} />
        <StatusCell label="Hotels" value={String(counts.hotels)} />
        <StatusCell label="Time-aware records" value={String(counts.events)} />
      </section>

      <section className="rounded-2xl border border-sky-300/14 bg-sky-300/10 px-4 py-3 text-sm text-sky-50">
        <p>
          <strong>Canonical model:</strong> <code className="rounded bg-black/20 px-1.5 py-0.5 text-xs">Resources</code> is now the source of truth.
          Type-specific tables hold service, hotel, and event details. <code className="rounded bg-black/20 px-1.5 py-0.5 text-xs">/admin/services</code> remains available as a filtered compatibility workspace.
        </p>
      </section>

      <section className="grid gap-4 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="space-y-3 rounded-2xl border border-white/10 bg-[#08111d]/92 p-4 shadow-[0_18px_45px_rgba(3,8,20,0.3)]">
          <h2 className="text-sm font-semibold text-white">Modules</h2>
          <div className="space-y-2">
            <ModuleCard label="Services" description="Experience + practical service editors" href="/admin/services" />
            <ModuleCard label="Resources core" description="Canonical cross-type record list" href="/admin/resources" active />
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#08111d]/92 p-4 shadow-[0_18px_45px_rgba(3,8,20,0.3)]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">All resource records</h2>
            <span className="text-xs text-slate-500">Sorted alphabetically</span>
          </div>

          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {resources.map((resource) => {
              const meta = typeMeta[resource.type]
              const Icon = meta.icon
              return (
                <article key={resource.recordId} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="inline-flex min-h-8 items-center rounded-full border border-white/10 bg-white/[0.04] px-3 text-[11px] uppercase tracking-[0.18em] text-slate-300">
                        {meta.label}
                      </span>
                      <h3 className="mt-3 text-sm font-medium text-white">{resource.title}</h3>
                    </div>
                    <Icon className="mt-1 size-4 text-slate-400" />
                  </div>

                  <dl className="mt-4 space-y-1.5 text-sm text-slate-400">
                    <div className="flex justify-between gap-3"><dt>ID</dt><dd className="truncate text-slate-200">{resource.resourceId}</dd></div>
                    <div className="flex justify-between gap-3"><dt>Status</dt><dd className="text-slate-200">{resource.status}</dd></div>
                    <div className="flex justify-between gap-3"><dt>City</dt><dd className="truncate text-slate-200">{resource.city || '—'}</dd></div>
                    <div className="flex justify-between gap-3"><dt>Module</dt><dd className="text-slate-200">{resource.editorModule}</dd></div>
                  </dl>
                </article>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}

function NavPill({ href, label, active }: { href: string; label: string; active?: boolean }) {
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
      {label}
    </Link>
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

function ModuleCard({ href, label, description, active }: { href: string; label: string; description: string; active?: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        'block rounded-2xl border px-4 py-3 transition',
        active
          ? 'border-sky-300/20 bg-sky-400/10 text-white'
          : 'border-white/8 bg-white/[0.03] text-slate-200 hover:border-white/16 hover:bg-white/[0.05]',
      )}
    >
      <div className="text-sm font-medium">{label}</div>
      <div className="mt-1 text-xs text-slate-400">{description}</div>
    </Link>
  )
}
