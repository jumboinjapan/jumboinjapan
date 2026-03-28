import type { Metadata } from 'next'
import Link from 'next/link'
import {
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

export const metadata: Metadata = {
  title: tour.title,
  description: tour.description,
  alternates: {
    canonical: '/from-tokyo/intercity/hakone',
  },
  openGraph: {
    title: `${tour.title} | JumboInJapan`,
    description: tour.description,
    images: [{ url: tour.image }],
  },
}

const tourSchema = {
  '@context': 'https://schema.org',
  '@type': 'TouristTrip',
  name: 'Тур в Хаконэ',
  alternateName: 'Hakone',
  description: tour.description,
  inLanguage: 'ru',
  image: 'https://jumboinjapan.com/tours/hakone/hakone-1.jpg',
  duration: 'P1D',
  touristType: 'Russian-speaking tourists',
  provider: {
    '@type': 'Person',
    name: 'Eduard Revidovich',
    url: 'https://jumboinjapan.com',
  },
  offers: {
    '@type': 'Offer',
    availability: 'https://schema.org/InStock',
    url: `https://jumboinjapan.com/${tour.slug}`,
  },
}

const schematicRoute = [
  'Одавара или Хаконэ-Юмото',
  'Озеро Аси',
  'Святилище Хаконэ или старая дорога Токайдо',
  'Канатная дорога',
  'Овакудани',
  'Музей под открытым небом',
  'Онсэн или спокойная финальная остановка',
]

const fullRouteStops = [
  {
    eyebrow: 'Вход в день',
    title: 'Озеро Аси и круиз',
    description:
      'Кальдера вулкана, тёмная вода и редкая для Японии пространность. В ясный день Фудзи появляется прямо в такелаже, а сам переход по озеру собирает весь ландшафт в одну панораму.',
  },
  {
    eyebrow: 'Исторический слой',
    title: 'Святилище Хаконэ и старая дорога Токайдо',
    description:
      'Эта часть маршрута добавляет глубину: кедры, старая дорога, тихие участки у воды и ощущение, что Хаконэ — это не только видовые точки, но и старый проход между регионами.',
  },
  {
    eyebrow: 'Рельеф и движение',
    title: 'Канатная дорога Хаконэ',
    description:
      'Подъём здесь важен не только как транспорт. Это момент, когда маршрут буквально перестраивается по высоте, а озеро, гребни и вулканическая зона начинают читаться как единая система.',
  },
  {
    eyebrow: 'Геология',
    title: 'Овакудани',
    description:
      'Активная вулканическая зона с серными парами, кипящими склонами и тем самым запахом, который чувствуешь раньше, чем видишь. Это та часть Хаконэ, где геология перестаёт быть абстракцией.',
  },
  {
    eyebrow: 'Финальный акцент',
    title: 'Музей под открытым небом',
    description:
      'Одна из лучших остановок в Хаконэ, если хочется не только видов, но и масштаба. Скульптура, склон холма, павильон Пикассо и ванночки для ног — редкое место, где искусство и пейзаж действительно работают вместе.',
  },
  {
    eyebrow: 'По ситуации',
    title: 'Онсэн, парк Онси или спокойная завершающая точка',
    description:
      'Финал я обычно подбираю под темп дня: кому-то важен короткий онсэн, кому-то — воздух и вид, кому-то — ещё одна тихая остановка без суеты. Здесь маршрут мягко закрывается, а не обрывается.',
  },
]

const whoItSuits =
  'Тем, кто любит маршруты, где природа, история и искусство работают вместе; тем, кто хочет увидеть Хаконэ не только как открытку с Фудзи, но и как живой, немного странный и очень разный регион — с водой, серой, старой дорогой, музеем и хорошей тишиной.'

const transportOptions = [
  {
    title: 'Общественный транспорт',
    description:
      'Для Хаконэ это рабочий и уместный формат: поезд, корабль, канатная дорога и локальные переезды можно собрать в цельный день, если вам ближе маршрут в естественном ритме региона.',
    note: 'Хорошо подходит, если важен сам опыт Хаконэ как системы пересадок и видов.',
    Icon: TrainFront,
  },
  {
    title: 'Индивидуальная транспортная организация',
    description:
      'Более спокойный и гибкий формат для тех, кто не хочет подстраиваться под пересадки, очереди и погодные окна. Обычно он удобнее, если важны ровный темп, семья, багаж или запас сил на сами места.',
    note: 'Логистика настраивается под ритм дня, без обещаний невозможного по времени.',
    Icon: UserRound,
  },
  {
    title: 'Автомобиль с водителем',
    description:
      'Отдельный логистический формат для случаев, когда нужен именно автомобиль с водителем. По устройству дня он не всегда совпадает с предыдущим вариантом, поэтому детали лучше согласовать заранее.',
    note: 'Подходит, если приоритет — удобная посадка, меньше переходов и предсказуемый темп.',
    Icon: CarFront,
  },
]

const optionalPoiDescriptions: Record<string, string> = {
  'Застава Хаконэ Сэкисё': 'Историческая остановка для тех, кому хочется добавить в день старый Токайдо и контекст дороги между Эдо и Киото.',
  'Парк Онси Хаконэ': 'Тихая видовая точка над озером, если нужен воздух, пауза и хороший ракурс без лишнего шума.',
  'Святилище Хаконэ Дзиндзя': 'Сильная остановка у воды и в кедрах, если хочется больше атмосферы, чем музейной структуры.',
  'Горячие источники Хаконэ': 'Короткий онсэн или более длинная пауза в финале дня, если хочется закончить маршрут мягко.',
  'Художественный музей Пола': 'Для тех, кто хочет заменить или усилить художественную часть дня более камерным и архитектурно сильным музеем.',
  'Музей искусства Окада': 'Большой музейный формат, который можно добавить, если вам интереснее коллекция и спокойный темп внутри пространства.',
  'Художественный музей Нарукава': 'Подходит, если хочется объединить музейную паузу с одним из лучших видов на озеро Аси.',
  'Музей венецианского стекла': 'Более декоративная и лёгкая остановка, если нужен другой визуальный тон внутри дня.',
  'Художественный музей Хаконэ': 'Небольшой музейный акцент для тех, кто ценит сад, керамику и более тихую культурную остановку.',
  'Парк Гора': 'Удобная зелёная пауза рядом с центральной частью маршрута, если хочется добавить дыхание между переездами.',
  'Храм Тёандзи': 'Неспешная точка в стороне от основного потока, если хочется больше тишины и меньше обязательных must-see мест.',
  'Поле серебряных трав Сэнгокухара': 'Сезонная остановка, особенно хорошая осенью, когда хочется простора и мягкого света.',
  'Аутлет Готэмба': 'Логистически отдельная опция, если в этот день важен шопинг и вид на Фудзи, а не только классический Хаконэ.',
  'Замок Одавара': 'Уместное добавление на входе или выходе из маршрута, если хочется усилить историческую часть дня.',
  'Ботанический сад Хаконэ': 'Спокойная природная опция для любителей ботаники и менее очевидных остановок.',
  'Обсерватория Эноура': 'Сильная архитектурно-пейзажная точка, если маршрут можно расширить в сторону более авторского опыта.',
}

const excludedPoiNames = [
  'Озеро Аси',
  'Святилище Хаконэ Дзиндзя',
  'Канатная дорога Хаконэ',
  'Овакудани',
  'Музей под открытым небом',
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
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <ImageCarousel
          images={['/tours/hakone/hakone-1.jpg', '/tours/hakone/hakone-2.jpg', '/tours/hakone/hakone-3.jpg']}
          alt="Тур в Хаконэ — озеро Аси, Овакудани и канатная дорога"
        />

        <header className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--accent)]">День</p>
          <h1 className="font-sans text-3xl font-medium tracking-[-0.02em] md:text-4xl">Хаконэ</h1>
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            Маршрут через разные лица Хаконэ: озеро, старая дорога, вулканический рельеф,
            искусство и финальная точка, после которой день не хочется торопливо закрывать.
          </p>
        </header>

        <section className="space-y-6">
          <div className="space-y-3">
            <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">
              Схема маршрута
            </h2>
            <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
              Короткая версия для тех, кто сначала хочет понять логику дня, а уже потом смотреть
              детали по остановкам.
            </p>
          </div>

          <div className="rounded-sm border border-[var(--border)] bg-[var(--bg)] px-5 py-5">
            <ol className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:gap-x-3 md:gap-y-4">
              {schematicRoute.map((stop, index) => (
                <li
                  key={stop}
                  className="flex items-center gap-3 text-[15px] leading-[1.6] text-[var(--text)] md:flex-none"
                >
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[12px] font-medium text-[var(--text-muted)]">
                    {index + 1}
                  </span>
                  <span className="font-sans font-light">{stop}</span>
                  {index < schematicRoute.length - 1 && (
                    <ChevronRight
                      aria-hidden="true"
                      className="hidden h-4 w-4 text-[var(--text-muted)] md:block"
                    />
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">
            Кому подойдёт
          </h2>
          <article className="rounded-sm border border-[var(--border)] bg-[var(--bg)] px-5 py-5 md:px-6">
            <p className="font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">
              {whoItSuits}
            </p>
          </article>
        </section>

        <section className="space-y-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">
                Логистика
              </h2>
              <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
                В Хаконэ можно хорошо провести день и на общественном транспорте. Но если важны
                более ровный темп, гибкость и меньше трения между точками, формат логистики стоит
                выбрать заранее.
              </p>
            </div>
            <Link
              href="/contact"
              className="inline-flex min-h-11 items-center text-sm font-medium tracking-wide text-[var(--text)] transition-colors hover:text-[var(--accent)] hover:underline focus-visible:text-[var(--accent)] focus-visible:underline"
            >
              Уточнить, какой формат подойдёт →
            </Link>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {transportOptions.map(({ title, description, note, Icon }) => (
              <details
                key={title}
                className="group relative rounded-sm border border-[var(--border)] bg-[var(--bg)] transition-colors hover:border-[var(--accent)] focus-within:border-[var(--accent)] open:border-[var(--accent)]"
              >
                <summary className="flex min-h-28 list-none cursor-pointer items-center gap-4 px-5 py-4 marker:hidden focus:outline-none">
                  <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--accent)] transition-colors group-hover:border-[var(--accent)] group-focus-within:border-[var(--accent)] group-open:border-[var(--accent)]">
                    <Icon aria-hidden="true" className="h-5 w-5" />
                  </span>
                  <div className="space-y-1">
                    <h3 className="font-sans text-[18px] font-medium leading-[1.3] tracking-[-0.01em]">
                      {title}
                    </h3>
                    <p className="text-[13px] font-light leading-[1.6] text-[var(--text-muted)]">
                      Нажмите или наведите, чтобы увидеть детали.
                    </p>
                  </div>
                </summary>

                <div className="border-t border-[var(--border)] px-5 pb-5 pt-4 md:absolute md:left-4 md:right-4 md:top-[calc(100%-0.5rem)] md:z-10 md:translate-y-2 md:rounded-sm md:border md:bg-[var(--bg)] md:opacity-0 md:shadow-sm md:transition-all md:duration-200 md:group-hover:translate-y-0 md:group-hover:opacity-100 md:group-focus-within:translate-y-0 md:group-focus-within:opacity-100 md:group-open:translate-y-0 md:group-open:opacity-100">
                  <p className="font-sans text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
                    {description}
                  </p>
                  <p className="mt-3 text-[13px] font-light leading-[1.7] text-[var(--text-muted)]">
                    {note}
                  </p>
                </div>
              </details>
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
            <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
              Здесь уже не схема, а полноценная структура дня: с атмосферой, переходами и теми
              точками, вокруг которых удобно собирать именно ваш ритм Хаконэ.
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
                Дополнительные включения
              </span>
            </div>
            <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
              Ниже — дополнительные точки из базы POI. Это не каркас маршрута, а опции, которыми
              можно усилить день без повторения главных опорных остановок.
            </p>
          </div>

          <PoiSection
            pois={poisData.pois as any}
            title="Что можно включить"
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
