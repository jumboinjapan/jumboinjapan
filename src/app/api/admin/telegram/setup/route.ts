import { NextRequest, NextResponse } from 'next/server'

import { getPoiBotToken } from '@/lib/notifications/telegram'

/**
 * Подключение POI-бота одной кнопкой из админки (2026-07-11).
 *
 * Раньше это требовало ручного curl с токеном и секретом в терминале —
 * владелец не должен возиться с командной строкой и копированием секретов.
 * Здесь сервер сам говорит Telegram, куда слать сообщения, беря токен и
 * секрет из переменных окружения: наружу они не выходят.
 *
 * GET  — показать текущее состояние вебхука (куда бот шлёт сообщения).
 * POST — привязать бота к этому деплою (setWebhook).
 */

function getWebhookSecret(): string {
  return process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? ''
}

function getWebhookUrl(request: NextRequest): string {
  // Привязываемся к тому адресу, с которого нажали кнопку: в проде это
  // jumboinjapan.com, на превью — адрес превью. Так один и тот же код
  // позволяет безопасно тестировать бота на превью-деплое.
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? ''
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  return `${proto}://${host}/api/telegram/webhook`
}

export async function GET(request: NextRequest) {
  const token = getPoiBotToken()
  if (!token) {
    return NextResponse.json({ ok: false, error: 'TELEGRAM_POI_BOT_TOKEN не задан' }, { status: 400 })
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)
  const data = (await response.json()) as {
    ok: boolean
    result?: { url?: string; pending_update_count?: number; last_error_message?: string }
  }

  return NextResponse.json({
    ok: data.ok,
    currentUrl: data.result?.url || '',
    expectedUrl: getWebhookUrl(request),
    pending: data.result?.pending_update_count ?? 0,
    lastError: data.result?.last_error_message || '',
    secretConfigured: Boolean(getWebhookSecret()),
  })
}

export async function POST(request: NextRequest) {
  const token = getPoiBotToken()
  const secret = getWebhookSecret()

  if (!token) {
    return NextResponse.json({ ok: false, error: 'TELEGRAM_POI_BOT_TOKEN не задан в переменных окружения' }, { status: 400 })
  }
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'TELEGRAM_WEBHOOK_SECRET не задан в переменных окружения' }, { status: 400 })
  }

  const url = getWebhookUrl(request)
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, secret_token: secret, allowed_updates: ['message'] }),
  })

  const data = (await response.json()) as { ok: boolean; description?: string }
  if (!data.ok) {
    console.error('[telegram-setup] setWebhook failed:', data.description)
    return NextResponse.json({ ok: false, error: data.description ?? 'Telegram отклонил запрос' }, { status: 502 })
  }

  return NextResponse.json({ ok: true, url })
}
