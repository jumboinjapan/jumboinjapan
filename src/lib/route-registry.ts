import { cache } from 'react'
import { notFound } from 'next/navigation'
import { publicDataCache } from './public-data-cache'
import { readRouteRegistry } from './route-registry-store'
import { isPublicRoute, type ContentKind } from './route-publication'

/** Same rules in preview and production; route/POI edits invalidate this projection. */
export const listRouteRegistry = cache(publicDataCache(readRouteRegistry, ['route-publication-registry-v1'], {
  tags: ['airtable:routes', 'airtable:pois'], revalidate: 3600,
}))
export async function getPublicRoute(slug: string, kind?: ContentKind) {
  const route = (await listRouteRegistry()).find(r => r.slug === slug)
  return isPublicRoute(route, kind) ? route! : null
}
export async function requirePublicRoute(slug: string, kind?: ContentKind) {
  const route = await getPublicRoute(slug, kind)
  if (!route) notFound()
  return route
}
