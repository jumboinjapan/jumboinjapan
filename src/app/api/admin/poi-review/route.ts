import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession, requireSameOrigin } from '@/lib/admin-guard'
import { ownerReviewEvent, ReviewInputError } from '@/lib/poi-review'
import { createReviewStore } from '@/lib/poi-review-storage'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }
export async function GET(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied
  try {
    return NextResponse.json({ rows: await createReviewStore().load() }, { headers })
  } catch (error) {
    console.error('[poi-review] read failed', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ error: 'Не удалось загрузить обсуждения. Повторите попытку.' }, { status: 503, headers })
  }
}
export async function POST(request: NextRequest) {
  const denied = await requireAdminSession(request) ?? requireSameOrigin(request)
  if (denied) return denied
  if (!request.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ error: 'Нужен JSON' }, { status: 415 })
  try {
    const raw = await request.text()
    if (new TextEncoder().encode(raw).length > 50000) return NextResponse.json({ error: 'Комментарий слишком длинный' }, { status: 413 })
    const event = ownerReviewEvent(JSON.parse(raw))
    return NextResponse.json({ event: await createReviewStore().append(event) }, { headers })
  } catch (error) {
    if (error instanceof ReviewInputError || error instanceof SyntaxError) return NextResponse.json({ error: error.message }, { status: 400, headers })
    console.error('[poi-review] save failed', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ error: 'Не удалось подтвердить сохранение. Текст оставлен в поле; повторите попытку.' }, { status: 503, headers })
  }
}
