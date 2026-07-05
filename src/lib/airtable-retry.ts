/**
 * fetch wrapper for Airtable REST calls: global rate limiting + 429 backoff.
 *
 * Why: production builds prerender ~67 pages in one Node process; intercity
 * pages read POI / Route Stops / Routes / Cities / Tickets with a cold cache
 * and collectively trip Airtable's 5 rps per-base limit. Plain backoff is not
 * enough — concurrent retries keep the bucket saturated (thundering herd),
 * which killed deploys 8558de8, 1b8af02, 8100ea0 and 8aa41f7.
 *
 * Two layers:
 *  1. Rate limiter — request STARTS are spaced ≥ MIN_INTERVAL_MS apart
 *     process-wide (~4 rps, safely under the 5 rps cap). Requests still run
 *     concurrently once started; only their launch times are serialized.
 *  2. Bounded exponential backoff on 429 (honors Retry-After) as a safety
 *     net for anything else hitting the same base (admin traffic, importer).
 *
 * Use this for every api.airtable.com call that can run at build time or on
 * a user-facing request.
 */

const MAX_ATTEMPTS = 5
const BASE_DELAY_MS = 700
const MIN_INTERVAL_MS = 250

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let lastStartAt = 0
let startQueue: Promise<void> = Promise.resolve()

/** Serializes request launch times: each start waits its ≥250ms slot. */
function acquireStartSlot(): Promise<void> {
  const myTurn = startQueue.then(async () => {
    const wait = lastStartAt + MIN_INTERVAL_MS - Date.now()
    if (wait > 0) await sleep(wait)
    lastStartAt = Date.now()
  })
  // Next caller waits for our slot regardless of our request's outcome.
  startQueue = myTurn.catch(() => {})
  return myTurn
}

export async function fetchAirtableWithRetry(url: string | URL, init?: RequestInit): Promise<Response> {
  let lastResponse: Response | null = null

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    await acquireStartSlot()
    const response = await fetch(url, init)
    if (response.status !== 429) return response

    lastResponse = response
    if (attempt < MAX_ATTEMPTS - 1) {
      const retryAfterHeader = Number(response.headers.get('Retry-After'))
      const backoff = BASE_DELAY_MS * 2 ** attempt + Math.random() * 300
      const delay = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
        ? Math.min(retryAfterHeader * 1000, 15000)
        : backoff
      await sleep(delay)
    }
  }

  return lastResponse as Response
}
