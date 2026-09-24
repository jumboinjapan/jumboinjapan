import { unstable_cache } from 'next/cache'

/** Preview reads the current base on each request; production keeps tagged ISR. */
export const publicDataCache: typeof unstable_cache = (callback, keys, options) =>
  process.env.VERCEL_ENV === 'preview' ? callback : unstable_cache(callback, keys, options)
