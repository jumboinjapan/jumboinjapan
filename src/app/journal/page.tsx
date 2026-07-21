import type { Metadata } from 'next'
import Link from 'next/link'

import { getPublishedJournalArticles } from '@/lib/journal'
import { UnderConstruction } from '@/components/sections/UnderConstruction'

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Журнал — истории о Японии от частного гида',
  description:
    'Редкие личные истории о Японии от Эдуарда Ревидовича — гида, живущего в Токио больше 25 лет: выставки, места и наблюдения, которых нет в путеводителях.',
  alternates: { canonical: 'https://jumboinjapan.com/journal' },
}

function formatDate(iso: string): string {
  if (!iso) return ''
  const date = new Date(`${iso}T00:00:00+09:00`)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default async function JournalPage() {
  const articles = await getPublishedJournalArticles()

  // Пока статей нет — прежняя заглушка (но страница уже индексируема,
  // чтобы Google знал раздел заранее).
  if (articles.length === 0) {
    return (
      <UnderConstruction
        title="Журнал"
        message="Раздел с заметками и статьями о Японии готовится к публикации. Пока вы можете написать мне напрямую, если хотите обсудить будущую поездку."
      />
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-12 md:py-16">
      <header className="mb-10">
        <h1 className="font-sans text-[32px] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--text)] md:text-[40px]">
          Журнал
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] font-light leading-[1.8] text-[var(--text-muted)] md:text-[16px]">
          Личные истории о Японии — выставки, места и наблюдения из жизни в Токио. Пишу нечасто и
          только о том, что видел сам.
        </p>
      </header>

      <div className="space-y-8">
        {articles.map((article) => (
          <article key={article.id} className="border-b border-[var(--border)] pb-8">
            <p className="text-[12px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
              {formatDate(article.publishedDate)}
            </p>
            <h2 className="mt-1.5 font-sans text-[22px] font-medium leading-[1.25] text-[var(--text)]">
              <Link
                href={`/journal/${article.slug}`}
                className="transition-colors hover:text-[var(--accent)]"
              >
                {article.title}
              </Link>
            </h2>
            {article.lead && (
              <p className="mt-2 text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
                {article.lead}
              </p>
            )}
            <Link
              href={`/journal/${article.slug}`}
              className="mt-3 inline-block text-sm font-medium text-[var(--accent)] transition-colors hover:underline"
            >
              Читать →
            </Link>
          </article>
        ))}
      </div>
    </div>
  )
}
