import type { Metadata } from 'next'

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      'max-snippet': 0,
      'max-image-preview': 'none',
      'max-video-preview': 0,
    },
  },
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    /* Без overflow-hidden. Он был здесь как страховка от подтёков декоративных
       слоёв, но те и так absolute inset-0 — за контейнер им не выйти. Зато
       overflow на предке отменяет position: sticky у всего, что внутри:
       шапка панели с меню уезжала вверх при прокрутке и не могла закрепиться. */
    <div className="relative min-h-screen bg-[var(--adm-bg)] text-[var(--adm-text)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.16),transparent_26%),radial-gradient(circle_at_80%_0%,rgba(99,102,241,0.18),transparent_24%),radial-gradient(circle_at_50%_100%,rgba(15,118,110,0.12),transparent_28%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:72px_72px]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(3,8,20,0.16),rgba(3,8,20,0.82))]" />
      <div className="relative">{children}</div>
    </div>
  )
}
