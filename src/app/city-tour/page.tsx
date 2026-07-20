import { tours } from '@/data/tours'
import { buildPageMetadata } from '@/lib/page-metadata'

const tour = tours.find(t => t.slug === 'city-tour')!

export const metadata = buildPageMetadata('/city-tour', {
  title: tour.title,
  description: tour.description,
  openGraph: {
    title: `${tour.title} | JumboInJapan`,
    description: tour.description,
    images: [{ url: tour.image }],
  },
})

const tourSchema = {
  "@context": "https://schema.org",
  "@type": "TouristTrip",
  "name": tour.titleEn,
  "description": tour.description,
  "touristType": "Russian-speaking tourists",
  "provider": guideRef,
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
import { guideRef } from '@/lib/schema'

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
      "Маршрут легко выстроить под ваши интересы, темп и настроение. Блошиные рынки, мастерские, храмы без туристов. Токио, который не найти на карте.",
    duration: "Гибкий формат",
    slug: "city-tour/hidden-spots",
    image: "/hero-city-tour-hidden-spots.jpg",
  },
];

const transportOptions: readonly TransportCardProps[] = [
  {
    title: "Общественный транспорт",
    description:
      "Пешеходный ритм с переездами на метро или такси: быстро, экономно и ближе всего к повседневному Токио.",
    href: "/city-tour/public",
    image: "/city-tour-transport-public-v2.jpg",
    imageDisplay: "hero",
  },
  {
    title: "Частный транспорт",
    description:
      "Городская программа в основном пешеходная: переходы заметные, и к машине маршрут возвращается. Зато становятся доступными более сложные по логистике маршруты — удалённые районы и точки вне пешей досягаемости, поэтому под частный транспорт существуют отдельные варианты программ.",
    href: "/city-tour/private",
    image: "/city-tour-transport-private-v4.jpg",
    imageDisplay: "hero",
  },
  {
    title: "Заказной транспорт",
    description:
      "Лимузин-сервис с просторным минивэном — вариант для семьи или группы, когда важно ехать всем вместе и беречь силы. Комфорт предсказуем в любую погоду и любой час дня.",
    href: "/city-tour/charter",
    image: "/city-tour-transport-limousine-v2.jpg",
    imageDisplay: "hero",
  },
];

const quickGuide = [
  'Первый день — если хочется сразу увидеть основные точки Токио, которые нельзя пропустить.',
  'Второй день — задача дополнить картину первого дня. Сюда можно также добавить скрытые уголки.',
  'Скрытые уголки — хорошо подойдёт любителям неизбитых маршрутов и тем, кто не в первый раз в Токио.',
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
        subtitle="Три маршрута по городу: всё важное за день, широкий фокус и скрытые уголки"
      />
      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
        <div className="mx-auto w-full max-w-6xl space-y-10">
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">{experience.intro}</p>

          <section className="space-y-8">
            <div className="space-y-3">
              <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Как выбрать маршрут</h2>
              <div className="grid gap-px overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--border)] md:grid-cols-3">
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
