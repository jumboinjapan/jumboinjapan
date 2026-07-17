import { NextRequest, NextResponse } from 'next/server'

import { AIRTABLE_BASE_ID } from '@/lib/airtable-schema'

/**
 * Публичный first-party приёмник событий воронки (дублирует GA4-события в
 * Airtable «Funnel Events», чтобы воронка была видна в /admin без внешних
 * сервисов). Клиент шлёт через navigator.sendBeacon из src/lib/analytics.ts.
 *
 * Защита от мусора: белый список событий, обрезка строк, мягкая проверка
 * Origin. Ошибки Airtable не транслируются клиенту — аналитика не должна
 * влиять на UX; endpoint всегда отвечает 204.
 */

const FUNNEL_EVENTS_TABLE = 'Funnel Events'

const ALLOWED_EVENTS = new Set([
  'generate_lead',
  'contact_form_error',
  'questionnaire_open',
  'questionnaire_step',
  'questionnaire_submit',
  'cta_contact_click',
])

const KNOWN_PARAM_FIELDS: Record<string, string> = {
  page: 'Page',
  href: 'Href',
  label: 'Label',
  channel: 'Channel',
}

function clip(value: unknown, max = 200): string {
  return String(value ?? '').slice(0, max)
}

export async function POST(request: NextRequest) {
  const ok = new NextResponse(null, { status: 204 })

  try {
    // sendBeacon шлёт text/plain — парсим тело вручную.
    const body = (await request.json().catch(() => null)) as
      | { event?: string; params?: Record<string, unknown> }
      | null
    const event = body?.event ?? ''
    if (!ALLOWED_EVENTS.has(event)) return ok

    // Мягкая same-origin проверка: браузерные запросы с чужих сайтов отсекаем,
    // запросы без Origin (боты, curl) — тоже, honest-клиент его всегда шлёт.
    const origin = request.headers.get('origin') ?? ''
    if (!/^https?:\/\/(www\.)?(jumboinjapan\.com|localhost(:\d+)?)$/.test(origin)) return ok

    const token = process.env.AIRTABLE_TOKEN
    if (!token) return ok

    const params = body?.params && typeof body.params === 'object' ? body.params : {}
    const fields: Record<string, string> = {
      Event: clip(event, 60),
      Created: new Date().toISOString(),
    }
    const meta: Record<string, string> = {}
    for (const [key, value] of Object.entries(params)) {
      const field = KNOWN_PARAM_FIELDS[key]
      if (field) fields[field] = clip(value)
      else meta[clip(key, 40)] = clip(value)
    }
    if (Object.keys(meta).length > 0) fields['Meta'] = clip(JSON.stringify(meta), 1000)

    await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(FUNNEL_EVENTS_TABLE)}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [{ fields }] }),
      },
    ).catch(() => undefined)
  } catch {
    // Никогда не роняем ответ из-за аналитики.
  }

  return ok
}
