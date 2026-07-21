import { MetadataRoute } from 'next'
import { tours, staticPages } from '@/data/tours'
import { listSavedMultiDayRoutes } from '@/lib/multi-day-builder-storage'
import { getPublishedJournalArticles } from '@/lib/journal'

const BASE_URL = 'https://jumboinjapan.com'

/**
 * Единственный источник sitemap. Ранее параллельно существовал next-sitemap
 * (postbuild → public/sitemap.xml), но App Router metadata route всегда
 * затенял его в проде — артефакт удалён 2026-07-17, чтобы не было двух
 * конкурирующих списков URL.
 *
 * Осознанно НЕ включены (заглушки/устаревшие, решение зафиксировано ещё в
 * next-sitemap.config): /faq, /multi-day/classic, /multi-day/mountain,
 * /multi-day/custom. /journal включён с 2026-07-18 (запуск Журнала).
 */

/** Страницы городских туров, не входящие в tours[] (у tours только хаб /city-tour). */
const CITY_TOUR_PAGES = [
  'city-tour/day-one',
  'city-tour/day-two',
  'city-tour/hidden-spots',
  'city-tour/takao',
  'city-tour/mitake',
  'city-tour/charter',
  'city-tour/private',
  'city-tour/public',
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  const tourPages: MetadataRoute.Sitemap = tours.map((tour) => ({
    url: `${BASE_URL}/${tour.slug}`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority: tour.priority,
  }))

  const staticEntries: MetadataRoute.Sitemap = staticPages.map((page) => ({
    url: `${BASE_URL}${page.url}`,
    lastModified: now,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }))

  const cityTourEntries: MetadataRoute.Sitemap = CITY_TOUR_PAGES.map((slug) => ({
    url: `${BASE_URL}/${slug}`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority: 0.75,
  }))

  // Опубликованные маршруты конструктора (multi-day/[slug]). Slug в Airtable
  // хранится с префиксом ("multi-day/..."). Недоступность Airtable не должна
  // ронять sitemap — тогда отдаём только статическую часть.
  let builderEntries: MetadataRoute.Sitemap = []
  try {
    const saved = await listSavedMultiDayRoutes()
    builderEntries = saved
      .filter((route) => route.status === 'Published')
      .map((route) => ({
        url: `${BASE_URL}/${route.slug}`,
        lastModified: route.lastBuilderSync ? new Date(route.lastBuilderSync) : now,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
      }))
  } catch {
    // Airtable недоступен — sitemap остаётся валидным без динамических маршрутов.
  }

  // Журнал: хаб + опубликованные статьи.
  let journalEntries: MetadataRoute.Sitemap = []
  try {
    const articles = await getPublishedJournalArticles()
    journalEntries = [
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

  return [...staticEntries, ...tourPages, ...cityTourEntries, ...builderEntries, ...journalEntries]
}
