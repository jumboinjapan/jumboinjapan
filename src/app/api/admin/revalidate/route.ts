import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'

import { requireAdminSession } from '@/lib/admin-guard'

// Ручной сброс кэша публичного сайта. Нужен, когда данные меняются в обход
// admin API — прямой правкой в Airtable (владелец или агент через MCP):
// такие записи не триггерят revalidateTag, и страницы ждут ISR до часа.
export async function POST(request: NextRequest) {
  const denied = await requireAdminSession(request)
  if (denied) return denied

  revalidateTag('airtable:routes', 'max')
  revalidateTag('airtable:pois', 'max')
  revalidateTag('airtable:resources', 'max')
  revalidateTag('airtable:journal', 'max')
  return NextResponse.json({ ok: true })
}
