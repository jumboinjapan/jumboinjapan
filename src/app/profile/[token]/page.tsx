import type { Metadata } from 'next'
import Link from 'next/link'

import { TouristProfileForm } from '@/components/profile/TouristProfileForm'
import { getProspectByToken } from '@/lib/prospects'

// Персональная ссылка опросника «Профиль туриста» (/profile/[token]).
// Токен принадлежит существующему prospect; submit обновляет его запись.
// Публичное чтение — по токену, без кэша. Noindex, вне sitemap.

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Профиль туриста — расскажите о поездке',
  description: 'Несколько вопросов о будущей поездке в Японию — чтобы я собрал маршрут точнее.',
  robots: { index: false, follow: false },
}

export default async function ProfileTokenPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const prospect = await getProspectByToken(token)

  if (!prospect) {
    // Мягкий отказ: ничего о существовании/несуществовании записей не раскрываем.
    return (
      <section className="flex min-h-screen items-center border-t border-[var(--border)] bg-[var(--bg-warm)] px-4">
        <div className="mx-auto w-full max-w-lg py-20">
          <h1 className="text-2xl font-medium tracking-[-0.02em]">Ссылка устарела</h1>
          <p className="mt-4 text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            Похоже, эта ссылка больше не действует. Ничего страшного — её легко обновить: достаточно написать мне. Или о поездке можно рассказать через{' '}
            <Link href="/profile" className="underline decoration-[var(--border)] underline-offset-4 hover:text-[var(--accent)]">
              форму на сайте
            </Link>
            .
          </p>
        </div>
      </section>
    )
  }

  const isEdit = Boolean(prospect.factFindAnswers)

  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg)]">
      <TouristProfileForm
        token={token}
        initialPayload={prospect.factFindAnswers}
        initialContact={prospect.name || prospect.contact ? { name: prospect.name, contact: prospect.contact } : null}
      />
    </section>
  )
}
