import { fetchAirtableWithRetry } from './airtable-retry.ts'
import { POI_REVIEW_TABLE_NAME } from './airtable-schema.ts'
import { projectReview, validateReviewEvent, type ReviewEvent } from './poi-review.ts'
import seed from '../data/poi-review-seed.json' with { type: 'json' }

export const REVIEW_TABLE_DEFINITION = {
  name: POI_REVIEW_TABLE_NAME,
  description: 'Private POI import discussion. Does not create or publish POI.',
  fields: [
    { name: 'Event ID', type: 'singleLineText' },
    { name: 'Source Key', type: 'singleLineText' },
    { name: 'Event JSON', type: 'multilineText' },
  ],
}

interface RecordRow { id: string; fields: Record<string, unknown> }
export function createReviewStore(options: { token?: string; baseId?: string; fetchImpl?: typeof fetch } = {}) {
  const token = options.token ?? process.env.AIRTABLE_TOKEN
  const baseId = options.baseId ?? process.env.AIRTABLE_BASE_ID
  const transport = options.fetchImpl ?? fetchAirtableWithRetry
  function endpoint() {
    if (!token || !baseId) throw new Error('Хранилище разбора не настроено. Обратитесь к агенту.')
    return `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(POI_REVIEW_TABLE_NAME)}`
  }
  async function request(url: string, init: RequestInit = {}) {
    const response = await transport(url, {
      ...init, cache: 'no-store', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    if (!response.ok) throw new Error(`Хранилище разбора недоступно (${response.status}). Повторите попытку; текст комментария сохранён в браузере.`)
    return response.json()
  }
  function decode(record: RecordRow): ReviewEvent {
    const value = record.fields['Event JSON']
    if (typeof value !== 'string') throw new Error('Повреждена запись обсуждения. Нужна проверка агента.')
    const event = validateReviewEvent(JSON.parse(value))
    if (record.fields['Event ID'] !== event.id || record.fields['Source Key'] !== event.sourceKey) throw new Error('Тождество записи обсуждения не совпало')
    return event
  }
  async function records(formula?: string): Promise<RecordRow[]> {
    const all: RecordRow[] = []
    let offset = ''
    const seen = new Set<string>()
    do {
      const url = new URL(endpoint())
      url.searchParams.set('pageSize', '100')
      if (formula) url.searchParams.set('filterByFormula', formula)
      if (offset) url.searchParams.set('offset', offset)
      const data = await request(url.toString())
      if (!Array.isArray(data.records)) throw new Error('Хранилище вернуло некорректный список')
      all.push(...data.records)
      offset = data.offset ?? ''
      if (offset && (typeof offset !== 'string' || seen.has(offset))) throw new Error('Ошибка постраничного чтения обсуждения')
      seen.add(offset)
    } while (offset)
    return all
  }
  async function events() { return (await records()).map(decode) }
  async function load() { return projectReview(seed, await events()) }
  async function append(raw: ReviewEvent) {
    const event = validateReviewEvent(raw)
    const matches = await records(`{Event ID}='${event.id}'`)
    if (matches.length) {
      const stored = matches.map(decode)
      // A browser retry has a fresh server timestamp; compare the actual intent.
      const intent = (e: ReviewEvent) => JSON.stringify({ ...e, at: '' })
      if (stored.some(e => intent(e) !== intent(event))) throw new Error('Этот идентификатор уже использован для другого изменения')
      return stored[0]
    }
    if (event.kind !== 'item' && !(await load()).some(row => row.sourceKey === event.sourceKey)) throw new Error('Карточка не найдена. Обновите список.')
    const fields = { 'Event ID': event.id, 'Source Key': event.sourceKey, 'Event JSON': JSON.stringify(event) }
    // Append only; no PATCH or DELETE, and no call into POI Intake.
    const data = await request(endpoint(), { method: 'POST', body: JSON.stringify({ records: [{ fields }] }) })
    if (!Array.isArray(data.records) || data.records.length !== 1 || typeof data.records[0]?.id !== 'string') throw new Error('Сохранение не подтверждено. Повторите с тем же идентификатором.')
    const checked = decode(await request(`${endpoint()}/${encodeURIComponent(data.records[0].id)}`))
    if (JSON.stringify(checked) !== JSON.stringify(event)) throw new Error('Сохранённое изменение не совпало с отправленным')
    return checked
  }
  return { events, load, append }
}
