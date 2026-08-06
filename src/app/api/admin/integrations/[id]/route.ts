import { NextRequest, NextResponse } from 'next/server'

import { getAdminSessionEmail, requireAdminSession, requireSameOrigin } from '@/lib/admin-guard'
import { findIntegration } from '@/lib/integrations/registry'
import { clearIntegration, describeIntegration, saveIntegration } from '@/lib/integrations/vault'

/**
 * Учётные данные одного провайдера.
 *
 * PUT    — сохранить (частично: пустое значение секретного поля = «не менять»).
 * DELETE — стереть все учётные данные и выключить провайдера.
 *
 * Ответ никогда не содержит секретов — только описание с масками, ровно то же,
 * что отдаёт список. Это сознательно: не должно существовать НИ ОДНОГО роута,
 * способного вернуть сохранённый ключ в браузер.
 */

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const denied = await requireAdminSession(request)
  if (denied) return denied
  const crossOrigin = requireSameOrigin(request)
  if (crossOrigin) return crossOrigin

  const { id } = await context.params
  const definition = findIntegration(id)
  if (!definition) {
    return NextResponse.json({ ok: false, error: `Неизвестный провайдер: ${id}` }, { status: 404 })
  }
  if (definition.envOnly) {
    return NextResponse.json(
      { ok: false, error: `${definition.name} настраивается только переменными окружения Vercel` },
      { status: 400 },
    )
  }

  let payload: { values?: unknown; enabled?: unknown; notes?: unknown }
  try {
    payload = (await request.json()) as typeof payload
  } catch {
    return NextResponse.json({ ok: false, error: 'Тело запроса не разобралось' }, { status: 400 })
  }

  // Принимаем только поля, объявленные в реестре: посторонние ключи в сейф
  // не попадают, даже если их прислали.
  const values: Record<string, string | null> = {}
  if (payload.values && typeof payload.values === 'object' && !Array.isArray(payload.values)) {
    for (const field of definition.fields) {
      const raw = (payload.values as Record<string, unknown>)[field.key]
      if (raw === null) values[field.key] = null
      else if (typeof raw === 'string') values[field.key] = raw
    }
  }

  try {
    await saveIntegration({
      definition,
      values,
      enabled: typeof payload.enabled === 'boolean' ? payload.enabled : undefined,
      notes: typeof payload.notes === 'string' ? payload.notes : undefined,
      updatedBy: await getAdminSessionEmail(request),
    })

    return NextResponse.json({ ok: true, provider: await describeIntegration(definition) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось сохранить'
    console.error(`[integrations] save failed for ${id}:`, message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const denied = await requireAdminSession(request)
  if (denied) return denied
  const crossOrigin = requireSameOrigin(request)
  if (crossOrigin) return crossOrigin

  const { id } = await context.params
  const definition = findIntegration(id)
  if (!definition) {
    return NextResponse.json({ ok: false, error: `Неизвестный провайдер: ${id}` }, { status: 404 })
  }
  if (definition.envOnly) {
    return NextResponse.json(
      { ok: false, error: `${definition.name} настраивается только переменными окружения Vercel` },
      { status: 400 },
    )
  }

  try {
    await clearIntegration(definition, await getAdminSessionEmail(request))
    return NextResponse.json({ ok: true, provider: await describeIntegration(definition) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось стереть'
    console.error(`[integrations] clear failed for ${id}:`, message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
