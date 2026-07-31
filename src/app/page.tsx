import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CircleHelp, MessageSquareMore, Route, Search } from "lucide-react";

import { about } from "@/data/about";
import { guideRef } from "@/lib/schema";
import { typoDeep } from "@/lib/typography";

const journeyFormats = typoDeep([
  {
    title: "По Токио",
    duration: "4–8 часов",
    href: "/city-tour",
    image: "/dest-city-tour-tokyo-station.jpg",
    summary:
      "Токио — естественная точка первого знакомства с Японией. Частная экскурсия по городу: храмы, сады, современные районы и архитектура — всё, чтобы сразу почувствовать контраст и ритм японской столицы.",
    highlights: [
      "Ключевые городские локации",
      "«Свои» районы Токио",
      "Маршрут под собственный ритм",
    ],
  },
  {
    title: "Маршруты из Токио",
    duration: "День и больше",
    href: "/intercity",
    image: "/dest-intercity-fuji.jpg",
    summary:
      "Нельзя почувствовать страну, оставаясь только в одном городе. Никко, Хаконе, Фудзи — однодневные поездки из Токио. У каждого направления своя душа: природа, история, традиции, праздники и развлечения.",
    highlights: ["Выезды на день и более", "Комфортная логистика", "Коррекция маршрута на ходу"],
  },
  {
    title: "Многодневные путешествия",
    duration: "2–14 дней",
    href: "/multi-day",
    image: "/dest-multi-day-journeys-hero-20260421c.jpg",
    summary:
      "Формат для тех, кому интересна Япония между городами: небольшие посёлки, портовые городки, горные дороги, локальная повседневность и более глубокий ритм страны.",
    highlights: ["Маршруты между регионами", "Больше глубины и атмосферы", "Подходит для неторопливых поездок"],
  },
] as const);

const processSteps = typoDeep([
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
    icon: Search,
  },
] as const);

const aboutCards = typoDeep([
  {
    title: "Первая поездка",
    text: "Даже для первой поездки маршрут стоит обсудить с гидом, если хочется не просто отметить главные места и сделать обязательные фотографии, а увидеть страну немного глубже, понять её ритм, детали и то, как она устроена изнутри.",
  },
  {
    title: "Повторное путешествие",
    text: "Для тех, кто уже бывал в Японии и хочет выйти за пределы стандартного маршрута. Стоит выбирать поездки по регионам: Тохоку и Хоккайдо — если нужен акцент на природе, Кансай и Санъё — если вам ближе культура и история.",
  },
  {
    title: "Частный формат",
    text: "Возможно, вы хотели бы поездку под ключ, собранную с учётом всех пожеланий: подбор отелей и ресторанов, заказной транспорт, вертолётные прогулки, мастер-классы и закрытые сады.",
  },
  {
    title: "Фокус маршрутов",
    text: "Стоит вспомнить, что в поездках доставляет вам радость и удовольствие: прогулки на природе, арт, необычный шоппинг, гостиничный отдых и спа. Вокруг этих предпочтений складывается ритм поездки по стране.",
  },
] as const);

const faqs = typoDeep([
  {
    question: "Вы работаете только в Токио?",
    answer:
      "Нет. Токио всего лишь рекомендуемая мною точка для первого знакомства со страной, но как гид-универсал я работаю по любым маршрутам в Японии.",
  },
  {
    question: "Можно ли адаптировать маршрут под интересы группы?",
    answer:
      "Да. Именно в этом и состоит смысл частного формата: маршрут я собираю под вашу группу — её интересы, темп и бытовые предпочтения, а не наоборот.",
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
] as const);

// Блок «Подход»: тезис эпиграфом на всю ширину, под линейкой две колонки —
// слева то, с чем гость приезжает, справа работа гида, — и вывод отдельной
// строкой внизу. Каждая колонка ровно один абзац: разрез проходит по шву
// «сложность / что я с этим делаю», внутри колонки мысль не рвётся.
const approach = typoDeep({
  label: "Подход",
  heading: "Путешествие — это сцена театра, где зритель выбирает свой жанр",
  columnOne:
    "Япония часто остаётся понятой лишь наполовину: насыщенное путешествие превращается в набор красивых кадров, если в нём не хватает контекста, ритма и правильной драматургии. Человек приезжает со своими ожиданиями, клише и представлениями о Японии.",
  columnTwo:
    "Я как драматург решаю, с чего начать, где сделать паузу, а где устроить кульминацию. Кому-то нужна точка входа через тихий храмовый район, другому через арт-пространство, а третьему — сразу суета молодёжного района. Нюансы планирования, которые невозможны без опыта личного контакта со зрителем.",
  conclusion:
    "Моя задача — сделать так, чтобы маршрут имел форму и в большей степени стал повествованием, нежели банальным списком мест для посещения.",
} as const);

const homepageSchemas = typoDeep([
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Частный гид по Японии на русском",
    url: "https://jumboinjapan.com",
    description:
      "Частный гид по Японии на русском языке: Токио, выезды из Токио и многодневные маршруты по стране с локальным контекстом.",
    inLanguage: "ru",
    about: guideRef,
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
]);

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
            className="object-cover object-center opacity-58"
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(20,12,7,0.92)_0%,rgba(20,12,7,0.82)_34%,rgba(20,12,7,0.58)_62%,rgba(20,12,7,0.26)_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(20,12,7,0.20)_0%,rgba(20,12,7,0.06)_24%,rgba(20,12,7,0.74)_100%)]" />
        </div>

        <div className="relative mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-6xl flex-col justify-between px-4 pt-28 pb-8 md:px-6 md:pt-36 md:pb-10 lg:min-h-[760px] lg:pt-40 lg:pb-12">
          <div className="max-w-4xl space-y-7 md:space-y-9">
            <div className="flex items-center gap-3 text-label font-medium uppercase tracking-[0.22em] text-[var(--accent-soft)]">
              <span className="h-px w-10 bg-[var(--accent-soft)]/55" />
              <span>Эдуард Ревидович — частный гид в Японии</span>
            </div>

            <div className="space-y-5">
              <h1 className="text-hero leading-[1.02] text-white lg:leading-[0.98]">
                Япония в деталях.
              </h1>
              <p className="max-w-[40ch] text-body font-light leading-[1.72] text-white/84 md:text-lead md:leading-[1.62]">
                От Хоккайдо до Окинавы. Авторские маршруты по всей стране — для первого и не первого знакомства.
              </p>
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

          <div className="mt-12 flex flex-col gap-4 border-t border-white/12 pt-5 md:flex-row md:items-end md:justify-between md:pt-6">
            <p className="max-w-[30rem] text-meta font-light leading-[1.7] text-white/66 md:text-body-sm">
              Индивидуальные поездки по всей Японии — вне шаблонов
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-label uppercase tracking-[0.16em] text-white/54 md:justify-end">
              <span>Токио</span>
              <span>Киото</span>
              <span>Осака</span>
              <span>Маршруты по Японии</span>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-16 md:px-6 md:py-24 section-tint">
        <div className="mx-auto w-full max-w-6xl">
          <p className="text-label font-medium uppercase tracking-[0.22em] text-[var(--gold-text)]">{approach.label}</p>
          <h2 className="mt-5 max-w-[46rem] text-section leading-[1.1] text-[var(--text)] md:leading-[1.08]">
            {approach.heading}
          </h2>
          {/* На мобильном колонки складываются в одну ленту: зазор между ними
              должен совпадать с межабзацным, иначе в середине прозы читается
              разрыв раздела. На десктопе это уже расстояние между колонками. */}
          <div className="mt-10 grid gap-4 border-t border-[var(--border)] pt-10 text-body font-light leading-[1.8] text-[var(--text-muted)] md:grid-cols-2 md:gap-14">
            <p>{approach.columnOne}</p>
            <p>{approach.columnTwo}</p>
          </div>
          {/* Вывод — врезка-цитата: антиква на 24 px, а не проза с засечками.
              На 20 px Lora читается как блог (см. правило гарнитур в
              src/lib/fonts.ts), на этом кегле — как редакционная реплика.
              Линейка вынесена из абзаца в отдельный блок: иначе она обрезалась
              по мере текста и не совпадала с верхней. */}
          <div className="mt-10 border-t border-[var(--border)] pt-8">
            <p className="max-w-[40rem] font-display text-title-sm leading-[1.4] text-[var(--text)]">
              {approach.conclusion}
            </p>
          </div>
        </div>
      </section>

      <section id="journeys" className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-20 md:px-6 md:py-28 section-tint">
        <div className="mx-auto w-full max-w-6xl space-y-10 md:space-y-14">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl space-y-4">
              <p className="text-label font-medium uppercase tracking-[0.22em] text-[var(--gold-text)]">Форматы путешествия</p>
              <h2 className="text-section text-[var(--text)]">Какой формат путешествия ближе именно вам</h2>
              <p className="text-body-sm font-light leading-[1.85] text-[var(--text-muted)] md:text-base">
                Токио, Киото, Осака или авторский маршрут через несколько регионов Японии — это не просто точки на
                карте, а решение о том, как вы хотите прожить это путешествие.
              </p>
            </div>
            {/* Единственная ссылка на анкету, оставленная на главной: здесь
                она уместна — подбор формата и есть то, что анкета делает.
                Но объём названа заранее, чтобы «подобрать» не оборачивалось
                неожиданными одиннадцатью экранами. */}
            <div className="shrink-0 space-y-1 md:text-right">
              <Link
                href="/profile"
                className="inline-flex min-h-11 items-center gap-2 text-sm font-medium tracking-[0.12em] text-[var(--text)] uppercase transition-colors hover:text-[var(--accent)]"
              >
                Подобрать формат
                <ArrowRight className="h-4 w-4" />
              </Link>
              <p className="text-meta font-light text-[var(--text-muted)]">11 вопросов, около трёх минут</p>
            </div>
          </div>

          <div className="border-y border-[var(--border)]">
            {journeyFormats.map((journey) => (
              <article
                key={journey.title}
                className="grid border-b border-[var(--border)] last:border-b-0 lg:min-h-[320px] lg:grid-cols-[360px_minmax(0,1fr)] lg:items-center"
              >
                <div className="relative min-h-[240px] overflow-hidden lg:min-h-[320px]">
                  <Image
                    src={journey.image}
                    alt={journey.title}
                    fill
                    className="object-cover object-center"
                    sizes="(max-width: 1024px) 100vw, 360px"
                  />
                </div>

                <div className="p-6 md:p-8 lg:px-12 lg:py-10">
                  <div className="max-w-2xl space-y-4">
                    <p className="text-label uppercase tracking-[0.2em] text-[var(--gold-text)]">{journey.duration}</p>
                    <h3 className="text-title leading-[1.08] text-[var(--text)]">
                      {journey.title}
                    </h3>
                    <p className="max-w-[42rem] text-body-sm font-light leading-[1.85] text-[var(--text-muted)] md:text-base">
                      {journey.summary}
                    </p>
                  </div>

                  <ul className="mt-6 max-w-[32rem] space-y-2 text-body-sm font-light leading-[1.7] text-[var(--text-muted)]">
                    {journey.highlights.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>

                  <Link
                    href={journey.href}
                    className="mt-7 inline-flex min-h-11 items-center gap-2 whitespace-nowrap text-meta font-medium tracking-[0.04em] text-[var(--text)] uppercase transition-colors hover:text-[var(--accent)]"
                  >
                    Смотреть маршруты
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-24 section-tint">
        <div className="mx-auto w-full max-w-6xl space-y-10">
          <div className="max-w-3xl space-y-4">
            <p className="text-label font-medium uppercase tracking-[0.22em] text-[var(--gold-text)]">Как строится работа</p>
            <h2 className="text-section text-[var(--text)]">Хорошее путешествие всегда начинается с простого разговора</h2>
          </div>

          <div className="grid gap-px overflow-hidden border border-[var(--border)] bg-[var(--border)] md:grid-cols-3">
            {processSteps.map((step) => {
              const Icon = step.icon;

              return (
                <article key={step.title} className="bg-[var(--surface)] p-6 md:p-8">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] text-[var(--accent)]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-6 text-xl text-[var(--text)]">{step.title}</h3>
                  <p className="mt-4 text-body-sm font-light leading-[1.8] text-[var(--text-muted)]">{step.text}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-20 md:px-6 md:py-28 section-tint">
        <div className="mx-auto w-full max-w-6xl space-y-10 md:space-y-12">
          <div className="grid gap-10 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-16">
            <div className="space-y-4">
              <div className="relative aspect-[4/5] overflow-hidden border border-[var(--border)] bg-[var(--bg)]">
                <Image
                  src="/about-photo.jpg"
                  alt="Эдуард Ревидович, частный гид по Японии"
                  fill
                  className="object-cover object-top"
                  sizes="(max-width: 1024px) 100vw, 320px"
                />
              </div>
              <p className="text-label uppercase tracking-[0.22em] text-[var(--gold-text)]">Эдуард Ревидович • частный гид</p>
            </div>

            <div className="space-y-5 border-b border-[var(--border)] pb-8 md:space-y-6 md:pb-10">
              <p className="text-label font-medium uppercase tracking-[0.22em] text-[var(--gold-text)]">О гиде и формате</p>
              <h2 className="text-section leading-[1.06] text-[var(--text)]">
                Япония — 25 лет непрекращающихся открытий
              </h2>
              <div className="max-w-2xl border-l border-[var(--accent)]/35 pl-5 md:pl-6">
                <p className="text-label uppercase tracking-[0.22em] text-[var(--gold-text)]">Личный принцип</p>
                <blockquote className="mt-3 font-[family-name:var(--font-display)] text-lead font-normal leading-[1.45] tracking-[-0.01em] text-[var(--text)] md:text-title-sm">
                  “{about.quote}”
                </blockquote>
              </div>
              <p className="max-w-3xl text-body-sm font-light leading-[1.9] text-[var(--text-muted)] md:text-base">
                Более 25 лет жизни в Японии и более 20 лет в туризме позволяют видеть страну не как набор достопримечательностей,
                а как живую среду со своими оттенками, привычками и внутренней логикой. Именно это особенно важно, когда путешествие
                должно получиться цельным, а не просто насыщенным.
              </p>
            </div>
          </div>

          <div className="grid gap-px overflow-hidden border border-[var(--border)] bg-[var(--border)] md:grid-cols-3">
            {typoDeep([
              ["25+", "лет в Японии"],
              ["20+", "лет в туризме"],
              ["400+", "авторских маршрутов"],
            ]).map(([value, label]) => (
              <div key={label} className="bg-[var(--surface)] p-5 md:p-6">
                <p className="text-title font-light tracking-[-0.04em] text-[var(--text)] md:text-section">{value}</p>
                <p className="mt-2 text-label uppercase tracking-[0.18em] text-[var(--text-muted)]">{label}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-px overflow-hidden border border-[var(--border)] bg-[var(--border)] md:grid-cols-2 xl:grid-cols-4">
            {aboutCards.map((item) => (
              <article key={item.title} className="flex h-full flex-col gap-4 bg-[var(--bg)] p-5 md:p-6">
                <p className="text-label font-medium uppercase tracking-[0.2em] text-[var(--gold-text)]">{item.title}</p>
                <p className="text-body-sm font-light leading-[1.85] text-[var(--text-muted)]">{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-[var(--border)] bg-[var(--bg)] px-4 py-20 md:px-6 md:py-28 section-tint">
        <div className="mx-auto w-full max-w-6xl space-y-10">
          <div className="max-w-3xl space-y-4">
            <p className="text-label font-medium uppercase tracking-[0.22em] text-[var(--gold-text)]">Частые вопросы</p>
            <h2 className="text-section text-[var(--text)]">То, что обычно хочется уточнить до первого сообщения</h2>
            <p className="text-body-sm font-light leading-[1.85] text-[var(--text-muted)] md:text-base">
              Здесь самые важные ориентиры, которые помогают понять формат работы ещё до начала разговора.
            </p>
          </div>

          <div className="grid gap-px overflow-hidden border border-[var(--border)] bg-[var(--border)] lg:grid-cols-2">
            {faqs.map((item) => (
              <article key={item.question} className="bg-[var(--surface)] p-6 md:p-7">
                <div className="flex items-start gap-3">
                  <CircleHelp className="mt-1 h-5 w-5 shrink-0 text-[var(--accent)]" />
                  <div>
                    <h3 className="text-lg text-[var(--text)]">{item.question}</h3>
                    <p className="mt-3 text-body-sm font-light leading-[1.8] text-[var(--text-muted)]">{item.answer}</p>
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
            <p className="text-label font-medium uppercase tracking-[0.22em] text-[var(--accent-soft)]">Контакт</p>
            <h2 className="text-section text-white">Хорошее путешествие начинается с короткого разговора</h2>
            <p className="text-body-sm font-light leading-[1.85] text-white/76 md:text-base">
              Достаточно пары строк: даты, состав группы и как вам хотелось бы прожить эту поездку. Дальше можно спокойно собрать маршрут под ваши
              интересы и ритм.
            </p>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row lg:flex-col lg:items-stretch">
            <Link
              href="/contact"
              className="inline-flex min-h-11 items-center justify-center bg-[var(--accent)] px-8 py-4 text-sm font-medium tracking-[0.12em] text-white uppercase transition-colors hover:bg-[var(--accent-hover)]"
            >
              Обсудить поездку
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
