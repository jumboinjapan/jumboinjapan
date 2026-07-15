import { NextRequest, NextResponse } from 'next/server'

import { requireAdminSession } from '@/lib/admin-guard'
import {
  disableShare,
  enableShare,
  expireEndedShareTokens,
  getShareState,
  rotateShare,
  setShareLabel,
} from '@/lib/program-share'

/**
 * Управление публичной ссылкой на программу (Routes.Public Token/Label).
 * GET ?slug= — состояние; POST { slug, action: enable|rotate|disable } —
 * управление токеном; POST { action: 'cleanup' } — физическая очистка
 * истёкших токенов; PATCH { slug, label } — кодовое имя.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  const slug = request.nextUrl.searchParams.get('slug')?.trim() ?? ''
  if (!slug) return NextResponse.json({ error: 'Не указан slug' }, { status: 400 })

  try {
    const state = await getShareState(slug)
    if (!state) return NextResponse.json({ error: 'Маршрут не найден' }, { status: 404 })
    return NextResponse.json({ state })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  try {
    const body = (await request.json()) as { slug?: string; action?: string }
    const action = body.action ?? ''

    if (action === 'cleanup') {
      const result = await expireEndedShareTokens()
      return NextResponse.json({ ok: true, ...result })
    }

    const slug = body.slug?.trim() ?? ''
    if (!slug) return NextResponse.json({ error: 'Не указан slug' }, { status: 400 })

    let state
    if (action === 'enable') state = await enableShare(slug)
    else if (action === 'rotate') state = await rotateShare(slug)
    else if (action === 'disable') state = await disableShare(slug)
    else return NextResponse.json({ error: `Неизвестное действие: ${action}` }, { status: 400 })

    return NextResponse.json({ ok: true, state })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  try {
    const body = (await request.json()) as { slug?: string; label?: string }
    const slug = body.slug?.trim() ?? ''
    if (!slug) return NextResponse.json({ error: 'Не указан slug' }, { status: 400 })

    const state = await setShareLabel(slug, typeof body.label === 'string' ? body.label : '')
    return NextResponse.json({ ok: true, state })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
