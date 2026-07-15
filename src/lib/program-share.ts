import { randomBytes } from 'node:crypto'

import { fetchAirtableWithRetry } from '@/lib/airtable-retry'
import { BASE_URL } from '@/lib/schema'

/**
 * Публичная «живая» ссылка на программу тура (2026-07-16).
 *
 * Гость получает адрес `jumboinjapan.com/p/<token>` вместо PDF-вложения:
 * страница всегда показывает актуальную версию программы и даёт скачать PDF.
 *
 * Приватность — защита в глубину:
 *  — доступ по неугадываемому токену (Routes.Public Token), не по имени;
 *  — на странице НЕТ персональных данных: вместо имени клиента — кодовое имя
 *    группы (Routes.Public Label → Group Name клиента из анкеты → заглушка);
 *  — ссылка живёт только до конца дня отъезда (последний день тура по японскому
 *    времени) — потом жёсткий гейт отдаёт 404, а `expireEndedShareTokens()`
 *    физически стирает токен из базы;
 *  — отмена поездки = ручное «Отключить» (очистка токена) в конструкторе.
 *
 * Токен — единственный секрет; кодовое имя короткое и адресом быть НЕ может.
 */

const ROUTES_TABLE = 'Routes'
const PROSPECTS_TABLE = 'Prospects'

/** Часовой пояс Японии — тур-даты «умирают» по местному времени гостя/гида. */
const JST_OFFSET = '+09:00'

const FALLBACK_CODENAME = 'Программа путешествия'

interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
}

function getCredentials() {
  const token = process.env.AIRTABLE_TOKEN?.trim()
  const baseId = process.env.AIRTABLE_BASE_ID?.trim()
  return { token, baseId }
}

function ensureCredentials() {
  const { token, baseId } = getCredentials()
  if (!token || !baseId) {
    throw new Error('AIRTABLE_TOKEN and AIRTABLE_BASE_ID are required for program share links')
  }
  return { token, baseId }
}

function buildUrl(baseId: string, table: string) {
  return `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`
}

function getText(fields: Record<string, unknown>, key: string): string {
  const value = fields[key]
  return typeof value === 'string' ? value : ''
}

function getNumber(fields: Record<string, unknown>, key: string): number {
  const value = fields[key]
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

async function fetchRecords(table: string, formula: string, fields?: string[]): Promise<AirtableRecord[]> {
  const { token, baseId } = ensureCredentials()
  const url = new URL(buildUrl(baseId, table))
  url.searchParams.set('filterByFormula', formula)
  url.searchParams.set('pageSize', '100')
  if (fields) for (const f of fields) url.searchParams.append('fields[]', f)

  const records: AirtableRecord[] = []
  let offset: string | undefined
  do {
    if (offset) url.searchParams.set('offset', offset)
    else url.searchParams.delete('offset')
    const res = await fetchAirtableWithRetry(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`Airtable read failed for ${table}: ${res.status} ${await res.text()}`)
    const data = (await res.json()) as { records?: AirtableRecord[]; offset?: string }
    records.push(...(data.records ?? []))
    offset = data.offset
  } while (offset)
  return records
}

async function patchRoute(recordId: string, fields: Record<string, unknown>) {
  const { token, baseId } = ensureCredentials()
  const res = await fetchAirtableWithRetry(`${buildUrl(baseId, ROUTES_TABLE)}/${recordId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  })
  if (!res.ok) throw new Error(`Airtable patch failed for ${ROUTES_TABLE}: ${res.status} ${await res.text()}`)
}

function escapeFormulaValue(value: string): string {
  return value.replace(/'/g, "\\'")
}

async function fetchRouteBySlug(slug: string): Promise<AirtableRecord | null> {
  const records = await fetchRecords(ROUTES_TABLE, `{Slug}='${escapeFormulaValue(slug)}'`)
  return records[0] ?? null
}

// ── Токен ────────────────────────────────────────────────────────────────────

/** 32-символьный url-safe токен: неугадываемость — единственный контроль доступа. */
function generateToken(): string {
  return randomBytes(24).toString('base64url')
}

// ── Срок жизни ссылки ─────────────────────────────────────────────────────────

/**
 * Момент смерти ссылки: полночь по Японии ПОСЛЕ дня отъезда. Последний день
 * тура — startDate + (dayCount − 1); ссылка живёт весь этот день, поэтому
 * граница — startDate + dayCount дней в 00:00 JST.
 *
 * Нет даты старта или числа дней (одиночные туры, черновики) → срока нет,
 * ссылка живёт до ручного отключения. Возвращает epoch ms или null.
 */
export function shareExpiryInstant(startDate: string, dayCount: number): number | null {
  if (!startDate || !Number.isFinite(dayCount) || dayCount < 1) return null
  const start = Date.parse(`${startDate}T00:00:00${JST_OFFSET}`)
  if (!Number.isFinite(start)) return null
  return start + dayCount * 86_400_000
}

export function isShareExpired(startDate: string, dayCount: number, now: number = Date.now()): boolean {
  const instant = shareExpiryInstant(startDate, dayCount)
  if (instant === null) return false
  return now >= instant
}

// ── Кодовое имя ───────────────────────────────────────────────────────────────

/** Group Name связанного клиента: Prospect, у которого slug есть в Linked Routes. */
async function fetchProspectGroupName(slug: string): Promise<string> {
  try {
    const records = await fetchRecords(
      PROSPECTS_TABLE,
      `FIND('${escapeFormulaValue(slug)}', {Linked Routes})`,
      ['Group Name'],
    )
    for (const record of records) {
      const name = getText(record.fields, 'Group Name').trim()
      if (name) return name
    }
  } catch {
    // Отсутствие клиента не должно ронять публичную страницу — просто нет имени.
  }
  return ''
}

/** Кодовое имя для страницы: ручной оверрайд → Group Name анкеты → заглушка. */
async function resolveCodename(routeFields: Record<string, unknown>, slug: string): Promise<string> {
  const override = getText(routeFields, 'Public Label').trim()
  if (override) return override
  const groupName = await fetchProspectGroupName(slug)
  return groupName || FALLBACK_CODENAME
}

// ── Публичный резолв (страница /p/[token] и её PDF) ────────────────────────────

export interface ResolvedSharedProgram {
  slug: string
  codename: string
}

/**
 * Маршрут по токену для публичной страницы. Возвращает null, если токена нет
 * ИЛИ срок ссылки вышел (жёсткий гейт → страница отдаёт 404 точно в срок,
 * не дожидаясь фоновой очистки).
 */
export async function resolveSharedProgram(token: string): Promise<ResolvedSharedProgram | null> {
  const clean = token.trim()
  if (!clean) return null

  let records: AirtableRecord[]
  try {
    records = await fetchRecords(ROUTES_TABLE, `{Public Token}='${escapeFormulaValue(clean)}'`)
  } catch {
    return null
  }
  const record = records[0]
  if (!record) return null

  const slug = getText(record.fields, 'Slug')
  if (!slug) return null

  const startDate = getText(record.fields, 'Tour Start Date')
  const dayCount = getNumber(record.fields, 'Day Count')
  if (isShareExpired(startDate, dayCount)) return null

  const codename = await resolveCodename(record.fields, slug)
  return { slug, codename }
}

// ── Управление из конструктора ────────────────────────────────────────────────

export interface ShareState {
  enabled: boolean
  token: string
  url: string
  /** Ручной оверрайд кодового имени (Routes.Public Label), может быть пустым. */
  label: string
  /** Итоговое кодовое имя, которое увидит гость (оверрайд → анкета → заглушка). */
  resolvedCodename: string
  /** Дата окончания ссылки (ISO) или null, если срока нет. */
  expiresAt: string | null
  expired: boolean
}

async function buildShareState(record: AirtableRecord, slug: string): Promise<ShareState> {
  const token = getText(record.fields, 'Public Token').trim()
  const label = getText(record.fields, 'Public Label').trim()
  const startDate = getText(record.fields, 'Tour Start Date')
  const dayCount = getNumber(record.fields, 'Day Count')
  const expiryInstant = shareExpiryInstant(startDate, dayCount)

  return {
    enabled: Boolean(token),
    token,
    url: token ? `${BASE_URL}/p/${token}` : '',
    label,
    resolvedCodename: await resolveCodename(record.fields, slug),
    expiresAt: expiryInstant !== null ? new Date(expiryInstant).toISOString() : null,
    expired: isShareExpired(startDate, dayCount),
  }
}

/** Текущее состояние шеринга маршрута для UI конструктора. */
export async function getShareState(slug: string): Promise<ShareState | null> {
  const record = await fetchRouteBySlug(slug)
  if (!record) return null
  return buildShareState(record, slug)
}

/** Включить ссылку: если токена ещё нет — сгенерировать. Идемпотентно. */
export async function enableShare(slug: string): Promise<ShareState> {
  const record = await fetchRouteBySlug(slug)
  if (!record) throw new Error(`Маршрут не найден: ${slug}`)
  if (!getText(record.fields, 'Public Token').trim()) {
    await patchRoute(record.id, { 'Public Token': generateToken() })
    const updated = await fetchRouteBySlug(slug)
    return buildShareState(updated ?? record, slug)
  }
  return buildShareState(record, slug)
}

/** Сменить ссылку: новый токен, старая ссылка мгновенно мертва. */
export async function rotateShare(slug: string): Promise<ShareState> {
  const record = await fetchRouteBySlug(slug)
  if (!record) throw new Error(`Маршрут не найден: ${slug}`)
  await patchRoute(record.id, { 'Public Token': generateToken() })
  const updated = await fetchRouteBySlug(slug)
  return buildShareState(updated ?? record, slug)
}

/** Отключить ссылку (отмена поездки): очистка токена. */
export async function disableShare(slug: string): Promise<ShareState> {
  const record = await fetchRouteBySlug(slug)
  if (!record) throw new Error(`Маршрут не найден: ${slug}`)
  await patchRoute(record.id, { 'Public Token': '' })
  const updated = await fetchRouteBySlug(slug)
  return buildShareState(updated ?? record, slug)
}

/** Задать/очистить ручное кодовое имя. */
export async function setShareLabel(slug: string, label: string): Promise<ShareState> {
  const record = await fetchRouteBySlug(slug)
  if (!record) throw new Error(`Маршрут не найден: ${slug}`)
  await patchRoute(record.id, { 'Public Label': label.trim() })
  const updated = await fetchRouteBySlug(slug)
  return buildShareState(updated ?? record, slug)
}

// ── Физическая очистка (ночная уборка) ─────────────────────────────────────────

/**
 * Стирает Public Token у всех маршрутов, чей тур уже закончился. Жёсткий гейт
 * уже делает такие ссылки нерабочими — эта уборка убирает мёртвые токены из
 * базы физически. Безопасна и идемпотентна: трогает только просроченные строки.
 */
export async function expireEndedShareTokens(now: number = Date.now()): Promise<{ cleared: number }> {
  const records = await fetchRecords(ROUTES_TABLE, `NOT({Public Token}='')`, [
    'Public Token',
    'Tour Start Date',
    'Day Count',
  ])

  let cleared = 0
  for (const record of records) {
    const startDate = getText(record.fields, 'Tour Start Date')
    const dayCount = getNumber(record.fields, 'Day Count')
    if (isShareExpired(startDate, dayCount, now)) {
      await patchRoute(record.id, { 'Public Token': '' })
      cleared += 1
    }
  }
  return { cleared }
}
