'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { inject, type BeforeSendEvent } from '@vercel/analytics'
import { filterAnalyticsEvent, canCollectPublicAnalytics } from '@/lib/analytics-policy'
import { initializeGoogleAnalytics } from '@/lib/google-analytics'

function beforeSend(event: BeforeSendEvent) {
  if (!canCollectPublicAnalytics()) return null
  return filterAnalyticsEvent(event)
}

export function PublicAnalytics({ measurementId }: { measurementId: string }) {
  const pathname = usePathname()
  useEffect(() => {
    if (!initializeGoogleAnalytics(measurementId)) return
    // Both SDKs are injected once, only after their send-time guards exist.
    inject({ beforeSend, framework: 'next' })
    if (!document.getElementById('public-google-analytics')) {
      const script = document.createElement('script')
      script.id = 'public-google-analytics'
      script.async = true
      script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`
      document.head.appendChild(script)
    }
  }, [measurementId, pathname])

  // No GA/Vercel library on a private first load or on local/preview hosts.
  // Once loaded, send-time guards also cover public → private SPA navigation.
  return null
}
