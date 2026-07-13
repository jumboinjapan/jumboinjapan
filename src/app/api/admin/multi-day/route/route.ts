import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'

import type { MultiDayBuilderRoute } from '@/lib/multi-day-builder'
import {
  BuilderSaveBlockedError,
  type BuilderSaveOptions,
  listSavedMultiDayRoutes,
  loadMultiDayBuilderRoute,
  saveMultiDayBuilderRoute,
} from '@/lib/multi-day-builder-storage'

import { requireAdminSession } from '@/lib/admin-guard'

export async function GET(request: NextRequest) {
  const denied = await requireAdminSession()
  if (denied) return denied

  try {
    const slug = request.nextUrl.searchParams.get('slug')?.trim()
    if (slug) {
      const route = await loadMultiDayBuilderRoute(slug)
      if (!route) {
        return NextResponse.json({ error: 'Route not found' }, { status: 404 })
      }
      return NextResponse.json(route)
    }

    const routes = await listSavedMultiDayRoutes()
    return NextResponse.json(routes)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireAdminSession()
  if (denied) return denied

  try {
    const body = (await request.json()) as MultiDayBuilderRoute & {
      titleRu?: string
      /** Явные override'ы серверных предохранителей (см. BuilderSaveOptions) — только с осознанного подтверждения в UI. */
      saveOptions?: BuilderSaveOptions
    }
    const { saveOptions, ...routePayload } = body
    let route = routePayload as MultiDayBuilderRoute & { titleRu?: string }

    // Validate and ensure slug exists before saving (prevents undefined slug error)
    if (!route.slug || typeof route.slug !== 'string' || route.slug.trim() === '') {
      const timestamp = Date.now()
      route = {
        ...route,
        slug: `route-${timestamp}`,
        title: route.title || route.titleRu || 'Без названия',
        titleEn: route.titleEn || 'untitled-route',
      } as MultiDayBuilderRoute
    }

    const result = await saveMultiDayBuilderRoute(route, saveOptions ?? {})
    // Builder writes Routes fields that feed cached intercity SEO reads
    // (getMultiDayRouteSeoFieldsCached, tag 'airtable:routes') — invalidate
    // like every other admin CRUD route does.
    revalidateTag('airtable:routes', 'max')
    return NextResponse.json(result)
  } catch (error) {
    // Предохранитель сервера: не ошибка инфраструктуры, а осознанная
    // остановка разрушающей записи — клиент получает код и объяснение.
    if (error instanceof BuilderSaveBlockedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
