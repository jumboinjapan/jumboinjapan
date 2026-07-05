/**
 * fetch wrapper for Airtable REST calls with 429 backoff.
 *
 * Why: production builds prerender ~67 pages; intercity pages read POI /
 * Route Stops / Routes / Cities with a cold cache, and Airtable's 5 rps
 * per-base limit makes builds flaky — deploys 8558de8, 1b8af02 and 8100ea0
 * died with RATE_LIMIT_REACHED mid-prerender. A bounded exponential backoff
 * (Airtable asks for ~30s cooldown via Retry-After, but in practice short
 * waits succeed once the burst drains) makes the read path deterministic.
 *
 * Use this for every api.airtable.com call that can run at build time or on
 * a user-facing request. Fire-and-forget admin writes may keep plain fetch.
 */

const MAX_ATTEMPTS = 5
const BASE_DELAY_MS = 700

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function fetchAirtableWithRetry(url: string | URL, init?: RequestInit): Promise<Response> {
  let lastResponse: Response | null = null

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url, init)
    if (response.status !== 429) return response

    lastResponse = response
    if (attempt < MAX_ATTEMPTS - 1) {
      const retryAfterHeader = Number(response.headers.get('Retry-After'))
      const backoff = BASE_DELAY_MS * 2 ** attempt + Math.random() * 300
      const delay = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
        ? Math.min(retryAfterHeader * 1000, 8000)
        : backoff
      await sleep(delay)
    }
  }

  return lastResponse as Response
}
