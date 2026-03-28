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
  'Застава Хаконэ Сэкисё',
  'Хаконэ Дзиндзя',
  'Круиз по озеру Аси',
  'Канатная дорога Хаконэ',
  'Овакудани',
  'Музей под открытым небом Хаконэ',
  'Отдых в отеле',
]

const planningContext =
  'Хаконэ особенно хорошо встраивается в маршрут вместе с Фудзи: после дня у озёр, смотровых и вокруг самой горы здесь удобно сделать ночёвку, чтобы не превращать переезд в утомительный хвост. А если Хаконэ — это отдельный дневной маршрут, дальше логично и проще уходить уже в сторону Киото, не возвращая день назад лишней логистикой.'

const fullRouteStops = [
  {
    eyebrow: 'Экскурс в историю',
    title: 'Застава Хаконэ Сэкисё',
    description:
      'День удобно начать с восстановленной заставы на старом тракте Токайдо: она сразу даёт маршруту исторический масштаб и настраивает на ритм Хаконэ.',
  },
  {
    eyebrow: 'Святилище у воды',
    title: 'Хаконэ Дзиндзя',
    description:
      'После заставы маршрут мягко переходит к лесному святилищу на берегу озера Аси — это спокойная и очень хаконэская по атмосфере точка.',
  },
  {
    eyebrow: 'Круиз по Озеру',
    title: 'Круиз по озеру Аси',
    description:
      'Короткий круиз собирает ландшафт воедино: вода, береговые линии и, при хорошей погоде, вид на Фудзи.',
  },
  {
    eyebrow: 'Подъём',
    title: 'Канатная дорога Хаконэ',
    description:
      'Подъём по канатной дороге нужен не только ради логистики: по пути хорошо читается вулканический рельеф и общий рисунок региона.',
  },
  {
    eyebrow: 'Вулканическая долина',
    title: 'Овакудани',
    description:
      'Самая узнаваемая геологическая сцена Хаконэ — серные пары, кипящие склоны и чёрные яйца.',
  },
  {
    eyebrow: 'Искусство под открытым небом',
    title: 'Музей под открытым небом Хаконэ',
    description:
      'После Овакудани маршрут хорошо завершается музеем: здесь день становится спокойнее и смещается от геологии к искусству и пространству.',
  },
  {
    eyebrow: 'Финал с продолжением',
    title: 'Рекомендованный отель в Хаконэ',
    description:
      'Если день хочется не закрывать наспех, а продолжить правильно, я обычно советую не искать абстрактный “ещё один стоп”, а выбрать хороший отель в нужной части Хаконэ. После связки с Фудзи это особенно удачный формат: регион отлично работает как ночёвка, а на следующий день уже удобно двигаться дальше — в том числе в сторону Киото.',
  },
]

const whoItSuits =
  'Тем, кто любит маршруты, где природа, история и искусство работают вместе; тем, кто хочет увидеть Хаконэ не только как открытку с Фудзи, но и как живой, многослойный регион — с водой, серой, старой дорогой, музеем и хорошей тишиной. Особенно хорошо этот день подходит тем, кто совмещает район Фудзи и Хаконэ в одном отрезке поездки и хочет собрать его без ощущения, что всё происходит на бегу.'

const transportOptions = [
  {
    title: 'Общественный транспорт',
    description:
      'Для Хаконэ это рабочий и уместный формат: поезд, корабль, канатная дорога и локальные переезды можно собрать в цельный день, если вам ближе маршрут в естественном ритме региона.',
    note: 'Хорошо подходит, если важен сам опыт Хаконэ как системы пересадок и видов.',
    Icon: TrainFront,
  },
  {
    title: 'Организация индивидуального транспорта',
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
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <ImageCarousel
          images={['/tours/hakone/hakone-1.jpg', '/tours/hakone/hakone-2.jpg', '/tours/hakone/hakone-3.jpg']}
          alt="Тур в Хаконэ — озеро Аси, Овакудани и канатная дорога"
        />

        <header className="space-y-3">
          <p className="text-xs font-medium tracking-[0.04em] text-[var(--accent)]">День</p>
          <h1 className="font-sans text-3xl font-medium tracking-[-0.02em] md:text-4xl">Хаконэ</h1>
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
            Хаконэ хорошо раскрывается как маршрут через несколько разных состояний региона: озеро,
            старая дорога, вулканический рельеф, искусство и спокойный финал, после которого день
            хочется не обрывать, а продолжить правильно.
          </p>
        </header>

        <section className="space-y-6">
          <div className="space-y-3">
            <h2 className="font-sans text-xl font-medium tracking-[-0.01em] text-[var(--text-muted)]">
              Рекомендованная схема маршрута
            </h2>
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
            <div className="space-y-4">
              <p className="font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">
                {whoItSuits}
              </p>
              <p className="font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">
                {planningContext}
              </p>
            </div>
          </article>
        </section>

        <section className="space-y-6">
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

          <div className="grid gap-4 md:grid-cols-3">
            {transportOptions.map(({ title, description, note, Icon }) => {
              const panelId = `transport-details-${title
                .toLowerCase()
                .replace(/[^a-zа-яё0-9]+/gi, '-')
                .replace(/^-+|-+$/g, '')}`

              return (
                <article
                  key={title}
                  className="group relative rounded-sm border border-[var(--border)] bg-[var(--bg)] transition-colors hover:border-[var(--accent)] focus-within:border-[var(--accent)]"
                >
                  <div
                    tabIndex={0}
                    aria-describedby={panelId}
                    className="flex min-h-28 w-full items-center gap-4 px-5 py-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
                  >
                    <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--accent)] transition-colors group-hover:border-[var(--accent)] group-focus-within:border-[var(--accent)]">
                      <Icon aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="font-sans text-[18px] font-medium leading-[1.3] tracking-[-0.01em]">
                        {title}
                      </h3>
                    </div>
                  </div>

                  <div
                    id={panelId}
                    className="border-t border-[var(--border)] px-5 pb-5 pt-4 md:pointer-events-none md:absolute md:left-4 md:right-4 md:top-[calc(100%-0.5rem)] md:z-10 md:translate-y-2 md:rounded-sm md:border md:bg-[var(--bg)] md:opacity-0 md:shadow-sm md:transition-all md:duration-200 md:group-hover:pointer-events-auto md:group-hover:translate-y-0 md:group-hover:opacity-100 md:group-focus-within:pointer-events-auto md:group-focus-within:translate-y-0 md:group-focus-within:opacity-100"
                  >
                    <p className="font-sans text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
                      {description}
                    </p>
                    <p className="mt-3 text-[13px] font-light leading-[1.7] text-[var(--text-muted)]">
                      {note}
                    </p>
                  </div>
                </article>
              )
            })}
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
              <span className="text-xs font-medium tracking-[0.04em]">
                Популярные точки поблизости
              </span>
            </div>
            <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
              Ниже — дополнительные точки из базы POI. Это не каркас маршрута, а опции, которыми
              можно усилить день без повторения главных опорных остановок.
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
