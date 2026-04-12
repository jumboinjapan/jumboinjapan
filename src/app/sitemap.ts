import { MetadataRoute } from 'next'
import { tours, staticPages } from '@/data/tours'

const BASE_URL = 'https://jumboinjapan.com'

export default function sitemap(): MetadataRoute.Sitemap {
  const tourPages: MetadataRoute.Sitemap = tours.map((tour) => ({
    url: `${BASE_URL}/${tour.slug}`,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: tour.priority,
  }))

  const staticEntries: MetadataRoute.Sitemap = staticPages.map((page) => ({
    url: `${BASE_URL}${page.url}`,
    lastModified: new Date(),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }))

  const resourceEntries: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}/resources/events`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.7,
    },
  ]

  return [...staticEntries, ...resourceEntries, ...tourPages]
}
