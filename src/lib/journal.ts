import { unstable_cache } from 'next/cache'

import { AIRTABLE_BASE_ID } from '@/lib/airtable-schema'
import { fetchAirtableWithRetry } from '@/lib/airtable-retry'

/**
 * «Журнал» — редкие личные истории гида (GEO-контент, таблица Airtable
 * Journal, tblCexTm8KHrA6gB0). Публично рендерятся только Status=Published.
 *
 * Геопривязка (решение владельца 2026-07-18): статья несёт Location Tags
 * (свободные названия — «Гинза, Токио») и/или POI IDs (точные POI-000xxx).
 * Страницы туров показывают блок «Из журнала», если их точки пересекаются
 * с привязкой статьи — см. findArticlesForRoute().
 */

const JOURNAL_TABLE = 'Journal'
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN

export interface JournalArticle {
  id: string
  title: string
  slug: string
  status: string
  publishedDate: string
  lead: string
  body: string
  heroImageUrl: string
  heroImageAlt: string
  seoTitle: string
  seoDescription: string
  relatedRouteSlug: string
  locationTags: string[]
  poiIds: string[]
  themeTags: string[]
}

function text(fields: Record<string, unknown>, name: string): string {
  return typeof fields[name] === 'string' ? (fields[name] as string).trim() : ''
}

function csv(fields: Record<string, unknown>, name: string): string[] {
  return text(fields, name)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

async function fetchJournalArticlesUncached(): Promise<JournalArticle[]> {
  if (!AIRTABLE_TOKEN) return []
  const articles: JournalArticle[] = []
  let offset: string | undefined

  do {
    const url = new URL(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(JOURNAL_TABLE)}`,
    )
    url.searchParams.set('pageSize', '100')
    if (offset) url.searchParams.set('offset', offset)

    const res = await fetchAirtableWithRetry(url.toString(), {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      cache: 'no-store',
    })
    if (!res.ok) return articles
    const data = (await res.json()) as {
      records: Array<{ id: string; fields: Record<string, unknown> }>
      offset?: string
    }
    for (const record of data.records) {
      const f = record.fields
      articles.push({
        id: record.id,
        title: text(f, 'Title'),
        slug: text(f, 'Slug'),
        status: text(f, 'Status'),
        publishedDate: text(f, 'Published Date'),
        lead: text(f, 'Lead'),
        body: text(f, 'Body'),
        heroImageUrl: text(f, 'Hero Image URL'),
        heroImageAlt: text(f, 'Hero Image Alt'),
        seoTitle: text(f, 'SEO Title'),
        seoDescription: text(f, 'SEO Description'),
        relatedRouteSlug: text(f, 'Related Route Slug'),
        locationTags: csv(f, 'Location Tags'),
        poiIds: csv(f, 'POI IDs'),
        themeTags: csv(f, 'Theme Tags'),
      })
    }
    offset = data.offset
  } while (offset)

  return articles
}

/** Все опубликованные статьи, свежие сверху. Кэш — час, тег airtable:journal
 *  (сбрасывается кнопкой «Обновить кэш сайта» в админке). */
export const getPublishedJournalArticles = unstable_cache(
  async (): Promise<JournalArticle[]> => {
    const all = await fetchJournalArticlesUncached().catch(() => [])
    return all
      .filter((a) => a.status === 'Published' && a.slug && a.title)
      .sort((a, b) => (b.publishedDate || '').localeCompare(a.publishedDate || ''))
  },
  ['journal-published'],
  { tags: ['airtable:journal'], revalidate: 3600 },
)

export async function getJournalArticleBySlug(slug: string): Promise<JournalArticle | null> {
  const articles = await getPublishedJournalArticles()
  return articles.find((a) => a.slug === slug) ?? null
}

function fuzzyIntersects(tags: string[], candidates: string[]): boolean {
  const names = candidates.map((n) => n.toLowerCase()).filter(Boolean)
  return tags.some((tag) => {
    const t = tag.toLowerCase()
    return names.some((n) => n.includes(t) || t.includes(n))
  })
}

/**
 * Статьи, релевантные странице тура. Совпадение по любому из каналов:
 *  - slug маршрута (Related Route Slug),
 *  - POI ID точек маршрута (точная геопривязка),
 *  - название локации (Location Tags против названий точек/городов),
 *  - тема (Theme Tags против тематических меток тура — категорий/тегов POI).
 * Всё без учёта регистра. Примеры: статья с тегом «Гинза» всплывает на
 * city-tour/day-one; статья с темой «искусство» — на турах с арт-точками.
 */
export async function findArticlesForRoute(
  routeSlug: string,
  poiIds: string[] = [],
  locationNames: string[] = [],
  themes: string[] = [],
): Promise<JournalArticle[]> {
  const articles = await getPublishedJournalArticles()
  const poiSet = new Set(poiIds.filter(Boolean))

  return articles
    .filter((a) => {
      if (a.relatedRouteSlug === routeSlug) return true
      if (a.poiIds.some((id) => poiSet.has(id))) return true
      if (fuzzyIntersects(a.locationTags, locationNames)) return true
      if (fuzzyIntersects(a.themeTags, themes)) return true
      return false
    })
    .slice(0, 3)
}
