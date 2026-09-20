import { buildPageMetadata } from './page-metadata'

/** Keep search and social previews aligned with the visible collection. */
export function buildTourCollectionMetadata(path: string, title: string, description: string, image: string, alt: string) {
  return buildPageMetadata(path, {
    title,
    description,
    openGraph: {
      title: `${title} | JumboInJapan`,
      description,
      type: 'website',
      url: `https://jumboinjapan.com${path}`,
      locale: 'ru_RU',
      siteName: 'JumboInJapan',
      images: [{ url: image, alt }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | JumboInJapan`,
      description,
      images: [{ url: image, alt }],
    },
  })
}
