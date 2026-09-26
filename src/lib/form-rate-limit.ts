/** Per-instance fixed window, with bounded memory (not a global serverless limit).
 * At capacity, reject new IPs until a slot expires. Never evict a live bucket:
 * doing so would let a stream of new IPs reset an existing offender's limit.
 */
export function createFormRateLimiter(limit: number, windowMs = 10 * 60 * 1000, capacity = 5000) {
  const buckets = new Map<string, { count: number; expiresAt: number }>()
  let nextSweep = 0

  return function isRateLimited(ip: string): boolean {
    const now = Date.now()
    const bucket = buckets.get(ip)
    if (bucket && now < bucket.expiresAt) {
      bucket.count = Math.min(bucket.count + 1, limit + 1)
      return bucket.count > limit
    }
    if (bucket) buckets.delete(ip)

    if (buckets.size >= capacity && now >= nextSweep) {
      nextSweep = Infinity
      for (const [key, value] of buckets) {
        if (now >= value.expiresAt) buckets.delete(key)
        else nextSweep = Math.min(nextSweep, value.expiresAt)
      }
    }
    if (buckets.size >= capacity) return true
    const expiresAt = now + windowMs
    buckets.set(ip, { count: 1, expiresAt })
    nextSweep = Math.min(nextSweep, expiresAt)
    return false
  }
}
