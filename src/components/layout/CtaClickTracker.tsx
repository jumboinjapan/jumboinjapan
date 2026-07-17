'use client'

import { useEffect } from 'react'

import { trackEvent } from '@/lib/analytics'

/**
 * Глобальный трекер CTA-кликов через делегирование: один слушатель на
 * документ вместо onClick в десятке серверных компонентов (Header, Footer,
 * MobileCtaBar, TourPage и т.д.). Ловит клики по ссылкам на /contact и
 * t.me — это и есть все конверсионные CTA сайта.
 *
 * Не срабатывает в админке (там page_view выключен, события были бы шумом).
 */
export function CtaClickTracker() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (window.location.pathname.startsWith('/admin')) return
      const target = event.target as Element | null
      const link = target?.closest?.('a[href]')
      if (!link) return
      const href = link.getAttribute('href') ?? ''
      const isContact = href === '/contact' || href.startsWith('/contact?') || href.startsWith('/contact#')
      // Канон воронки 2026-07-18: основная точка — опросник /profile, /contact — запасной канал.
      const isProfile = href === '/profile' || href.startsWith('/profile?') || href.startsWith('/profile#')
      const isTelegram = href.includes('t.me/')
      if (!isContact && !isProfile && !isTelegram) return
      trackEvent('cta_contact_click', {
        href,
        channel: isTelegram ? 'telegram' : isProfile ? 'questionnaire' : 'contact_page',
        label: (link.textContent ?? '').trim().slice(0, 80),
        page: window.location.pathname,
      })
    }
    document.addEventListener('click', onClick, { capture: true })
    return () => document.removeEventListener('click', onClick, { capture: true })
  }, [])

  return null
}
