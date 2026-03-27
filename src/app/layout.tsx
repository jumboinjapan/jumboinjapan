import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MobileCtaBar } from "@/components/layout/MobileCtaBar";
import "./globals.css";

const localBusinessSchema = {
  "@context": "https://schema.org",
  "@type": "TouristInformationCenter",
  "name": "JumboInJapan",
  "description": "Частные туры по Японии на русском языке для русскоязычных туристов.",
  "url": "https://jumboinjapan.com",
  "address": {
    "@type": "PostalAddress",
    "addressLocality": "Tokyo",
    "addressCountry": "JP"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": 35.6762,
    "longitude": 139.6503
  },
  "openingHours": "Mo-Su 09:00-21:00",
  "priceRange": "¥¥¥¥",
  "knowsLanguage": ["ru", "en", "ja"],
  "areaServed": "Japan"
};

const personSchema = {
  "@context": "https://schema.org",
  "@type": "Person",
  "name": "Eduard Revidovich",
  "alternateName": "Эдуард Ревидович",
  "jobTitle": "Private Tour Guide",
  "worksFor": {
    "@type": "Organization",
    "name": "JumboInJapan",
    "url": "https://jumboinjapan.com"
  },
  "knowsAbout": ["Japan", "Tokyo", "Japanese culture", "Private tours"],
  "knowsLanguage": ["ru", "en", "ja"],
  "url": "https://jumboinjapan.com"
};

export const metadata: Metadata = {
  metadataBase: new URL('https://jumboinjapan.com'),
  title: {
    default: 'JumboInJapan — Личный гид по Японии',
    template: '%s | JumboInJapan',
  },
  description: 'Частные туры по Японии на русском языке. Токио, Хаконэ, Никко, Камакура, Киото, Осака и другие города. Премиум сопровождение с опытом 10+ лет.',
  keywords: ['гид по Японии', 'частный гид Токио', 'туры по Японии на русском', 'личный гид Япония', 'экскурсии Токио русский', 'JumboInJapan'],
  authors: [{ name: 'Eduard Revidovich' }],
  creator: 'Eduard Revidovich',
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    url: 'https://jumboinjapan.com',
    siteName: 'JumboInJapan',
    title: 'JumboInJapan — Личный гид по Японии',
    description: 'Частные туры по Японии на русском языке. Токио, Хаконэ, Никко, Камакура, Киото, Осака.',
    images: [{ url: '/hero.jpg', width: 1200, height: 630, alt: 'JumboInJapan — Личный гид по Японии' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'JumboInJapan — Личный гид по Японии',
    description: 'Частные туры по Японии на русском языке.',
    images: ['/hero.jpg'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  alternates: {
    canonical: 'https://jumboinjapan.com',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className={`${GeistSans.variable}`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(personSchema) }}
        />
      </head>
      <body className={`${GeistSans.className} bg-[var(--bg)] font-sans text-[var(--text)] antialiased`}>
        <div className="min-h-screen pb-20 lg:pb-0">
          <Header />
          <main className="pt-20 md:pt-24">{children}</main>
          <Footer />
        </div>
        <MobileCtaBar />
      </body>
    </html>
  );
}
