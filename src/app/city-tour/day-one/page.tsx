import Link from "next/link";
import Image from "next/image";
import { PageHero } from "@/components/sections/PageHero";

const program = {
  title: "Токио. Первый день",
  description:
    "У меня есть личный рецепт идеального знакомства с Токио. Этот город удивляет своей контрастностью и во многом становится окном в самые разные грани Японии. Именно поэтому Токио — лучшее место для первого глубокого знакомства со страной. Здесь можно увидеть всё сразу: древние храмы и японские сады, самобытные районы, где рождаются новые субкультуры, кварталы, бережно хранящие старые традиции, впечатляющие смотровые площадки и культовые заведения, без которых невозможно почувствовать настоящий ритм города. Такое разнообразие делает знакомство с Токио по-настоящему ярким, цельным и запоминающимся.",
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
    text: "Внешний рынок Цукидзи — одно из самых известных гастрономических мест Токио и настоящая точка притяжения для любителей японского стритфуда со всего мира. Туристов здесь много, но рынок по-прежнему даёт живое и очень материальное ощущение городской еды: десятки маленьких прилавков готовят тамагояки, подают морского ежа и нарезают тунца с той уверенностью и точностью, за которые Цукидзи и ценят.\n\nСюда лучше приходить голодными. Кто-то ищет лучший кусок тунца, кто-то — свежайшие морепродукты, кто-то — быстрый и шумный гастрономический опыт Токио. В Цукидзи каждый находит своё: от простой закуски на ходу до маленького вкусового открытия, ради которого сюда хочется вернуться снова",
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
    id: "harajuku-shibuya",
    number: "05 · Вечер",
    title: "Харадзюку и Сибуя",
    text: "Финал маршрута — переход от одного Токио к другому за один квартал. Такэсита-дори, главная улица Харадзюку, узкая, кричащая, невозможная — здесь японская молодёжь изобретает себя заново каждые выходные. Пять минут пешком — и вы у перекрёстка Сибуя.\n\nМы поднимаемся на смотровую площадку Scramble Square, смотрим на тысячи людей, которые одновременно переходят перекрёсток, и пьём что-нибудь тёплое. Это лучшая точка для финального разговора о том, что вы увидели за день.",
    duration: "~90 минут",
    photo: "/tours/city-tour-day-two/harajuku.jpg",
    alt: "Улица Харадзюку как финальный акцент маршрута",
  },
];

type ItineraryStopProps = {
  stop: Stop;
  reverse?: boolean;
};

function ItineraryStop({ stop, reverse = false }: ItineraryStopProps) {
  return (
    <article className="border-t border-[var(--border)] pt-12 first:pt-0 md:pt-20">
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:items-center md:gap-12 lg:gap-16">
        <div className={reverse ? "md:order-2" : undefined}>
          <div className="relative aspect-[5/4] overflow-hidden bg-white">
            <Image
              src={stop.photo}
              alt={stop.alt ?? stop.title}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 50vw"
            />
          </div>
        </div>

        <div className={reverse ? "md:order-1" : undefined}>
          <p className="mb-3 text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)]">
            {stop.number}
          </p>
          <h3 className="max-w-md text-[24px] font-medium leading-tight tracking-[-0.02em] md:text-[28px]">
            {stop.title}
          </h3>
          <div className="mt-5 space-y-4 md:max-w-xl">
            {stop.text.split("\n\n").map((paragraph) => (
              <p
                key={`${stop.id}-${paragraph.slice(0, 24)}`}
                className="text-[15px] font-light leading-[1.85] text-[var(--text-muted)] md:text-base"
              >
                {paragraph}
              </p>
            ))}
          </div>
          <span className="mt-6 inline-flex text-[11px] tracking-[0.12em] uppercase text-[var(--accent)]">
            {stop.duration}
          </span>
        </div>
      </div>
    </article>
  );
}

export default function CityTourDayOnePage() {
  return (
    <>
      <PageHero
        image="/hero-city-tour-day-one.jpg"
        eyebrow="6–8 часов"
        title="Токио. Первый день"
        subtitle="Храмы, сады, районы с характером — личный маршрут знакомства с городом."
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

          <section className="space-y-10 md:space-y-14">
            <div className="flex items-center gap-5 py-4 md:py-6">
              <div className="h-px flex-1 bg-[var(--border)]" />
              <span className="text-[10px] tracking-[0.2em] uppercase whitespace-nowrap text-[var(--text-muted)]">
                Маршрут дня
              </span>
              <div className="h-px flex-1 bg-[var(--border)]" />
            </div>

            <div className="space-y-12 md:space-y-0">
              {stops.map((stop, index) => (
                <ItineraryStop key={stop.id} stop={stop} reverse={index % 2 === 1} />
              ))}
            </div>
          </section>

          <section className="border-t border-[var(--border)] pt-14 md:pt-20">
            <div className="space-y-4">
              <h2 className="font-sans text-2xl font-semibold tracking-tight md:text-3xl">
                Логистика
              </h2>
              <div className="grid gap-4 md:grid-cols-3">
                <article className="rounded-sm border border-[var(--border)] bg-white p-5">
                  <h3 className="font-sans text-lg font-semibold tracking-tight">
                    Общественный транспорт
                  </h3>
                  <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">
                    {
                      "В маршруте, не считая дороги от отеля до места старта и обратного возвращения в конце дня, предусмотрен всего один переезд на общественном транспорте. Это удобная возможность заодно увидеть, как работает токийское метро."
                    }
                  </p>
                </article>
                <article className="rounded-sm border border-[var(--border)] bg-white p-5">
                  <h3 className="font-sans text-lg font-semibold tracking-tight">Такси</h3>
                  <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">
                    {
                      "В Токио хорошо развита служба такси, и пользоваться ей можно не только через приложение. Это удобный вариант для коротких переездов по городу. Если хочется большего комфорта, рекомендую Uber Black Van."
                    }
                  </p>
                </article>
                <article className="rounded-sm border border-[var(--border)] bg-white p-5">
                  <h3 className="font-sans text-lg font-semibold tracking-tight">
                    Лимузин сервис
                  </h3>
                  <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">
                    {
                      "Для групп, которым важен максимальный комфорт — индивидуальный транспорт с водителем на целый день. Минивэн заберёт вас в условленных точках маршрута и при необходимости доставит покупки в отель."
                    }
                  </p>
                </article>
              </div>
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
