import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { getJournalArticleBySlug, getPublishedJournalArticles } from '@/lib/journal'
import { guideRef } from '@/lib/schema'
import { tours } from '@/data/tours'

export const revalidate = 3600

const BASE_URL = 'https://jumboinjapan.com'

interface PageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const article = await getJournalArticleBySlug(slug)
  if (!article) return {}
  const title = article.seoTitle || article.title
  const description = article.seoDescription || article.lead
  return {
    title,
    description,
    alternates: { canonical: `${BASE_URL}/journal/${article.slug}` },
    openGraph: {
      title,
      description,
      type: 'article',
      ...(article.heroImageUrl ? { images: [{ url: article.heroImageUrl }] } : {}),
    },
  }
}

function formatDate(iso: string): string {
  if (!iso) return ''
  const date = new Date(`${iso}T00:00:00+09:00`)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Markdown-лайт из Airtable Body: пустая строка = абзац, "## " = h2,
 *  "![alt](url)" на отдельной строке = изображение. Без сторонних зависимостей. */
function renderBody(body: string) {
  const blocks = body
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)

  return blocks.map((block, index) => {
    if (block.startsWith('## ')) {
      return (
        <h2
          key={index}
          className="mt-10 font-sans text-[22px] font-medium leading-[1.3] text-[var(--text)]"
        >
          {block.slice(3).trim()}
        </h2>
      )
    }
    const image = block.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/)
    if (image) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={index}
          src={image[2]}
          alt={image[1]}
          loading="lazy"
          className="my-6 w-full rounded-lg"
        />
      )
    }
    return (
      <p
        key={index}
        className="mt-5 text-[15px] font-light leading-[1.85] text-[var(--text-muted)] whitespace-pre-line md:text-[16px]"
      >
        {block}
      </p>
    )
  })
}

export default async function JournalArticlePage({ params }: PageProps) {
  const { slug } = await params
  const article = await getJournalArticleBySlug(slug)
  if (!article) notFound()

  const relatedTour = article.relatedRouteSlug
    ? tours.find((t) => t.slug === article.relatedRouteSlug)
    : undefined

  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.seoDescription || article.lead,
    inLanguage: 'ru',
    datePublished: article.publishedDate || undefined,
    author: guideRef,
    mainEntityOfPage: `${BASE_URL}/journal/${article.slug}`,
    ...(article.heroImageUrl ? { image: article.heroImageUrl } : {}),
  }
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Журнал', item: `${BASE_URL}/journal` },
      {
        '@type': 'ListItem',
        position: 2,
        name: article.title,
        item: `${BASE_URL}/journal/${article.slug}`,
      },
    ],
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-12 md:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />

      <nav className="mb-8 text-[13px] text-[var(--text-muted)]">
        <Link href="/journal" className="transition-colors hover:text-[var(--accent)]">
          Журнал
        </Link>
        <span className="mx-2">/</span>
        <span>{article.title}</span>
      </nav>

      <article>
        <header>
          <p className="text-[12px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
            {formatDate(article.publishedDate)}
          </p>
          <h1 className="mt-2 font-sans text-[30px] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--text)] md:text-[38px]">
            {article.title}
          </h1>
          {article.lead && (
            <p className="mt-4 text-[16px] font-light leading-[1.8] text-[var(--text)] md:text-[17px]">
              {article.lead}
            </p>
          )}
        </header>

        {article.heroImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={article.heroImageUrl}
            alt={article.heroImageAlt || article.title}
            className="mt-8 w-full rounded-lg"
          />
        )}

        <div className="mt-4">{renderBody(article.body)}</div>
      </article>

      {relatedTour && (
        <aside className="mt-12 rounded-lg border border-[var(--border)] bg-[var(--bg-warm)] p-6">
          <p className="text-[12px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Эти места — в маршруте
          </p>
          <p className="mt-2 font-sans text-[18px] font-medium text-[var(--text)]">
            {relatedTour.title}
          </p>
          <Link
            href={`/${relatedTour.slug}`}
            className="mt-3 inline-flex min-h-10 items-center border border-[var(--accent)] px-5 py-2 text-sm font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
          >
            Посмотреть маршрут
          </Link>
        </aside>
      )}
    </div>
  )
}

export async function generateStaticParams() {
  const articles = await getPublishedJournalArticles().catch(() => [])
  return articles.map((a) => ({ slug: a.slug }))
}
