import { revalidatePath, revalidateTag } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'

// Keep in sync with the tags used by the unstable_cache wrappers in
// src/lib/airtable.ts (getCityDataCached, getPoisByCityCached,
// getIntercityRouteStopsCached) and src/lib/resources.ts (getCachedResources,
// getCachedEventResources). Restricting to a known set means this
// secret-gated but public-reachable endpoint can't be used to poke at
// arbitrary cache tags.
const KNOWN_TAGS = ['airtable:routes', 'airtable:pois', 'airtable:resources', 'airtable:events'] as const
type KnownTag = (typeof KNOWN_TAGS)[number]

function isKnownTag(value: string): value is KnownTag {
  return (KNOWN_TAGS as readonly string[]).includes(value)
}

const CITY_PATHS: Record<string, string[]> = {
  enoshima: ['/intercity/enoshima'],
  fuji: ['/intercity/fuji'],
  hakone: ['/intercity/hakone'],
  kamakura: ['/intercity/kamakura'],
  kanazawa: ['/intercity/kanazawa'],
  kyoto: ['/intercity/kyoto-1', '/intercity/kyoto-2'],
  nara: ['/intercity/nara'],
  nikko: ['/intercity/nikko'],
  osaka: ['/intercity/osaka'],
  uji: ['/intercity/uji'],
}

function normalizePath(path: string) {
  if (!path) return ''
  return path.startsWith('/') ? path : `/${path}`
}

function getPathsForCity(citySlug: string) {
  const normalizedCity = citySlug.trim().toLowerCase()
  return CITY_PATHS[normalizedCity] ?? []
}

async function parseRequest(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? ''
  const searchParams = request.nextUrl.searchParams

  let body: Record<string, unknown> = {}

  if (request.method === 'POST' && contentType.includes('application/json')) {
    body = await request.json().catch(() => ({}))
  }

  const secret = String(body.secret ?? searchParams.get('secret') ?? '')
  const path = String(body.path ?? searchParams.get('path') ?? '')
  const citySlug = String(body.citySlug ?? body.city ?? searchParams.get('citySlug') ?? searchParams.get('city') ?? '')

  const rawTags = body.tags ?? body.tag ?? searchParams.get('tags') ?? searchParams.get('tag') ?? ''
  const tags = (Array.isArray(rawTags) ? rawTags : String(rawTags).split(','))
    .map((tag) => tag.trim())
    .filter(Boolean)

  return { secret, path, citySlug, tags }
}

async function handleRevalidate(request: NextRequest) {
  const expectedSecret = process.env.REVALIDATE_SECRET

  if (!expectedSecret) {
    return NextResponse.json(
      { ok: false, error: 'REVALIDATE_SECRET is not configured on the server' },
      { status: 500 },
    )
  }

  const { secret, path, citySlug, tags } = await parseRequest(request)

  if (secret !== expectedSecret) {
    return NextResponse.json({ ok: false, error: 'Invalid secret' }, { status: 401 })
  }

  const unknownTags = tags.filter((tag) => !isKnownTag(tag))
  const validTags = tags.filter(isKnownTag)

  const paths = new Set<string>([
    '/intercity',
    '/sitemap.xml',
  ])

  if (path) {
    paths.add(normalizePath(path))
  }

  if (citySlug) {
    for (const cityPath of getPathsForCity(citySlug)) {
      paths.add(cityPath)
    }
  }

  if (paths.size === 2 && !path && !citySlug && validTags.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Provide path, citySlug, or tags (one of: ' + KNOWN_TAGS.join(', ') + ')',
        ...(unknownTags.length > 0 ? { unknownTags } : {}),
      },
      { status: 400 },
    )
  }

  for (const currentPath of paths) {
    revalidatePath(currentPath)
  }

  for (const tag of validTags) {
    revalidateTag(tag, 'max')
  }

  return NextResponse.json({
    ok: true,
    revalidated: Array.from(paths),
    revalidatedTags: validTags,
    ...(unknownTags.length > 0 ? { unknownTags } : {}),
    citySlug: citySlug || null,
  })
}

export async function GET(request: NextRequest) {
  return handleRevalidate(request)
}

export async function POST(request: NextRequest) {
  return handleRevalidate(request)
}
