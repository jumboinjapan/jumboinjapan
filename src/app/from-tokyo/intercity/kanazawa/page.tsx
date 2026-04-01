import type { Metadata } from 'next'
import {
  CarFront,
  TrainFront,
  UserRound,
} from 'lucide-react'
import { RouteAccordion } from '@/components/RouteAccordion'
import { ImageCarousel } from '@/components/sections/ImageCarousel'
import { tours } from '@/data/tours'
import { getCityData, getPoisByCity } from '@/lib/airtable'
import { PoiSheet } from '@/components/PoiSheet'

const tour = tours.find((t) => t.slug === 'from-tokyo/intercity/kanazawa')!

const BASE_URL = 'https://jumboinjapan.com'
const PAGE_URL = `${BASE_URL}/${tour.slug}`
const PAGE_IMAGE = `${BASE_URL}${tour.image}`

export const metadata: Metadata = {
  title: tour.title,
  description: tour.description,
  alternates: { canonical: 'https://jumboinjapan.com/from-tokyo/intercity/kanazawa' },
  openGraph: {
    title: `${tour.title} | JumboInJapan`,
    description: tour.description,
    type: 'website',
    url: PAGE_URL,
    locale: 'ru_RU',
    siteName: 'JumboInJapan',
    images: [{ url: PAGE_IMAGE, width: 1200, height: 800, alt: 'Тур в Канадзаву — сад Кэнрокуэн, замок, чайные кварталы' }],
  },
}

const tourSchema = {
  '@context': 'https://schema.org',
  '@type': 'TouristTrip',
  name: tour.title,
  alternateName: tour.titleEn,
  description: tour.description,
  inLanguage: 'ru',
  image: PAGE_IMAGE,
  url: PAGE_URL,
  duration: 'P2D',
  touristType: 'Russian-speaking tourists',
  provider: { '@type': 'Person', name: 'Eduard Revidovich', url: BASE_URL },
  offers: { '@type': 'Offer', availability: 'https://schema.org/InStock', url: PAGE_URL },
  location: {
    '@type': 'Place',
    name: 'Kanazawa',
    address: { '@type': 'PostalAddress', addressCountry: 'JP' },
  },
}

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Главная', item: BASE_URL },
    { '@type': 'ListItem', position: 2, name: 'Из Токио', item: `${BASE_URL}/from-tokyo` },
    { '@type': 'ListItem', position: 3, name: 'Загородные туры', item: `${BASE_URL}/from-tokyo/intercity` },
    { '@type': 'ListItem', position: 4, name: tour.title, item: PAGE_URL },
  ],
}

const schematicRoute = [
  'Сад Кэнрокуэн',
  'Замок Канадзава',
  'Рыбный рынок Омитё',
  'Район Хигаси Тяя-гай',
  'Музей современного искусства 21 века',
]

const fullRouteStops = [
  {
    eyebrow: 'Один из трёх великих садов',
    title: 'Сад Кэнрокуэн',
    description:
      'Один из трёх великих садов Японии, признанный образцом ландшафтного совершенства. Здесь сочетаются шесть идеальных качеств: простор, уединение, искусственность, древность, водные элементы и панорама. Весной — сакура, летом — туман над прудом, осенью — клёны, зимой — легендарные верёвочные подвязки юкитсуру, защищающие деревья от снега.',
  },
  {
    eyebrow: 'Феодальная крепость',
    title: 'Замок Канадзава',
    description:
      'Некогда мощная феодальная крепость с белоснежными стенами, деревянными воротами и обзорной башней. Замок и сад Кэнрокуэн соединены пешеходным мостом — отсюда лучшие виды на историческую часть города.',
  },
  {
    eyebrow: 'Гастрономия',
    title: 'Рыбный рынок Омитё',
    description:
      '«Кухня Канадзавы», действующая с эпохи Эдо. Свежайшие крабы, морские ежи, сушёные кальмары и знаменитые сладости из фасоли и золота. Можно остановиться на дегустацию стрит-фуда или быструю обеденную паузу.',
  },
  {
    eyebrow: 'Чайные дома и гейши',
    title: 'Район Хигаси Тяя-гай',
    description:
      'Атмосфера старой Японии в районе чайных домов — узкие улочки, решётчатые фасады, антикварные магазины и действующие чайные дома, где до сих пор проходят выступления гейш. Один из лучших районов страны для прогулок в кимоно.',
  },
  {
    eyebrow: 'Современное искусство',
    title: 'Музей современного искусства 21 века',
    description:
      'Неожиданно контрастное место, прекрасно вписывающееся в художественное ДНК города. Здесь можно посетить «The Swimming Pool» Леандро Эрлиха, увидеть актуальные выставки на пересечении традиций и технологий.',
  },
]

const excludedPoiIds: string[] = []
const fullRoutePoiMap: Record<string, string> = {
  'Сад Кэнрокуэн': 'POI-000208',
  'Замок Канадзава': 'POI-000209',
  'Рыбный рынок Омитё': 'POI-000214',
  'Район Хигаси Тяя-гай': 'POI-000210',
  'Музей современного искусства 21 века': 'POI-000212',
}

const whoItSuits = 'Для тех, кто уже был в Киото и ищет то же самое, но без толп. Сад Кэнроку-эн, самурайский квартал, морепродукты с Японского моря — город, который живёт своей жизнью и не особо старается понравиться туристу. Именно поэтому нравится.'

export default async function KanazawaPage() {
  const [pois, cityData] = await Promise.all([
    getPoisByCity('kanazawa'),
    getCityData('CTY-0037'),
  ])

  const guideFlexibility = cityData.hasNonCarSegments ? 3 : 4

  const transportOptions = [
    { title: 'Общественный транспорт', Icon: TrainFront, scores: { стоимость: 2, гибкость: 1, комфорт: 2 } },
    { title: 'Гид-водитель', Icon: UserRound, scores: { стоимость: 4, гибкость: guideFlexibility, комфорт: 4 } },
    { title: 'Лимузин-сервис', Icon: CarFront, scores: { стоимость: 5, гибкость: 5, комфорт: 5 } },
  ]

  const poiByPoiId = new Map(pois.map((p) => [p.poiId, p]))

  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      <div className="mx-auto w-full max-w-6xl space-y-12 md:space-y-14">
        <ImageCarousel
          images={['/tours/kanazawa/kanazawa-1.jpg', '/tours/kanazawa/kanazawa-2.jpg', '/tours/kanazawa/kanazawa-3.jpg']}
          alt="Тур в Канадзаву — сад Кэнрокуэн, замок, чайные кварталы"
        />

        <header className="space-y-4 md:space-y-5">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">2 дня</p>
          <h1 className="font-sans text-3xl font-medium tracking-[-0.02em] md:text-4xl">Тур в Канадзаву из Токио</h1>
          <p className="text-sm font-medium tracking-[0.01em] text-[var(--accent)]">
            Тур в Канадзаву из Токио с гидом на русском
          </p>
          <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.82] text-[var(--text-muted)]">
            Это город-шедевр на побережье Японского моря, с богатейшей традицией художественных ремёсел и одним из самых прекрасных садов Японии. Канадзава — Япония без суеты мегаполисов, но с роскошью, которая ощущается в деталях: в изящных мостиках, в шуме воды в саду, в отблеске сусального золота в витринах.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
            {['Сады и парки', 'Ремёсла и искусство', 'Гастрономия', 'Гейши', 'Замки', 'Ночёвка'].map((tag) => (
              <span key={tag} className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">
                <span className="h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                {tag}
              </span>
            ))}
          </div>
        </header>


        <section className="space-y-4">
          <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">
            Кому подходит тур
          </h2>
          <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.82] text-[var(--text-muted)]">
            {whoItSuits}
          </p>
        </section>

        {/* Маршрут (аккордеон) */}
        <section className="space-y-6">
          <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">
            Маршрут
          </h2>
          <RouteAccordion
            stops={fullRouteStops.map((stop) => {
              const poiId = fullRoutePoiMap[stop.title]
              const airtablePoi = poiId ? poiByPoiId.get(poiId) : undefined
              return {
                eyebrow: stop.eyebrow,
                title: stop.title,
                description: airtablePoi?.descriptionRu || stop.description,
                workingHours: airtablePoi?.workingHours,
                minPrice: airtablePoi?.tickets.length ? Math.min(...airtablePoi.tickets.map((t) => t.price)) : null,
              }
            })}
          />
        </section>

        {pois.filter((p) => !excludedPoiIds.includes(p.poiId)).length > 0 && (
          <section className="space-y-6">
            <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">Что можно включить в маршрут</h2>
            <PoiSheet pois={pois.filter((p) => !excludedPoiIds.includes(p.poiId))} />
          </section>
        )}

        <section className="space-y-6">
          <div className="space-y-2">
            <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">Логистика</h2>
            <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">Три способа путешествовать по Японии. Отличаются по стоимости, гибкости и комфорту.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {transportOptions.map(({ title, scores, Icon }) => (
              <article key={title} className="group rounded-sm border border-[var(--border)] bg-[var(--bg)] p-5 transition-colors hover:border-[var(--accent)] md:p-6">
                <div className="flex items-center gap-3 mb-5">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--accent)]"><Icon aria-hidden="true" className="h-5 w-5" /></span>
                  <h3 className="font-sans text-[16px] font-medium leading-[1.3] tracking-[-0.01em]">{title}</h3>
                </div>
                <div className="space-y-3">
                  {Object.entries(scores).map(([label, score]) => (
                    <div key={label} className="flex items-center justify-between gap-4">
                      <span className="w-20 capitalize text-[12px] text-[var(--text-muted)]">{label}</span>
                      <div className="flex gap-1">
                        {[1,2,3,4,5].map(i => (
                          <span key={i} className={`h-1.5 w-6 rounded-full ${i <= score ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Навигация */}
        <nav className="flex flex-wrap gap-3" aria-label="Похожие туры">
          {[
              { title: 'Киото', href: '/from-tokyo/intercity/kyoto-1' },
              { title: 'Осака', href: '/from-tokyo/intercity/osaka' },
              { title: 'Никко', href: '/from-tokyo/intercity/nikko' },
              { title: 'Все загородные туры', href: '/from-tokyo/intercity' },
          ].map((link) => (
            <a key={link.href} href={link.href} className="rounded-sm border border-[var(--border)] px-4 py-2 text-[13px] font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]">
              {link.title}
            </a>
          ))}
        </nav>

        {/* CTA */}
        <section className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-6 py-8 space-y-4">
          <h2 className="font-sans text-xl font-medium tracking-[-0.01em]">Обсудить тур</h2>
          <p className="max-w-2xl font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            Напишите — уточним программу, стоимость и доступные даты. Тур можно скорректировать под ваш маршрут по Японии.
          </p>
          <a
            href="/contact"
            className="inline-flex items-center gap-2 rounded-sm border border-[var(--accent)] px-5 py-2.5 text-[14px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
          >
            Написать гиду
          </a>
        </section>
      </div>
    </section>
  )
}
