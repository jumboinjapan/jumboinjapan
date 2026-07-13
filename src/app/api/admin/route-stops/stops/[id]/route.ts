import { revalidateTag } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'

import { ROUTE_STOPS_TABLE_ID } from '@/lib/airtable-schema'

import { requireAdminSession } from '@/lib/admin-guard'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN!
const BASE_ID = process.env.AIRTABLE_BASE_ID!
const STOPS_TABLE = ROUTE_STOPS_TABLE_ID

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAdminSession()
  if (denied) return denied

  try {
    const { id } = await params
    const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${STOPS_TABLE}/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    })
    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ error: text }, { status: res.status })
    }
    revalidateTag('airtable:routes', 'max')

    return NextResponse.json({ ok: true, deleted: id })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
