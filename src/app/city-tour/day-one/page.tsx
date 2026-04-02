import Link from "next/link";
import Image from "next/image";
import { PageHero } from "@/components/sections/PageHero";

const program = {
  title: "Токио. Первый день",
  description: "У меня есть личный рецепт идеального знакомства с Токио. Этот город удивляет своей контрастностью и во многом становится окном в самые разные грани Японии. Именно поэтому Токио — лучшее место для первого глубокого знакомства со страной. Здесь можно увидеть всё сразу: древние храмы и японские сады, самобытные районы, где рождаются новые субкультуры, кварталы, бережно хранящие старые традиции, впечатляющие смотровые площадки и культовые заведения, без которых невозможно почувствовать настоящий ритм города. Такое разнообразие делает знакомство с Токио по-настоящему ярким, цельным и запоминающимся.",
  duration: "6–8 часов",
};

const stops = [
  {
    id: "ginza",
    number: "01 · Утро",
    title: "Гинза",
    text: "Гинза — это не просто торговый район, это декларация. Широкие проспекты с флагманами Chanel, Hermès и Mikimoto задают тон всему дню: Токио серьёзно относится к деталям. Мы начинаем маршрут здесь намеренно — в час открытия, пока толпы ещё не пришли, а утренний свет падает сквозь стекло небоскрёбов под острым углом.\n\nПрогуляйтесь по Chuo-dori, загляните в арт-галерею на первом этаже GINZA SIX и выпейте кофе в одном из маленьких баров, где местные офисные работники начинают свой день.",
    duration: "~45 минут",
    photo: "/tours/city-tour-day-one/ginza-six.jpg",
  },
  {
    id: "hamarikyu",
    number: "02 · Середина утра",
    title: "Сад Хамарикю",
    text: "Десять минут пешком от Гинзы — и вы в другом мире. Сад Хамарикю существует с XVII века: когда-то здесь охотились сёгуны, теперь токийцы приходят смотреть на уток и пить матча в чайном домике над прудом. За оградой сада вырастают небоскрёбы Shiodome — этот контраст нарочито дерзкий и очень японский.\n\nВ зависимости от сезона здесь цветут канола или хризантемы, летают цапли, а по каналу ходят прогулочные лодки. Мы задерживаемся здесь на 40–50 минут — достаточно, чтобы замедлиться перед рынком.",
    duration: "~50 минут",
    photo: "/tours/city-tour-day-one/hamarikyu-teahouse.jpg",
  },
  {
    id: "tsukiji",
    number: "03 · Обед",
    title: "Рынок Цукидзи",
    text: "Внешний рынок Цукидзи — один из немногих мест в Токио, где можно увидеть настоящую японскую уличную еду без сценографии. Десятки крошечных прилавков торгуют тамагояки прямо со сковородки, морскими ежами в картонных стаканчиках и тунцом, нарезанным так, как умеют только здесь.\n\nПриходим сюда голодными — это правило. Берём по два-три блюда с разных прилавков, едим стоя или на скамейке у прохода. Я покажу, что именно стоит пробовать и у каких продавцов.",
    duration: "~60 минут",
    photo: "/tours/city-tour-day-one/tsukiji-chef.jpg",
  },
  {
    id: "meiji",
    number: "04 · День",
    title: "Святилище Мэйдзи",
    text: "Мэйдзи — это опыт тишины в одном из самых громких городов мира. Семидесятиметровые тории из криптомерии встречают вас у входа, а дальше — 70 гектаров леса, который был посажен вручную в 1920 году и вырос в настоящую чащу в центре мегаполиса. Здесь венчаются, молятся, медитируют.\n\nПо дороге я рассказываю о синтоизме не как о религии, а как об отношении к пространству и времени — это меняет восприятие всего, что вы увидите дальше в Японии.",
    duration: "~60 минут",
    photo: "/tours/city-tour-day-one/hamarikyu-garden.webp",
  },
  {
    id: "harajuku-shibuya",
    number: "05 · Вечер",
    title: "Харадзюку и Сибуя",
    text: "Финал маршрута — переход от одного Токио к другому за один квартал. Такэсита-дори, главная улица Харадзюку, узкая, кричащая, невозможная — здесь японская молодёжь изобретает себя заново каждые выходные. Пять минут пешком — и вы у перекрёстка Сибуя.\n\nМы поднимаемся на смотровую площадку Scramble Square, смотрим на тысячи людей, которые одновременно переходят перекрёсток, и пьём что-нибудь тёплое. Это лучшая точка для финального разговора о том, что вы увидели за день.",
    duration: "~90 минут",
    photo: "/tours/city-tour-day-two/harajuku.jpg",
  },
];

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
          <p className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">{program.duration}</p>
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">{program.title}</h1>
          <p className="text-base leading-[1.7] text-[var(--text-muted)] md:text-lg">{program.description}</p>
        </header>

        {/* Route Stops */}
        <section>
          <div className="flex items-center gap-5 pb-12">
            <div className="h-px flex-1 bg-[var(--border)]" />
            <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--text-muted)] whitespace-nowrap">Маршрут дня</span>
            <div className="h-px flex-1 bg-[var(--border)]" />
          </div>

          <div className="space-y-0">
            {stops.map((stop, i) => (
              <div
                key={stop.id}
                className={`grid grid-cols-1 md:grid-cols-[62fr_38fr] border-t border-[var(--border)] md:min-h-[380px] ${
                  i % 2 === 1 ? "md:grid-cols-[38fr_62fr]" : ""
                }`}
              >
                <div className={`flex flex-col justify-center py-8 md:py-12 ${
                  i % 2 === 1 ? "md:order-2 md:pl-12" : "md:pr-12"
                }`}>
                  <p className="text-[10px] tracking-[0.2em] uppercase text-[var(--text-muted)] mb-3">{stop.number}</p>
                  <h3 className="text-2xl font-medium tracking-[-0.02em] mb-5">{stop.title}</h3>
                  <div className="space-y-3.5">
                    {stop.text.split("\n\n").map((p, j) => (
                      <p key={j} className="text-[15px] font-light leading-[1.8] text-[var(--text-muted)]">{p}</p>
                    ))}
                  </div>
                  <span className="mt-6 text-[11px] tracking-[0.1em] uppercase text-[var(--accent)]">{stop.duration}</span>
                </div>
                <div className={`relative overflow-hidden aspect-[4/3] ${
                  i % 2 === 1 ? "md:order-1" : ""
                }`}>
                  <Image src={stop.photo} alt={stop.title} fill className="object-cover" sizes="(max-width: 768px) 100vw, 38vw" />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-sans font-semibold text-2xl tracking-tight md:text-3xl">Логистика</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Общественный транспорт</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"В маршруте, не считая дороги от отеля до места старта и обратного возвращения в конце дня, предусмотрен всего один переезд на общественном транспорте. Это удобная возможность заодно увидеть, как работает токийское метро."}</p>
            </article>
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Такси</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"В Токио хорошо развита служба такси, и пользоваться ей можно не только через приложение. Это удобный вариант для коротких переездов по городу. Если хочется большего комфорта, рекомендую Uber Black Van."}</p>
            </article>
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Лимузин сервис</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"Для групп, которым важен максимальный комфорт — индивидуальный транспорт с водителем на целый день. Минивэн заберёт вас в условленных точках маршрута и при необходимости доставит покупки в отель."}</p>
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
