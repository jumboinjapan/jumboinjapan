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

const transportOptions: readonly TransportCardProps[] = [
  {
    title: "Общественный транспорт",
    description:
      "В маршруте, не считая дороги от отеля до места старта и обратного возвращения в конце дня, предусмотрен всего один переезд на общественном транспорте. Это удобная возможность заодно увидеть, как работает токийское метро.",
    href: "/city-tour/public",
    image: "/city-tour-transport-public-v2.jpg",
    imageDisplay: "hero",
  },
  {
    title: "Частный транспорт",
    description:
      "Формат с водителем для тех дней, когда важны door-to-door логистика, сохранение сил и спокойный темп без пересадок. Особенно уместен для семьи, мини-группы или маршрута с покупками.",
    href: "/city-tour/private",
    image: "/city-tour-transport-private-v4.jpg",
    imageDisplay: "hero",
  },
  {
    title: "Лимузин сервис",
    description:
      "Для групп, которым важен максимальный комфорт — индивидуальный транспорт с водителем на целый день. Минивэн заберёт вас в условленных точках маршрута и при необходимости доставит покупки в отель.",
    href: "/city-tour/limousine",
    image: "/city-tour-transport-limousine-v2.jpg",
    imageDisplay: "hero",
  },
];

const quickGuide = [
  'Первый день — если нужен собранный вход в Токио: основные точки, понятная логика города и сильное первое знакомство без ощущения конвейера.',
  'Второй день — если базовый Токио уже понятен и хочется перейти к районам, ритму и среде, где город раскрывается глубже и спокойнее.',
  'Скрытые уголки — если важнее не обязательная программа, а маршрут под интересы, повторную поездку или менее очевидный характер Токио.',
] as const

const familySummary = [
  {
    label: 'Логика family',
    value: '3 сценария',
    note: 'Первое знакомство · расширение картины · маршрут под интересы',
  },
  {
    label: 'Длительность',
    value: '6–8 часов',
    note: 'Скрытые уголки — гибкий формат',
  },
  {
    label: 'Кому подходит',
    value: 'И первый, и повторный Токио',
    note: 'Выбор зависит не от списка точек, а от глубины знакомства с городом',
  },
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
        subtitle="Три маршрута по городу: все важное за день, широкий фокус и скрытые уголки"
      />
      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
        <div className="mx-auto w-full max-w-6xl space-y-14 md:space-y-16">
          <section className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)] lg:items-start">
            <div className="space-y-5">
              <p className="font-sans text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">{experience.intro}</p>
            </div>
            <aside className="rounded-sm border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Как устроен раздел</p>
              <p className="mt-3 text-[14px] font-light leading-[1.8] text-[var(--text-muted)]">
                Сначала выбрать тип знакомства с Токио, затем перейти к конкретной программе, и только после этого уточнять логистику под свой темп, семью или формат дня.
              </p>
            </aside>
          </section>

          <section className="grid gap-px overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--border)] md:grid-cols-3">
            {familySummary.map((item) => (
              <article key={item.label} className="bg-[var(--bg)] px-5 py-4 md:px-6">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">{item.label}</p>
                <p className="mt-2 text-[17px] font-medium tracking-[-0.02em] text-[var(--text)]">{item.value}</p>
                <p className="mt-1 text-[13px] font-light leading-[1.7] text-[var(--text-muted)]">{item.note}</p>
              </article>
            ))}
          </section>

          <section className="space-y-8">
            <div className="space-y-3">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Как выбрать маршрут</p>
              <h2 className="font-sans text-[26px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[32px]">Сначала — тип Токио, который вам нужен</h2>
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
            <div className="space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Программы</p>
              <h2 className="font-sans text-[26px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[32px]">Три маршрута внутри city-tour family</h2>
            </div>
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

          <section className="grid gap-6 rounded-sm border border-[var(--border)] bg-[var(--surface)] px-6 py-7 md:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)] md:items-start md:px-8 md:py-8">
            <div className="space-y-3">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">Логистика</p>
              <h2 className="font-sans text-[26px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-[32px]">Транспорт — это уже второй выбор, после маршрута</h2>
              <p className="max-w-2xl text-[15px] font-light leading-[1.85] text-[var(--text-muted)]">
                У city-tour family логистика не должна спорить с выбором программы в верхней части страницы. Сначала человек понимает, какой Токио ему нужен, а затем решает, пройти день на метро, с водителем или в лимузин-сервисе.
              </p>
            </div>
            <div className="grid gap-10 md:grid-cols-1">
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
