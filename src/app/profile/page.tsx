import type { Metadata } from 'next'

import { TouristProfileForm } from '@/components/profile/TouristProfileForm'

// Публичный лендинг опросника «Профиль туриста» (общая ссылка без токена).
// Владелец пересылает её кому угодно; submit создаёт prospect, Source — из
// `?src=telegram|social|...`. Noindex, вне sitemap.

export const metadata: Metadata = {
  title: 'Профиль туриста — расскажите о поездке',
  description: 'Несколько вопросов о будущей поездке в Японию — чтобы я собрал маршрут точнее.',
  robots: { index: false, follow: false },
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string }>
}) {
  const { src } = await searchParams

  return (
    <section className="min-h-screen border-t border-[var(--border)] bg-[var(--bg-warm)]">
      <div className="mx-auto w-full max-w-lg px-4 pt-10 md:pt-16">
        <h1 className="font-sans text-2xl font-medium tracking-[-0.02em] md:text-3xl">
          Расскажите о вашей поездке
        </h1>
        <p className="mt-3 text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
          Несколько коротких вопросов, это займёт 3–5 минут. По ответам я собираю первый набросок вашего
          маршрута, который мы потом обсудим.
        </p>
      </div>
      <TouristProfileForm token={null} src={src ?? null} />
    </section>
  )
}
