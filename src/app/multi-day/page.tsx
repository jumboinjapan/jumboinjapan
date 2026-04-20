import type { Metadata } from 'next'
import { tours } from '@/data/tours'

const tour = tours.find(t => t.slug === 'multi-day')!

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
import { PageHero } from "@/components/sections/PageHero";
import { TransportCard, type TransportCardProps } from "@/components/sections/TransportCard";
import { experiences } from "@/data/experiences";

const experience = experiences.find((item) => item.slug === "multi-day");

const programGroups = [
  {
    title: 'Готовые маршруты',
    note: 'Для тех, кто хочет опереться на уже выверенный ритм поездки и понять масштаб путешествия заранее.',
    items: [
      {
        title: 'Классическая Япония',
        description:
          'Токио — Хаконэ — Киото — Нара — Осака. Маршрут, который работает и первый раз, и пятый.',
        duration: '7–10 дней',
        slug: 'multi-day/classic',
      },
      {
        title: 'Горная Япония',
        description:
          'Такаяма, Сиракава-го, Канадзава. Деревянные деревни, рисовые поля и горные онсэны вдали от туристических маршрутов.',
        duration: '5–7 дней',
        slug: 'multi-day/mountain',
      },
    ],
  },
  {
    title: 'Индивидуальный маршрут',
    note: 'Если у вас уже есть свои интересы, города или любимый ритм поездки — можно собрать программу с нуля.',
    items: [
      {
        title: 'Своим маршрутом',
        description:
          'Вы выбираете интересы — я строю маршрут. Арт, еда, природа, ретро-Япония — что угодно.',
        duration: 'От 2 дней',
        slug: 'multi-day/custom',
      },
    ],
  },
]

const quickGuide = [
  'Классический маршрут — если хочется увидеть главные культурные опоры Японии в одном путешествии.',
  'Горный маршрут — если важнее глубинка, природа и менее очевидная Япония.',
  'Индивидуальный маршрут — если сначала есть интересы, а программа строится уже вокруг них.',
]

const transportOptions: readonly TransportCardProps[] = [
  {
    title: "Поезда и синкансэн",
    description:
      "Основа для длинных перегонов между крупными городами. Быстро, предсказуемо и особенно логично там, где маршрут держится на железнодорожной оси.",
    href: "/intercity/public",
    image: "/tours/kyoto-1/kyoto-1.jpg",
    imageDisplay: "hero",
  },
  {
    title: "Смешанная логистика",
    description:
      "Самый живой сценарий для многодневного путешествия: поезд между крупными точками, локальное такси или машина там, где важно убрать лишнюю усталость и сохранить ритм.",
    href: "/contact",
    image: "/dest-multi-day-snow-village.jpg",
    imageDisplay: "hero",
  },
  {
    title: "Private transport",
    description:
      "Подходит для отдельных дней с багажом, родителями, детьми или маршрутом вне сильной железнодорожной логики, когда door-to-door комфорт реально меняет ощущение поездки.",
    href: "/intercity/private",
    image: "/tours/hakone/hakone-2.jpg",
    imageDisplay: "hero",
  },
]

export default function MultiDayPage() {
  if (!experience) return null;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }}
      />
      <PageHero
        image="/dest-multi-day.jpg"
        eyebrow="Многодневные туры"
        title="Япония за несколько дней"
        subtitle="Маршруты для тех, кто готов выйти за пределы Токио и увидеть больше."
      />
      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
        <div className="mx-auto w-full max-w-6xl space-y-10">
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">{experience.intro}</p>

          <section className="space-y-8">
            <div className="space-y-3">
              <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Как выбрать ритм</h2>
              <div className="grid gap-px overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--border)] md:grid-cols-3">
                {quickGuide.map((item) => (
                  <p key={item} className="bg-[var(--bg)] px-5 py-4 font-sans text-[14px] font-light leading-[1.8] text-[var(--text-muted)] md:px-6">
                    {item}
                  </p>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-12">
            <h2 className="font-sans font-medium text-xl tracking-[-0.01em] text-[var(--text-muted)]">Программы</h2>
            {programGroups.map((group) => (
              <section key={group.title} className="space-y-6">
                <div className="max-w-3xl space-y-2">
                  <p className="font-sans text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">{group.title}</p>
                  <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">{group.note}</p>
                </div>
                <div className={`grid gap-10 ${group.items.length === 1 ? 'md:max-w-2xl md:grid-cols-1' : 'md:grid-cols-2 lg:grid-cols-3'}`}>
                  {group.items.map((program) => (
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
            ))}
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
