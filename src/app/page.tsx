import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CircleHelp, MessageSquareMore, Route, Search } from "lucide-react";

import { about } from "@/data/about";
import { guideRef } from "@/lib/schema";
import { typo, typoDeep } from "@/lib/typography";

const journeyFormats = typoDeep([
  {
    title: "Обзорная экскурсия по Токио",
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
    title: "Вы делитесь своими планами",
    text: "Даты, состав группы, интересы, предпочтительный темп и то, что вам особенно важно увидеть в Японии.",
    icon: MessageSquareMore,
  },
  {
    title: "Я предлагаю формат и маршрут",
    text: "Город старта, выездные туры или план более сложного путешествия по стране. С понятной логистикой и ритмом остановок.",
    icon: Route,
  },
  {
    title: "Мы уточняем детали",
    text: "Логистика, финансы, транспорт, сезонные акценты, бытовые нюансы и ритм дня, чтобы путешествие получилось цельным.",
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
    text: "Возможно, вы хотели бы поездку под ключ, собранную с учётом всех пожеланий: подбор отелей и ресторанов, заказной транспорт, вертолётные прогулки, мастер-классы и закрытые сады. Я считаю, что главная ценность в пути по Японии — это возможность сделать паузу, и здесь мы с вами просто решаем, как лучше заполнить пространство между.",
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
      "Чем раньше, тем лучше, особенно если речь идёт о длинных маршрутах, сезоне сакуры, осенних поездках или путешествии по нескольким регионам.",
  },
  {
    question: "Можно обратиться только за помощью с маршрутом?",
    answer:
      "Да. Иногда полезнее сначала обсудить саму логику поездки: как распределить дни, какие регионы сочетать, где стоит замедлиться, а где не тратить время зря.",
  },
] as const);

const aboutCardsHeading = typo("Форматы поездок");
const journeysHeading = typo("Авторские форматы туров");
const journeysPickerTitle = typo("Не знаете, с чего начать?");
const journeysPickerText = typo(
  "Ответьте на несколько вопросов и получите на почту предварительный макет вашей программы, где я расскажу не только о маршруте, но и о важных событиях и мероприятиях, которые возможно будет посетить.",
);

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
            className="object-cover object-center opacity-90"
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(20,12,7,0.52)_0%,rgba(20,12,7,0.46)_34%,rgba(20,12,7,0.32)_62%,rgba(20,12,7,0.15)_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(20,12,7,0.11)_0%,rgba(20,12,7,0.03)_24%,rgba(20,12,7,0.41)_100%)]" />
        </div>

        <div className="relative mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-6xl min-[1800px]:max-w-[84rem] flex-col justify-between px-4 pt-28 pb-8 md:px-6 md:pt-36 md:pb-10 lg:min-h-[760px] lg:pt-40 lg:pb-12">
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
              {/* Ярлыки направлений ведут на свои страницы: строка выглядит как
                  перечень и по ней пробуют кликать. Вид не меняем — подсветка
                  сделала бы из неё второе меню в двадцати сантиметрах от шапки;
                  ссылка проявляется только при наведении. min-h-11 — палец на
                  телефоне должен попадать в 44 px, а не в 11-пиксельный капс. */}
              {[
                { label: "Токио", href: "/city-tour" },
                { label: "Киото", href: "/intercity/kyoto-1" },
                { label: "Осака", href: "/intercity/osaka" },
                { label: "Маршруты по Японии", href: "/multi-day" },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="inline-flex min-h-11 items-center underline-offset-4 transition-colors hover:text-[var(--accent-soft)] hover:underline"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="journeys" className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-24 md:px-6 md:py-32 section-tint">
        <div className="mx-auto w-full max-w-6xl min-[1800px]:max-w-[84rem]">
          {/* Три вертикальные рельсы на весь раздел: левый край, начало текстовой
              колонки, правый край. Шапка и карточки висят на одних и тех же —
              до правки заголовок, лид и текст карточки обрывались в трёх разных
              местах, и раздел читался как перекошенный. Надзаголовок снят: он
              дословно повторял заголовок. */}
          {/* В шапке остался только вопрос. Рассуждение о том, что формат —
              это решение, а не список точек, переехало в закрывающий блок: там
              оно объясняет анкету, а не дублирует её за два экрана до неё. */}
          <h2 className="max-w-[34rem] text-section leading-[1.08] text-[var(--text)]">{journeysHeading}</h2>

          <div className="mt-12 border-t border-[var(--border)] md:mt-14">
            {journeyFormats.map((journey, index) => {
              // Шахматный порядок: фотография меняет сторону через ряд. На
              // мобильном порядок один для всех — шахматка в одну колонку
              // смысла не имеет.
              const flipped = index % 2 === 1;
              return (
                <article
                  key={journey.title}
                  className="grid gap-8 border-b border-[var(--border)] py-12 lg:grid-cols-[minmax(0,44%)_minmax(0,1fr)] lg:items-center lg:gap-16 lg:py-16"
                >
                  {/* Пропорция задана жёстко, а не высотой ряда: три снимка
                      стоят одинаково, чем бы ни отличались исходники. */}
                  <div className={`relative aspect-[5/4] overflow-hidden ${flipped ? "lg:order-2" : ""}`}>
                    <Image
                      src={journey.image}
                      alt={journey.title}
                      fill
                      className="object-cover object-center"
                      sizes="(max-width: 1024px) 100vw, 44vw"
                    />
                  </div>

                  <div className={flipped ? "lg:order-1" : ""}>
                    <p className="text-label uppercase tracking-[0.2em] text-[var(--gold-text)]">{journey.duration}</p>
                    <h3 className="mt-4 text-title leading-[1.08] text-[var(--text)]">{journey.title}</h3>
                    <p className="mt-4 text-body font-light leading-[1.75] text-[var(--text-muted)]">
                      {journey.summary}
                    </p>
                    <Link
                      href={journey.href}
                      className="mt-7 inline-flex min-h-11 items-center gap-2 text-meta font-medium tracking-[0.04em] text-[var(--text)] uppercase transition-colors hover:text-[var(--accent)]"
                    >
                      Смотреть маршруты
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Единственный призыв раздела собран в один блок: вопрос, объяснение
              и действие рядом. Тёплая подложка отделяет его от карточек, но
              рельсы те же — левый край, текстовая колонка, правый край. */}
          <div className="mt-12 bg-[var(--bg-warm)] px-6 py-10 md:px-10 md:py-12 lg:mt-16">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,38%)_minmax(0,1fr)] lg:items-start lg:gap-14">
              <h3 className="text-title leading-[1.1] text-[var(--text)]">{journeysPickerTitle}</h3>
              <div>
                <p className="max-w-[36rem] text-body font-light leading-[1.75] text-[var(--text-muted)]">
                  {journeysPickerText}
                </p>
                <Link
                  href="/profile"
                  className="mt-7 inline-flex min-h-11 items-center justify-center bg-[var(--accent)] px-7 py-3.5 text-sm font-medium tracking-[0.12em] text-white uppercase transition-colors hover:bg-[var(--accent-hover)]"
                >
                  Получить маршрут
                </Link>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* Фотопауза — единственный полноширинный кадр страницы. Восемь секций
          подряд устроены одинаково (метка, заголовок, ряд плашек), и глазу
          негде передохнуть между выбором формата и разговором о работе.
          Текста здесь нет намеренно: пауза не должна ничего сообщать.
          Кадр свой, не общий с героем /intercity: пропорция 2,6:1 нарезана
          под широкую полосу, ворота занимают 55% высоты и переживают любой
          срез — от мобильной 1,2:1 до 4,7:1 на большом мониторе. */}
      <section
        aria-hidden
        className="relative isolate h-[38vh] min-h-[260px] overflow-hidden border-b border-[var(--border)] lg:h-[52vh] lg:max-h-[660px]"
      >
        {/* object-[63%_center]: на узком экране кадр режется по бокам, и центр
            окна должен приходиться на тории — в оригинале они на 63% ширины.
            На широких экранах обрезка вертикальная, координата X не влияет. */}
        <Image
          src="/pause-torii.jpg"
          alt=""
          fill
          className="object-cover object-[63%_center]"
          sizes="100vw"
        />
      </section>

      <section className="border-b border-[var(--border)] bg-[var(--bg-warm)] px-4 py-16 md:px-6 md:py-20 section-tint">
        <div className="mx-auto w-full max-w-6xl min-[1800px]:max-w-[84rem] space-y-10">
          <div className="max-w-3xl space-y-4">
            <p className="text-label font-medium uppercase tracking-[0.22em] text-[var(--gold-text)]">Как строится работа</p>
            <h2 className="text-section text-[var(--text)]">Хорошее путешествие всегда начинается с разговора</h2>
          </div>

          {/* Не плашки, а последовательность: три шага разделены волосяными
              линейками. Раньше здесь, у цифр и у карточек «кому подходит» стояла
              одна и та же конструкция из обведённых прямоугольников — три разных
              по смыслу блока читались как один длинный список. */}
          <div className="grid border-y border-[var(--border)] md:grid-cols-3 md:divide-x md:divide-[var(--border)]">
            {processSteps.map((step) => {
              const Icon = step.icon;

              return (
                <article
                  key={step.title}
                  className="border-b border-[var(--border)] py-8 last:border-b-0 md:border-b-0 md:px-8 md:py-10 md:first:pl-0 md:last:pr-0"
                >
                  <Icon className="h-5 w-5 text-[var(--accent)]" />
                  <h3 className="mt-5 text-title-sm text-[var(--text)]">{step.title}</h3>
                  <p className="mt-3 text-body-sm font-light leading-[1.8] text-[var(--text-muted)]">{step.text}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-24 md:px-6 md:py-32 section-tint">
        <div className="mx-auto w-full max-w-6xl min-[1800px]:max-w-[84rem] space-y-10 md:space-y-12">
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
              <p className="text-label font-medium uppercase tracking-[0.22em] text-[var(--gold-text)]">О себе</p>
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
                Более 25 лет жизни в Японии и более 20 лет в туризме позволяют видеть страну не как набор
                достопримечательностей, а как живую среду людей со своими региональными оттенками, пищевыми
                пристрастиями и внутренней гармонией. Именно это особенно важно, когда задача в поездке не просто
                увидеть набор мест, но и хотя бы немного прикоснуться к пониманию людей и культуры.
              </p>
            </div>
          </div>

          {/* Самый сильный аргумент страницы набран дисплейным кеглем антиквой:
              до правки цифры стояли ниже заголовка карточки и терялись между
              двумя соседними рядами плашек. */}
          <div className="grid border-y border-[var(--border)] sm:grid-cols-3 sm:divide-x sm:divide-[var(--border)]">
            {typoDeep([
              ["25+", "лет в Японии"],
              ["20+", "лет в туризме"],
              ["400+", "авторских маршрутов"],
            ]).map(([value, label]) => (
              <div
                key={label}
                className="border-b border-[var(--border)] py-8 last:border-b-0 sm:border-b-0 sm:px-8 sm:py-10 sm:first:pl-0 sm:last:pr-0"
              >
                <p className="font-display text-page leading-none tracking-[-0.02em] text-[var(--text)] tabular-nums">
                  {value}
                </p>
                <p className="mt-4 text-label uppercase tracking-[0.18em] text-[var(--text-muted)]">{label}</p>
              </div>
            ))}
          </div>

          {/* У списка появился собственный заголовок: без него четыре записи
              читались как продолжение цифр, а не как отдельный разговор о
              формате. h3, потому что h2 в секции уже занят «Япония — 25 лет». */}
          <h3 className="max-w-[34rem] text-title leading-[1.1] text-[var(--text)]">{aboutCardsHeading}</h3>

          {/* Список, а не плашки: метка слева, текст справа, записи разделены
              линейками. Две колонки вместо четырёх — четыре узких столбца рвали
              русский текст на строки по три слова. */}
          <div className="mt-8 grid border-t border-[var(--border)] md:grid-cols-2 md:gap-x-16">
            {aboutCards.map((item) => (
              <article
                key={item.title}
                className="grid gap-2 border-b border-[var(--border)] py-6 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6 md:py-7"
              >
                <p className="text-label font-medium uppercase tracking-[0.2em] text-[var(--gold-text)] sm:pt-1">
                  {item.title}
                </p>
                <p className="text-body-sm font-light leading-[1.8] text-[var(--text-muted)]">{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-[var(--border)] bg-[var(--bg)] px-4 py-20 md:px-6 md:py-24 section-tint">
        <div className="mx-auto w-full max-w-6xl min-[1800px]:max-w-[84rem] space-y-10">
          <div className="max-w-3xl space-y-4">
            <p className="text-label font-medium uppercase tracking-[0.22em] text-[var(--gold-text)]">Частые вопросы</p>
            <h2 className="text-section text-[var(--text)]">Формат предоставляемых услуг</h2>
            <p className="text-body-sm font-light leading-[1.85] text-[var(--text-muted)] md:text-base">
              Здесь самые важные ориентиры, которые помогают понять, подходит ли вам формат моих услуг.
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
    </>
  );
}
