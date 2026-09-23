import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireAdminSession } from '@/lib/admin-guard'
import { DAY_ITEMS_TABLE_NAME } from '@/lib/airtable-schema'
import { repairDayItemPois, DayItemRepairError } from '@/lib/day-item-poi-repair'
import { preflightRoutePois, RoutePoiReadinessError } from '@/lib/route-poi-preflight'

export async function PATCH(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied
  try {
    const { token, baseId } = { token: process.env.AIRTABLE_TOKEN, baseId: process.env.AIRTABLE_BASE_ID }
    if (!token || !baseId) throw Error('Airtable credentials required')
    const base = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(DAY_ITEMS_TABLE_NAME)}`
    async function access(id: string, fields?: Record<string, unknown>) {
      const response = await fetch(`${base}/${id}`, {
        method: fields ? 'PATCH' : 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: fields ? JSON.stringify({ fields }) : undefined,
        cache: 'no-store', signal: AbortSignal.timeout(30000),
      })
      if (!response.ok) throw Error(`Day item ${fields ? 'write' : 'read'} failed: ${response.status}`)
      return response.json()
    }
    const { records } = await request.json()
    const result = await repairDayItemPois(records, { read: id => access(id), patch: async (id, fields) => { await access(id, fields) }, preflight: preflightRoutePois })
    revalidateTag('airtable:routes', 'max')
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof DayItemRepairError) {
      if (error.recoveryRequired) revalidateTag('airtable:routes', 'max')
      return NextResponse.json({ error: error.message, applied: error.applied, failedId: error.failedId, uncertainId: error.uncertainId, phase: error.phase, recoveryRequired: error.recoveryRequired }, { status: 409 })
    }
    if (error instanceof RoutePoiReadinessError) return NextResponse.json({ error: error.message, code: error.code, issues: error.issues }, { status: 422 })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Repair failed; reconcile before retry' }, { status: 409 })
  }
}
