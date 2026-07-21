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
    <section className="border-t border-[var(--border)] bg-[var(--bg)]">
      <TouristProfileForm token={null} src={src ?? null} />
    </section>
  )
}
