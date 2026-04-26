import { AdminShell } from './AdminShell'

// ─── Airtable helpers ────────────────────────────────────────────────────────

const TOKEN = process.env.AIRTABLE_TOKEN?.trim() ?? ''
const BASE = process.env.AIRTABLE_BASE_ID?.trim() ?? ''

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
  lastModified: string | null
}> {
  const records = await airtableFetch('tblVCmFcHRpXUT24y', ['POI ID', 'Copy Status', 'Site City'])

  let synced = 0
  const cityMap = new Map<string, number>()
  let lastModified: string | null = null

  for (const r of records) {
    const status = String(r.fields['Copy Status'] ?? '').toLowerCase()
    if (status === 'synced') synced++
    const rawCity = r.fields['Site City']
    const city = (Array.isArray(rawCity) ? rawCity[0] : rawCity != null ? String(rawCity) : '').trim()
    if (city) cityMap.set(city, (cityMap.get(city) ?? 0) + 1)
    // Airtable record id contains creation order; use array order as proxy
    lastModified = r.id
  }

  const byCityTop5 = Array.from(cityMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([city, count]) => ({ city, count }))

  return { total: records.length, synced, byCityTop5, lastModified }
}

interface DraftRoute {
  title: string
  dayCount: number
  status: string
  slug: string
  lastSync: string
}

async function fetchRouteStats(): Promise<{
  total: number
  drafts: DraftRoute[]
}> {
  const records = await airtableFetch('Routes', ['Title', 'Title EN', 'Day Count', 'Status', 'Slug', 'Last Builder Sync'])

  const drafts: DraftRoute[] = []
  for (const r of records) {
    const status = String(r.fields['Status'] ?? '').toLowerCase()
    if (status === 'draft') {
      const rawTitle = r.fields['Title'] ?? r.fields['Title EN'] ?? 'Без названия'
      drafts.push({
        title: Array.isArray(rawTitle) ? String(rawTitle[0] ?? 'Без названия') : String(rawTitle),
        dayCount: Number(r.fields['Day Count'] ?? 0),
        status: String(r.fields['Status'] ?? ''),
        slug: Array.isArray(r.fields['Slug']) ? String(r.fields['Slug'][0] ?? '') : String(r.fields['Slug'] ?? ''),
        lastSync: Array.isArray(r.fields['Last Builder Sync']) ? String(r.fields['Last Builder Sync'][0] ?? '') : String(r.fields['Last Builder Sync'] ?? ''),
      })
    }
  }

  return { total: records.length, drafts }
}

async function pingEndpoint(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(4000) })
    return res.ok
  } catch {
    return false
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0b1623]/90 px-5 py-4 flex flex-col gap-1">
      <div className="text-2xl font-semibold tracking-tight text-white">{value}</div>
      <div className="text-sm font-medium text-slate-300">{label}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

function HealthDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block size-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'}`}
    />
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export async function AdminOverviewDashboard() {
  const [poiStats, routeStats, airtableOk, multiDayOk, resourcesOk] = await Promise.all([
    fetchPoiStats(),
    fetchRouteStats(),
    // health pings — call Airtable directly (1 record)
    (async () => {
      try {
        const r = await fetch(
          `https://api.airtable.com/v0/${BASE}/tblVCmFcHRpXUT24y?pageSize=1`,
          { headers: { Authorization: `Bearer ${TOKEN}` }, cache: 'no-store', signal: AbortSignal.timeout(4000) },
        )
        return r.ok
      } catch {
        return false
      }
    })(),
    pingEndpoint('http://localhost:3000/api/admin/multi-day/route'),
    pingEndpoint('http://localhost:3000/api/admin/resources'),
  ])

  return (
    <AdminShell currentPath="/admin" title="Обзор" subtitle="Состояние системы и незавершённые задачи">
      {/* ── Section 1: Quick stats ─────────────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="POI" value={poiStats.total} sub="объектов в базе" />
        <StatCard label="Маршруты" value={routeStats.total} sub="сохранённых маршрутов" />
        <StatCard label="Черновики" value={routeStats.drafts.length} sub="незавершённых" />
        <StatCard label="Синхронизировано" value={poiStats.synced} sub="POI со статусом Synced" />
      </div>

      {/* ── Section 2: Draft routes ────────────────────────────────────────── */}
      <div className="mt-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.08em] text-slate-400">
          Незавершённые маршруты
        </h2>
        {routeStats.drafts.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#0b1623]/90 px-6 py-8 text-center text-sm text-slate-500">
            Нет незавершённых маршрутов
          </div>
        ) : (
          <div className="flex flex-col gap-2">
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
                    {route.dayCount > 0 ? `${route.dayCount} дн.` : '—'}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs text-amber-400">
                    Черновик
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* ── Section 3: Data stats ──────────────────────────────────────────── */}
      <div className="mt-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.08em] text-slate-400">
          Статистика данных
        </h2>
        <div className="rounded-2xl border border-white/10 bg-[#0b1623]/90 px-5 py-5">
          <div className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500 mb-3">
            Топ городов по количеству POI
          </div>
          {poiStats.byCityTop5.length === 0 ? (
            <p className="text-sm text-slate-500">Нет данных</p>
          ) : (
            <div className="flex flex-col gap-2">
              {poiStats.byCityTop5.map(({ city, count }) => (
                <div key={city} className="flex items-center justify-between gap-4">
                  <span className="text-sm text-slate-300">{city}</span>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="h-1.5 rounded-full bg-white/10 w-24 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-blue-500/70"
                        style={{
                          width: `${Math.round((count / (poiStats.byCityTop5[0]?.count || 1)) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="text-sm font-medium text-slate-400 w-8 text-right">{count}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Section 4: Tool health ─────────────────────────────────────────── */}
      <div className="mt-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.08em] text-slate-400">
          Здоровье инструментов
        </h2>
        <div className="rounded-2xl border border-white/10 bg-[#0b1623]/90 px-5 py-4 flex flex-wrap gap-6">
          {[
            { label: 'Airtable', ok: airtableOk },
            { label: 'Multi-day API', ok: multiDayOk },
            { label: 'Resources API', ok: resourcesOk },
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
