'use client'

import { track } from '@vercel/analytics'

export function HakoneCtaButton({ variant }: { variant: string }) {
  return (
    <a
      href="/contact"
      onClick={() => track('contact_click', { page: 'hakone', variant })}
      className="inline-flex items-center gap-2 rounded-sm border border-[var(--accent)] px-5 py-2.5 text-[14px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
    >
      Написать гиду
    </a>
  )
}
