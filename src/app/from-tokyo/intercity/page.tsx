import type { Metadata } from "next";
import { ExperienceCard } from "@/components/sections/ExperienceCard";
import { TransportCard } from "@/components/sections/TransportCard";
import { PageHero } from "@/components/sections/PageHero";
import { experiences } from "@/data/experiences";

export const metadata: Metadata = {
  title: 'Загородные туры из Токио с гидом на русском',
  description: 'Однодневные и многодневные туры из Токио: Хаконэ, Никко, Камакура, Киото, Осака, Нара, Канадзава. Русскоязычный гид, индивидуальные маршруты.',
  alternates: { canonical: 'https://jumboinjapan.com/from-tokyo/intercity' },
  openGraph: {
    title: 'Загородные туры из Токио | JumboInJapan',
    description: 'Однодневные и многодневные туры из Токио: Хаконэ, Никко, Камакура, Киото, Осака, Нара, Канадзава. Русскоязычный гид, индивидуальные маршруты.',
    type: 'website',
    url: 'https://jumboinjapan.com/from-tokyo/intercity',
    locale: 'ru_RU',
    images: [{ url: 'https://jumboinjapan.com/dest-intercity.jpg', width: 1200, height: 800, alt: 'Загородные туры из Токио с гидом — Хаконэ, Никко, Камакура, Киото' }],
    siteName: 'JumboInJapan',
  },
};

const experience = experiences.find((item) => item.slug === "intercity");

const programs = [
  {
    title: "Хаконэ",
    description: "Горный курорт, горячие источники и идеальная остановка на пути в Киото.",
    duration: "День и более",
    slug: "intercity/hakone",
    image: "/tours/hakone/hakone-1.jpg",
  },
  {
    title: "Химэдзи",
    description: "Замок Белой Цапли — лучший феодальный замок Японии и сад Кокоэн у его стен.",
    duration: "День",
    slug: "intercity/himeji",
    image: "/tours/himeji/himeji-1.jpg",
  },
  {
    title: "Гора Фудзи",
    description: "Четыре ракурса великой горы — от кратера до деревни у подножия.",
    duration: "День",
    slug: "intercity/fuji",
    image: "/tours/fuji/fuji-a.jpg",
  },
  {
    title: "Никко",
    description: "Мавзолей Тосёгу, горные водопады и осенние клёны. Духовный центр Японии в 2 часах от Токио.",
    duration: "День",
    slug: "intercity/nikko",
    image: "/tours/nikko/nikko-1.jpg",
  },
  {
    title: "Камакура",
    description: "Великий Будда, самурайские святилища и Тихий океан.",
    duration: "День",
    slug: "intercity/kamakura",
    image: "/tours/kamakura/kamakura-2.jpg",
  },
  {
    title: "Эносима",
    description: "Остров с драконьими пещерами, морской гастрономией и видом на Фудзи.",
    duration: "День",
    slug: "intercity/enoshima",
    image: "/tours/enoshima/enoshima-1.jpg",
  },
  {
    title: "Киото. Первое знакомство",
    description: "Золотой павильон, сад камней Рёандзи, рынок Нисики и квартал гейш Гион.",
    duration: "День и более",
    slug: "intercity/kyoto-1",
    image: "/tours/kyoto-1/kyoto-1.jpg",
  },
  {
    title: "Киото. Продолжение",
    description: "Серебряный павильон, Философская тропа, Арасияма и бамбуковый лес.",
    duration: "День и более",
    slug: "intercity/kyoto-2",
    image: "/tours/kyoto-2/kyoto-1.jpg",
  },
  {
    title: "Нара",
    description: "Великий Будда в Тодай-дзи, святилище тысячи фонарей и свободные олени в парке.",
    duration: "День",
    slug: "intercity/nara",
    image: "/tours/nara/nara-1.jpg",
  },
  {
    title: "Удзи",
    description: "Чайная столица Японии. Павильон Феникса и улочки с матья-мороженым.",
    duration: "День",
    slug: "intercity/uji",
    image: "/tours/uji/uji-1.jpg",
  },
  {
    title: "Осака",
    description: "Торговая столица Японии, квартал Дотонбори, такояки и Осакский замок.",
    duration: "День",
    slug: "intercity/osaka",
    image: "/tours/osaka/osaka-1.jpg",
  },
  {
    title: "Канадзава",
    description: "Сад Кэнрокуэн, квартал гейш, рыбный рынок и музей современного искусства.",
    duration: "День и более",
    slug: "intercity/kanazawa",
    image: "/tours/kanazawa/kanazawa-1.jpg",
  },
];

const transportOptions = [
  {
    title: "Общественный транспорт",
    description:
      "Синкансэн и региональные поезда — быстро, точно, с видом из окна. Japan Rail Pass делает длинные перегоны доступными по цене.",
    href: "/from-tokyo/intercity/public",
  },
  {
    title: "Заказной транспорт",
    description:
      "Минивэн с водителем — свобода маршрута, остановки где угодно и никакого багажного стресса. Особенно удобно для групп и семей.",
    href: "/from-tokyo/intercity/private",
  },
];

export default function IntercityPage() {
  if (!experience) return null;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          "name": "Загородные туры из Токио с гидом на русском",
          "description": "Однодневные и многодневные туры из Токио: Хаконэ, Никко, Камакура, Киото, Осака, Нара, Канадзава.",
          "url": "https://jumboinjapan.com/from-tokyo/intercity",
          "inLanguage": "ru",
          "hasPart": [
            { "@type": "TouristTrip", "name": "Тур в Хаконэ из Токио", "url": "https://jumboinjapan.com/from-tokyo/intercity/hakone" },
            { "@type": "TouristTrip", "name": "Тур в Никко из Токио", "url": "https://jumboinjapan.com/from-tokyo/intercity/nikko" },
            { "@type": "TouristTrip", "name": "Тур в Камакуру из Токио", "url": "https://jumboinjapan.com/from-tokyo/intercity/kamakura" },
            { "@type": "TouristTrip", "name": "Тур в Киото из Токио (день 1)", "url": "https://jumboinjapan.com/from-tokyo/intercity/kyoto-1" },
            { "@type": "TouristTrip", "name": "Тур в Киото из Токио (день 2)", "url": "https://jumboinjapan.com/from-tokyo/intercity/kyoto-2" },
            { "@type": "TouristTrip", "name": "Тур в Осаку из Токио", "url": "https://jumboinjapan.com/from-tokyo/intercity/osaka" },
            { "@type": "TouristTrip", "name": "Тур в Нару из Токио", "url": "https://jumboinjapan.com/from-tokyo/intercity/nara" },
            { "@type": "TouristTrip", "name": "Тур на гору Фудзи из Токио", "url": "https://jumboinjapan.com/from-tokyo/intercity/fuji" },
            { "@type": "TouristTrip", "name": "Тур на Эносиму из Токио", "url": "https://jumboinjapan.com/from-tokyo/intercity/enoshima" },
            { "@type": "TouristTrip", "name": "Тур в Канадзаву из Токио", "url": "https://jumboinjapan.com/from-tokyo/intercity/kanazawa" },
            { "@type": "TouristTrip", "name": "Тур в Химэдзи из Токио", "url": "https://jumboinjapan.com/from-tokyo/intercity/himeji" },
            { "@type": "TouristTrip", "name": "Тур в Удзи из Токио", "url": "https://jumboinjapan.com/from-tokyo/intercity/uji" }
          ]
        }) }}
      />
      <PageHero
        image="/hero-intercity.jpg"
        eyebrow="Загородные туры · Из Токио"
        title="Япония за пределами Токио"
        subtitle="Хаконэ, Никко, Камакура, Киото, Осака и другие города — с русскоязычным гидом."
        objectPosition="bottom"
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
                  image={"image" in program ? (program as { image?: string }).image : undefined}
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
