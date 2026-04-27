import type { Metadata } from 'next'
import { ArrowRight, CarFront, TrainFront, UserRound } from 'lucide-react'
import { cookies } from 'next/headers'
import { IntercityRouteTimeline } from '@/components/IntercityRouteTimeline'
import { IntercitySummaryStrip } from '@/components/sections/IntercitySummaryStrip'
import { PageHero } from '@/components/sections/PageHero'
import { HakoneCtaButton } from '@/components/HakoneCtaButton'
import { tours } from '@/data/tours'
import { hakoneVariantB } from '@/data/hakone-ab'
import { getCityData, getHakonePois } from '@/lib/airtable'
import { buildIntercityRouteStops, getIntercityHelperPois } from '@/lib/intercity-pois'
import { PoiSheet } from '@/components/PoiSheet'
import { getIntercitySummary } from '@/data/intercitySummaries'

export const dynamic = 'force-dynamic'

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
    photoPath: '/tours/hakone/hakone-2.jpg',
    photoAlt: 'Круиз по озеру Аси, Хаконэ',
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
    photoPath: '/tours/hakone/hakone-3.jpg',
    photoAlt: 'Вулканическая долина Овакудани',
  },
  {
    eyebrow: 'Искусство под открытым небом',
    title: 'Музей под открытым небом Хаконэ',
    description:
      'Семь гектаров скульптурного парка на фоне гор — один из немногих музеев в Японии, где контекст равноправен с экспонатами. Коллекция включает работы Родена, Мура, Кальдера и японских скульпторов второй половины XX века. Центральный зал Пикассо хранит около 300 работ — один из крупнейших фондов в Азии. Можно ходить долго.',
  },
]


const whoItSuitsCards = [
  {
    title: 'Пары',
    description:
      'Хаконэ хорошо работает, когда хочется тихого цельного дня с панорамами, озером, водой и возможностью закончить маршрут онсэном или ночёвкой.',
  },
  {
    title: 'Семьи с детьми 8+',
    description:
      'Маршрут держится на смене впечатлений, а не на длинных переходах: корабль, канатная дорога, вулканическая долина и музей читаются легко даже в одном дне.',
  },
  {
    title: 'Те, кто хочет один сильный выезд из Токио',
    description:
      'Это хороший выбор, если нужен не набор разрозненных точек, а один собранный загородный день с понятным ритмом и сильной визуальной линией.',
  },
] as const

const editorialNotes = [
  {
    title: 'Фудзи — бонус, а не обещание',
    description:
      'В ясную погоду гора собирает весь пейзаж, но Хаконэ не стоит строить только вокруг этого ожидания: маршрут работает и как озеро, и как рельеф, и как смена высоты.',
  },
  {
    title: 'Ритм строится сам',
    description:
      'Озеро, паром и подъём по канатной дороге естественно задают темп. Здесь не нужно искусственно ускорять день, чтобы он чувствовался насыщенным.',
  },
  {
    title: 'Ночёвка меняет характер места',
    description:
      'Если остаться в Хаконэ после основного маршрута, день перестаёт быть просто выездом из Токио и превращается в более мягкое, курортное переживание.',
  },
  {
    title: 'Логистика влияет на мягкость дня',
    description:
      'На общественном транспорте маршрут возможен, но пересадки и стыковки делают его жёстче. Машина или гид-водитель заметно выравнивают темп.',
  },
] as const

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <div className="space-y-3 md:space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">{eyebrow}</p>
        <span aria-hidden="true" className="h-px w-14 bg-[var(--border)]" />
      </div>
      <div className="space-y-2">
        <h2 className="font-sans text-[28px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[34px]">
          {title}
        </h2>
        {description ? (
          <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)] md:text-[16px]">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  )
}

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
  const timelineStops = routeStops.map((stop) => {
    if (stop.title === 'Застава Хаконэ Сэкисё') {
      return {
        ...stop,
        type: 'landmark' as const,
        arrivalTime: '09:30',
      }
    }

    if (stop.title === 'Хаконэ Дзиндзя') {
      return {
        ...stop,
        type: 'landmark' as const,
        arrivalTime: '10:20',
      }
    }

    if (stop.title === 'Круиз по озеру Аси') {
      return {
        ...stop,
        type: 'transport' as const,
        arrivalTime: '11:15',
      }
    }

    if (stop.title === 'Канатная дорога Хаконэ') {
      return {
        ...stop,
        type: 'transport' as const,
        arrivalTime: '12:00',
      }
    }

    if (stop.title === 'Овакудани') {
      return {
        ...stop,
        type: 'nature' as const,
        arrivalTime: '12:35',
      }
    }

    if (stop.title === 'Музей под открытым небом Хаконэ') {
      return {
        ...stop,
        type: 'museum' as const,
        arrivalTime: '14:30',
      }
    }

    return stop
  })

  return (
    <>
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

      <PageHero
        image="/tours/hakone/hakone-hero.jpg"
        alt="Тур в Хаконэ, озеро Аси и горы"
        eyebrow="Загородный тур · День и более"
        title="Тур в Хаконэ из Токио"
        subtitle="Хаконэ — озеро Аси, Овакудани, канатная дорога и старый тракт Токайдо. За один день — очень цельное впечатление."
        objectPosition="center 30%"
      />

      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
        <div className="mx-auto w-full max-w-6xl space-y-16 md:space-y-20 lg:space-y-24">
          <section className="space-y-8 md:space-y-10">
            <header className="space-y-5 md:space-y-6">
              <p className="text-sm font-medium tracking-[0.01em] text-[var(--accent)]">
                Тур в Хаконэ из Токио с гидом на русском
              </p>

              <p className="max-w-3xl font-sans text-[16px] font-light leading-[1.9] text-[var(--text-muted)] md:text-[18px]">
                {isVariantB
                  ? hakoneVariantB.pageDescription
                  : 'Хаконэ складывается в редкий для одного дня маршрут: история старого тракта, вода, подъём в кальдеру и искусство под открытым небом читаются здесь как одна цельная линия. А если остаться на ночь и добавить онсэн, место раскрывается уже не как выезд из Токио, а как отдельное курортное пространство.'}
              </p>
            </header>
          </section>

          <section className="space-y-6 md:space-y-8">
            <SectionHeading
              eyebrow="Journey"
              title="Маршрут по Хаконэ"
              description="От старого тракта к озеру, затем к подъёму и вулканической долине, а после — к музею на воздухе. Именно эта последовательность собирает день в цельный выезд, а не в набор отдельных остановок."
            />
            <IntercityRouteTimeline stops={timelineStops} />
          </section>

          <section className="space-y-6 md:space-y-8">
            <SectionHeading
              eyebrow="Worth noticing"
              title="На что обратить внимание"
              description="Не инструкция по маршруту, а несколько вещей, которые помогают правильно прочитать Хаконэ и не ждать от него не того."
            />
            <div className="grid gap-4 md:grid-cols-2">
              {editorialNotes.map((note) => (
                <article key={note.title} className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
                  <h3 className="font-sans text-[17px] font-medium tracking-[-0.02em] text-[var(--text)]">{note.title}</h3>
                  <p className="mt-3 font-sans text-[14px] font-light leading-[1.85] text-[var(--text-muted)] md:text-[15px]">
                    {note.description}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="space-y-6 md:space-y-8">
            <SectionHeading eyebrow="Для кого" title="Кому подходит тур" />
            <div className="grid gap-4 md:grid-cols-3">
              {whoItSuitsCards.map((item) => (
                <article key={item.title} className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
                  <h3 className="font-sans text-[17px] font-medium tracking-[-0.02em] text-[var(--text)]">{item.title}</h3>
                  <p className="mt-3 font-sans text-[14px] font-light leading-[1.85] text-[var(--text-muted)] md:text-[15px]">
                    {item.description}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="space-y-6 md:space-y-8">
            <SectionHeading
              eyebrow="Дополнения"
              title="Что можно добавить"
              description="Если день хочется сделать мягче, насыщеннее или растянуть на ночь, ниже — точки, которые действительно поддерживают характер Хаконэ, а не перегружают его."
            />
            <PoiSheet pois={helperPois.slice(0, 8)} />
          </section>

          <section className="space-y-6 md:space-y-8">
            <SectionHeading
              eyebrow="Логистика"
              title="Как лучше ехать"
              description="Главный выбор здесь не теоретический, а практический: насколько мягким должен быть сам день. Поезд даёт более бюджетный формат, а машина или гид-водитель снимают пересадки и делают маршрут заметно спокойнее."
            />

            <div className="grid gap-4 md:grid-cols-3">
              {transportOptions.map(({ title, scores, Icon }) => (
                <article
                  key={title}
                  className="group rounded-sm border border-[var(--border)] bg-[var(--bg)] p-5 transition-colors hover:border-[var(--accent)] md:p-6"
                >
                  <div className="mb-5 flex items-center gap-3">
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
                          {[1, 2, 3, 4, 5].map((i) => (
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

          <section className="grid gap-6 rounded-sm border border-[var(--border)] bg-[var(--surface)] px-6 py-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:px-8 md:py-8">
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">Следующий шаг</p>
              <h2 className="font-sans text-[28px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[34px]">Обсудить маршрут под ваш ритм</h2>
              <p className="max-w-2xl font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">
                Напишите, и соберём Хаконэ под ваш темп. Можно выехать раньше, добавить ночёвку с онсэном или связать маршрут с дорогой в Киото, чтобы день выглядел цельно, а не как компромисс.
              </p>
            </div>
            <div className="flex flex-col gap-3 md:items-end">
              <HakoneCtaButton variant={abVariant} />
              <span className="inline-flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
                Ответ обычно в тот же день
                <ArrowRight className="h-3.5 w-3.5 text-[var(--accent)]" aria-hidden="true" />
              </span>
            </div>
          </section>

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
        </div>
      </section>
    </>
  )
}
