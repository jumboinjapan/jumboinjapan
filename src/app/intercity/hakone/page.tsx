import type { Metadata } from 'next'
import {
  CarFront,
  ChevronRight,
  TrainFront,
  UserRound,
} from 'lucide-react'
import { cookies } from 'next/headers'
import { RouteAccordion } from '@/components/RouteAccordion'
import { IntercitySummaryStrip } from '@/components/sections/IntercitySummaryStrip'
import { HakoneCtaButton } from '@/components/HakoneCtaButton'
import { tours } from '@/data/tours'
import { hakoneVariantB } from '@/data/hakone-ab'
import { getCityData, getHakonePois } from '@/lib/airtable'
import { buildIntercityRouteStops, getIntercityHelperPois } from '@/lib/intercity-pois'
import { PoiSheet } from '@/components/PoiSheet'
import { getIntercitySummary } from '@/data/intercitySummaries'
import { PageHero } from '@/components/sections/PageHero'

const tour = tours.find((t) => t.slug === 'intercity/hakone')!

const BASE_URL = 'https://jumboinjapan.com'
const PAGE_URL = `${BASE_URL}/${tour.slug}`
const PAGE_IMAGE = `${BASE_URL}${tour.image}`

export const metadata: Metadata = {
  title: tour.title,
  description: tour.description,
  alternates: {
    canonical: 'https://jumboinjapan.com/intercity/hakone',
  },
  openGraph: {
    title: `${tour.title} | JumboInJapan`,
    description: tour.description,
    type: 'website',
    url: PAGE_URL,
    locale: 'ru_RU',
    siteName: 'JumboInJapan',
    images: [{ url: PAGE_IMAGE, width: 1200, height: 800, alt: 'Тур в Хаконэ — озеро Аси, Овакудани, канатная дорога' }],
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
  duration: 'P1D',
  touristType: 'Russian-speaking tourists',
  provider: {
    '@type': 'Person',
    name: 'Eduard Revidovich',
    url: BASE_URL,
  },
  offers: {
    '@type': 'Offer',
    availability: 'https://schema.org/InStock',
    url: PAGE_URL,
  },
  location: {
    '@type': 'Place',
    name: 'Хаконэ',
    address: { '@type': 'PostalAddress', addressRegion: 'Канагава', addressCountry: 'JP' },
  },
  itinerary: {
    '@type': 'ItemList',
    itemListElement: [
      'Застава Хаконэ Сэкисё',
      'Хаконэ Дзиндзя',
      'Канатная дорога Хаконэ',
      'Овакудани',
      'Музей под открытым небом Хаконэ',
    ].map((stop, i) => ({ '@type': 'ListItem', position: i + 1, name: stop })),
  },
}

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    {
      '@type': 'ListItem',
      position: 1,
      name: 'Главная',
      item: BASE_URL,
    },
    {
      '@type': 'ListItem',
      position: 2,
      name: 'Загородные туры',
      item: `${BASE_URL}/intercity`,
    },
    {
      '@type': 'ListItem',
      position: 3,
      name: tour.title,
      item: PAGE_URL,
    },
  ],
}

const fullRouteStops = [
  {
    eyebrow: 'Экскурс в историю',
    title: 'Застава Хаконэ Сэкисё',
    description:
      'Контрольно-пропускной пункт эпохи Эдо, стоявший здесь с 1619 года. Сёгунат использовал его для контроля над перемещением людей и оружия по Токайдо — главной дороге страны. Из двадцати пяти застав Хаконэ была самой строгой: здесь особо проверяли женщин, выезжавших из Эдо — потенциальных заложниц врагов сёгуната. Реконструкция 2007 года воспроизводит ворота, сторожевые посты и архив с оригинальными документами.',
  },
  {
    eyebrow: 'Святилище у воды',
    title: 'Хаконэ Дзиндзя',
    description:
      'Синтоистское святилище на берегу озера Аси. Красный торий стоит прямо в воде. Сюда приходят пешком через кедровую аллею — пять минут от причала.',
  },
  {
    eyebrow: 'Круиз по озеру',
    title: 'Круиз по озеру Аси',
    description:
      'Получасовой круиз на пароме от одного берега к другому. Если повезёт с погодой — Фудзи встанет прямо по курсу, отражаясь в озере. Причал на той стороне — начало подъёма к Овакудани.',
  },
  {
    eyebrow: 'Подъём',
    title: 'Канатная дорога Хаконэ',
    description:
      'Подъём от озера к Овакудани. Из кабинки открывается кальдера целиком: горные хребты по кругу, долина внизу, озеро позади. Едешь минут двадцать.',
  },
  {
    eyebrow: 'Вулканическая долина',
    title: 'Овакудани',
    description:
      'Активная вулканическая зона: из земли идёт серный пар, в горячих источниках варят чёрные яйца. Пахнет серой, под ногами жёлтая порода.',
  },
  {
    eyebrow: 'Искусство под открытым небом',
    title: 'Музей под открытым небом Хаконэ',
    description:
      'Семь гектаров скульптурного парка на фоне гор — один из немногих музеев в Японии, где контекст равноправен с экспонатами. Коллекция включает работы Родена, Мура, Кальдера и японских скульпторов второй половины XX века. Центральный зал Пикассо хранит около 300 работ — один из крупнейших фондов в Азии. Можно ходить долго.',
  },
]


const whoItSuits =
  'Для тех, кто уже видел Токио и хочет один день провести иначе — в горах, без городского ритма. Маршрут держит темп, но не торопит: подходит для пары, семьи с детьми постарше, небольшой компании. Гид на русском ведёт день — логистика и контекст на нём.'


const sectionTitleClassName = 'font-sans text-2xl font-medium tracking-[-0.02em] text-[var(--text)] md:text-[32px]'
const sectionIntroClassName = 'max-w-3xl font-sans text-[15px] font-light leading-[1.82] text-[var(--text-muted)] md:text-base'

export default async function HakonePage() {
  const cookieStore = await cookies()
  const abVariant = cookieStore.get('ab-hakone')?.value ?? 'a'
  const isVariantB = abVariant === 'b'

  const [pois, cityData] = await Promise.all([
    getHakonePois(),
    getCityData('CTY-0006'),
  ])

  const guideFlexibility = cityData.hasNonCarSegments ? 3 : 4

  const transportOptions = [
    {
      title: 'Общественный транспорт',
      Icon: TrainFront,
      scores: { стоимость: 2, гибкость: 1, комфорт: 2 },
    },
    {
      title: 'Гид-водитель',
      Icon: UserRound,
      scores: { стоимость: 4, гибкость: guideFlexibility, комфорт: 4 },
    },
    {
      title: 'Лимузин-сервис',
      Icon: CarFront,
      scores: { стоимость: 5, гибкость: 5, комфорт: 5 },
    },
  ]
  const routeStops = buildIntercityRouteStops('hakone', fullRouteStops, pois).map((stop) => {
    if (isVariantB && hakoneVariantB.routeDescriptions[stop.title]) {
      return { ...stop, description: hakoneVariantB.routeDescriptions[stop.title] }
    }
    return stop
  })
  const helperPois = getIntercityHelperPois('hakone', pois)
  return (
    <>
      <PageHero
        image="/tours/hakone/hakone-1.jpg"
        alt="Тур в Хаконэ — озеро Аси, Овакудани и канатная дорога"
        eyebrow="Загородный маршрут из Токио"
        title="Тур в Хаконэ из Токио"
        subtitle="Озеро Аси, вулканическая долина, канатная дорога и день с русскоязычным гидом — в одном собранном маршруте без транспортной суеты."
        objectPosition="center bottom"
      />
      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          var v = document.cookie.match(/ab-hakone=([ab])/);
          if (v) window.__abVariant = v[1];
        })();
      ` }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <div className="mx-auto w-full max-w-6xl space-y-12 md:space-y-14">
        <header className="grid gap-8 border-b border-[var(--border)] pb-12 md:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)] md:items-end md:gap-12 md:pb-14">
          <div className="space-y-5">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">День и более</p>
            <div className="space-y-3">
              <h1 className="font-sans text-3xl font-medium tracking-[-0.02em] md:text-4xl">Тур в Хаконэ из Токио</h1>
              <p className="text-sm font-medium tracking-[0.01em] text-[var(--accent)]">
                Тур в Хаконэ из Токио с гидом на русском
              </p>
            </div>
            <p className={sectionIntroClassName}>
              {isVariantB
                ? hakoneVariantB.pageDescription
                : 'Хаконэ стоит на старом тракте Токайдо, которым ходили между столицами ещё в эпоху Эдо. Горы здесь живые — из земли идёт пар, вулканическая кальдера открывается с канатной дороги, а в ясный день над озером стоит Фудзи. Можно приехать на день из Токио, можно сделать остановку по дороге в Киото — Хаконэ хорошо работает в обоих форматах.'}
            </p>
          </div>
          <div className="space-y-5 rounded-sm border border-[var(--border)] bg-[var(--bg)] p-5 md:p-6">
            <IntercitySummaryStrip items={getIntercitySummary('hakone')} />
            <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
              {["Природа и пейзажи", "Термальные источники", "Ночёвка", "Для пар", "Традиции и история"].map((tag) => (
                <span key={tag} className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">
                  <span className="h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </header>

        {/* 3. Кому подходит */}
        <section className="space-y-4">
          <h2 className={sectionTitleClassName}>
            Кому подходит тур
          </h2>
          <p className={sectionIntroClassName}>
            {whoItSuits}
          </p>
        </section>

        {/* 4. Маршрут (аккордеон) */}
        <section className="space-y-6">
          <div className="flex items-center gap-5 py-1">
            <div className="h-px flex-1 bg-[var(--border)]" />
            <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">Маршрут дня</span>
            <div className="h-px flex-1 bg-[var(--border)]" />
          </div>
          <h2 className={sectionTitleClassName}>
            Маршрут по Хаконэ
          </h2>
          <RouteAccordion
            stops={routeStops}
          />
        </section>

        {/* 6. Что включить */}
        <section className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className={sectionTitleClassName}>
                Что можно включить в маршрут
              </h2>
              <p className="mt-3 max-w-3xl text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
                Дополнительные точки для тех, кто хочет сделать день мягче, насыщеннее или сместить акцент с классического маршрута на музеи, прогулки и виды.
              </p>
            </div>
            <span className="hidden items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[var(--accent)] md:inline-flex">
              Открывается по клику <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </div>
          <PoiSheet pois={helperPois} />
        </section>

        {/* 7. Логистика */}
        <section className="space-y-6">
          <div className="space-y-2">
            <h2 className={sectionTitleClassName}>
              Логистика
            </h2>
            <p className={sectionIntroClassName}>
              Три способа путешествовать по Японии. Отличаются по стоимости, гибкости и комфорту.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {transportOptions.map(({ title, scores, Icon }) => (
              <article
                key={title}
                className="group rounded-sm border border-[var(--border)] bg-[var(--bg)] p-5 transition-colors hover:border-[var(--accent)] md:p-6"
              >
                <div className="flex items-center gap-3 mb-5">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--accent)]">
                    <Icon aria-hidden="true" className="h-5 w-5" />
                  </span>
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

        {/* 8. Навигация */}
        <nav className="flex flex-wrap gap-3" aria-label="Похожие туры">
          {[
            { title: 'Камакура', href: '/intercity/kamakura' },
            { title: 'Никко', href: '/intercity/nikko' },
            { title: 'Гора Фудзи', href: '/intercity/fuji' },
            { title: 'Все загородные туры', href: '/intercity' },
          ].map((link) => (
            <a key={link.href} href={link.href} className="inline-flex min-h-[44px] items-center rounded-sm border border-[var(--border)] px-4 py-2 text-[13px] font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]">
              {link.title}
            </a>
          ))}
        </nav>

        {/* 9. CTA */}
        <section className="rounded-sm border border-[var(--border)] bg-[var(--surface)] px-6 py-8 space-y-4">
          <h2 className="font-sans text-xl font-medium tracking-[-0.01em]">Обсудить тур</h2>
          <p className="max-w-2xl font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            Напишите — уточним программу, стоимость и доступные даты. Тур можно скорректировать под ваш маршрут по Японии.
          </p>
          <HakoneCtaButton variant={abVariant} />
        </section>
      </div>
    </section>
    </>
  )
}
