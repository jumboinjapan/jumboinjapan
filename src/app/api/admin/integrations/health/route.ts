import { NextRequest, NextResponse } from 'next/server'

import { requireAdminSession, requireSameOrigin } from '@/lib/admin-guard'
import { checkAllIntegrations } from '@/lib/integrations/health'

/**
 * Живая проверка провайдеров: один запрос от браузера — все проверки
 * параллельно на сервере.
 *
 * POST, а не GET, при том что запрос ничего не меняет у нас: он тратит
 * лимиты у провайдера, а значит не должен выполняться браузерным префетчем
 * или ускорителем ссылок. Ровно тот же урок, что с /api/admin/auth/logout
 * (инцидент «умирающие сессии» 2026-07-14).
 *
 * Тело: { ids?: string[], force?: boolean }.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied
  const crossOrigin = requireSameOrigin(request)
  if (crossOrigin) return crossOrigin

  let ids: string[] | undefined
  let force = false

  try {
    const body: unknown = await request.json()
    if (body && typeof body === 'object') {
      const parsed = body as { ids?: unknown; force?: unknown }
      if (Array.isArray(parsed.ids)) ids = parsed.ids.filter((id): id is string => typeof id === 'string')
      force = parsed.force === true
    }
  } catch {
    // Пустое тело — проверяем всех, без принуждения.
  }

  try {
    const results = await checkAllIntegrations(ids, force)
    return NextResponse.json({ ok: true, results })
  } catch (error) {
    console.error('[integrations] health failed:', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ ok: false, error: 'Проверка не выполнилась' }, { status: 500 })
  }
}
