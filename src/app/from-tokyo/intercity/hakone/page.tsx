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
      'Восстановленная застава на старом тракте Токайдо. В эпоху Эдо (1603–1868) здесь контролировали въезд в горный регион — место читается просто, без лишних объяснений.',
  },
  {
    eyebrow: 'Святилище у воды',
    title: 'Хаконэ Дзиндзя',
    description:
      'Святилище в кедровом лесу у берега озера Аси. Торий уходит прямо в воду — один из тех видов, которые работают без предисловий.',
  },
  {
    eyebrow: 'Круиз по озеру',
    title: 'Круиз по озеру Аси',
    description:
      'Короткий переход по воде — и Фудзи, если повезёт с погодой, видна целиком. Одна из тех точек маршрута, где ничего не нужно искать взглядом.',
  },
  {
    eyebrow: 'Подъём',
    title: 'Канатная дорога Хаконэ',
    description:
      'Не просто способ добраться до Овакудани. С высоты видно, что весь Хаконэ — внутри кратера: горные хребты, долины, озеро внизу.',
  },
  {
    eyebrow: 'Вулканическая долина',
    title: 'Овакудани',
    description:
      'Самая узнаваемая точка Хаконэ: серный пар, активные фумаролы, чёрные яйца из кипящих источников. Место, которое не нуждается в комментариях.',
  },
  {
    eyebrow: 'Искусство под открытым небом',
    title: 'Музей под открытым небом Хаконэ',
    description:
      'После вулканической долины — скульптуры на склоне, открытый воздух, другой темп. В конце дня, когда всё уже увидено, здесь можно просто ходить.',
  },
]

const whoItSuits =
  'Хаконэ не рассчитан на один тип путешественника. Природа, история и искусство здесь стоят рядом, а не в разных залах. Маршрут за день несколько раз меняет тон: от заставы на старом тракте — к озеру, от озера — к вулканическим склонам, оттуда — к музею под открытым небом. Особенно хорошо ложится, если вы совмещаете Хаконэ с Фудзи и не хотите превращать поездку в спринт.'

const transportOptions = [
  {
    title: 'Общественный транспорт',
    description:
      'Для Хаконэ это рабочий формат: поезд, корабль, канатная дорога и локальные переезды складываются в цельный день. Подходит тем, кому интересен сам опыт перемещения по региону.',
    note: 'Хорошо подходит, если важен сам опыт Хаконэ как системы пересадок и видов.',
    summary: 'Подходит тем, кому интересен сам процесс: поезд, корабль, канатная дорога — Хаконэ как маршрут.',
    Icon: TrainFront,
  },
  {
    title: 'Организация индивидуального транспорта',
    description:
      'Спокойнее и гибче: не нужно подстраиваться под пересадки, очереди и погодные окна. Удобнее, если важны ровный темп, семья, багаж или запас сил на сами места.',
    note: 'Логистика подстраивается под ваш темп — не под расписание.',
    summary: 'Более ровный темп и меньше организационной нагрузки по ходу дня.',
    Icon: UserRound,
  },
  {
    title: 'Автомобиль с водителем',
    description:
      'Для тех, кому нужен именно водитель: своя посадка, своё расписание, минимум переходов. День устроен иначе, чем при аренде машины — детали лучше согласовать заранее.',
    note: 'Подходит, если приоритет — удобная посадка, меньше переходов и предсказуемый темп.',
    summary: 'Максимум комфорта и предсказуемости, когда важны посадка, ритм и минимум лишних переходов.',
    Icon: CarFront,
  },
]

const optionalPoiDescriptions: Record<string, string> = {
  'Парк Онси Хаконэ': 'Тихая видовая точка над озером, если нужен воздух, пауза и хороший ракурс без лишнего шума.',
  'Святилище Хаконэ Дзиндзя': 'Остановка у воды и в кедрах — если хочется больше тишины, чем музейной программы.',
  'Горячие источники Хаконэ': 'Короткий онсэн или долгая пауза в конце дня — хороший способ закончить маршрут.',
  'Художественный музей Пола': 'Камерный музей с сильной архитектурой — можно заменить или дополнить открытый музей в конце маршрута.',
  'Музей искусства Окада': 'Большая коллекция и спокойный темп — для тех, кому ближе музейный день, чем пеший.',
  'Художественный музей Нарукава': 'Подходит, если хочется объединить музейную паузу с одним из лучших видов на озеро Аси.',
  'Музей венецианского стекла': 'Лёгкая декоративная остановка — другой визуальный тон, когда хочется контраста.',
  'Художественный музей Хаконэ': 'Небольшой музей с садом и керамикой — тихая культурная остановка без масштаба.',
  'Парк Гора': 'Зелёная пауза рядом с центральной частью маршрута — передохнуть между переездами.',
  'Храм Тёандзи': 'В стороне от основного потока — для тех, кому важнее тишина, чем обязательная программа.',
  'Поле серебряных трав Сэнгокухара': 'Осенью здесь особенно хорошо — простор, мягкий свет и серебряная трава до горизонта.',
  'Аутлет Готэмба': 'Отдельная опция по логистике — если в этот день важен шопинг и вид на Фудзи, а не только классический маршрут.',
  'Замок Одавара': 'Удобно добавить на входе или выходе из маршрута — усиливает историческую часть дня.',
  'Ботанический сад Хаконэ': 'Спокойная природная опция для любителей ботаники и менее очевидных остановок.',
  'Обсерватория Эноура': 'Архитектура Сугимото Хироси на обрыве над океаном — если маршрут можно расширить в сторону авторского опыта.',
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
            Старый тракт Токайдо, кедровое святилище у воды, вулканические склоны с серным
            дымом, скульптуры на горном воздухе — и всё это за один день. Регион небольшой,
            но не однообразный.
          </p>
        </header>

        <section className="space-y-6">
          <div className="space-y-3">
            <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">
              Рекомендованная схема маршрута
            </h2>
            <p className="max-w-[64ch] font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
              Последовательность ниже — так день обычно собирается без лишних возвратов
              и с естественным финалом.
            </p>
          </div>

          <div className="rounded-sm border border-[var(--border)] bg-[var(--bg)] p-5 md:p-6">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)] lg:items-start">
              <div className="space-y-3 border-b border-[var(--border)] pb-5 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6">
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--accent)]">
                  Логика дня
                </p>
                <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
                  Начинаем с исторической и озёрной части. Заканчиваем там, где ритм
                  самый спокойный: искусство и прогулка.
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
                Хаконэ удобно совмещать с{' '}
                <Link
                  href="/from-tokyo/intercity/fuji"
                  className="text-[var(--accent)] underline-offset-2 hover:underline"
                >
                  Фудзи
                </Link>
                : после дня у горы ночёвка здесь избавляет от лишнего переезда обратно в Токио. А если Хаконэ — отдельный дневной маршрут, после него удобно уходить в сторону Киото.
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
              Хаконэ — один из немногих японских маршрутов, где общественный транспорт
              интересен сам по себе. Но он подойдёт не всем — три варианта ниже устроены
              по-разному.
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
              Как день раскрывается целиком
            </h2>
            <p className="max-w-[68ch] font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
              Как день складывается на самом деле: откуда начинать, как переходы связаны
              между собой и где у маршрута естественный финал.
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
              Если хочется задержаться в Хаконэ, добавить ещё одну остановку
              или сместить акцент дня.
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
