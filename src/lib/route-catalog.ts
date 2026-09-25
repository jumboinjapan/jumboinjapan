import { isPublicRoute, type RoutePublication } from './route-publication.ts'

export interface RouteCatalogEntry extends Pick<RoutePublication, 'contentKind' | 'ready' | 'routeType'> {
  slug: string
  title: string
  description: string
  image: string
  status: string
}

export interface RouteCard {
  slug: string
  title: string
  description: string
  image: string
  duration: string
  imagePosition?: string
}

/** Existing designed routes retain their placement; new published routes join automatically. */
export function mergeRouteCatalog(seeds: RouteCard[], records: RouteCatalogEntry[], section: string): RouteCard[] {
  const bySlug = new Map(records.map(route => [route.slug, route]))
  const known = new Set(seeds.map(route => route.slug))
  const cards = seeds.filter(seed => isPublicRoute(bySlug.get(seed.slug), 'Tour') && bySlug.get(seed.slug)?.routeType === section).map(seed => {
    const route = bySlug.get(seed.slug)
    return route ? { ...seed, title: route.title || seed.title,
      description: route.description || seed.description, image: route.image || seed.image } : seed
  })
  for (const route of records) {
    if (!isPublicRoute(route, 'Tour') || route.routeType !== section || known.has(route.slug)) continue
    cards.push({ ...route, duration: '' })
  }
  return cards
}
