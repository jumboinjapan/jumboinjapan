import type { Metadata } from 'next'
import { tours } from '@/data/tours'

const tour = tours.find(t => t.slug === 'city-tour')!

export const metadata: Metadata = {
  title: tour.title,
  description: tour.description,
  openGraph: {
    title: `${tour.title} | JumboInJapan`,
    description: tour.description,
    images: [{ url: tour.image }],
  },
}

const tourSchema = {
  "@context": "https://schema.org",
  "@type": "TouristTrip",
  "name": tour.titleEn,
  "description": tour.description,
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

import { ExperienceCard } from "@/components/sections/ExperienceCard";
import { TransportCard } from "@/components/sections/TransportCard";
import { PageHero } from "@/components/sections/PageHero";
import { experiences } from "@/data/experiences";

const experience = experiences.find((item) => item.slug === "city-tour");

const programs = [
  {
    title: "Токио. Первый день",
    description:
      "Классический маршрут по главным точкам города — от Гинзы до Сибуи. То, что стоит увидеть в Токио первым делом, но без туристического конвейера.",
    duration: "6–8 часов",
    slug: "city-tour/day-one",
  },
  {
    title: "Токио. Второй день",
    description:
      "Другой Токио — районы, которые не попадают в стандартные маршруты. Янака, Симокитадзава, Коэнзи: город, в котором живут сами токийцы.",
    duration: "6–8 часов",
    slug: "city-tour/day-two",
  },
  {
    title: "Скрытые уголки Токио",
    description:
      "Маршрут собирается под вас — по интересам, темпу и настроению. Блошиные рынки, мастерские, храмы без туристов. Токио, который не найти на карте.",
    duration: "Гибкий формат",
    slug: "city-tour/hidden-spots",
  },
];

const transportOptions = [
  {
    title: "Общественный транспорт",
    description:
      "В маршруте, не считая дороги от отеля до места старта и обратного возвращения в конце дня, предусмотрен всего один переезд на общественном транспорте. Это удобная возможность заодно увидеть, как работает токийское метро.",
    href: "/city-tour/public",
  },
  {
    title: "Такси",
    description:
      "В Токио хорошо развита служба такси, и пользоваться ей можно не только через приложение. Это удобный вариант для коротких переездов по городу. Если хочется большего комфорта, рекомендую Uber Black Van.",
    href: "/city-tour/public",
  },
  {
    title: "Лимузин сервис",
    description:
      "Для групп, которым важен максимальный комфорт — индивидуальный транспорт с водителем на целый день. Минивэн заберёт вас в условленных точках маршрута и при необходимости доставит покупки в отель.",
    href: "/city-tour/private",
  },
];

export default function CityTourPage() {
  if (!experience) return null;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }}
      />
      <PageHero
        image="/dest-city-tour-v4.jpg"
        eyebrow="Туры по Токио"
        title="Токио — не за один день"
        subtitle="Три маршрута по городу: классика, скрытые места и частный тур."

      />
      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
        <div className="mx-auto w-full max-w-6xl space-y-10">
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">{experience.intro}</p>

          <section className="space-y-8">
            <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Программы</h2>
            <div className="grid gap-10 md:grid-cols-3">
              {programs.map((program) => (
                <ExperienceCard
                  key={program.slug}
                  title={program.title}
                  description={program.description}
                  duration={program.duration}
                  slug={program.slug}
                />
              ))}
            </div>
          </section>

          <section className="space-y-8">
            <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Варианты логистики</h2>
            <div className="grid gap-10 md:grid-cols-3">
              {transportOptions.map((option) => (
                <TransportCard key={option.title} {...option} />
              ))}
            </div>
          </section>
        </div>
      </section>
    </>
  );
}
