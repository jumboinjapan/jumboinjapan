import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'

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

  return { secret, path, citySlug }
}

async function handleRevalidate(request: NextRequest) {
  const expectedSecret = process.env.REVALIDATE_SECRET

  if (!expectedSecret) {
    return NextResponse.json(
      { ok: false, error: 'REVALIDATE_SECRET is not configured on the server' },
      { status: 500 },
    )
  }

  const { secret, path, citySlug } = await parseRequest(request)

  if (secret !== expectedSecret) {
    return NextResponse.json({ ok: false, error: 'Invalid secret' }, { status: 401 })
  }

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

  if (paths.size === 2 && !path && !citySlug) {
    return NextResponse.json(
      { ok: false, error: 'Provide either path or citySlug' },
      { status: 400 },
    )
  }

  for (const currentPath of paths) {
    revalidatePath(currentPath)
  }

  return NextResponse.json({
    ok: true,
    revalidated: Array.from(paths),
    citySlug: citySlug || null,
  })
}

export async function GET(request: NextRequest) {
  return handleRevalidate(request)
}

export async function POST(request: NextRequest) {
  return handleRevalidate(request)
}
