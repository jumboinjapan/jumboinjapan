import type { Metadata } from 'next'
import Link from "next/link";
import { ImageCarousel } from "@/components/sections/ImageCarousel";
import { PoiSection } from "@/components/sections/PoiSection";
import { tours } from '@/data/tours'
import poisData from '@/data/pois/hakone.json'

const tour = tours.find(t => t.slug === 'from-tokyo/intercity/hakone')!

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
  "@context": "https://schema.org",
  "@type": "TouristTrip",
  "name": "Тур в Хаконэ",
  "alternateName": "Hakone",
  "description": tour.description,
  "inLanguage": "ru",
  "image": "https://jumboinjapan.com/tours/hakone/hakone-1.jpg",
  "duration": "P1D",
  "touristType": "Russian-speaking tourists",
  "provider": {
    "@type": "Person",
    "name": "Eduard Revidovich",
    "url": "https://jumboinjapan.com"
  },
  "offers": {
    "@type": "Offer",
    "availability": "https://schema.org/InStock",
    "url": `https://jumboinjapan.com/${tour.slug}`
  }
}

const anchorStops = [
  {
    title: "Озеро Аси и круиз",
    description:
      "Кальдера вулкана, тёмная вода и редкая для Японии пространность. В ясный день Фудзи появляется прямо в такелаже, а сам переход по озеру собирает весь ландшафт в одну панораму.",
  },
  {
    title: "Овакудани",
    description:
      "Активная вулканическая зона с серными парами, кипящими склонами и тем самым запахом, который чувствуешь раньше, чем видишь. Это та часть Хаконэ, где геология перестаёт быть абстракцией.",
  },
  {
    title: "Музей под открытым небом",
    description:
      "Одна из лучших остановок в Хаконэ, если хочется не только видов, но и масштаба. Скульптура, склон холма, павильон Пикассо и ванночки для ног — редкое место, где искусство и пейзаж действительно работают вместе.",
  },
]

const whoItSuits = [
  "Тем, кто любит маршруты, где природа, история и искусство не спорят между собой, а усиливают друг друга.",
  "Тем, кто любит насыщенные дни с переменой ритма: озеро, канатная дорога, вулканический пейзаж, музей, святилище.",
  "Тем, кто любит Японию не только открыткой с Фудзи, но и её странностью — серой, туманом, старой дорогой и хорошей тишиной.",
]

const transportOptions = [
  {
    title: "Общественный транспорт",
    description:
      "Для Хаконэ это реальный вариант: поезд, корабль, канатная дорога и локальные переезды можно собрать в цельный день, если хочется пройти регион в его естественном ритме.",
  },
  {
    title: "Individual transport arrangement",
    description:
      "Более спокойный и гибкий формат для тех, кто не хочет подстраиваться под пересадки, очереди и погодные окна. Обычно он удобнее, если важны комфортный темп, семья, багаж или желание сохранить силы на сами места, а не на логистику.",
  },
  {
    title: "Car with driver",
    description:
      "Отдельный логистический формат для тех случаев, когда нужен именно автомобиль с водителем. Не всегда совпадает по устройству дня с Individual transport arrangement, поэтому детали лучше согласовать заранее.",
  },
]

export default function HakonePage() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }}
      />
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <ImageCarousel images={["/tours/hakone/hakone-1.jpg","/tours/hakone/hakone-2.jpg","/tours/hakone/hakone-3.jpg"]} alt="Тур в Хаконэ — озеро Аси, Овакудани и канатная дорога" />

        <header className="space-y-3">
          <p className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">День</p>
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">Хаконэ</h1>
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">A route through the different faces of Hakone: lake views, the old Tokaido road, volcanic scenery, art, and an onsen at the end of the day.</p>
        </header>

        <section className="space-y-6">
          <div className="space-y-3">
            <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Маршрут</h2>
            <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">Для первого взгляда на Хаконэ я обычно собираю день вокруг трёх опорных точек. Остальные остановки добавляются по погоде, очередям, сезону и вашему темпу — так маршрут остаётся честным по отношению к самому месту.</p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {anchorStops.map((stop) => (
              <article key={stop.title} className="flex h-full flex-col gap-3">
                <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25]">{stop.title}</h3>
                <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">{stop.description}</p>
              </article>
            ))}
          </div>

          <div className="rounded-sm border border-[var(--border)] px-5 py-4">
            <p className="font-sans text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
              <span className="font-medium text-[var(--text)]">Полный день также может включать:</span>{" "}
              заставу Хаконэ, святилище Хаконэ, канатную дорогу, парк Онси, старую дорогу Токайдо, чайный привал по пути или другие поддерживающие остановки, если они помогают лучше раскрыть именно ваш ритм Хаконэ.
            </p>
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Кому подойдёт</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {whoItSuits.map((item) => (
              <article key={item} className="rounded-sm border border-[var(--border)] px-5 py-4">
                <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">{item}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="space-y-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Логистика</h2>
              <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">В Хаконэ можно хорошо провести день и на общественном транспорте. Но если важны более ровный темп, гибкость и меньше трения между точками, логистика имеет значение почти так же сильно, как сам маршрут.</p>
            </div>
            <Link
              href="/contact"
              className="inline-flex min-h-11 items-center text-sm font-medium tracking-wide text-[var(--text)] transition-colors hover:text-[var(--accent)] hover:underline"
            >
              Уточнить логистику →
            </Link>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {transportOptions.map((option) => (
              <article key={option.title} className="flex h-full flex-col gap-3">
                <h3 className="font-sans font-medium text-[19px] tracking-[-0.01em] leading-[1.25]">{option.title}</h3>
                <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">{option.description}</p>
              </article>
            ))}
          </div>
        </section>

        <PoiSection
          pois={poisData.pois as any}
          title="Что можно включить в маршрут"
        />

        <Link
          href="/contact"
          className="inline-flex min-h-11 items-center text-sm font-medium tracking-wide text-[var(--text)] transition-colors hover:text-[var(--accent)] hover:underline"
        >
          Связаться →
        </Link>
      </div>
    </section>
  );
}
