import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { PageHero } from "@/components/sections/PageHero";

const canonicalUrl = "https://jumboinjapan.com/city-tour/day-one";

export const metadata: Metadata = {
  title: "Токио за один день: маршрут с гидом — Гинза, Цукидзи, Мэйдзи, Сибуя",
  description:
    "Маршрут по Токио на один день: Гинза, сад Хамарикю, рынок Цукидзи, святилище Мэйдзи, Харадзюку и Сибуя. Тур с русскоязычным гидом 6–8 часов.",
  alternates: {
    canonical: canonicalUrl,
  },
  openGraph: {
    title: "Токио за один день: маршрут с гидом | JumboInJapan",
    description:
      "Маршрут по Токио на один день: Гинза, сад Хамарикю, рынок Цукидзи, святилище Мэйдзи, Харадзюку и Сибуя. Тур с русскоязычным гидом 6–8 часов.",
    url: canonicalUrl,
    images: [{ url: "/hero-city-tour-day-one.jpg" }],
  },
};

const program = {
  title: "Токио за один день: маршрут с гидом",
  description:
    "Этот тур по Токио с русскоязычным гидом собран как первое глубокое знакомство с городом за один день. Маршрут проходит через Гинзу, сад Хамарикю, рынок Цукидзи, святилище Мэйдзи, Харадзюку и Сибую, чтобы показать разные грани Токио — от старых традиций и японских садов до гастрономии, молодёжной культуры и современного мегаполиса. Такой маршрут удобно выбирать тем, кто хочет увидеть главное без туристического конвейера и понять внутреннюю логику города уже в первый день.",
  duration: "6–8 часов",
};

type Stop = {
  id: string;
  number: string;
  title: string;
  text: string;
  duration: string;
  photo: string;
  alt?: string;
};

const stops: Stop[] = [
  {
    id: "ginza",
    number: "01 · Утро",
    title: "Гинза",
    text: "Гинза в Токио давно стала символом престижа, моды и безупречного дизайна далеко за пределами Японии. Почти в каждом мегаполисе есть свой люксовый квартал, где соседствуют Chanel, Hermès и Mikimoto, но именно район Гинза в Токио соединяет статусный шопинг с историей развития города. Это не просто витрина luxury-брендов, а пространство, где японское ремесло, эстетика и коммерция существуют на стыке мастерства и искусства.\n\nСтаринный магазин библий, кофейня 1940-х годов с репутацией одного из лучших мест для кофе, магазин японских сладостей, салон кимоно — даже если вас не интересует шопинг, Гинза даёт редкую возможность увидеть, как формировалась японская культура роскоши, вкуса и потребления.",
    duration: "~45 минут",
    photo: "/tours/city-tour-day-one/ginza-six.jpg",
    alt: "Фасад и городской ритм района Гинза в Токио",
  },
  {
    id: "hamarikyu",
    number: "02 · Середина утра",
    title: "Сад Хамарикю",
    text: "Сад Хамарикю в Токио находится всего в десяти минутах пешком от Гинзы, но ощущается как совершенно другой мир. Этот исторический японский сад существует с XVII века: когда-то здесь охотились сёгуны правящего в Эдо клана Токугава, а сегодня сюда приходят, чтобы в тишине наблюдать за утками и пить матча в чайном домике у пруда. За границей сада поднимаются небоскрёбы — эффектный контраст природы и мегаполиса, очень характерный для Токио.\n\nВ зависимости от сезона в Хамарикю можно увидеть цветение рапса или хризантем, в воде мелькает рыба, а по берегам неспешно ходят цапли. Обычно мы проводим здесь около часа, этого достаточно, чтобы замедлиться, перевести дыхание и только потом снова погрузиться в плотный ритм и живой хаос района рынка Цукидзи.",
    duration: "~50 минут",
    photo: "/tours/city-tour-day-one/hamarikyu-teahouse.jpg",
    alt: "Чайный домик и пруд в саду Хамарикю",
  },
  {
    id: "tsukiji",
    number: "03 · Обед",
    title: "Рынок Цукидзи",
    text: "Внешний рынок Цукидзи — одно из самых известных гастрономических мест Токио и настоящая точка притяжения для любителей японского стритфуда со всего мира. Туристов здесь много, но рынок по-прежнему даёт живое и очень материальное ощущение городской еды: десятки маленьких прилавков готовят тамагояки, подают морского ежа и нарезают тунца с той уверенностью и точностью, за которые Цукидзи и ценят.\n\nСюда лучше приходить голодными. Кто-то ищет лучший кусок тунца, кто-то — свежайшие морепродукты, кто-то — быстрый и шумный гастрономический опыт Токио. В Цукидзи каждый находит своё: от простой закуски на ходу до маленького вкусового открытия, ради которого сюда хочется вернуться снова.",
    duration: "~60 минут",
    photo: "/tours/city-tour-day-one/tsukiji-chef.jpg",
    alt: "Шеф и уличная гастрономия на рынке Цукидзи",
  },
  {
    id: "meiji",
    number: "04 · День",
    title: "Святилище Мэйдзи",
    text: "Мэйдзи Дзингу — это опыт тишины в одном из самых шумных городов мира. У входа возвышаются гигантские тории из японского кедра, а дальше начинается лесной массив площадью около 70 гектаров. Этот лес был высажен вручную в 1920 году и со временем превратился в настоящий оазис в самом центре Токио. Здесь молятся, заключают браки и просто переживают редкое для мегаполиса состояние внутренней паузы.\n\nПо дороге мы говорим о синтоизме не только как о религии, но и как о японском способе воспринимать пространство, время и присутствие человека в мире. Здесь же особенно удобно обсудить, что такое эпоха Мэйдзи, как она связана с модернизацией и вестернизацией страны и почему без этого сложно по-настоящему понять современную Японию.",
    duration: "~60 минут",
    photo: "/tours/city-tour-day-one/meiji-jingu.png",
    alt: "Святилище Мэйдзи в Токио",
  },
  {
    id: "harajuku",
    number: "05 · Вечер",
    title: "Харадзюку",
    text: "Харадзюку — это Токио в режиме визуального эксперимента. Здесь рядом существуют уличная мода, молодёжные субкультуры, тщательно выстроенная эстетика витрин и большие бренды, которые давно превратили район в площадку для проверки новых визуальных идей. Но Харадзюку — это не только про эксцентричность: за яркой поверхностью скрывается важный разговор о вкусе, самовыражении и том, как Япония умеет превращать стиль в социальный язык.\n\nПо дороге мы поговорим о том, как район стал символом молодёжной культуры, почему именно здесь мода перестала быть просто одеждой и превратилась в форму идентичности, и как Харадзюку связано с более широкой историей послевоенной Японии, потребления, медиа и городской эстетики Токио.",
    duration: "~45 минут",
    photo: "/tours/city-tour-day-two/harajuku.jpg",
    alt: "Улица Харадзюку как отдельная остановка маршрута",
  },
  {
    id: "shibuya",
    number: "06 · Вечер",
    title: "Сибуя",
    text: "Сибуя — один из тех районов Токио, где особенно ясно видно, как город постоянно переписывает сам себя. Когда-то это была окраина на важных транспортных путях, позже — территория торговли, развлечений и молодёжной культуры, а сегодня Сибуя стала символом большого мегаполиса в состоянии вечного обновления. Здесь неон, экраны, потоки людей и знаменитый перекрёсток создают образ почти контролируемого хаоса, но за этой энергией стоит долгая история превращения района в один из главных городских центров современной Японии. Здесь мы поговорим о том, как Сибуя проходит долгий период перестройки, который будет длиться до 2032 года.",
    duration: "~45 минут",
    photo: "/tours/city-tour-day-two/shibuya.jpg",
    alt: "Сибуя и вечерний городской ритм Токио",
  },
];

const tourSchema = {
  "@context": "https://schema.org",
  "@type": "TouristTrip",
  name: "Tokyo in One Day Guided Tour",
  description:
    "One-day guided Tokyo itinerary covering Ginza, Hamarikyu Gardens, Tsukiji Outer Market, Meiji Shrine, Harajuku and Shibuya.",
  url: canonicalUrl,
  touristType: "Russian-speaking travelers",
  provider: {
    "@type": "Person",
    name: "Eduard Revidovich",
    url: "https://jumboinjapan.com",
  },
  offers: {
    "@type": "Offer",
    availability: "https://schema.org/InStock",
    url: canonicalUrl,
  },
  itinerary: stops.map((stop) => ({
    "@type": "TouristAttraction",
    name: stop.title,
    description: stop.text.split("\n\n")[0],
  })),
};

export default function CityTourDayOnePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(tourSchema) }}
      />
      <PageHero
        image="/hero-city-tour-day-one.jpg"
        eyebrow="6–8 часов"
        title="Токио за один день: маршрут с гидом"
        subtitle="Гинза, Хамарикю, Цукидзи, Мэйдзи, Харадзюку и Сибуя — 6–8 часов с русскоязычным гидом."
      />
      <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
        <div className="mx-auto w-full max-w-6xl space-y-16 md:space-y-20">
          <header className="space-y-3">
            <p className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">
              {program.duration}
            </p>
            <h1 className="font-sans text-3xl font-medium tracking-[-0.02em] md:text-4xl">
              {program.title}
            </h1>
            <p className="text-base leading-[1.7] text-[var(--text-muted)] md:text-lg">
              {program.description}
            </p>
          </header>

          <section>
            <div className="flex items-center gap-5 py-8">
              <div className="h-px flex-1 bg-[var(--border)]" />
              <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--text-muted)] whitespace-nowrap">
                Маршрут дня
              </span>
              <div className="h-px flex-1 bg-[var(--border)]" />
            </div>

            <div className="space-y-0">
              {stops.map((stop, i) => {
                const textBlock = (
                  <div
                    key="text"
                    className={`flex flex-col justify-center p-6 md:p-12${i % 2 === 0 ? " md:border-r md:border-[var(--border)]" : ""}`}
                  >
                    <p className="mb-2 text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)]">
                      {stop.number}
                    </p>
                    <h3 className="mb-4 text-[22px] font-medium tracking-[-0.02em] leading-tight">
                      {stop.title}
                    </h3>
                    <div className="space-y-3.5">
                      {stop.text.split("\n\n").map((paragraph) => (
                        <p
                          key={`${stop.id}-${paragraph.slice(0, 24)}`}
                          className="text-[15px] font-light leading-[1.82] text-[var(--text-muted)]"
                        >
                          {paragraph}
                        </p>
                      ))}
                    </div>
                    <span className="mt-5 text-[11px] tracking-[0.1em] uppercase text-[var(--accent)]">
                      {stop.duration}
                    </span>
                  </div>
                );

                const photoBlock = (
                  <div key="photo" className="relative w-full" style={{ paddingTop: "75%" }}>
                    <Image
                      src={stop.photo}
                      alt={stop.alt ?? stop.title}
                      fill
                      className="absolute inset-0 object-cover"
                      sizes="(max-width: 768px) 100vw, 50vw"
                    />
                  </div>
                );

                return (
                  <div
                    key={stop.id}
                    className="grid grid-cols-1 border-t border-[var(--border)] md:min-h-[420px] md:grid-cols-2"
                  >
                    <>
                      {photoBlock}
                      {textBlock}
                    </>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="font-sans text-2xl font-semibold tracking-tight md:text-3xl">
              Логистика
            </h2>
            <div className="grid gap-4 md:grid-cols-3">
              <article className="rounded-sm border border-[var(--border)] bg-white p-5">
                <h3 className="font-sans text-lg font-semibold tracking-tight">
                  Общественный транспорт
                </h3>
                <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">
                  Подходит для тех, кто хочет пройти маршрут по Токио в городском ритме и заодно почувствовать, как работает метро.
                </p>
              </article>
              <article className="rounded-sm border border-[var(--border)] bg-white p-5">
                <h3 className="font-sans text-lg font-semibold tracking-tight">Такси</h3>
                <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">
                  Удобный вариант для коротких переездов между точками маршрута, если хочется больше гибкости и меньше ходить пешком.
                </p>
              </article>
              <article className="rounded-sm border border-[var(--border)] bg-white p-5">
                <h3 className="font-sans text-lg font-semibold tracking-tight">
                  Лимузин сервис
                </h3>
                <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">
                  Лучший выбор для частного тура с максимальным комфортом, особенно если важны темп, паузы и удобство для семьи или группы.
                </p>
              </article>
            </div>
          </section>

          <Link
            href="/contact"
            className="inline-flex min-h-11 items-center text-sm font-medium tracking-wide text-[var(--text)] uppercase transition-colors hover:text-[var(--accent)]"
          >
            Связаться с нами →
          </Link>
        </div>
      </section>
    </>
  );
}
