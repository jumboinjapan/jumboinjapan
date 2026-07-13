import { unstable_cache } from 'next/cache'
import Link from 'next/link'

import { AdminShell } from './AdminShell'
import { TelegramBotSetup } from './TelegramBotSetup'
import { CountRow, EmptyNote, HealthDot, Panel, SectionTitle, StatCard } from './ui'
import { AIRTABLE_BASE_ID, POI_TABLE_ID } from '@/lib/airtable-schema'
import { fetchAirtableWithRetry } from '@/lib/airtable-retry'
import { STAGE_LABELS, SOURCE_LABELS, TOUR_TYPE_LABELS, type ProspectStage } from '@/lib/prospect-labels'
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

  const funnelStages: ProspectStage[] = ['received', 'processed', 'discussing', 'agreed', 'conducted', 'paid']
  const tourTypeRows = Object.entries(TOUR_TYPE_LABELS).map(([key, label]) => ({
    label,
    count: funnel.activeByTourType.get(key) ?? 0,
  }))
  const untypedActive = funnel.activeByTourType.get('не указан') ?? 0
  const activeTotal = funnel.byStage.agreed + funnel.byStage.conducted
  const channelRows = [...funnel.activeBySource.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ label: SOURCE_LABELS[key] ?? key, count }))

  return (
    <AdminShell currentPath="/admin" title="Обзор" subtitle="Что требует внимания сегодня">
      {/* ── Клиенты и воронка ─────────────────────────────────────────────────── */}
      <div className="mt-6">
        <div className="flex items-center justify-between gap-4">
          <SectionTitle>Клиенты и воронка</SectionTitle>
          <Link
            href="/admin/clients"
            className="mb-4 inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--adm-accent-border)] bg-[var(--adm-accent-bg)] px-3.5 text-sm text-[var(--adm-accent-text)] transition hover:border-[var(--adm-accent-border)] hover:bg-[var(--adm-accent-hover)]/15 hover:text-[var(--adm-accent-text)]"
          >
            Открыть CRM →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {funnelStages.map((stage) => (
            <Link key={stage} href="/admin/clients" className="block rounded-2xl transition hover:ring-1 hover:ring-[var(--adm-accent-border)]">
              <StatCard
                label={STAGE_LABELS[stage]}
                value={funnel.byStage[stage]}
                sub={stage === 'received' ? `+${funnel.new7d} за 7 дней` : undefined}
              />
            </Link>
          ))}
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <Panel title={`Застрявшие — ${funnel.stuck.length} · ${funnel.stuckPercent}% заявок в работе`}>
            {funnel.stuck.length === 0 ? (
              <EmptyNote>Никто не ждёт дольше нормы</EmptyNote>
            ) : (
              <div className="flex flex-col gap-2">
                {funnel.stuck.slice(0, 5).map((s) => (
                  <Link
                    key={s.recordId}
                    href={`/admin/clients/${s.recordId}`}
                    className="flex items-center justify-between gap-3 -mx-2 rounded-lg px-2 py-1 transition hover:bg-[var(--adm-hover)]"
                  >
                    <div className="min-w-0">
                      <div className="text-sm text-[var(--adm-text)] truncate">{s.name}</div>
                      <div className="text-xs text-[var(--adm-text-3)]">{STAGE_STUCK_LABELS[s.stage]}</div>
                    </div>
                    <span className="shrink-0 inline-flex items-center rounded-full border border-[var(--adm-warn-border)] bg-[var(--adm-warn-bg)] px-2.5 py-0.5 text-xs text-[var(--adm-warn-text)]">
                      {s.days} дн.
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Приход заявок по источникам">
            {funnel.bySource.length === 0 ? (
              <EmptyNote>Пока нет данных</EmptyNote>
            ) : (
              <div className="flex flex-col gap-2">
                {funnel.bySource.map(([source, count]) => (
                  <CountRow
                    key={source}
                    label={SOURCE_LABELS[source] ?? source}
                    count={count}
                    percent={funnel.total > 0 ? Math.round((count / funnel.total) * 100) : null}
                  />
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
                      <div className="text-sm text-[var(--adm-text)] truncate">{a.name}</div>
                      {a.party && <div className="text-xs text-[var(--adm-text-3)]">{a.party}</div>}
                    </div>
                    <span className="shrink-0 text-xs text-[var(--adm-text-2)]">
                      {new Date(a.arrivalDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                    </span>
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
          <StatCard label="Согласованы" value={funnel.byStage.agreed} accent={funnel.byStage.agreed > 0} />
          <StatCard label="Проведены, ждут оплаты" value={funnel.byStage.conducted} />
          <StatCard label="Оплачены" value={funnel.byStage.paid} />
          <StatCard
            label="Конверсия"
            value={funnel.conversionRate !== null ? `${funnel.conversionRate}%` : '—'}
            sub={`${funnel.agreedPlus} туров из ${funnel.total} заявок`}
          />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Panel title="По типу тура">
            {activeTotal === 0 ? (
              <EmptyNote>Нет туров в работе — отметьте Stage и Tour Type в карточке клиента</EmptyNote>
            ) : (
              <div className="flex flex-col gap-2">
                {tourTypeRows.map(({ label, count }) => (
                  <CountRow key={label} label={label} count={count} />
                ))}
                {untypedActive > 0 && <CountRow label="Тип не указан" count={untypedActive} />}
              </div>
            )}
          </Panel>

          <Panel title="По каналу привлечения">
            {channelRows.length === 0 ? (
              <EmptyNote>Нет туров в работе</EmptyNote>
            ) : (
              <div className="flex flex-col gap-2">
                {channelRows.map(({ label, count }) => (
                  <CountRow key={label} label={label} count={count} />
                ))}
              </div>
            )}
          </Panel>
        </div>
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
                    <span className="text-sm text-[var(--adm-text-2)]">{city}</span>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="h-1.5 rounded-full bg-[var(--adm-active)] w-24 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[var(--adm-accent)]"
                          style={{ width: `${Math.round((count / (poiStats.byCityTop5[0]?.count || 1)) * 100)}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium text-[var(--adm-text-3)] w-8 text-right">{count}</span>
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
                <CountRow key={String(label)} label={String(label)} count={Number(count)} />
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {/* ── Здоровье инструментов ────────────────────────────────────────────── */}
      <div className="mt-8">
        <SectionTitle>Здоровье инструментов</SectionTitle>
        <div className="rounded-2xl border border-[var(--adm-border)] bg-[var(--adm-panel)] px-5 py-4 flex flex-wrap gap-6">
          {[
            { label: 'Airtable', ok: airtableOk },
            { label: 'Telegram-бот', ok: telegramOk },
            { label: 'OpenAI ключ (генерация текстов)', ok: openaiConfigured },
          ].map(({ label, ok }) => (
            <div key={label} className="flex items-center gap-2">
              <HealthDot ok={ok} />
              <span className={`text-sm ${ok ? 'text-[var(--adm-text-2)]' : 'text-[var(--adm-danger-text)]'}`}>
                {label} {ok ? '✓' : '✗'}
              </span>
            </div>
          ))}
        </div>
        {/* Подключение POI-бота: одна кнопка вместо curl с токеном в терминале */}
        <TelegramBotSetup />
      </div>
    </AdminShell>
  )
}
