/** One deadline covers headers AND consumption. No automatic write retries. */
export const EXCHANGE_DEADLINE_MS = 20_000
export const JSON_RESPONSE_MAX_BYTES = 4 * 1024 * 1024

export class NetworkBoundaryError extends Error {
  constructor(code, message, phase = null) {
    super(message)
    this.name = 'NetworkBoundaryError'
    this.code = code
    this.phase = phase
  }
}

function abandon(body) {
  try { Promise.resolve(body?.cancel()).catch(() => {}) } catch { /* cancellation is best effort */ }
}

export async function withResponseDeadline(fetchImpl, url, init, consume, deadlineMs = EXCHANGE_DEADLINE_MS) {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) throw new TypeError('deadlineMs must be a positive integer')
  const controller = new AbortController()
  let phase = 'headers'
  let rejectDeadline
  const expired = new Promise((_, reject) => { rejectDeadline = reject })
  const timer = setTimeout(() => {
    const error = new NetworkBoundaryError('requestDeadline', `Network deadline ${deadlineMs} ms exceeded (${phase})`, phase)
    rejectDeadline(error)
    controller.abort(error)
  }, deadlineMs)
  const operation = Promise.resolve().then(async () => {
    const response = await fetchImpl(url, { ...init, signal: controller.signal })
    if (controller.signal.aborted) { abandon(response?.body); throw controller.signal.reason }
    phase = 'body'
    try { return await consume(response, controller.signal) }
    finally { abandon(response?.body) }
  })
  try { return await Promise.race([operation, expired]) }
  finally { clearTimeout(timer) }
}

/** Native responses must be streamed; limited fallbacks support injected fixtures. */
export async function readResponseBytes(response, maxBytes, signal) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new TypeError('maxBytes must be a positive integer')
  if (signal?.aborted) throw signal.reason
  const reader = response.body?.getReader?.()
  if (!reader) {
    let bytes
    if (typeof response.arrayBuffer === 'function') bytes = new Uint8Array(await response.arrayBuffer())
    else if (typeof response.text === 'function') bytes = new TextEncoder().encode(await response.text())
    else bytes = new TextEncoder().encode(JSON.stringify(await response.json()))
    if (signal?.aborted) throw signal.reason
    if (bytes.byteLength > maxBytes) throw new NetworkBoundaryError('responseTooLarge', `Response exceeds ${maxBytes} bytes`)
    return bytes
  }
  const cancel = () => abandon(reader)
  signal?.addEventListener('abort', cancel, { once: true })
  const chunks = []
  let size = 0
  try {
    for (;;) {
      if (signal?.aborted) throw signal.reason
      const { done, value } = await reader.read()
      if (done) break
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
      size += bytes.byteLength
      if (size > maxBytes) throw new NetworkBoundaryError('responseTooLarge', `Response exceeds ${maxBytes} bytes`)
      chunks.push(bytes)
    }
    if (signal?.aborted) throw signal.reason
    const result = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
    return result
  } catch (error) { cancel(); throw error }
  finally {
    signal?.removeEventListener('abort', cancel)
    try { reader.releaseLock() } catch { /* an aborted read may still be pending */ }
  }
}

/** Materialize bounded JSON/text while the deadline is alive, before returning. */
export function fetchJsonResponse(fetchImpl, url, init, deadlineMs = EXCHANGE_DEADLINE_MS) {
  return withResponseDeadline(fetchImpl, url, init, async (response, signal) => {
    const bytes = await readResponseBytes(response, JSON_RESPONSE_MAX_BYTES, signal)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { ok: response.ok, status: response.status, json: async () => JSON.parse(text), text: async () => text }
  }, deadlineMs)
}
