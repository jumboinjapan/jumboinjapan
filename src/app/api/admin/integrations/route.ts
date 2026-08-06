import { NextRequest, NextResponse } from 'next/server'

import { requireAdminSession } from '@/lib/admin-guard'
import { INTEGRATIONS } from '@/lib/integrations/registry'
import { describeIntegration, getVaultState } from '@/lib/integrations/vault'

/**
 * Список подключённых внешних API для дэшборда /admin/integrations.
 *
 * Внешних запросов НЕ делает — только состояние настройки. Живые проверки
 * вынесены в POST /api/admin/integrations/health, чтобы открытие страницы
 * не зависело от того, отвечает ли сейчас каждый провайдер.
 *
 * Секретов в ответе нет по построению: describeIntegration отдаёт маски.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  try {
    const providers = await Promise.all(INTEGRATIONS.map((definition) => describeIntegration(definition)))
    return NextResponse.json({ ok: true, providers, vault: getVaultState() })
  } catch (error) {
    console.error('[integrations] не удалось собрать список:', error instanceof Error ? error.message : String(error))
    return NextResponse.json({ ok: false, error: 'Не удалось прочитать состояние интеграций' }, { status: 500 })
  }
}
