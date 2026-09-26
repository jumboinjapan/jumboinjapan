import { MetadataRoute } from 'next'
import { staticPages } from '@/data/tours'
import { listRouteRegistry } from '@/lib/route-registry'
import { isIndexableRoute, isRouteSlug } from '@/lib/route-publication'
import { getPublishedJournalArticles } from '@/lib/journal'

const BASE_URL = 'https://jumboinjapan.com'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const routeEntries: MetadataRoute.Sitemap = (await listRouteRegistry()).filter(isIndexableRoute).map(route => ({
    url: `${BASE_URL}/${route.slug}`, lastModified: now, changeFrequency: 'weekly',
    priority: route.contentKind === 'Collection' ? 0.9 : 0.8,
  }))
  const staticEntries: MetadataRoute.Sitemap = staticPages.filter(page => !isRouteSlug(page.url.slice(1))).map(page => ({
    url: `${BASE_URL}${page.url}`, lastModified: now, changeFrequency: page.changeFrequency, priority: page.priority,
  }))

  // Журнал: хаб появляется вместе с первой опубликованной статьёй.
  let journalEntries: MetadataRoute.Sitemap = []
  try {
    const articles = await getPublishedJournalArticles()
    journalEntries = articles.length === 0 ? [] : [
      {
        url: `${BASE_URL}/journal`,
        lastModified: now,
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      },
      ...articles.map((article) => ({
        url: `${BASE_URL}/journal/${article.slug}`,
        lastModified: article.publishedDate ? new Date(article.publishedDate) : now,
        changeFrequency: 'monthly' as const,
        priority: 0.7,
      })),
    ]
  } catch {
    // Airtable недоступен — журнал в этот раз пропускаем.
  }

  return [...staticEntries, ...routeEntries, ...journalEntries]
}
