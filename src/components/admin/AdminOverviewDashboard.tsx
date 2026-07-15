import { unstable_cache } from 'next/cache'
import Link from 'next/link'
import { Fragment } from 'react'
import { ArrowRight } from 'lucide-react'

import { AdminShell } from './AdminShell'
import { TelegramBotSetup } from './TelegramBotSetup'
import { HealthDot } from './ui'
import { AIRTABLE_BASE_ID, POI_TABLE_ID } from '@/lib/airtable-schema'
import { fetchAirtableWithRetry } from '@/lib/airtable-retry'
import { cn } from '@/lib/utils'
import { SOURCE_LABELS, type ProspectStage } from '@/lib/prospect-labels'
import { listProspectsForOverview, type ProspectOverviewItem } from '@/lib/prospects'
import { getEventLifecycleCounts } from '@/lib/events'
import { getAdminResourceItems, getAdminResourcesSummary } from '@/lib/admin-resources'

// ─── Airtable helpers ────────────────────────────────────────────────────────

const TOKEN = process.env.AIRTABLE_TOKEN?.trim() ?? ''
const BASE = AIRTABLE_BASE_ID

interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
}

async function airtableFetch(
  tableId: string,
  fields?: string[],
): Promise<AirtableRecord[]> {
  if (!TOKEN || !BASE) return []
  try {
    const url = new URL(`https://api.airtable.com/v0/${BASE}/${tableId}`)
    if (fields) {
      for (const f of fields) url.searchParams.append('fields[]', f)
    }
    const records: AirtableRecord[] = []
    let offset: string | undefined
    do {
      if (offset) url.searchParams.set('offset', offset)
      else url.searchParams.delete('offset')
      const res = await fetchAirtableWithRetry(url.toString(), {
        headers: { Authorization: `Bearer ${TOKEN}` },
        cache: 'no-store',
      })
      if (!res.ok) return records
      const data = (await res.json()) as { records: AirtableRecord[]; offset?: string }
      records.push(...data.records)
      offset = data.offset
    } while (offset)
    return records
  } catch {
    return []
  }
}

// ─── Data fetchers ────────────────────────────────────────────────────────────

const fetchPoiStats = unstable_cache(fetchPoiStatsUncached, ['admin-overview-poi-stats'], {
  tags: ['airtable:pois'],
  revalidate: 300,
})

async function fetchPoiStatsUncached(): Promise<{
  total: number
  synced: number
  byCityTop5: Array<{ city: string; count: number }>
}> {
  const records = await airtableFetch(POI_TABLE_ID, ['POI ID', 'Copy Status', 'Site City'])

  let synced = 0
  const byCity = new Map<string, number>()
  for (const r of records) {
    if (String(r.fields['Copy Status'] ?? '').toLowerCase() === 'synced') synced += 1
    const city = String(r.fields['Site City'] ?? '').trim()
    if (city) byCity.set(city, (byCity.get(city) ?? 0) + 1)
  }
  const byCityTop5 = [...byCity.entries()]
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return { total: records.length, synced, byCityTop5 }
}

// ─── Prospect funnel stats ────────────────────────────────────────────────────

const DAY_MS = 86400_000

/** Stages counted as «заявки в работе» (not finished, not lost). */
const IN_WORK_STAGES: ProspectStage[] = ['received', 'processed', 'discussing', 'agreed']

/** Stages meaning «тур в работе» (agreed and being executed, not yet paid). */
const ACTIVE_TOUR_STAGES: ProspectStage[] = ['agreed', 'conducted']

/** Per-stage «застрял» thresholds, days without stage movement. */
const STUCK_THRESHOLDS: Partial<Record<ProspectStage, number>> = {
  received: 3,
  processed: 7,
  discussing: 14,
}

interface StuckProspect {
  recordId: string
  name: string
  stage: ProspectStage
  days: number
}

interface UpcomingArrival {
  name: string
  arrivalDate: string
  party: string
}

function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? Math.floor((now - t) / DAY_MS) : null
}

function computeProspectStats(items: ProspectOverviewItem[], now: number) {
  const byStage: Record<ProspectStage, number> = {
    received: 0,
    processed: 0,
    discussing: 0,
    agreed: 0,
    conducted: 0,
    paid: 0,
    lost: 0,
  }
  const bySource = new Map<string, number>()
  const activeByTourType = new Map<string, number>()
  const activeBySource = new Map<string, number>()
  let new7d = 0
  const stuck: StuckProspect[] = []
  const arrivals: UpcomingArrival[] = []

  for (const p of items) {
    const stage = (p.stage || '') as ProspectStage | ''
    if (stage && stage in byStage) byStage[stage as ProspectStage] += 1
    if (p.source) bySource.set(p.source, (bySource.get(p.source) ?? 0) + 1)

    const ageDays = daysSince(p.createdAt, now)
    if (ageDays !== null && ageDays <= 7) new7d += 1

    const displayName = p.name || p.prospectId || 'Без имени'

    // «Застрял»: no stage movement longer than the stage threshold.
    // Stage Updated At is written by code on stage changes; until it is
    // populated we fall back to Created At (coarse but honest).
    if (stage && stage in STUCK_THRESHOLDS) {
      const sinceDays = daysSince(p.stageUpdatedAt ?? p.createdAt, now)
      const threshold = STUCK_THRESHOLDS[stage as ProspectStage]!
      if (sinceDays !== null && sinceDays > threshold) {
        stuck.push({ recordId: p.recordId, name: displayName, stage: stage as ProspectStage, days: sinceDays })
      }
    }

    if (stage && ACTIVE_TOUR_STAGES.includes(stage as ProspectStage)) {
      const typeKey = p.tourType || 'не указан'
      activeByTourType.set(typeKey, (activeByTourType.get(typeKey) ?? 0) + 1)
      const sourceKey = p.source || 'не указан'
      activeBySource.set(sourceKey, (activeBySource.get(sourceKey) ?? 0) + 1)
    }

    if (p.arrivalDate && stage !== 'lost') {
      const t = Date.parse(p.arrivalDate)
      if (Number.isFinite(t) && t >= now - DAY_MS && t <= now + 30 * DAY_MS) {
        arrivals.push({
          name: displayName,
          arrivalDate: p.arrivalDate,
          party: [p.partyComposition, p.partySize ? `${p.partySize} чел.` : null].filter(Boolean).join(', '),
        })
      }
    }
  }

  stuck.sort((a, b) => b.days - a.days)
  arrivals.sort((a, b) => Date.parse(a.arrivalDate) - Date.parse(b.arrivalDate))

  const total = items.length
  const inWork = IN_WORK_STAGES.reduce((sum, s) => sum + byStage[s], 0)
  const agreedPlus = byStage.agreed + byStage.conducted + byStage.paid
  const conversionRate = total > 0 ? Math.round((agreedPlus / total) * 100) : null
  const stuckPercent = inWork > 0 ? Math.round((stuck.length / inWork) * 100) : 0

  return {
    total,
    inWork,
    byStage,
    bySource: [...bySource.entries()].sort((a, b) => b[1] - a[1]),
    activeByTourType,
    activeBySource,
    new7d,
    stuck,
    stuckPercent,
    arrivals: arrivals.slice(0, 5),
    conversionRate,
    agreedPlus,
  }
}

// ─── Health checks ────────────────────────────────────────────────────────────

async function checkAirtable(): Promise<boolean> {
  if (!TOKEN || !BASE) return false
  try {
    const r = await fetchAirtableWithRetry(`https://api.airtable.com/v0/${BASE}/${POI_TABLE_ID}?pageSize=1`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    })
    return r.ok
  } catch {
    return false
  }
}

async function checkTelegram(): Promise<boolean> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) return false
  try {
    const r = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    })
    return r.ok
  } catch {
    return false
  }
}

// STAGE_LABELS / SOURCE_LABELS / TOUR_TYPE_LABELS — общие, из prospects.ts.

const STAGE_STUCK_LABELS: Record<ProspectStage, string> = {
  received: 'заявка без ответа',
  processed: 'обработана, обсуждение не началось',
  discussing: 'обсуждение затянулось',
  agreed: 'согласован',
  conducted: 'проведён',
  paid: 'оплачен',
  lost: 'потерян',
}

// ─── Main component ───────────────────────────────────────────────────────────

export async function AdminOverviewDashboard() {
  const now = Date.now()

  const [poiStats, prospects, eventCounts, resourceItems, airtableOk, telegramOk] = await Promise.all([
    fetchPoiStats(),
    listProspectsForOverview(),
    getEventLifecycleCounts(now).catch(() => ({ live: 0, upcoming: 0, endingSoonDays14: 0, endedNotArchived: 0 })),
    getAdminResourceItems().catch(() => []),
    checkAirtable(),
    checkTelegram(),
  ])

  const funnel = computeProspectStats(prospects, now)
  const resourcesSummary = getAdminResourcesSummary(resourceItems)
  const openaiConfigured = Boolean(process.env.OPENAI_API_KEY)

  // Сквозная воронка (1c): все стадии одной горизонтальной лентой.
  const FUNNEL_STAGES: { stage: ProspectStage; label: string }[] = [
    { stage: 'received', label: 'Заявки' },
    { stage: 'processed', label: 'Обработка' },
    { stage: 'discussing', label: 'Обсуждение' },
    { stage: 'agreed', label: 'Согласован' },
    { stage: 'conducted', label: 'Проведён' },
    { stage: 'paid', label: 'Оплачен' },
  ]
  const funnelMax = Math.max(funnel.total, 1)
  const sourceMax = Math.max(1, ...funnel.bySource.map(([, count]) => count))
  const dateStr = new Date(now).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <AdminShell
      currentPath="/admin"
      title="Обзор"
      subtitle={`Что требует внимания сегодня · ${dateStr}`}
      actions={
        <Link
          href="/admin/clients"
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--adm-accent)] px-4 text-sm font-medium text-[var(--adm-on-accent)] transition hover:bg-[var(--adm-accent-hover)]"
        >
          Открыть CRM →
        </Link>
      }
    >
      <div className="mt-6 flex flex-col gap-4">
        {/* ── Сквозная воронка ─────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)] p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--adm-text-3)]">Сквозная воронка</span>
            <span className="text-xs text-[var(--adm-text-3)]">
              {funnel.total} заявок · <span className="font-semibold text-[var(--adm-accent-text)]">{funnel.stuck.length}</span> застряли · конверсия{' '}
              <span className="font-semibold text-[var(--adm-text-2)]">{funnel.conversionRate !== null ? `${funnel.conversionRate}%` : '—'}</span>
            </span>
          </div>
          <div className="flex items-stretch overflow-x-auto">
            {FUNNEL_STAGES.map(({ stage, label }, i) => {
              const count = funnel.byStage[stage]
              const active = count > 0
              return (
                <Fragment key={stage}>
                  {i > 0 && (
                    <div className="flex items-center px-1 text-[var(--adm-text-3)]">
                      <ArrowRight className="size-4 opacity-50" />
                    </div>
                  )}
                  <Link href="/admin/clients" className="min-w-[80px] flex-1 rounded-lg px-3 py-1 transition hover:bg-[var(--adm-hover)]">
                    <div className={cn('text-2xl font-bold leading-none', active ? 'text-[var(--adm-text)]' : 'text-[var(--adm-text-3)]')}>{count}</div>
                    <div className="mt-1.5 text-[13px] text-[var(--adm-text-2)]">{label}</div>
                    <div className="mt-0.5 h-[15px] text-[11px] text-[var(--adm-text-3)]">
                      {stage === 'received' && funnel.new7d > 0 ? `+${funnel.new7d} за 7 дней` : ' '}
                    </div>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--adm-active)]">
                      {active && (
                        <div className="h-full rounded-full bg-[var(--adm-accent)]" style={{ width: `${Math.round((count / funnelMax) * 100)}%` }} />
                      )}
                    </div>
                  </Link>
                </Fragment>
              )
            })}
          </div>
        </section>

        {/* ── Ряд: внимание слева · приезды/источники/система справа ─────────── */}
        <div className="grid gap-4 lg:grid-cols-[1.05fr_1fr]">
          {/* Требует внимания */}
          <section className="flex flex-col rounded-2xl border border-[var(--adm-accent-border)] bg-[var(--adm-accent-bg)] p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--adm-accent-text)]">Требует внимания — заявки без ответа</span>
              {funnel.stuck.length > 0 && (
                <span className="shrink-0 rounded-full bg-[var(--adm-accent-bg)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--adm-accent-text)]">
                  {funnel.stuck.length} · {funnel.stuckPercent}% в работе
                </span>
              )}
            </div>
            {funnel.stuck.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--adm-text-3)]">Никто не ждёт дольше нормы</p>
            ) : (
              <div className="flex flex-col">
                {funnel.stuck.slice(0, 6).map((s) => (
                  <Link
                    key={s.recordId}
                    href={`/admin/clients/${s.recordId}`}
                    className="flex items-center justify-between gap-3 border-b border-[var(--adm-border)] py-2 transition last:border-0 hover:opacity-80"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[var(--adm-text)]">{s.name}</div>
                      <div className="text-xs text-[var(--adm-text-3)]">{STAGE_STUCK_LABELS[s.stage]}</div>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
                        s.days >= 30 ? 'bg-[var(--adm-danger-bg)] text-[var(--adm-danger-text)]' : 'bg-[var(--adm-warn-bg)] text-[var(--adm-warn-text)]',
                      )}
                    >
                      {s.days} дн.
                    </span>
                  </Link>
                ))}
              </div>
            )}
            <Link href="/admin/clients" className="mt-auto pt-3 text-sm font-medium text-[var(--adm-accent-text)]">Все заявки в CRM →</Link>
          </section>

          {/* Правая колонка */}
          <div className="flex flex-col gap-4">
            {/* Приезды */}
            <section className="rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)] p-5">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--adm-text-3)]">Ближайшие приезды · 30 дней</div>
              {funnel.arrivals.length === 0 ? (
                <p className="text-sm text-[var(--adm-text-3)]">Нет запланированных прилётов</p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {funnel.arrivals.map((a, i) => (
                    <div key={i} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[var(--adm-text)]">{a.name}</div>
                        {a.party && <div className="text-xs text-[var(--adm-text-3)]">{a.party}</div>}
                      </div>
                      <span className="shrink-0 text-sm font-semibold text-[var(--adm-accent-text)]">
                        {new Date(a.arrivalDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Источники */}
            <section className="rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)] p-5">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--adm-text-3)]">Источники заявок</div>
              {funnel.bySource.length === 0 ? (
                <p className="text-sm text-[var(--adm-text-3)]">Пока нет данных</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {funnel.bySource.map(([source, count]) => (
                    <div key={source} className="flex items-center gap-3">
                      <span className="w-20 shrink-0 truncate text-[13px] text-[var(--adm-text-2)]">{SOURCE_LABELS[source] ?? source}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--adm-active)]">
                        <div className="h-full rounded-full bg-[var(--adm-accent)]" style={{ width: `${Math.round((count / sourceMax) * 100)}%` }} />
                      </div>
                      <span className="w-16 shrink-0 text-right text-xs font-medium text-[var(--adm-text-3)]">
                        {count}{funnel.total > 0 ? ` · ${Math.round((count / funnel.total) * 100)}%` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Система */}
            <section className="rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)] p-5">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--adm-text-3)]">Система</div>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {[
                  { label: 'Airtable', ok: airtableOk },
                  { label: 'Telegram-бот', ok: telegramOk },
                  { label: 'OpenAI', ok: openaiConfigured },
                ].map(({ label, ok }) => (
                  <span key={label} className="flex items-center gap-2 text-[13px] text-[var(--adm-text-2)]">
                    <HealthDot ok={ok} />
                    {label} <span className={ok ? 'text-[var(--adm-ok-text)]' : 'text-[var(--adm-danger-text)]'}>{ok ? '✓' : '✗'}</span>
                  </span>
                ))}
              </div>
              <TelegramBotSetup />
            </section>
          </div>
        </div>

        {/* ── Контент лентой ───────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)] p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--adm-text-3)]">Контент</span>
            <Link href="/admin/resources" className="text-xs text-[var(--adm-text-3)] transition hover:text-[var(--adm-text-2)]">Библиотека ресурсов →</Link>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 xl:grid-cols-[repeat(4,minmax(0,1fr))_1.4fr_1.4fr] xl:items-start">
            <div>
              <div className="text-xl font-bold leading-none text-[var(--adm-text)]">{poiStats.total}</div>
              <div className="mt-1 text-xs text-[var(--adm-text-3)]">POI · {poiStats.synced} синхр.</div>
            </div>
            <div>
              <div className="text-xl font-bold leading-none text-[var(--adm-text-3)]">{eventCounts.live}</div>
              <div className="mt-1 text-xs text-[var(--adm-text-3)]">событий идут · {eventCounts.upcoming} впереди</div>
            </div>
            <div>
              <div className={cn('text-xl font-bold leading-none', eventCounts.endedNotArchived > 0 ? 'text-[var(--adm-warn-text)]' : 'text-[var(--adm-text-3)]')}>
                {eventCounts.endedNotArchived}
              </div>
              <div className="mt-1 text-xs text-[var(--adm-text-3)]">к архивации</div>
            </div>
            <div>
              <div className="text-xl font-bold leading-none text-[var(--adm-text)]">{resourcesSummary.missingDescriptions + resourcesSummary.missingPrimaryUrl}</div>
              <div className="mt-1 text-xs text-[var(--adm-text-3)]">дыры · {resourcesSummary.missingDescriptions} без опис.</div>
            </div>
            <div className="xl:border-l xl:border-[var(--adm-border)] xl:pl-6">
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--adm-text-3)]">Топ городов</div>
              <div className="flex flex-wrap gap-1.5">
                {poiStats.byCityTop5.map(({ city, count }) => (
                  <span key={city} className="rounded-md bg-[var(--adm-hover)] px-2 py-1 text-xs text-[var(--adm-text-2)]">{city} {count}</span>
                ))}
              </div>
            </div>
            <div className="xl:border-l xl:border-[var(--adm-border)] xl:pl-6">
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--adm-text-3)]">Ресурсы по типам</div>
              <div className="flex flex-wrap gap-1.5">
                {([
                  ['Рестораны', resourcesSummary.restaurants],
                  ['Отели', resourcesSummary.hotels],
                  ['События', resourcesSummary.events],
                  ['Услуги', resourcesSummary.services],
                ] as const).map(([label, count]) => (
                  <span key={label} className="rounded-md bg-[var(--adm-hover)] px-2 py-1 text-xs text-[var(--adm-text-2)]">{label} {count}</span>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </AdminShell>
  )
}
