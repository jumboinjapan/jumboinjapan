const LATIN_PATTERN = /[A-Za-z]/
const CYRILLIC_PATTERN = /[\u0400-\u04FF]/
const JAPANESE_OR_CJK_PATTERN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
const NON_ENGLISH_SCRIPT_PATTERN = new RegExp(`${CYRILLIC_PATTERN.source}|${JAPANESE_OR_CJK_PATTERN.source}`)

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export function isLikelyEnglishSurfaceText(value: string | null | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? '')
  if (!normalized) return false
  if (NON_ENGLISH_SCRIPT_PATTERN.test(normalized)) return false
  return LATIN_PATTERN.test(normalized)
}

export function isSafeLocalizedSurfaceText(value: string | null | undefined): boolean {
  const normalized = normalizeWhitespace(value ?? '')
  if (!normalized) return false
  return !isLikelyEnglishSurfaceText(normalized)
}

export function preferNonEnglishSurfaceText(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const normalized = normalizeWhitespace(value ?? '')
    if (isSafeLocalizedSurfaceText(normalized)) return normalized
  }

  return ''
}

const translationCache = new Map<string, Promise<string>>()

async function translateViaGoogle(value: string) {
  const url = new URL('https://translate.googleapis.com/translate_a/single')
  url.searchParams.set('client', 'gtx')
  url.searchParams.set('sl', 'auto')
  url.searchParams.set('tl', 'ru')
  url.searchParams.set('dt', 't')
  url.searchParams.set('q', value)

  const response = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'jumboinjapan-event-normalizer/1.0 (+https://jumboinjapan.com)',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Translation request failed: ${response.status} ${await response.text()}`)
  }

  const payload = (await response.json()) as unknown
  const translated = Array.isArray(payload) && Array.isArray(payload[0])
    ? (payload[0] as unknown[])
        .map((entry) => (Array.isArray(entry) && typeof entry[0] === 'string' ? entry[0] : ''))
        .join('')
    : ''

  return normalizeWhitespace(translated)
}

export async function translateTextToRussian(value: string | null | undefined): Promise<string> {
  const normalized = normalizeWhitespace(value ?? '')
  if (!normalized) return ''
  if (!isLikelyEnglishSurfaceText(normalized)) return normalized

  const cached = translationCache.get(normalized)
  if (cached) return cached

  const request = translateViaGoogle(normalized)
    .then((translated) => translated || '')
    .catch(() => '')
  translationCache.set(normalized, request)
  return request
}

export async function normalizeEventSurfaceText(input: {
  title: string
  titleJa?: string | null
  summary?: string | null
  description?: string | null
  city?: string | null
  venue?: string | null
  venueJa?: string | null
  neighborhood?: string | null
}) {
  const title = normalizeWhitespace(input.title)
  const titleJa = normalizeWhitespace(input.titleJa ?? '')
  const summary = normalizeWhitespace(input.summary ?? '')
  const description = normalizeWhitespace(input.description ?? '')
  const city = normalizeWhitespace(input.city ?? '')
  const venue = normalizeWhitespace(input.venue ?? '')
  const venueJa = normalizeWhitespace(input.venueJa ?? '')
  const neighborhood = normalizeWhitespace(input.neighborhood ?? '')

  const titleRu = await translateTextToRussian(title)
  const summaryRu = await translateTextToRussian(summary)
  const descriptionRu = await translateTextToRussian(description)
  const cityRu = await translateTextToRussian(city)
  const venueRu = await translateTextToRussian(venue)
  const neighborhoodRu = await translateTextToRussian(neighborhood)

  return {
    title: titleRu || preferNonEnglishSurfaceText(titleJa, title),
    summary: summaryRu || descriptionRu || '',
    description: descriptionRu || summaryRu || '',
    city: cityRu || preferNonEnglishSurfaceText(city),
    venue: venueRu || preferNonEnglishSurfaceText(venueJa, venue),
    neighborhood: neighborhoodRu || preferNonEnglishSurfaceText(neighborhood),
  }
}
