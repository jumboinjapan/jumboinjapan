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
import { buildIntercityRouteStops, getIntercityHelperPois, getIntercitySchematicRoute } from '@/lib/intercity-pois'
import { PoiSheet } from '@/components/PoiSheet'

const tour = tours.find((t) => t.slug === 'from-tokyo/intercity/nikko')!

const BASE_URL = 'https://jumboinjapan.com'
const PAGE_URL = `${BASE_URL}/${tour.slug}`
const PAGE_IMAGE = `${BASE_URL}${tour.image}`

export const metadata: Metadata = {
  title: tour.title,
  description: tour.description,
  alternates: { canonical: 'https://jumboinjapan.com/from-tokyo/intercity/nikko' },
  openGraph: {
    title: `${tour.title} | JumboInJapan`,
    description: tour.description,
    type: 'website',
    url: PAGE_URL,
    locale: 'ru_RU',
    siteName: 'JumboInJapan',
    images: [{ url: PAGE_IMAGE, width: 1200, height: 800, alt: 'Тур в Никко — Тосёгу, водопад Кэгон, горное озеро' }],
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
  provider: { '@type': 'Person', name: 'Eduard Revidovich', url: BASE_URL },
  offers: { '@type': 'Offer', availability: 'https://schema.org/InStock', url: PAGE_URL },
  location: {
    '@type': 'Place',
    name: 'Nikko',
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


const fullRouteStops = [
  {
    eyebrow: 'Врата в Никко',
    title: 'Священный мост Синкё',
    description:
      'Один из трёх самых живописных мостов Японии — архитектурная визитная карточка Никко. По легенде, именно здесь монах Сёдо, перебравшись через реку с помощью божественного змея, впервые ступил на землю Никко и положил начало буддийской традиции в этих горах.',
  },
  {
    eyebrow: 'Мавзолей сёгуна',
    title: 'Святилище Тосёгу',
    description:
      'В отличие от большинства синтоистских храмов с архитектурной скромностью, Тосёгу поражает богатством оформления. Возведённый в XVII веке, он стал воплощением художественного мастерства эпохи. Роскошные ворота, обилие золота, замысловатая резьба и красочная роспись делают его уникальным для японской религиозной архитектуры. Здесь находится мавзолей Токугавы Иэясу, объединившего Японию.',
  },
  {
    eyebrow: 'Мистическая аллея',
    title: 'Аллея исчезающих Будд «Канмангафути»',
    description:
      'Тихий лесной уголок на берегу горной реки. Здесь находится таинственная Аллея Бездны со статуями Дзидзо — покровителей душ умерших детей и путников. Феномен этого места: каждый раз количество фигур кажется разным, пересчитать их невозможно.',
  },
  {
    eyebrow: 'Горное озеро',
    title: 'Горное озеро Тюдзэндзи',
    description:
      'Природная жемчужина Никко у подножия священной горы Нантайсан. Вдоль береговой линии проложены прогулочные тропы. Под вечер здесь нередко появляются японские макаки, олени и кабаны.',
  },
  {
    eyebrow: 'Водопад',
    title: 'Водопад Кэгон',
    description:
      'Природный символ Никко, один из трёх величайших водопадов Японии. Его мощный поток обрушивается с высоты более 100 метров, питаясь из горного озера Тюдзэндзи. Особенно впечатляет осенью, когда склоны окрашиваются в багряные оттенки.',
  },
]

const schematicRoute = getIntercitySchematicRoute('nikko', fullRouteStops)



const nikkoPoiDescriptionOverrides: Record<string, string> = {
  'POI-000232': 'Исторический деревянный дом, с которого началась история легендарного отеля Kanaya. Хорошая остановка, чтобы увидеть раннюю западно-японскую архитектуру Никко без музейной тяжеловесности.',
  'POI-000229': 'Смотровая площадка над серпантином Ирохадзака и долиной Оку-Никко. Сюда приезжают ради панорамы на горы, озеро и осенние клёны.',
  'POI-000230': 'Старинный храм на берегу озера Тюдзэндзи, связанный с культом горы Нантай. Внутри хранится почитаемая деревянная статуя Каннон.',
  'POI-000224': 'Высокогорное болото с деревянными настилами и длинными прогулочными тропами. Одно из самых спокойных мест Оку-Никко — особенно красиво в сезон трав и осеннего цвета.',
  'POI-000222': 'Бывшая императорская летняя резиденция, где японские интерьеры сочетаются с деталями западной эпохи Мэйдзи. Один из крупнейших сохранившихся деревянных дворцовых комплексов в стране.',
  'POI-000219': 'Главный буддийский храм Никко, известный залом Санбуцудо с тремя монументальными позолоченными статуями. Рядом находятся сокровищница и сад Сёёэн, особенно красивый осенью.',
  'POI-000231': 'Широкий каскадный водопад в лесистой части Никко, особенно эффектный в начале сезона красных клёнов. С обзорной площадки видно, почему его сравнивают с расправленными струями тумана.',
  'POI-000221': 'Горный онсэн-курорт в глубине национального парка Никко, известный молочно-белой серной водой. Сюда едут за тишиной, паром и ощущением настоящего японского курорта.',
  'POI-000223': 'Старейший ботанический сад Никко, созданный для изучения альпийских растений. Здесь тихие дорожки, редкие горные виды и хороший ритм для неспешной прогулки.',
  'POI-000226': 'Один из самых выразительных водопадов Оку-Никко, особенно яркий в начале октября. Небольшая смотровая площадка и тропа вдоль реки дают несколько сильных ракурсов подряд.',
  'POI-000218': 'Мавзолей сёгуна Токугавы Иэмицу — более сдержанный, чем Тосёгу, но не менее впечатляющий по резьбе и композиции. Хороший выбор для тех, кто хочет увидеть никкоскую храмовую архитектуру без толпы.',
  'POI-000061': 'Одно из ключевых святилищ Никко, посвящённое горам региона и древнему культу Футарасан. Атмосфера здесь заметно спокойнее, чем у соседнего Тосёгу.',
  'POI-000228': 'Популярная смотровая точка над озером Тюдзэндзи, куда едут ради широкого вида на озеро и окружающие хребты. Осенью это одно из самых фотогеничных мест в Оку-Никко.',
}

const whoItSuits = 'Для тех, кому в Японии важна история, а не Instagram. Тосёгу — один из самых перегруженных деталями храмовых комплексов в стране, горные водопады, осенью — клёны такого цвета, что кажется, кто-то переусердствовал с насыщенностью. Тихо, немноголюдно, требует внимания.'

export default async function NikkoPage() {
  const [pois, cityData] = await Promise.all([
    getPoisByCity('nikko'),
    getCityData('CTY-0003'),
  ])

  const guideFlexibility = cityData.hasNonCarSegments ? 3 : 4

  const transportOptions = [
    { title: 'Общественный транспорт', Icon: TrainFront, scores: { стоимость: 2, гибкость: 1, комфорт: 2 } },
    { title: 'Гид-водитель', Icon: UserRound, scores: { стоимость: 4, гибкость: guideFlexibility, комфорт: 4 } },
    { title: 'Лимузин-сервис', Icon: CarFront, scores: { стоимость: 5, гибкость: 5, комфорт: 5 } },
  ]

  const routeStops = buildIntercityRouteStops('nikko', fullRouteStops, pois)
  const helperPois = getIntercityHelperPois('nikko', pois)

  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      <div className="mx-auto w-full max-w-6xl space-y-12 md:space-y-14">
        <ImageCarousel
          images={['/tours/nikko/nikko-1.jpg', '/tours/nikko/nikko-2.jpg', '/tours/nikko/nikko-3.jpg']}
          alt="Тур в Никко — Тосёгу, водопад Кэгон, горное озеро"
        />

        <header className="space-y-4 md:space-y-5">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">День</p>
          <h1 className="font-sans text-3xl font-medium tracking-[-0.02em] md:text-4xl">Тур в Никко из Токио</h1>
          <p className="text-sm font-medium tracking-[0.01em] text-[var(--accent)]">
            Тур в Никко из Токио с гидом на русском
          </p>
          <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.82] text-[var(--text-muted)]">
            Для тех, кто ценит природу и историческую глубину Японии, Никко — одно из наиболее насыщенных направлений. Этот регион, духовный центр страны и родина японского горного буддизма, сохранил подлинную атмосферу уединения и традиций. Здесь покоится основатель сёгуната Токугава — великий государственный деятель Токугава Иэясу. Курорт также известен термальными источниками и кулинарными изысками, включая знаменитые соевые сливки юба и озёрную форель.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
            {['Природа и пейзажи', 'Горный буддизм', 'Водопады', 'Традиции и история', 'Осенние клёны'].map((tag) => (
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
            stops={routeStops}
          />
        </section>

        {helperPois.length > 0 && (
          <section className="space-y-6">
            <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">Что можно включить в маршрут</h2>
            <PoiSheet pois={helperPois} descriptionOverrides={nikkoPoiDescriptionOverrides} />
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
              { title: 'Хаконэ', href: '/from-tokyo/intercity/hakone' },
              { title: 'Камакура', href: '/from-tokyo/intercity/kamakura' },
              { title: 'Гора Фудзи', href: '/from-tokyo/intercity/fuji' },
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
