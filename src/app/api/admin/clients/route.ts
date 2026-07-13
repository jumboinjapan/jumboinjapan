import { NextRequest, NextResponse } from 'next/server'

import { listProspectsForOverview } from '@/lib/prospects'

import { requireAdminSession } from '@/lib/admin-guard'

// Список prospects для доски /admin/clients. Auth — middleware-периметр
// /api/admin/** (как у соседних admin-роутов). Чтение всегда свежее.

export async function GET(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  try {
    const items = await listProspectsForOverview()
    return NextResponse.json({ items })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
