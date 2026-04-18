import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Compass, MapPinned, MessageSquareMore, Route, TrainFront } from "lucide-react";

import { about } from "@/data/about";

const journeyFormats = [
  {
    title: "По Токио",
    duration: "4–8 часов",
    href: "/city-tour",
    image: "/hero-city-tour-rainbow-bridge-tokyo-tower.jpg",
    summary:
      "Лучший первый вход в Японию, если хочется почувствовать её контраст сразу: храмы и сады, старые кварталы, новые районы и городской ритм без ощущения туристического конвейера.",
    highlights: ["Классические точки без суеты", "Районы с собственным характером", "Маршрут под ваш темп"],
  },
  {
    title: "Загородные маршруты",
    duration: "День и больше",
    href: "/intercity",
    image: "/dest-intercity.jpg",
    summary:
      "Выезды из Токио туда, где особенно важны логистика, ритм и правильный контекст: Хаконэ, Никко, Камакура, Фудзи, Киото и другие направления.",
    highlights: ["Однодневные выезды", "Комфортная логистика", "Формат под интересы группы"],
  },
  {
    title: "Многодневные путешествия",
    duration: "2–14 дней",
    href: "/multi-day",
    image: "/dest-multi-day.jpg",
    summary:
      "Формат для тех, кому интересна Япония между городами: небольшие посёлки, портовые городки, горные дороги, локальная повседневность и более глубокий ритм страны.",
    highlights: ["Маршруты между регионами", "Больше глубины и атмосферы", "Подходит для неторопливых поездок"],
  },
] as const;

const processSteps = [
  {
    title: "Вы рассказываете о поездке",
    text: "Даты, состав группы, интересы, предпочтительный темп и то, что вам особенно важно увидеть в Японии.",
    icon: MessageSquareMore,
  },
  {
    title: "Я предлагаю формат и маршрут",
    text: "Токио, выезд из столицы или более длинное путешествие по стране. С понятной логикой и без случайного набора точек.",
    icon: Route,
  },
  {
    title: "Мы уточняем детали",
    text: "Логистика, транспорт, сезонные акценты, бытовые нюансы и ритм дня, чтобы путешествие получилось цельным.",
    icon: TrainFront,
  },
] as const;

const fitItems = [
  "Для первой поездки, если хочется не просто отметить главные места, а понять страну глубже.",
  "Для тех, кто уже бывал в Японии и хочет выйти за пределы стандартного маршрута.",
  "Для пары, семьи или небольшой группы, когда важны комфорт, ритм и личный контакт.",
] as const;

const faqs = [
  {
    question: "Вы работаете только в Токио?",
    answer:
      "Нет. Токио остаётся лучшей точкой входа в страну, но я также работаю с выездами из столицы и более длинными маршрутами по Японии.",
  },
  {
    question: "Можно ли адаптировать маршрут под интересы группы?",
    answer:
      "Да. Именно в этом и состоит смысл частного формата: маршрут собирается под ваш состав, темп, интересы и бытовые предпочтения, а не наоборот.",
  },
  {
    question: "На каком языке проходят экскурсии?",
    answer:
      "Основной язык работы — русский. При необходимости я также могу помочь с коммуникацией на английском и японском в ходе поездки.",
  },
  {
    question: "С чего лучше начать обращение?",
    answer:
      "Достаточно написать даты поездки, количество человек, базовые города, которые уже есть в планах, и пару слов о том, что вам особенно интересно.",
  },
  {
    question: "Когда лучше начинать планирование?",
    answer:
      "Чем раньше, тем лучше, особенно если речь идёт о длинных маршрутах, сезоне сакуры, осенних поездках или путешествии на несколько регионов.",
  },
  {
    question: "Можно обратиться только за помощью с маршрутом?",
    answer:
      "Да. Иногда полезнее сначала обсудить саму логику поездки: как распределить дни, какие регионы сочетать, где стоит замедлиться, а где не тратить время зря.",
  },
] as const;

const homepageSchemas = [
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Частный гид по Японии на русском",
    url: "https://jumboinjapan.com",
    description:
      "Частный гид по Японии на русском языке: Токио, выезды из Токио и многодневные маршруты по стране с локальным контекстом.",
    inLanguage: "ru",
    about: {
      "@type": "Person",
      name: "Eduard Revidovich",
      alternateName: "Эдуард Ревидович",
    },
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  },
];

export const metadata: Metadata = {
  title: "Частный гид по Японии на русском",
  description:
    "Частный гид по Японии на русском языке: Токио, выезды из Токио и многодневные маршруты по стране с локальным контекстом.",
  alternates: {
    canonical: "https://jumboinjapan.com",
  },
  openGraph: {
    title: "Частный гид по Японии на русском | JumboInJapan",
    description:
      "Токио, загородные маршруты и многодневные путешествия по Японии с частным гидом и вниманием к реальному контексту.",
    url: "https://jumboinjapan.com",
    type: "website",
    locale: "ru_RU",
    images: [
      {
        url: "/hero-city-tour-rainbow-bridge-tokyo-tower.jpg",
        width: 1400,
        height: 900,
        alt: "Токио вечером, Радужный мост и Токийская башня",
      },
    ],
  },
};

export default function HomePage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(homepageSchemas) }} />

      <section className="relative isolate overflow-hidden border-b border-[var(--border)] bg-[var(--text)] text-[var(--surface)]">
        <div className="absolute inset-0">
          <Image
            src="/hero-city-tour-rainbow-bridge-tokyo-tower.jpg"
            alt="Вечерний Токио с видом на Радужный мост и Токийскую башню"
            fill
            priority
            className="object-cover object-center opacity-60"
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(20,12,7,0.90)_0%,rgba(20,12,7,0.78)_36%,rgba(20,12,7,0.56)_62%,rgba(20,12,7,0.34)_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(20,12,7,0.18)_0%,rgba(20,12,7,0.10)_20%,rgba(20,12,7,0.68)_100%)]" />
        </div>

        <div className="relative mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-6xl flex-col justify-end px-4 pt-28 pb-8 md:px-6 md:pt-36 md:pb-10 lg:min-h-[760px] lg:pt-40 lg:pb-12">
          <div className="max-w-3xl space-y-6 md:space-y-8">
            <div className="space-y-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--accent-soft)]">Частный гид по Японии</p>
              <h1 className="max-w-[16ch] text-[42px] font-medium tracking-[-0.04em] leading-[1.02] text-white md:max-w-none md:text-[62px] lg:text-[68px] lg:leading-[0.98]">
                Япония в деталях.
              </h1>
            </div>
            <p className="max-w-[44ch] text-[17px] font-light leading-[1.72] text-white/84 md:text-[21px] md:leading-[1.62]">
              Путешествия с гидом для тех, кому важно не просто увидеть, но и понять.
            </p>
            <div className="flex flex-wrap gap-3 text-[11px] uppercase tracking-[0.16em] text-white/62 md:text-[12px]">
              <span>Токио</span>
              <span>•</span>
              <span>Выезды из столицы</span>
              <span>•</span>
              <span>Многодневные маршруты</span>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <Link
                href="/contact"
                className="inline-flex min-h-11 items-center justify-center bg-[var(--accent)] px-8 py-4 text-sm font-medium tracking-[0.12em] text-white uppercase transition-colors hover:bg-[var(--accent-hover)]"
              >
                Обсудить путешествие
              </Link>
              <Link
                href="#journeys"
                className="inline-flex min-h-11 items-center gap-2 text-sm font-medium tracking-[0.12em] text-white uppercase transition-colors hover:text-[var(--accent-soft)]"
              >
                Посмотреть форматы
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <div className="mt-12 grid gap-px overflow-hidden border border-white/10 bg-white/10 backdrop-blur-sm md:grid-cols-4">
            {[
              ["25+", "лет жизни в Японии"],
              ["20+", "лет в туризме"],
              ["400+", "авторских маршрутов"],
              ["1500+", "дней работы гидом"],
            ].map(([value, label]) => (
              <div key={label} className="bg-[rgba(20,12,7,0.52)] p-5 md:p-6">
                <p className="text-3xl font-light tracking-[-0.04em] text-white md:text-[40px]">{value}</p>
                <p className="mt-2 text-[11px] uppercase tracking-[0.16em] text-white/66">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-16 md:px-6 md:py-24">
        <div className="mx-auto grid w-full max-w-6xl gap-12 lg:grid-cols-[minmax(0,1.02fr)_minmax(320px,0.98fr)] lg:gap-20">
          <div className="space-y-5">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--gold)]">Подход</p>
            <h2 className="max-w-[14ch] text-[30px] font-medium tracking-[-0.03em] leading-[1.1] text-[var(--text)] md:text-[42px] md:leading-[1.06] lg:text-[46px]">
              Как и в театре, в путешествии каждый выбирает свой жанр и свою драматургию.
            </h2>
          </div>
          <div className="max-w-[38rem] space-y-6 text-[16px] font-light leading-[1.92] text-[var(--text-muted)] lg:pt-1">
            <p>
              Япония часто остаётся понятой лишь наполовину. Даже насыщенное путешествие может остаться набором красивых
              инстаграм-локаций, если в нём не хватает контекста, ритма и правильной оптики, которая помогает понять то,
              что мы переживаем.
            </p>
            <p>
              Для меня работа гида начинается именно здесь: помочь увидеть не только места, но и связи между ними,
              характер районов, региональные различия, культурные коды и их истоки, а также ту повседневность, из которой
              и складывается настоящее впечатление о стране.
            </p>
          </div>
        </div>
      </section>

      <section id="journeys" className="border-b border-[var(--border)] bg-[var(--bg)] px-4 py-20 md:px-6 md:py-28">
        <div className="mx-auto w-full max-w-6xl space-y-10 md:space-y-14">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl space-y-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--gold)]">Форматы путешествия</p>
              <h2 className="text-[30px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-5xl">Какой формат путешествия ближе именно вам</h2>
              <p className="text-[15px] font-light leading-[1.85] text-[var(--text-muted)] md:text-base">
                Токио, выезды из столицы или более длинная поездка по стране. Здесь важен не каталог направлений, а
                ритм, глубина и способ прожить Японию, который подходит именно вам.
              </p>
            </div>
            <Link
              href="/contact"
              className="inline-flex min-h-11 items-center gap-2 text-sm font-medium tracking-[0.12em] text-[var(--text)] uppercase transition-colors hover:text-[var(--accent)]"
            >
              Подобрать формат
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="overflow-hidden border border-[var(--border)] bg-[var(--surface)]">
            {journeyFormats.map((journey) => (
              <article
                key={journey.title}
                className="grid gap-px border-t border-[var(--border)] bg-[var(--border)] first:border-t-0 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-center"
              >
                <div className="bg-[var(--surface)] p-5 md:p-6">
                  <div className="relative aspect-[4/3] overflow-hidden bg-[var(--bg-warm)]">
                    <Image
                      src={journey.image}
                      alt={journey.title}
                      fill
                      className="object-cover object-center"
                      sizes="(max-width: 1024px) 100vw, 340px"
                    />
                  </div>
                </div>

                <div className="bg-[var(--surface)] p-6 md:p-8 lg:p-10">
                  <div className="max-w-2xl space-y-4">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--gold)]">{journey.duration}</p>
                    <h3 className="text-[28px] font-medium tracking-[-0.03em] leading-[1.08] text-[var(--text)] md:text-[38px]">
                      {journey.title}
                    </h3>
                    <p className="max-w-[42rem] text-[15px] font-light leading-[1.85] text-[var(--text-muted)] md:text-base">
                      {journey.summary}
                    </p>
                  </div>

                  <ul className="mt-6 max-w-[32rem] space-y-2 text-[14px] font-light leading-[1.7] text-[var(--text-muted)]">
                    {journey.highlights.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>

                  <Link
                    href={journey.href}
                    className="mt-7 inline-flex min-h-11 items-center gap-2 whitespace-nowrap text-[13px] font-medium tracking-[0.04em] text-[var(--text)] uppercase transition-colors hover:text-[var(--accent)]"
                  >
                    Смотреть маршрут
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-24">
        <div className="mx-auto w-full max-w-6xl space-y-10">
          <div className="max-w-3xl space-y-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--gold)]">Как строится работа</p>
            <h2 className="text-[30px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-5xl">Путешествие собирается вокруг вас, а не вокруг шаблона</h2>
          </div>

          <div className="grid gap-px overflow-hidden border border-[var(--border)] bg-[var(--border)] md:grid-cols-3">
            {processSteps.map((step) => {
              const Icon = step.icon;

              return (
                <article key={step.title} className="bg-[var(--surface)] p-6 md:p-8">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] text-[var(--accent)]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-6 text-xl font-medium tracking-[-0.02em] text-[var(--text)]">{step.title}</h3>
                  <p className="mt-4 text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">{step.text}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-20 md:px-6 md:py-28">
        <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[minmax(280px,0.7fr)_minmax(0,1.3fr)] lg:gap-16">
          <div className="space-y-5">
            <div className="relative aspect-[4/5] overflow-hidden border border-[var(--border)]">
              <Image
                src="/about-photo.jpg"
                alt="Эдуард Ревидович, частный гид по Японии"
                fill
                className="object-cover object-top"
                sizes="(max-width: 1024px) 100vw, 32vw"
              />
            </div>
            <div className="border border-[var(--border)] bg-[var(--bg)] p-5">
              <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--gold)]">Личный принцип</p>
              <p className="mt-3 text-[18px] font-light leading-[1.6] text-[var(--text)]">“{about.quote}”</p>
            </div>
          </div>

          <div className="space-y-8">
            <div className="space-y-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--gold)]">О гиде и формате</p>
              <h2 className="text-[30px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-5xl">Личный опыт, который превращается в правильный контекст</h2>
              <p className="max-w-3xl text-[15px] font-light leading-[1.9] text-[var(--text-muted)] md:text-base">
                Более 25 лет жизни в Японии и более 20 лет в туризме позволяют видеть страну не как набор достопримечательностей,
                а как живую среду со своими оттенками, привычками и внутренней логикой. Именно это особенно важно, когда путешествие
                должно получиться цельным, а не просто насыщенным.
              </p>
            </div>

            <div className="grid gap-px overflow-hidden border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2">
              {fitItems.map((item) => (
                <div key={item} className="bg-[var(--bg)] p-5 text-[15px] font-light leading-[1.8] text-[var(--text-muted)] md:p-6">
                  {item}
                </div>
              ))}
              <div className="bg-[var(--bg)] p-5 md:p-6">
                <div className="flex items-center gap-3">
                  <Compass className="h-5 w-5 text-[var(--accent)]" />
                  <p className="text-sm font-medium tracking-[0.12em] uppercase text-[var(--text)]">Фокус работы</p>
                </div>
                <p className="mt-4 text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">
                  Токио как лучшая точка входа, выезды из столицы, региональные маршруты и более длинные путешествия, где особенно важны ритм,
                  логистика и чувство места.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-[var(--border)] bg-[var(--bg)] px-4 py-20 md:px-6 md:py-28">
        <div className="mx-auto w-full max-w-6xl space-y-10">
          <div className="max-w-3xl space-y-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--gold)]">Частые вопросы</p>
            <h2 className="text-[30px] font-medium tracking-[-0.03em] text-[var(--text)] md:text-5xl">То, что обычно хочется уточнить до первого сообщения</h2>
            <p className="text-[15px] font-light leading-[1.85] text-[var(--text-muted)] md:text-base">
              Здесь самые важные ориентиры, которые помогают понять формат работы ещё до начала разговора.
            </p>
          </div>

          <div className="grid gap-px overflow-hidden border border-[var(--border)] bg-[var(--border)] lg:grid-cols-2">
            {faqs.map((item) => (
              <article key={item.question} className="bg-[var(--surface)] p-6 md:p-7">
                <div className="flex items-start gap-3">
                  <MapPinned className="mt-1 h-5 w-5 shrink-0 text-[var(--accent)]" />
                  <div>
                    <h3 className="text-lg font-medium tracking-[-0.02em] text-[var(--text)]">{item.question}</h3>
                    <p className="mt-3 text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">{item.answer}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[var(--text)] px-4 py-20 text-[var(--surface)] md:px-6 md:py-24">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--accent-soft)]">Контакт</p>
            <h2 className="text-[30px] font-medium tracking-[-0.03em] text-white md:text-5xl">Хорошее путешествие начинается с короткого разговора</h2>
            <p className="text-[15px] font-light leading-[1.85] text-white/76 md:text-base">
              Напишите даты, состав группы и пару слов о том, как вам хотелось бы прожить эту поездку. Дальше можно спокойно собрать маршрут под вас,
              без лишнего шума и без случайного набора точек.
            </p>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row lg:flex-col lg:items-stretch">
            <Link
              href="/contact"
              className="inline-flex min-h-11 items-center justify-center bg-[var(--accent)] px-8 py-4 text-sm font-medium tracking-[0.12em] text-white uppercase transition-colors hover:bg-[var(--accent-hover)]"
            >
              Написать Эдуарду
            </Link>
            <Link
              href="/intercity"
              className="inline-flex min-h-11 items-center justify-center border border-white/16 px-8 py-4 text-sm font-medium tracking-[0.12em] text-white uppercase transition-colors hover:bg-white/8"
            >
              Посмотреть маршруты
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
