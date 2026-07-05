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
            Похоже, эта ссылка больше не действует. Ничего страшного — просто напишите мне, и я пришлю
            новую. Или расскажите о поездке через{' '}
            <Link href="/contact" className="underline decoration-[var(--border)] underline-offset-4 hover:text-[var(--accent)]">
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
    <section className="min-h-screen border-t border-[var(--border)] bg-[var(--bg-warm)]">
      <div className="mx-auto w-full max-w-lg px-4 pt-10 md:pt-16">
        <h1 className="font-sans text-2xl font-medium tracking-[-0.02em] md:text-3xl">
          {isEdit ? 'Ваши ответы' : 'Расскажите о поездке'}
        </h1>
        <p className="mt-3 text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
          {isEdit
            ? 'Здесь можно изменить любой ответ — просто пройдите вопросы ещё раз и сохраните.'
            : 'Несколько коротких вопросов — минуты три. По ответам я собираю первый набросок маршрута, который мы потом обсудим.'}
        </p>
      </div>
      <TouristProfileForm
        token={token}
        initialPayload={prospect.factFindAnswers}
        initialContact={prospect.name || prospect.contact ? { name: prospect.name, contact: prospect.contact } : null}
      />
    </section>
  )
}
