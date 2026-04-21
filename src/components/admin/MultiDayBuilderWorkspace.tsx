'use client'

import { useMemo, useState } from 'react'
import { FileText, LogOut, Plus, Printer, Sparkles } from 'lucide-react'

import { AdminWorkspaceNav } from '@/components/admin/AdminWorkspaceNav'
import {
  buildMultiDaySkeleton,
  type MultiDayBuilderDay,
  type MultiDayBuilderRoute,
} from '@/lib/multi-day-builder'
import { cn } from '@/lib/utils'

const panelClass =
  'rounded-2xl border border-white/10 bg-[#08111d]/92 shadow-[0_18px_45px_rgba(3,8,20,0.3)]'

const inputClass =
  'w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white outline-none transition focus:border-sky-500/50'

const dayTypeTone: Record<MultiDayBuilderDay['dayType'], string> = {
  arrival: 'border-sky-400/20 bg-sky-400/12 text-sky-100',
  touring: 'border-white/10 bg-white/[0.04] text-slate-100',
  departure: 'border-amber-300/20 bg-amber-300/12 text-amber-100',
}

function createInitialRoute() {
  return buildMultiDaySkeleton({
    title: 'Classic Japan draft',
    dayCount: 7,
    startCity: 'Tokyo',
    endCity: 'Osaka',
  })
}

export function MultiDayBuilderWorkspace() {
  const [title, setTitle] = useState('Classic Japan draft')
  const [dayCount, setDayCount] = useState('7')
  const [startCity, setStartCity] = useState('Tokyo')
  const [endCity, setEndCity] = useState('Osaka')
  const [route, setRoute] = useState<MultiDayBuilderRoute>(() => createInitialRoute())
  const [selectedDayId, setSelectedDayId] = useState(route.days[0]?.id ?? '')
  const [previewMode, setPreviewMode] = useState<'internal' | 'client' | 'print'>('internal')

  const selectedDay = useMemo(() => route.days.find((day) => day.id === selectedDayId) ?? route.days[0], [route.days, selectedDayId])

  function handleGenerate() {
    const next = buildMultiDaySkeleton({
      title,
      dayCount: Number(dayCount),
      startCity,
      endCity,
    })

    setRoute(next)
    setSelectedDayId(next.days[0]?.id ?? '')
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[96rem] flex-col gap-4 px-4 py-4 md:px-6 md:py-5">
      <header className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#08111d]/94 px-4 py-3 shadow-[0_18px_45px_rgba(3,8,20,0.32)] md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Admin</div>
          <h1 className="text-lg font-semibold text-white">Multi-day route builder</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <AdminWorkspaceNav currentPath="/admin/multi-day" />
          <a
            href="/api/admin/auth/logout"
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-3.5 text-sm text-slate-200 transition hover:border-white/18 hover:bg-white/[0.08] hover:text-white"
          >
            <LogOut className="mr-2 size-4" />
            Sign out
          </a>
        </div>
      </header>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <article className={cn(panelClass, 'p-4 md:p-5')}>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Builder inputs</div>
              <h2 className="text-base font-semibold text-white">Generate the route skeleton first</h2>
              <p className="max-w-2xl text-sm leading-6 text-slate-300">
                This is the first implementation layer: route title, day count, arrival/departure defaults, and a stable day-first builder shell.
              </p>
            </div>

            <div className="inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1">
              {(['internal', 'client', 'print'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setPreviewMode(mode)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-sm transition',
                    previewMode === mode ? 'bg-white/[0.1] text-white' : 'text-slate-400 hover:text-white',
                  )}
                >
                  {mode === 'internal' ? 'Internal preview' : mode === 'client' ? 'Client preview' : 'Print preview'}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-2">
              <span className="text-sm text-slate-300">Route title</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} />
            </label>
            <label className="space-y-2">
              <span className="text-sm text-slate-300">Days</span>
              <input value={dayCount} onChange={(event) => setDayCount(event.target.value)} className={inputClass} inputMode="numeric" />
            </label>
            <label className="space-y-2">
              <span className="text-sm text-slate-300">Start city</span>
              <input value={startCity} onChange={(event) => setStartCity(event.target.value)} className={inputClass} />
            </label>
            <label className="space-y-2">
              <span className="text-sm text-slate-300">End city</span>
              <input value={endCity} onChange={(event) => setEndCity(event.target.value)} className={inputClass} />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleGenerate}
              className="inline-flex min-h-11 items-center rounded-full bg-sky-600 px-4 text-sm font-medium text-white transition hover:bg-sky-500"
            >
              <Sparkles className="mr-2 size-4" />
              Generate builder skeleton
            </button>
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm text-slate-200 transition hover:border-white/18 hover:bg-white/[0.08] hover:text-white"
            >
              <Printer className="mr-2 size-4" />
              PDF pathway placeholder
            </button>
          </div>
        </article>

        <article className={cn(panelClass, 'p-4 md:p-5')}>
          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Route state</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-white">{route.title}</h2>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-300">{route.status}</span>
            <span className="rounded-full border border-sky-300/16 bg-sky-300/10 px-2.5 py-1 text-xs text-sky-100">{route.dayCount} days</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <RouteStat label="Slug" value={route.slug} />
            <RouteStat label="Preview mode" value={previewMode} />
            <RouteStat label="Start city" value={route.startCity || 'Not set'} />
            <RouteStat label="End city" value={route.endCity || 'Not set'} />
          </div>
        </article>
      </section>

      <div className="grid flex-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <aside className={cn(panelClass, 'p-3')}>
          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Day outline</div>
          <div className="mt-3 space-y-2">
            {route.days.map((day) => {
              const incomplete = !day.overnightCity || day.items.length === 0

              return (
                <button
                  key={day.id}
                  type="button"
                  onClick={() => setSelectedDayId(day.id)}
                  className={cn(
                    'block w-full rounded-2xl border px-3 py-3 text-left transition',
                    selectedDay?.id === day.id
                      ? 'border-sky-400/28 bg-sky-400/10'
                      : 'border-white/8 bg-white/[0.03] hover:border-white/14 hover:bg-white/[0.05]',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">Day {day.dayNumber}</div>
                      <div className="mt-1 text-xs text-slate-400">{day.overnightCity || 'Overnight city pending'}</div>
                    </div>
                    <span className={cn('rounded-full border px-2 py-0.5 text-[11px]', dayTypeTone[day.dayType])}>{day.dayType}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                    <span>{day.items.length} blocks</span>
                    <span>{incomplete ? 'Needs fill' : 'Ready'}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </aside>

        <main className="space-y-4">
          <section className={cn(panelClass, 'overflow-hidden')}>
            <div className="border-b border-white/10 px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Route matrix</div>
              <h2 className="mt-1 text-base font-semibold text-white">Whole-trip scan before detailed editing</h2>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white/[0.03] text-left text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">Day</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Overnight</th>
                    <th className="px-4 py-3 font-medium">Blocks</th>
                    <th className="px-4 py-3 font-medium">Regions</th>
                  </tr>
                </thead>
                <tbody>
                  {route.days.map((day) => (
                    <tr key={`row-${day.id}`} className="border-t border-white/8 text-slate-200">
                      <td className="px-4 py-3">Day {day.dayNumber}</td>
                      <td className="px-4 py-3 capitalize">{day.dayType}</td>
                      <td className="px-4 py-3">{day.overnightCity || '—'}</td>
                      <td className="px-4 py-3">{day.items.length}</td>
                      <td className="px-4 py-3">{day.derivedRegions.length > 0 ? day.derivedRegions.join(', ') : 'Derived later'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-3">
            {route.days.map((day) => {
              const isOpen = selectedDay?.id === day.id

              return (
                <article key={day.id} className={cn(panelClass, 'overflow-hidden border', isOpen ? 'border-sky-400/24' : 'border-white/10')}>
                  <button
                    type="button"
                    onClick={() => setSelectedDayId(day.id)}
                    className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-white">Day {day.dayNumber}: {day.dayTitle}</h3>
                        <span className={cn('rounded-full border px-2 py-0.5 text-[11px]', dayTypeTone[day.dayType])}>{day.dayType}</span>
                      </div>
                      <p className="text-sm text-slate-300">{day.daySummary}</p>
                    </div>
                    <div className="text-right text-xs text-slate-400">
                      <div>{day.overnightCity || 'Overnight pending'}</div>
                      <div className="mt-1">{day.items.length} blocks</div>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-white/10 px-4 py-4">
                      <div className="grid gap-3 md:grid-cols-3">
                        <MiniMeta label="Overnight city" value={day.overnightCity || 'Pending'} />
                        <MiniMeta label="Derived regions" value={day.derivedRegions.join(', ') || 'Auto later'} />
                        <MiniMeta label="Status" value={day.displayStatus} />
                      </div>

                      <div className="mt-4 space-y-3">
                        {day.items.map((item) => (
                          <div key={item.id} className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div className="text-sm font-medium text-white">{item.displayTitle}</div>
                                <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{item.itemType}</div>
                              </div>
                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-300">{item.sourceMode}</span>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-slate-300">{item.shortDescription || 'No description yet.'}</p>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <ActionChip label="Add POI" />
                        <ActionChip label="Add transport" />
                        <ActionChip label="Add note" />
                      </div>
                    </div>
                  )}
                </article>
              )
            })}
          </section>
        </main>

        <aside className={cn(panelClass, 'p-4')}>
          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Inspector</div>
          {selectedDay ? (
            <div className="mt-3 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-white">Day {selectedDay.dayNumber}</h2>
                <p className="mt-1 text-sm text-slate-300">{selectedDay.dayTitle}</p>
              </div>

              <div className="grid gap-3">
                <MiniMeta label="Type" value={selectedDay.dayType} />
                <MiniMeta label="Start location" value={selectedDay.startLocation || 'Pending'} />
                <MiniMeta label="End location" value={selectedDay.endLocation || 'Pending'} />
                <MiniMeta label="Overnight city" value={selectedDay.overnightCity || 'Pending'} />
              </div>

              <div className="rounded-2xl border border-amber-300/14 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
                This side panel is where POI, transport, and override controls will live once Airtable read/write is connected.
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-sky-600 px-4 text-sm font-medium text-white transition hover:bg-sky-500"
                >
                  <Plus className="mr-2 size-4" />
                  Create manual override
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm text-slate-200 transition hover:border-white/18 hover:bg-white/[0.08] hover:text-white"
                >
                  <FileText className="mr-2 size-4" />
                  Open preview contract
                </button>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  )
}

function RouteStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-white">{value}</div>
    </div>
  )
}

function MiniMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-white">{value}</div>
    </div>
  )
}

function ActionChip({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="inline-flex min-h-10 items-center rounded-full border border-white/10 bg-white/[0.04] px-3.5 text-sm text-slate-200 transition hover:border-white/18 hover:bg-white/[0.08] hover:text-white"
    >
      <Plus className="mr-2 size-4" />
      {label}
    </button>
  )
}
