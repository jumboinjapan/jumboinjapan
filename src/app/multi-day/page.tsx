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
import { experiences } from "@/data/experiences";

const experience = experiences.find((item) => item.slug === "multi-day");

const programs = [
  {
    title: "Классическая Япония",
    description:
      "Токио — Хаконэ — Киото — Нара — Осака. Маршрут, который работает и первый раз, и пятый.",
    duration: "7–10 дней",
    slug: "multi-day/classic",
  },
  {
    title: "Горная Япония",
    description:
      "Такаяма, Сиракава-го, Канадзава. Деревянные деревни, рисовые поля и горные онсэны вдали от туристических маршрутов.",
    duration: "5–7 дней",
    slug: "multi-day/mountain",
  },
  {
    title: "Своим маршрутом",
    description:
      "Вы выбираете интересы — я строю маршрут. Арт, еда, природа, ретро-Япония — что угодно.",
    duration: "От 2 дней",
    slug: "multi-day/custom",
  },
];

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
        </div>
      </section>
    </>
  );
}
