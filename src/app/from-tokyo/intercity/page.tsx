import { ExperienceCard } from "@/components/sections/ExperienceCard";
import { TransportCard } from "@/components/sections/TransportCard";
import { experiences } from "@/data/experiences";

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
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <div className="space-y-4">
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">{experience.title}</h1>
          <p className="font-sans text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">{experience.intro}</p>
        </div>

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
  );
}
