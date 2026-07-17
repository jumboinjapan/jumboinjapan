import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'

import {
  appendLinkedRoute,
  appendProspectComment,
  getProspectById,
  normalizeLinkedRouteSlug,
  removeLinkedRoute,
  updateProspectNotes,
  updateProspectStage,
  updateProspectTourType,
  type ProspectStage,
  type ProspectTourType,
} from '@/lib/prospects'
import { routeSlugExists } from '@/lib/multi-day-builder-storage'

import { requireAdminSession } from '@/lib/admin-guard'

// Карточка клиента: чтение и точечные правки. Auth — middleware-периметр
// /api/admin/**. Весь доступ к Prospects — через prospects.ts.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  const { id } = await params
  const prospect = await getProspectById(id)
  if (!prospect) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  return NextResponse.json(prospect)
}

interface PatchBody {
  stage?: string
  tourType?: string
  notes?: string
  appendLinkedRoute?: string
  removeLinkedRoute?: string
  addComment?: string
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  const { id } = await params

  let body: PatchBody
  try {
    body = (await request.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const prospect = await getProspectById(id)
  if (!prospect) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const results: Record<string, boolean> = {}

  if (typeof body.stage === 'string') {
    const result = await updateProspectStage(prospect.recordId, body.stage as ProspectStage)
    if (!result.success) return NextResponse.json({ error: result.error ?? 'stage_failed' }, { status: 400 })
    results.stage = true
  }

  if (typeof body.tourType === 'string') {
    const result = await updateProspectTourType(prospect.recordId, body.tourType as ProspectTourType)
    if (!result.success) return NextResponse.json({ error: result.error ?? 'tour_type_failed' }, { status: 400 })
    results.tourType = true
  }

  if (typeof body.notes === 'string') {
    const result = await updateProspectNotes(prospect.recordId, body.notes)
    if (!result.success) return NextResponse.json({ error: result.error ?? 'notes_failed' }, { status: 502 })
    results.notes = true
  }

  if (typeof body.appendLinkedRoute === 'string') {
    // Валидация против Routes: мёртвый slug не должен попадать в карточку.
    // Голый хвост без префикса («golden-route-7-days») пробуем как multi-day —
    // владельцу не нужно помнить полный формат.
    let slug = normalizeLinkedRouteSlug(body.appendLinkedRoute)
    if (!slug) return NextResponse.json({ error: 'invalid_slug' }, { status: 400 })
    try {
      if (!(await routeSlugExists(slug))) {
        const withPrefix = slug.includes('/') ? '' : `multi-day/${slug}`
        if (withPrefix && (await routeSlugExists(withPrefix))) {
          slug = withPrefix
        } else {
          return NextResponse.json(
            { error: `Маршрут «${slug}» не найден в конструкторе — проверьте slug (полный вид: multi-day/…).` },
            { status: 400 }
          )
        }
      }
    } catch (error) {
      console.error('[admin/clients] route existence check failed:', error)
      // Airtable недоступен для проверки — не блокируем привязку намертво.
    }
    const result = await appendLinkedRoute(prospect.recordId, slug)
    if (!result.success) return NextResponse.json({ error: result.error ?? 'link_failed' }, { status: 400 })
    results.appendLinkedRoute = true
  }

  if (typeof body.removeLinkedRoute === 'string') {
    const result = await removeLinkedRoute(prospect.recordId, body.removeLinkedRoute)
    if (!result.success) return NextResponse.json({ error: result.error ?? 'unlink_failed' }, { status: 400 })
    results.removeLinkedRoute = true
  }

  if (typeof body.addComment === 'string') {
    const result = await appendProspectComment(prospect.recordId, body.addComment)
    if (!result.success) return NextResponse.json({ error: result.error ?? 'comment_failed' }, { status: 400 })
    results.addComment = true
  }

  if (Object.keys(results).length === 0) {
    return NextResponse.json({ error: 'no_supported_fields' }, { status: 400 })
  }

  revalidateTag('airtable:prospects', 'max')
  return NextResponse.json({ ok: true, updated: Object.keys(results) })
}
