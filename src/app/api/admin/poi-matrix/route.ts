import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/admin-guard'
import { getPoiRecordsForMatrix } from '@/lib/airtable'
import { assertMatrixQuery, searchMatrixCatalog } from '../../../../../scripts/poi-portals/lib/poi-matrix-catalog.mjs'

export async function GET(request:NextRequest) {
  const denied=await requireAdminSession(request)
  if(denied)return denied
  let query
  try {
    const raw=request.nextUrl.searchParams.get('query')
    if(!raw||raw.length>8192)throw new Error('matrixQueryRequired')
    query=assertMatrixQuery(JSON.parse(raw))
  }catch{
    return NextResponse.json({ok:false,error:'Проверьте выбранные свойства и возраст детей.'},{status:400})
  }
  try {
    const result=await searchMatrixCatalog(query,getPoiRecordsForMatrix)
    return NextResponse.json({ok:true,...result},{headers:{'Cache-Control':'private, no-store'}})
  }catch{
    return NextResponse.json({ok:false,error:'Не удалось проверить свойства мест. Повторите поиск.'},{status:503,headers:{'Cache-Control':'private, no-store'}})
  }
}
