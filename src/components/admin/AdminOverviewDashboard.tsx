import { AdminShell } from './AdminShell'
import { AIRTABLE_BASE_ID, POI_TABLE_ID, ROUTES_TABLE_ID } from '@/lib/airtable-schema'
import { listProspectsForOverview, type ProspectOverviewItem, type ProspectStatus } from '@/lib/prospects'
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
      const res = await fetch(url.toString(), {
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

async function fetchPoiStats(): Promise<{
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

interface DraftRoute {
  title: string
  dayCount: number
  slug: string
  lastSync: string
  stuck: boolean
}

const STUCK_DRAFT_DAYS = 14

async function fetchRouteStats(): Promise<{
  builderTotal: number
  byStatus: Record<string, number>
  drafts: DraftRoute[]
}> {
  // NB: field is named 'Title (EN)' in Airtable — the previous 'Title EN'
  // caused a 422 and the silent-catch in airtableFetch made route stats
  // permanently render as zero.
  const records = await airtableFetch(ROUTES_TABLE_ID, ['Title', 'Title (EN)', 'Day Count', 'Status', 'Slug', 'Last Builder Sync'])

  const byStatus: Record<string, number> = {}
  const drafts: DraftRoute[] = []
  const now = Date.now()
  let builderTotal = 0

  for (const r of records) {
    const slug = Array.isArray(r.fields['Slug']) ? String(r.fields['Slug'][0] ?? '') : String(r.fields['Slug'] ?? '')
    const lastSync = Array.isArray(r.fields['Last Builder Sync'])
      ? String(r.fields['Last Builder Sync'][0] ?? '')
      : String(r.fields['Last Builder Sync'] ?? '')

    // The Routes table mixes two kinds of records: builder-authored tours
    // (multi-day/* slugs, touched by the route builder) and service records
    // backing static intercity/city-tour pages (their draft Status is
    // meaningless — the pages are live regardless). Only builder tours are
    // «туры в работе»; everything else is editorial plumbing.
    const isBuilderRoute = slug.startsWith('multi-day/') || Boolean(lastSync)
    if (!isBuilderRoute) continue

    builderTotal += 1
    const status = String(r.fields['Status'] ?? '').toLowerCase()
    if (status) byStatus[status] = (byStatus[status] ?? 0) + 1
    if (status === 'draft' || status === 'review') {
      const rawTitle = r.fields['Title'] ?? r.fields['Title (EN)'] ?? 'Без названия'
      const syncTime = lastSync ? Date.parse(lastSync) : NaN
      drafts.push({
        title: Array.isArray(rawTitle) ? String(rawTitle[0] ?? 'Без названия') : String(rawTitle),
        dayCount: Number(r.fields['Day Count'] ?? 0),
        slug,
        lastSync,
        stuck: !Number.isFinite(syncTime) || now - syncTime > STUCK_DRAFT_DAYS * 86400_000,
      })
    }
  }

  drafts.sort((a, b) => Number(b.stuck) - Number(a.stuck))
  return { builderTotal, byStatus, drafts }
}

// ─── Prospect funnel stats ────────────────────────────────────────────────────

const DAY_MS = 86400_000

interface StuckProspect {
  name: string
  stage: string
  days: number
}

interface UpcomingArrival {
  name: string
  arrivalDate: string
  party: string
  status: string
}

function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? Math.floor((now - t) / DAY_MS) : null
}

function computeProspectStats(items: ProspectOverviewItem[], now: number) {
  const byStatus: Record<ProspectStatus, number> = { new: 0, fact_find: 0, proposal: 0, converted: 0, lost: 0 }
  const bySource = new Map<string, number>()
  let new7d = 0
  let readyForRoute = 0
  const stuck: StuckProspect[] = []
  const arrivals: UpcomingArrival[] = []
  const conversionDays: number[] = []

  for (const p of items) {
    if (p.status && p.status in byStatus) byStatus[p.status as ProspectStatus] += 1
    if (p.source) bySource.set(p.source, (bySource.get(p.source) ?? 0) + 1)

    const ageDays = daysSince(p.createdAt, now)
    if (ageDays !== null && ageDays <= 7) new7d += 1

    const displayName = p.name || p.prospectId || 'Без имени'

    if (p.factFindCompletedAt && (p.status === 'new' || p.status === 'fact_find')) {
      readyForRoute += 1
      const waitDays = daysSince(p.factFindCompletedAt, now)
      if (waitDays !== null && waitDays > 7) {
        stuck.push({ name: displayName, stage: 'анкета заполнена, нет предложения', days: waitDays })
      }
    } else if (p.status === 'new' && ageDays !== null && ageDays > 3) {
      stuck.push({ name: displayName, stage: 'новая заявка без ответа', days: ageDays })
    }

    if (p.arrivalDate && p.status !== 'lost') {
      const t = Date.parse(p.arrivalDate)
      if (Number.isFinite(t) && t >= now - DAY_MS && t <= now + 30 * DAY_MS) {
        arrivals.push({
          name: displayName,
          arrivalDate: p.arrivalDate,
          party: [p.partyComposition, p.partySize ? `${p.partySize} чел.` : null].filter(Boolean).join(', '),
          status: p.status,
        })
      }
    }

    if (p.status === 'converted' && p.createdAt && p.convertedAt) {
      const created = Date.parse(p.createdAt)
      const converted = Date.parse(p.convertedAt)
      if (Number.isFinite(created) && Number.isFinite(converted) && converted >= created) {
        conversionDays.push(Math.round((converted - created) / DAY_MS))
      }
    }
  }

  stuck.sort((a, b) => b.days - a.days)
  arrivals.sort((a, b) => Date.parse(a.arrivalDate) - Date.parse(b.arrivalDate))

  const total = items.length
  const conversionRate = total > 0 ? Math.round((byStatus.converted / total) * 100) : null
  conversionDays.sort((a, b) => a - b)
  const medianConversionDays = conversionDays.length > 0 ? conversionDays[Math.floor(conversionDays.length / 2)] : null

  return {
    total,
    byStatus,
    bySource: [...bySource.entries()].sort((a, b) => b[1] - a[1]),
    new7d,
    readyForRoute,
    stuck: stuck.slice(0, 5),
    arrivals: arrivals.slice(0, 5),
    conversionRate,
    medianConversionDays,
  }
}

// ─── Health checks ────────────────────────────────────────────────────────────

async function checkAirtable(): Promise<boolean> {
  if (!TOKEN || !BASE) return false
  try {
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${POI_TABLE_ID}?pageSize=1`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
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
      signal: AbortSignal.timeout(4000),
    })
    return r.ok
  } catch {
    return false
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border px-5 py-4 flex flex-col gap-1 ${accent ? 'border-sky-400/30 bg-sky-500/[0.08]' : 'border-white/10 bg-[#0b1623]/90'}`}>
      <div className="text-2xl font-semibold tracking-tight text-white">{value}</div>
      <div className="text-sm font-medium text-slate-300">{label}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.08em] text-slate-400">{children}</h2>
  )
}

function Panel({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0b1623]/90 px-5 py-5">
      {title && (
        <div className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500 mb-3">{title}</div>
      )}
      {children}
    </div>
  )
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-500">{children}</p>
}

function HealthDot({ ok }: { ok: boolean }) {
  return <span className={`inline-block size-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
}

const SOURCE_LABELS: Record<string, string> = {
  website: 'Сайт',
  telegram: 'Telegram',
  referral: 'Рекомендация',
  repeat: 'Повторный',
}

const PROSPECT_STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  fact_find: 'Анкета',
  proposal: 'Предложение',
  converted: 'Клиент',
  lost: 'Потерян',
}

// ─── Main component ───────────────────────────────────────────────────────────

export async function AdminOverviewDashboard() {
  const now = Date.now()

  const [poiStats, routeStats, prospects, eventCounts, resourceItems, airtableOk, telegramOk] = await Promise.all([
    fetchPoiStats(),
    fetchRouteStats(),
    listProspectsForOverview(),
    getEventLifecycleCounts(now).catch(() => ({ live: 0, upcoming: 0, endingSoonDays14: 0, endedNotArchived: 0 })),
    getAdminResourceItems().catch(() => []),
    checkAirtable(),
    checkTelegram(),
  ])

  const funnel = computeProspectStats(prospects, now)
  const resourcesSummary = getAdminResourcesSummary(resourceItems)

  const openaiConfigured = Boolean(process.env.OPENAI_API_KEY)

  return (
    <AdminShell currentPath="/admin" title="Обзор" subtitle="Что требует внимания сегодня">
      {/* ── Клиенты ──────────────────────────────────────────────────────────── */}
      <div className="mt-6">
        <SectionTitle>Клиенты</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Новые заявки" value={funnel.byStatus.new} sub={`+${funnel.new7d} за 7 дней`} />
          <StatCard label="Готовы к маршруту" value={funnel.readyForRoute} sub="анкета есть, предложения нет" accent={funnel.readyForRoute > 0} />
          <StatCard label="В предложении" value={funnel.byStatus.proposal} sub="ждут решения клиента" />
          <StatCard
            label="Конверсия"
            value={funnel.conversionRate !== null ? `${funnel.conversionRate}%` : '—'}
            sub={
              funnel.medianConversionDays !== null
                ? `медиана ${funnel.medianConversionDays} дн. до клиента`
                : `${funnel.byStatus.converted} клиентов из ${funnel.total}`
            }
          />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <Panel title="Застрявшие">
            {funnel.stuck.length === 0 ? (
              <EmptyNote>Никто не ждёт дольше нормы</EmptyNote>
            ) : (
              <div className="flex flex-col gap-2">
                {funnel.stuck.map((s, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm text-white truncate">{s.name}</div>
                      <div className="text-xs text-slate-500">{s.stage}</div>
                    </div>
                    <span className="shrink-0 inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs text-amber-400">
                      {s.days} дн.
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Ближайшие приезды (30 дней)">
            {funnel.arrivals.length === 0 ? (
              <EmptyNote>Нет запланированных прилётов</EmptyNote>
            ) : (
              <div className="flex flex-col gap-2">
                {funnel.arrivals.map((a, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm text-white truncate">{a.name}</div>
                      <div className="text-xs text-slate-500">{a.party || PROSPECT_STATUS_LABELS[a.status] || a.status}</div>
                    </div>
                    <span className="shrink-0 text-xs text-slate-300">
                      {new Date(a.arrivalDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Источники заявок">
            {funnel.bySource.length === 0 ? (
              <EmptyNote>Пока нет данных</EmptyNote>
            ) : (
              <div className="flex flex-col gap-2">
                {funnel.bySource.map(([source, count]) => (
                  <div key={source} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-slate-300">{SOURCE_LABELS[source] ?? source}</span>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="h-1.5 rounded-full bg-white/10 w-24 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-sky-500/70"
                          style={{ width: `${Math.round((count / (funnel.bySource[0]?.[1] || 1)) * 100)}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium text-slate-400 w-8 text-right">{count}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* ── Туры в работе ────────────────────────────────────────────────────── */}
      <div className="mt-8">
        <SectionTitle>Туры в работе</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Черновики" value={routeStats.byStatus['draft'] ?? 0} sub={`${routeStats.drafts.filter((d) => d.stuck).length} застряли (>${STUCK_DRAFT_DAYS} дн.)`} />
          <StatCard label="На проверке" value={routeStats.byStatus['review'] ?? 0} />
          <StatCard label="Опубликованы" value={routeStats.byStatus['published'] ?? 0} />
          <StatCard label="Маршрутов в билдере" value={routeStats.builderTotal} sub={`архив: ${routeStats.byStatus['archived'] ?? 0}`} />
        </div>

        {routeStats.drafts.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {routeStats.drafts.map((route, i) => (
              <a
                key={i}
                href="/admin/multi-day"
                className="rounded-2xl border border-white/10 bg-[#0b1623]/90 px-5 py-4 flex items-center justify-between gap-4 hover:border-white/20 hover:bg-white/[0.04] transition-colors"
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="text-sm font-medium text-white truncate">{route.title}</div>
                  {route.lastSync && (
                    <div className="text-xs text-slate-500">
                      Обновлён: {new Date(route.lastSync).toLocaleDateString('ru-RU')}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-4 flex-shrink-0">
                  <span className="text-xs text-slate-400 whitespace-nowrap">
                    {route.dayCount > 0 ? `тур на ${route.dayCount} дн.` : '—'}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs ${
                      route.stuck
                        ? 'border-red-500/30 bg-red-500/10 text-red-400'
                        : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                    }`}
                  >
                    {route.stuck
                      ? route.lastSync
                        ? `Без движения ${Math.floor((Date.now() - Date.parse(route.lastSync)) / 86400_000)} дн.`
                        : 'Без движения'
                      : 'Черновик'}
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* ── Контент ──────────────────────────────────────────────────────────── */}
      <div className="mt-8">
        <SectionTitle>Контент</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="POI" value={poiStats.total} sub={`${poiStats.synced} синхронизировано`} />
          <StatCard label="События идут" value={eventCounts.live} sub={`${eventCounts.endingSoonDays14} закончатся за 14 дн. · ${eventCounts.upcoming} впереди`} />
          <StatCard label="К архивации" value={eventCounts.endedNotArchived} sub="события завершились" accent={eventCounts.endedNotArchived > 0} />
          <StatCard
            label="Дыры в ресурсах"
            value={resourcesSummary.missingDescriptions + resourcesSummary.missingPrimaryUrl}
            sub={`${resourcesSummary.missingDescriptions} без описания · ${resourcesSummary.missingPrimaryUrl} без ссылки`}
          />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Panel title="Топ городов по количеству POI">
            {poiStats.byCityTop5.length === 0 ? (
              <EmptyNote>Нет данных</EmptyNote>
            ) : (
              <div className="flex flex-col gap-2">
                {poiStats.byCityTop5.map(({ city, count }) => (
                  <div key={city} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-slate-300">{city}</span>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="h-1.5 rounded-full bg-white/10 w-24 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-blue-500/70"
                          style={{ width: `${Math.round((count / (poiStats.byCityTop5[0]?.count || 1)) * 100)}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium text-slate-400 w-8 text-right">{count}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Ресурсы по типам">
            <div className="flex flex-col gap-2">
              {[
                ['Услуги', resourcesSummary.services],
                ['Отели', resourcesSummary.hotels],
                ['Рестораны', resourcesSummary.restaurants],
                ['События', resourcesSummary.events],
                ['Черновики', resourcesSummary.draft],
                ['Архив', resourcesSummary.archived],
              ].map(([label, count]) => (
                <div key={String(label)} className="flex items-center justify-between gap-4">
                  <span className="text-sm text-slate-300">{label}</span>
                  <span className="text-sm font-medium text-slate-400">{count}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {/* ── Здоровье инструментов ────────────────────────────────────────────── */}
      <div className="mt-8">
        <SectionTitle>Здоровье инструментов</SectionTitle>
        <div className="rounded-2xl border border-white/10 bg-[#0b1623]/90 px-5 py-4 flex flex-wrap gap-6">
          {[
            { label: 'Airtable', ok: airtableOk },
            { label: 'Telegram-бот', ok: telegramOk },
            { label: 'OpenAI ключ (генерация текстов)', ok: openaiConfigured },
          ].map(({ label, ok }) => (
            <div key={label} className="flex items-center gap-2">
              <HealthDot ok={ok} />
              <span className={`text-sm ${ok ? 'text-slate-300' : 'text-red-400'}`}>
                {label} {ok ? '✓' : '✗'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </AdminShell>
  )
}
