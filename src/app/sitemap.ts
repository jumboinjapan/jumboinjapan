import { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://jumboinjapan.com'

  return [
    { url: `${base}/`, lastModified: new Date(), changeFrequency: 'daily', priority: 1.0 },
    { url: `${base}/from-tokyo`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/from-tokyo/city-tour`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/from-tokyo/intercity`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/from-tokyo/multi-day`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/from-tokyo/intercity/hakone`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/from-tokyo/intercity/nikko`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/from-tokyo/intercity/kamakura`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/from-tokyo/intercity/enoshima`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/from-tokyo/intercity/fuji`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/from-tokyo/intercity/nara`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/from-tokyo/intercity/kyoto-1`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/from-tokyo/intercity/kyoto-2`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/from-tokyo/intercity/osaka`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/from-tokyo/intercity/kanazawa`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/faq`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/contact`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/resources`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 },
  ]
}
