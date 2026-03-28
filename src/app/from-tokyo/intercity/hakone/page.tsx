import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  CarFront,
  ChevronRight,
  Route,
  TrainFront,
  UserRound,
  Waves,
} from 'lucide-react'
import { ImageCarousel } from '@/components/sections/ImageCarousel'
import { PoiSection } from '@/components/sections/PoiSection'
import { tours } from '@/data/tours'
import poisData from '@/data/pois/hakone.json'

const tour = tours.find((t) => t.slug === 'from-tokyo/intercity/hakone')!

const BASE_URL = 'https://jumboinjapan.com'
const PAGE_URL = `${BASE_URL}/${tour.slug}`
const PAGE_IMAGE = `${BASE_URL}${tour.image}`

export const metadata: Metadata = {
  title: tour.title,
  description: tour.description,
  alternates: {
    canonical: '/from-tokyo/intercity/hakone',
  },
  openGraph: {
    title: `${tour.title} | JumboInJapan`,
    description: tour.description,
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
      name: 'Из Токио',
      item: `${BASE_URL}/from-tokyo`,
    },
    {
      '@type': 'ListItem',
      position: 3,
      name: 'Загородные туры',
      item: `${BASE_URL}/from-tokyo/intercity`,
    },
    {
      '@type': 'ListItem',
      position: 4,
      name: tour.title,
      item: PAGE_URL,
    },
  ],
}

const schematicRoute = [
  'Застава Хаконэ Сэкисё',
  'Хаконэ Дзиндзя',
  'Круиз по озеру Аси',
  'Канатная дорога Хаконэ',
  'Овакудани',
  'Музей под открытым небом Хаконэ',
]

// planningContext rendered in JSX with inline links (see below)

const fullRouteStops = [
  {
    eyebrow: 'Экскурс в историю',
    title: 'Застава Хаконэ Сэкисё',
    description:
      'Восстановленная застава на тракте Токайдо. В эпоху Эдо (1603–1868) здесь проверяли документы у каждого, кто шёл через горы. Сейчас внутри музей, а вокруг — тот же лес и тот же вид на озеро.',
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
      'Переход на кораблике занимает около получаса. В ясную погоду с воды видно Фудзи целиком. Это заодно и переезд к канатной дороге на другом берегу.',
  },
  {
    eyebrow: 'Подъём',
    title: 'Канатная дорога Хаконэ',
    description:
      'Подъём от озера к Овакудани. С кабинки видно масштаб кальдеры: горные хребты вокруг, долина внизу, озеро позади. Едешь минут двадцать.',
  },
  {
    eyebrow: 'Вулканическая долина',
    title: 'Овакудани',
    description:
      'Активная вулканическая зона: из земли идёт серный пар, в горячих источниках варят чёрные яйца. Пахнет серой, под ногами жёлтая порода. Самая необычная точка маршрута.',
  },
  {
    eyebrow: 'Искусство под открытым небом',
    title: 'Музей под открытым небом Хаконэ',
    description:
      'Музей скульптуры на открытом воздухе. После вулканической долины тут спокойно — газоны, работы Генри Мура и Пикассо, хороший вид на горы. Удобное место для завершения дня.',
  },
]

const whoItSuits =
  'Хаконэ подходит тем, кто хочет за один день увидеть разное: историю, озеро, вулкан, музей. День несколько раз меняет темп — от тихой заставы к воде, от воды к серным фумаролам, оттуда к скульптурам на траве. Удобно совмещать с поездкой к Фудзи, чтобы не возвращаться в Токио в тот же вечер.'

const transportOptions = [
  {
    title: 'Общественный транспорт',
    description:
      'Поезд до Хаконэ, кораблик по озеру, канатная дорога к Овакудани — пересадки сами становятся частью маршрута. Есть проездной Hakone Free Pass, который покрывает всё.',
    note: 'Дешевле всего и интересно само по себе, но требует внимания к расписанию.',
    summary: 'Поезд, кораблик, канатная дорога — пересадки здесь часть маршрута.',
    Icon: TrainFront,
  },
  {
    title: 'Организация индивидуального транспорта',
    description:
      'Не нужно следить за расписанием и стоять в очередях на пересадки. Удобнее с детьми, багажом или если хочется гибко менять порядок остановок.',
    note: 'Маршрут подстраивается под вас, а не наоборот.',
    summary: 'Свободный график и никаких очередей на пересадки.',
    Icon: UserRound,
  },
  {
    title: 'Автомобиль с водителем',
    description:
      'Водитель забирает утром и возвращает вечером. Не нужно ни парковки искать, ни разбираться с навигацией. Стоит дороже, но убирает всю логистику.',
    note: 'Самый простой вариант, если бюджет позволяет.',
    summary: 'Водитель берёт логистику на себя — вы только выбираете, куда заехать.',
    Icon: CarFront,
  },
]

const optionalPoiDescriptions: Record<string, string> = {
  'Парк Онси Хаконэ': 'Смотровая площадка над озером. Людей мало, вид на воду и горы. Минут двадцать на прогулку.',
  'Святилище Хаконэ Дзиндзя': 'Если основной маршрут не включает святилище — можно добавить отдельно. Рядом с причалом, занимает полчаса.',
  'Горячие источники Хаконэ': 'Онсэн в конце дня. Можно зайти на час или взять рёкан с купальнями на ночь.',
  'Художественный музей Пола': 'Частный музей с коллекцией импрессионистов. Здание стоит в лесу, архитектура сама по себе стоит визита.',
  'Музей искусства Окада': 'Большая коллекция японского и восточноазиатского искусства. Подходит, если хочется провести в музее пару часов.',
  'Художественный музей Нарукава': 'Японская живопись нихонга и панорамный вид на озеро Аси из зала. Небольшой, на полчаса-час.',
  'Музей венецианского стекла': 'Коллекция венецианского стекла XV–XIX веков. Место нетипичное для Хаконэ, но детям и любителям декоративного искусства нравится.',
  'Художественный музей Хаконэ': 'Керамика и японский сад. Маленький музей, минут на сорок.',
  'Парк Гора': 'Парк рядом со станцией Гора. Можно посидеть между переездами, есть розарий и теплица.',
  'Храм Тёандзи': 'Тихий дзэн-буддийский храм в стороне от туристических точек. Есть сухой сад.',
  'Поле серебряных трав Сэнгокухара': 'Осенью поле покрыто серебристым мискантом — выглядит эффектно, особенно на закате.',
  'Аутлет Готэмба': 'Большой аутлет у подножия Фудзи. Логистически проще добавить по дороге в Хаконэ или обратно.',
  'Замок Одавара': 'Замок XV века в городе Одавара. Удобно заехать по дороге в Хаконэ или на обратном пути.',
  'Ботанический сад Хаконэ': 'Ботанический сад с болотными растениями и горной флорой. Для тех, кому это интересно.',
  'Обсерватория Эноура': 'Культурный комплекс архитектора Сугимото Хироси на берегу океана. В стороне от Хаконэ, но можно совместить.',
}

const excludedPoiNames = [
  'Застава Хаконэ Сэкисё',
  'Озеро Аси',
  'Святилище Хаконэ Дзиндзя',
  'Канатная дорога Хаконэ',
  'Овакудани',
  'Музей под открытым небом',
  'Музей под открытым небом Хаконэ',
  'Горячие источники Хаконэ',
  'Парк Онси Хаконэ',
]

export default function HakonePage() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <div className="mx-auto w-full max-w-6xl space-y-12 md:space-y-14">
        <ImageCarousel
          images={['/tours/hakone/hakone-1.jpg', '/tours/hakone/hakone-2.jpg', '/tours/hakone/hakone-3.jpg']}
          alt="Тур в Хаконэ - озеро Аси, Овакудани и канатная дорога"
        />

        <header className="space-y-4 md:space-y-5">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">День и более</p>
          <h1 className="font-sans text-3xl font-medium tracking-[-0.02em] md:text-4xl">Хаконэ</h1>
          <p className="max-w-[64ch] font-sans text-[15px] font-light leading-[1.82] text-[var(--text-muted)]">
            За один день — застава на тракте Токайдо, святилище на берегу озера, вулканическая
            долина с фумаролами и музей скульптуры. Места разные, но маршрут собирается
            компактно.
          </p>
        </header>

        <section className="space-y-6">
          <div className="space-y-3">
            <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">
              Рекомендованная схема маршрута
            </h2>
            <p className="max-w-[64ch] font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
              Порядок, в котором удобнее всего проходить маршрут. Каждая следующая
              точка по пути, возвращаться не нужно.
            </p>
          </div>

          <div className="rounded-sm border border-[var(--border)] bg-[var(--bg)] p-5 md:p-6">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)] lg:items-start">
              <div className="space-y-3 border-b border-[var(--border)] pb-5 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6">
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--accent)]">
                  Логика дня
                </p>
                <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
                  Сначала история и озеро, потом подъём к вулкану, в конце —
                  музей скульптуры. Маршрут идёт в одном направлении, без возвратов.
                </p>
              </div>

              <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {schematicRoute.map((stop, index) => (
                  <li
                    key={stop}
                    className="group flex min-h-24 rounded-sm border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--accent)]"
                  >
                    <div className="flex items-start gap-3">
                      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[12px] font-medium text-[var(--text-muted)] transition-colors group-hover:border-[var(--accent)] group-hover:text-[var(--accent)]">
                        {index + 1}
                      </span>
                      <div className="space-y-2">
                        <p className="font-sans text-[15px] font-light leading-[1.65] text-[var(--text)]">
                          {stop}
                        </p>
                        {index < schematicRoute.length - 1 && (
                          <div className="inline-flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
                            <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                            Дальше по маршруту
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">
            Кому подойдёт
          </h2>
          <article className="rounded-sm border border-[var(--border)] bg-[var(--bg)] px-5 py-5 md:px-6">
            <div className="space-y-4">
              <p className="max-w-[72ch] font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">
                {whoItSuits}
              </p>
              <p className="max-w-[72ch] font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">
                Хорошо сочетается с{' '}
                <Link
                  href="/from-tokyo/intercity/fuji"
                  className="text-[var(--accent)] underline-offset-2 hover:underline"
                >
                  поездкой к Фудзи
                </Link>
                : можно переночевать в Хаконэ вместо того, чтобы возвращаться в Токио. А если Хаконэ — отдельная дневная поездка, отсюда удобно ехать дальше в сторону Киото.
              </p>
            </div>
          </article>
        </section>

        <section className="space-y-6">
          <div className="space-y-2">
            <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">
              Логистика
            </h2>
            <p className="max-w-[68ch] font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
              Три способа проехать маршрут. Отличаются по цене, гибкости
              и количеству усилий в течение дня.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {transportOptions.map(({ title, description, note, summary, Icon }) => (
              <article
                key={title}
                className="flex h-full flex-col rounded-sm border border-[var(--border)] bg-[var(--bg)] p-5 transition-colors hover:border-[var(--accent)] focus-within:border-[var(--accent)] md:p-6"
              >
                <div className="flex items-start gap-4">
                  <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--accent)] transition-colors">
                    <Icon aria-hidden="true" className="h-5 w-5" />
                  </span>
                  <div className="space-y-2">
                    <h3 className="font-sans text-[18px] font-medium leading-[1.3] tracking-[-0.01em]">
                      {title}
                    </h3>
                    <p className="font-sans text-[14px] font-light leading-[1.75] text-[var(--text-muted)]">
                      {summary}
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex flex-1 flex-col border-t border-[var(--border)] pt-4">
                  <p className="font-sans text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
                    {description}
                  </p>
                  <p className="mt-4 inline-flex w-fit items-center gap-2 rounded-full border border-[var(--border)] px-3 py-2 text-[12px] font-light leading-[1.5] text-[var(--text-muted)]">
                    <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-[var(--accent)]" />
                    {note}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="space-y-6">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 text-[var(--accent)]">
              <Route aria-hidden="true" className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-[0.12em]">Полный маршрут</span>
            </div>
            <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">
              Что на каждой остановке
            </h2>
            <p className="max-w-[68ch] font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
              Каждая точка маршрута по порядку: что там, сколько времени занимает
              и как связана со следующей.
            </p>
          </div>

          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {fullRouteStops.map((stop) => (
              <article
                key={stop.title}
                className="flex h-full flex-col rounded-sm border border-[var(--border)] bg-[var(--bg)] px-5 py-5"
              >
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--accent)]">
                  {stop.eyebrow}
                </p>
                <h3 className="mt-2 font-sans text-[20px] font-medium leading-[1.25] tracking-[-0.01em]">
                  {stop.title}
                </h3>
                <p className="mt-3 font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
                  {stop.description}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="space-y-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-[var(--accent)]">
              <Waves aria-hidden="true" className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-[0.12em]">
                Популярные точки поблизости
              </span>
            </div>
            <p className="max-w-[68ch] font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
              Можно добавить к основному маршруту или заменить одну из остановок,
              если есть время.
            </p>
          </div>

          <PoiSection
            pois={poisData.pois as any}
            title="Что можно включить в маршрут"
            compact
            excludeNames={excludedPoiNames}
            descriptionOverrides={optionalPoiDescriptions}
          />
        </section>

        <Link
          href="/contact"
          className="inline-flex min-h-11 items-center text-sm font-medium tracking-wide text-[var(--text)] transition-colors hover:text-[var(--accent)] hover:underline focus-visible:text-[var(--accent)] focus-visible:underline"
        >
          Связаться →
        </Link>
      </div>
    </section>
  )
}
