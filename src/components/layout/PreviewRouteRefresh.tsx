'use client'

import { useEffect, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'

/** Refresh visible tour previews, without reloading the page or moving its scroll. */
export function PreviewRouteRefresh() {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = useTransition()
  useEffect(() => {
    if (!/^\/(city-tour|intercity|multi-day)(\/|$)/.test(pathname)) return
    const refresh = () => {
      if (document.visibilityState === 'visible' && !pending) startTransition(() => router.refresh())
    }
    const timer = window.setInterval(refresh, 60000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [pathname, router, pending])
  return null
}
