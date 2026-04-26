import type { Metadata } from 'next'
import {
  ArrowRight,
  CarFront,
  Leaf,
  Mountain,
  ScrollText,
  TrainFront,
  UserRound,
  Waves,
} from 'lucide-react'
import { cookies } from 'next/headers'
import { IntercityRouteTimeline } from '@/components/IntercityRouteTimeline'
import { ImageCarousel } from '@/components/sections/ImageCarousel'
import { IntercitySummaryStrip } from '@/components/sections/IntercitySummaryStrip'
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
  'Подходит тем, кто уже провёл день-другой в Токио и хочет на один день выйти из городского ритма. Хаконэ хорош не одной отдельной точкой, а сочетанием озера, святилища, вулканического ландшафта и музея под открытым небом в пределах одного маршрута. По нагрузке это спокойный выезд: много панорам, немного ходьбы, один подъём на канатной дороге. Особенно хорошо маршрут воспринимается парами, семьями с детьми от восьми лет и небольшими компаниями.'

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <div className="space-y-3 md:space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">{eyebrow}</p>
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
        photo: '/tours/hakone/hakone-1.jpg',
        photoAlt: 'Озеро Аси и ворота Хаконэ в тёплом утреннем свете',
      }
    }

    if (stop.title === 'Хаконэ Дзиндзя') {
      return {
        ...stop,
        type: 'landmark' as const,
        arrivalTime: '10:20',
        photo: '/tours/hakone/hakone-1.jpg',
        photoAlt: 'Святилище Хаконэ рядом с озером Аси',
      }
    }

    if (stop.title === 'Круиз по озеру Аси') {
      return {
        ...stop,
        type: 'transport' as const,
        arrivalTime: '11:15',
        photo: '/tours/hakone/hakone-2.jpg',
        photoAlt: 'Круиз по озеру Аси с видом на горы Хаконэ',
      }
    }

    if (stop.title === 'Канатная дорога Хаконэ') {
      return {
        ...stop,
        type: 'transport' as const,
        arrivalTime: '12:00',
        photo: '/tours/hakone/hakone-2.jpg',
        photoAlt: 'Подъём по канатной дороге Хаконэ над долиной',
      }
    }

    if (stop.title === 'Овакудани') {
      return {
        ...stop,
        type: 'nature' as const,
        arrivalTime: '12:35',
        photo: '/tours/hakone/hakone-3.jpg',
        photoAlt: 'Парящая вулканическая долина Овакудани',
      }
    }

    if (stop.title === 'Музей под открытым небом Хаконэ') {
      return {
        ...stop,
        type: 'museum' as const,
        arrivalTime: '14:30',
        photo: '/tours/hakone/hakone-3.jpg',
        photoAlt: 'Скульптуры и горный ландшафт музея под открытым небом Хаконэ',
      }
    }

    return stop
  })

  return (
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
      <div className="mx-auto w-full max-w-6xl space-y-12 md:space-y-16 lg:space-y-20">
        <div className="space-y-8 md:space-y-10">
          <ImageCarousel
            images={['/tours/hakone/hakone-1.jpg', '/tours/hakone/hakone-2.jpg', '/tours/hakone/hakone-3.jpg']}
            alt="Тур в Хаконэ - озеро Аси, Овакудани и канатная дорога"
          />

          <header className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_320px] lg:items-end lg:gap-10">
            <div className="space-y-5 md:space-y-6">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">День и более</p>
                  <span aria-hidden="true" className="h-px w-16 bg-[var(--border)]" />
                </div>
                <h1 className="font-sans text-4xl font-medium tracking-[-0.04em] text-[var(--text)] md:text-5xl">
                  Тур в Хаконэ из Токио
                </h1>
                <p className="text-sm font-medium tracking-[0.01em] text-[var(--accent)]">
                  Тур в Хаконэ из Токио с гидом на русском
                </p>
              </div>

              <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.9] text-[var(--text-muted)] md:text-[16px]">
                {isVariantB
                  ? hakoneVariantB.pageDescription
                  : 'Хаконэ лежит на старом тракте Токайдо, который веками связывал Эдо и Киото. Здесь в пределах одного маршрута соединяются старый путь, озеро Аси, святилище у воды, вулканический ландшафт и музей под открытым небом. В ясную погоду отсюда видно Фудзи. За один день Хаконэ даёт очень цельное впечатление, а если остаться на ночь и добавить онсэн, место воспринимается уже совсем иначе.'}
              </p>

              <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
                {["Природа и пейзажи", "Термальные источники", "Ночёвка", "Для пар", "Традиции и история"].map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">
                    <span className="h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <aside className="space-y-5 rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
              <div className="space-y-2">
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Почему этот маршрут цепляет</p>
                <p className="font-sans text-[15px] font-light leading-[1.82] text-[var(--text-muted)]">
                  Не один музей и не одна смотровая. Здесь день складывается как последовательность сменяющих друг друга сцен: история дороги, вода, подъём, вулканический воздух и финал с искусством на фоне гор.
                </p>
              </div>

              <div className="grid gap-3 text-[12px] text-[var(--text-muted)] sm:grid-cols-2 lg:grid-cols-1">
                {[
                  { icon: ScrollText, label: 'Слой истории', value: 'Токайдо и заставы эпохи Эдо' },
                  { icon: Waves, label: 'Смена ритма', value: 'Озеро, паром и тишина святилища' },
                  { icon: Mountain, label: 'Кульминация', value: 'Овакудани и панорамы Хаконэ' },
                  { icon: Leaf, label: 'Финал дня', value: 'Музей под открытым небом' },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="flex items-start gap-3 border-t border-[var(--border)] pt-3 first:border-t-0 first:pt-0">
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--accent)]">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">{label}</p>
                      <p className="mt-1 font-sans text-[13px] font-light leading-[1.7] text-[var(--text-muted)]">{value}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-1">
                <HakoneCtaButton variant={abVariant} />
              </div>
            </aside>
          </header>
        </div>

        <IntercitySummaryStrip items={getIntercitySummary('hakone')} />

        <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
          <div className="space-y-5">
            <SectionHeading eyebrow="Для кого" title="Кому подходит тур" />
            <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.9] text-[var(--text-muted)] md:text-[16px]">
              {whoItSuits}
            </p>
          </div>

          <aside className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Формат дня</p>
            <div className="mt-3 space-y-3 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
              <p>Ранний выезд из Токио, мягкий темп внутри самого Хаконэ и сильный визуальный ритм без ощущения гонки.</p>
              <p>Если хочется глубже, логично оставить Хаконэ на ночь и добавить онсэн без перепаковки маршрута.</p>
            </div>
          </aside>
        </section>

        <section className="space-y-6 md:space-y-8">
          <SectionHeading
            eyebrow="Journey"
            title="Маршрут по Хаконэ"
            description="Не набор точек, а выстроенная последовательность. От истории старого тракта к воде, подъёму и вулканической долине, затем к искусству на воздухе. Каждую остановку можно раскрыть отдельно."
          />
          <IntercityRouteTimeline stops={timelineStops} />
        </section>

        <section className="space-y-6 md:space-y-8">
          <SectionHeading
            eyebrow="Дополнения"
            title="Что можно включить в маршрут"
            description="Если день хочется сделать мягче, насыщеннее или растянуть на ночь, ниже точки, которые удобно встроить без ощущения случайной добивки программы."
          />
          <PoiSheet pois={helperPois} />
        </section>

        <section className="space-y-6 md:space-y-8">
          <SectionHeading
            eyebrow="Логистика"
            title="Как лучше ехать"
            description="Из Токио в Хаконэ можно добраться поездом или на машине, и этот выбор напрямую влияет на темп дня. Ниже короткая ориентация по форматам, чтобы заранее понять компромисс между стоимостью, гибкостью и комфортом."
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
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Следующий шаг</p>
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
  )
}
