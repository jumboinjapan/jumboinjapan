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
import { TransportCard, type TransportCardProps } from "@/components/sections/TransportCard";
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
    image: "/hero-city-tour-day-one-tokyo-tower.jpg",
  },
  {
    title: "Токио. Второй день",
    description:
      "Другой Токио — районы, которые не попадают в стандартные маршруты. Янака, Симокитадзава, Коэнзи: город, в котором живут сами токийцы.",
    duration: "6–8 часов",
    slug: "city-tour/day-two",
    image: "/hero-city-tour-day-two.jpg",
  },
  {
    title: "Скрытые уголки Токио",
    description:
      "Маршрут собирается под вас — по интересам, темпу и настроению. Блошиные рынки, мастерские, храмы без туристов. Токио, который не найти на карте.",
    duration: "Гибкий формат",
    slug: "city-tour/hidden-spots",
    image: "/hero-city-tour-hidden-spots.jpg",
  },
];

const transportOptions: TransportCardProps[] = [
  {
    title: "Общественный транспорт",
    description:
      "В маршруте, не считая дороги от отеля до места старта и обратного возвращения в конце дня, предусмотрен всего один переезд на общественном транспорте. Это удобная возможность заодно увидеть, как работает токийское метро.",
    href: "/city-tour/public",
    image: "/city-tour-transport-public.jpg",
    imageDisplay: "hero",
  },
  {
    title: "Private transport",
    description:
      "Формат с водителем для тех дней, когда важны door-to-door логистика, сохранение сил и спокойный темп без пересадок. Особенно уместен для семьи, мини-группы или маршрута с покупками.",
    href: "/city-tour/private",
    image: "/city-tour-transport-private.jpg",
    imageDisplay: "hero",
  },
  {
    title: "Лимузин сервис",
    description:
      "Для групп, которым важен максимальный комфорт — индивидуальный транспорт с водителем на целый день. Минивэн заберёт вас в условленных точках маршрута и при необходимости доставит покупки в отель.",
    href: "/city-tour/private",
    image: "/city-tour-transport-limousine.jpg",
    imageDisplay: "hero",
  },
];

const quickGuide = [
  'Первый день — если хочется сразу увидеть основные точки Токио, которые нельзя пропустить.',
  'Второй день — задача дополнить картину первого дня. Сюда можно так же добавить скрытые уголки',
  'Скрытые уголки — хорошо подойдёт любителям неизжитых маршрутов и тем кто не первый раз в Токио.',
]

export default function CityTourPage() {
  if (!experience) return null;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }}
      />
      <PageHero
        image="/hero-city-tour-rainbow-bridge-tokyo-tower.jpg"
        alt="Радужный мост и Токийская башня на вечернем горизонте Токио"
        eyebrow="Туры по Токио"
        title="Токио — не за один день"
        subtitle="Три маршрута по городу: классика, скрытые места и частный тур."
      />
      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
        <div className="mx-auto w-full max-w-6xl space-y-10">
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">{experience.intro}</p>

          <section className="space-y-8">
            <div className="space-y-3">
              <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Как выбрать маршрут</h2>
              <div className="grid gap-px overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--border)] md:grid-cols-3">
                {quickGuide.map((item) => (
                  <p key={item} className="bg-[var(--bg)] px-5 py-4 font-sans text-[14px] font-light leading-[1.8] text-[var(--text-muted)] md:px-6">
                    {item}
                  </p>
                ))}
              </div>
            </div>
          </section>

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
                  image={program.image}
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
