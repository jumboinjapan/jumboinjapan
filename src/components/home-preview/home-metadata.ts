import type { Metadata } from 'next'

const pageUrl = 'https://jumboinjapan.com'
const pageTitle = 'Частный гид по Японии — Эдуард Ревидович'
const pageDescription = 'Индивидуальные экскурсии по Токио, поездки из Токио и многодневные туры по Японии на русском языке. Маршрут под ваши интересы и темп.'
const socialImage = {
  url: 'https://jumboinjapan.com/hero-city-tour-rainbow-bridge-tokyo-tower.jpg',
  width: 3840,
  height: 2560,
  alt: 'Вечерний Токио — путешествия по Японии с Эдуардом Ревидовичем',
}
export const homeMetadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: { canonical: pageUrl },
  openGraph: {
    type: 'website', locale: 'ru_RU', url: pageUrl, siteName: 'Jumbo in Japan',
    title: pageTitle, description: pageDescription, images: [socialImage],
  },
  twitter: { card: 'summary_large_image', title: pageTitle, description: pageDescription, images: [socialImage] },
}

