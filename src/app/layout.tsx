import type { Metadata } from "next";
import Script from "next/script";
import { GeistSans } from "geist/font/sans";
import { AppShell } from "@/components/layout/AppShell";
import { Analytics } from "@vercel/analytics/react";
import { buildGuideOrganizationSchema, buildGuidePersonSchema } from "@/lib/schema";
import "./globals.css";

// Single source of truth for these two entities -- see src/lib/schema.ts.
// Person carries '@id': '.../#guide' and is the site's primary entity;
// every page-level schema (TouristTrip.provider, etc.) should reference it
// via guideRef/buildTourProviderRef() instead of re-declaring a Person.
const personSchema = buildGuidePersonSchema();
const organizationSchema = buildGuideOrganizationSchema();

// GA4 measurement ID. Public by nature (visible in page source on any
// GA-instrumented site); NEXT_PUBLIC_GA_ID env overrides if ever needed.
const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? "G-VC1SJWZCGM";

export const metadata: Metadata = {
  metadataBase: new URL('https://jumboinjapan.com'),
  verification: {
    google: 'bnmQEckBRh9k6VtnLn43LrcOfgpQZXIq2J0FEJ2LivA',
  },
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
    shortcut: '/favicon.ico',
  },
  title: {
    default: 'JumboInJapan — Личный гид по Японии',
    template: '%s | JumboInJapan',
  },
  description: 'Частные туры по Японии на русском языке. Токио, Хаконе, Никко, Камакура, Киото, Осака и другие города. Премиум сопровождение с опытом 10+ лет.',
  keywords: ['гид по Японии', 'частный гид Токио', 'туры по Японии на русском', 'личный гид Япония', 'экскурсии Токио русский', 'JumboInJapan'],
  authors: [{ name: 'Eduard Revidovich' }],
  creator: 'Eduard Revidovich',
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    url: 'https://jumboinjapan.com',
    siteName: 'JumboInJapan',
    title: 'JumboInJapan — Личный гид по Японии',
    description: 'Частные туры по Японии на русском языке. Токио, Хаконе, Никко, Камакура, Киото, Осака.',
    images: [{ url: '/hero.jpg', width: 1200, height: 630, alt: 'JumboInJapan — Личный гид по Японии' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'JumboInJapan — Туры по Японии с гидом на русском',
    description: 'Индивидуальные туры по Японии: Токио, Киото, Хаконе, Никко, Осака и многое другое. Русскоязычный гид с 10-летним опытом.',
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
          dangerouslySetInnerHTML={{ __html: JSON.stringify(personSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
      </head>
      <body className={`${GeistSans.className} bg-[var(--bg)] font-sans text-[var(--text)] antialiased`}>
        <AppShell>{children}</AppShell>
        <Analytics />
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
          strategy="afterInteractive"
        />
        <Script id="ga4-init" strategy="afterInteractive">
          {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');`}
        </Script>
      </body>
    </html>
  );
}
