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
import { buildIntercityRouteStops, getIntercityHelperPois } from '@/lib/intercity-pois'
import { PoiSheet } from '@/components/PoiSheet'

const tour = tours.find((t) => t.slug === 'from-tokyo/intercity/kyoto-2')!

const BASE_URL = 'https://jumboinjapan.com'
const PAGE_URL = `${BASE_URL}/${tour.slug}`
const PAGE_IMAGE = `${BASE_URL}${tour.image}`

export const metadata: Metadata = {
  title: tour.title,
  description: tour.description,
  alternates: { canonical: 'https://jumboinjapan.com/from-tokyo/intercity/kyoto-2' },
  openGraph: {
    title: `${tour.title} | JumboInJapan`,
    description: tour.description,
    type: 'website',
    url: PAGE_URL,
    locale: 'ru_RU',
    siteName: 'JumboInJapan',
    images: [{ url: PAGE_IMAGE, width: 1200, height: 800, alt: 'Киото — Гинкакудзи, Философская тропа, Нандзэн-дзи' }],
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
    name: 'Kyoto',
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
    eyebrow: 'Серебряный павильон',
    title: 'Гинкакудзи',
    description:
      '«Серебряный павильон» — буддийский храм конца XV века, построенный сёгуном Асикага Ёсимаса как загородная резиденция. Несмотря на название, павильон никогда не был покрыт серебром — «серебряный» оттенок связан с отражением лунного света. Символ эстетики ваби-саби. Вокруг — знаменитый сад с белым песком, мхом, камнями и соснами.',
  },
  {
    eyebrow: 'Прогулка вдоль канала',
    title: 'Философская тропа',
    description:
      'Одна из самых живописных прогулочных дорог Киото, протянувшаяся вдоль канала у подножия Восточных гор. Названа в честь философа Нисиды Китаро. Особенно красива в сезон сакуры и багряных клёнов. По пути — кафе, галереи и небольшое святилище Отойо дзиндзя с каменными фигурами мышей — символов учёности и долголетия.',
  },
  {
    eyebrow: 'Обитель клёнов',
    title: 'Эйкандо (Зэнрин-дзи)',
    description:
      '«Обитель клёнов» — храм IX века, прославившийся в XI столетии настоятелем Эйканом, помогавшим бедным и больным. Особая гордость — статуя «оглядывающегося Будды», крайне редкий образ в японском буддийском искусстве. Осенью здесь расстилается огненный ковёр из багряных листьев.',
  },
  {
    eyebrow: 'Главный монастырь Риндзай',
    title: 'Нандзэн-дзи',
    description:
      'Главный монастырь школы Риндзай, основан в XIII веке по воле императора Камэяма. У входа — массивные деревянные ворота Санмон, с верхней галереи которых открывается знаменитый вид на Киото. На территории — каменный сад в строгом дзэнском стиле и необычный кирпичный акведук XIX века.',
  },
  {
    eyebrow: 'Дзэнский храм',
    title: 'Храм Тэнрюдзи',
    description:
      'Тэнрюдзи — главный храм школы Риндзай в Арасияме, основан в 1339 году сёгуном Асикага Такаудзи. Сад Содзэн-ин, созданный мастером Мусо Сосэки, считается одним из первых садов в стиле «заимствованного пейзажа» — горы Арасияма служат естественным фоном. Храм включён в список объектов Всемирного наследия ЮНЕСКО и является отправной точкой для прогулки по бамбуковой роще.',
  },
  {
    eyebrow: 'Бамбуковый лес',
    title: 'Арасияма',
    description:
      'Одно из самых поэтичных мест Киото, излюбленный уголок столичной аристократии ещё в эпоху Хэйан. Мост Тогэцу-кё, дзэнский храм Тэнрюдзи, бамбуковый лес Сагано. Также здесь — музей старинных кукол, вилла императора Го Сага, сад мхов Сайходзи, парк с дикими обезьянами и храм Отаги Нэнбуцудзи с тысячью архатов. Арасияма удалена от центра — закладывайте минимум полдня.',
  },
]



const whoItSuits = 'Для тех, кто уже видел открыточный Киото и хочет копнуть глубже. Фусими Инари на рассвете, бамбуковая роща Арасиямы, чайная церемония без туристического глянца — день для тех, у кого есть вопросы, а не только камера. Темп медленнее, ощущения точнее.'

export default async function KyotoSecondPage() {
  const [pois, cityData] = await Promise.all([
    getPoisByCity('kyoto'),
    getCityData('CTY-0008'),
  ])

  const guideFlexibility = cityData.hasNonCarSegments ? 3 : 4

  const transportOptions = [
    { title: 'Общественный транспорт', Icon: TrainFront, scores: { стоимость: 2, гибкость: 1, комфорт: 2 } },
    { title: 'Гид-водитель', Icon: UserRound, scores: { стоимость: 4, гибкость: guideFlexibility, комфорт: 4 } },
    { title: 'Лимузин-сервис', Icon: CarFront, scores: { стоимость: 5, гибкость: 5, комфорт: 5 } },
  ]

  const routeStops = buildIntercityRouteStops('kyoto-2', fullRouteStops, pois)
  const helperPois = getIntercityHelperPois('kyoto-2', pois)

  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      <div className="mx-auto w-full max-w-6xl space-y-12 md:space-y-14">
        <ImageCarousel
          images={['/tours/kyoto-1/kyoto-2.jpg', '/tours/kyoto-2/kyoto-1.jpg', '/tours/kyoto-2/kyoto-3.jpg']}
          alt="Киото — Серебряный павильон, Арасияма, Философская тропа"
        />

        <header className="space-y-4 md:space-y-5">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">День</p>
          <h1 className="font-sans text-3xl font-medium tracking-[-0.02em] md:text-4xl">Тур в Киото из Токио. Второй день</h1>
          <p className="text-sm font-medium tracking-[0.01em] text-[var(--accent)]">
            Тур по Киото с русскоязычным гидом
          </p>
          <p className="max-w-3xl font-sans text-[15px] font-light leading-[1.82] text-[var(--text-muted)]">
            Очень сложно охватить всё самое интересное за один день. Продолжаем покорять древнюю столицу Японии.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
            {['Дзэн-буддизм', 'Философия', 'Бамбуковый лес', 'Природа и пейзажи', 'Осенние клёны', 'Пешие прогулки'].map((tag) => (
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
            <PoiSheet pois={helperPois} />
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
              { title: 'Киото. Первое знакомство', href: '/from-tokyo/intercity/kyoto-1' },
              { title: 'Удзи', href: '/from-tokyo/intercity/uji' },
              { title: 'Нара', href: '/from-tokyo/intercity/nara' },
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
