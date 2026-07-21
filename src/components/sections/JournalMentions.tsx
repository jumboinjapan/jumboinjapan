import Link from 'next/link'

import { findArticlesForRoute } from '@/lib/journal'

/**
 * «Из журнала» — блок на странице тура со статьями, геопривязанными к его
 * точкам (Related Route Slug / POI IDs / Location Tags — см. src/lib/journal.ts).
 * Пример: статья с тегом «Гинза» всплывает на city-tour/day-one.
 * Ничего не рендерит, если совпадений нет — безопасно ставить на любую страницу.
 */
export async function JournalMentions({
  routeSlug,
  poiIds = [],
  locationNames = [],
  themes = [],
}: {
  routeSlug: string
  poiIds?: string[]
  locationNames?: string[]
  /** Тематические метки тура (категории/теги POI) — матчатся с Theme Tags статей. */
  themes?: string[]
}) {
  const articles = await findArticlesForRoute(routeSlug, poiIds, locationNames, themes).catch(
    () => [],
  )
  if (articles.length === 0) return null

  return (
    <section className="mx-auto max-w-5xl px-5 py-10">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
        Из журнала
      </p>
      <div className="mt-4 space-y-5">
        {articles.map((article) => (
          <article key={article.id}>
            <h3 className="font-sans text-[18px] font-medium leading-[1.3] text-[var(--text)]">
              <Link
                href={`/journal/${article.slug}`}
                className="transition-colors hover:text-[var(--accent)]"
              >
                {article.title}
              </Link>
            </h3>
            {article.lead && (
              <p className="mt-1.5 max-w-2xl text-[14px] font-light leading-[1.75] text-[var(--text-muted)]">
                {article.lead}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
