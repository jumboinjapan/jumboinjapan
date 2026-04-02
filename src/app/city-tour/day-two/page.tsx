import Link from "next/link";
import Image from "next/image";
import { PageHero } from "@/components/sections/PageHero";

const program = {
  title: "Токио. Второй день",
  description: "У меня есть личный рецепт идеального знакомства с Токио. Столица Японии очень многослойна: в ней легко увидеть и будущее, и прошлое...",
  duration: "6–8 часов",
};

const stops = [
  {
    id: "imperial-palace",
    number: "01 · Утро",
    title: "Императорский дворец (Восточный сад)",
    text: "Местом старта станет исторический Palace Hotel Tokyo, откуда мы сразу попадём в Восточный сад Императорской резиденции. Здесь буквально всё дышит историей: каменная кладка крепостных стен, старые рвы и карпы кои в прудах напоминают о временах, когда Токио ещё был военной столицей Эдо, а затем превратился в главный город современной Японии.\n\nВосточный сад открыт для публики и не требует предварительного бронирования — но утром здесь особенно тихо и красиво, когда солнце подсвечивает старые сосны и каменные стены замка.",
    duration: "~50 минут",
    photo: "/tours/city-tour-day-one/hamarikyu-garden.webp",
  },
  {
    id: "tokyo-station",
    number: "02 · Середина утра",
    title: "Токийский вокзал и Маруноути",
    text: "Токийский вокзал — один из главных архитектурных символов модернизации страны. Район Маруноути, где когда-то стояли усадьбы самурайской знати, сегодня стал домом для штаб-квартир крупнейших японских корпораций.\n\nПо пути мы поднимемся на смотровую площадку KITTE, расположенную на крыше исторического здания почты, откуда открывается прекрасный вид на площадь перед вокзалом и его знаменитый фасад. Ещё один выразительный контраст покажет Tokyo International Forum со своими стеклянными конструкциями.",
    duration: "~45 минут",
    photo: "/tours/city-tour-day-one/ginza.webp",
  },
  {
    id: "asakusa",
    number: "03 · Обед",
    title: "Асакуса и Сэнсо-дзи",
    text: "Какая же прогулка по Токио без буддийского храма. Мы отправимся в Сэнсо-дзи в старинном районе Асакуса, где нас ждёт не только один из самых известных храмов Японии, но и торговая улица Накамисэ, которая вряд ли оставит равнодушным любителей сувениров, ремесленных вещей и традиционной утвари.\n\nЗдесь же можно пообедать в одном из местных ресторанов — от классической тэмпуры до сезонных сетов в тихих переулках за храмом.",
    duration: "~70 минут",
    photo: "/tours/city-tour-day-two/tokyo-night.jpg",
  },
  {
    id: "shibuya-harajuku",
    number: "04 · День",
    title: "Сибуя и Харадзюку",
    text: "После обеда нас ждёт переезд в самый живой район Токио. Сибуя — это легендарный перекрёсток, памятник Хатико и энергия большого города в чистом виде. Отсюда мы пройдём в Харадзюку — район молодёжных субкультур и токийской моды.\n\nПо пути можно заглянуть в Cat Street — тихую улочку с дизайнерскими бутиками и кофейнями, которая контрастирует с кричащей Такэсита-дори буквально за углом.",
    duration: "~60 минут",
    photo: "/tours/city-tour-day-two/shibuya.jpg",
  },
  {
    id: "odaiba",
    number: "05 · Вечер",
    title: "Одайба (опционально)",
    text: "К вечеру можно отправиться на искусственный остров Одайба, чтобы напоследок насладиться красивым видом на Токийский залив и городской горизонт. Монорельс Юрикамомэ через Радужный мост — сам по себе аттракцион с панорамным видом.\n\nОдайба — это расслабленный финал дня: набережная, колесо обозрения, торговые центры и вечерняя подсветка Rainbow Bridge. Идеально для закатных фотографий.",
    duration: "~90 минут",
    photo: "/tours/city-tour-day-two/harajuku.jpg",
  },
];

export default function CityTourDayTwoPage() {
  return (
    <>
      <PageHero
        image="/hero-city-tour-day-two.jpg"
        eyebrow="6–8 часов"
        title="Токио. Второй день"
        subtitle="Императорский сад, Асакуса, Сибуя и ночные кварталы — другой Токио."
        objectPosition="center"
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
          <div className="flex items-center gap-5 py-8">
            <div className="h-px flex-1 bg-[var(--border)]" />
            <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--text-muted)] whitespace-nowrap">Маршрут дня</span>
            <div className="h-px flex-1 bg-[var(--border)]" />
          </div>

          <div className="space-y-0">
            {stops.map((stop, i) => {
              const textBlock = (
                <div key="text" className={`flex flex-col justify-center p-10 md:p-14${i % 2 === 0 ? " border-r border-[var(--border)]" : ""}`}>
                  <p className="text-[10px] tracking-[0.18em] uppercase text-[var(--text-muted)] mb-2">{stop.number}</p>
                  <h3 className="text-[22px] font-medium tracking-[-0.02em] leading-tight mb-4">{stop.title}</h3>
                  <div className="space-y-3.5">
                    {stop.text.split("\n\n").map((p, j) => (
                      <p key={j} className="text-[15px] font-light leading-[1.82] text-[var(--text-muted)]">{p}</p>
                    ))}
                  </div>
                  <span className="mt-5 text-[11px] tracking-[0.1em] uppercase text-[var(--accent)]">{stop.duration}</span>
                </div>
              );
              const photoBlock = (
                <div key="photo" className="relative w-full" style={{ aspectRatio: "4/3" }}>
                  <Image src={stop.photo} alt={stop.title} fill className="object-cover" sizes="(max-width: 768px) 100vw, 50vw" />
                </div>
              );
              return (
                <div key={stop.id} className="grid grid-cols-2 border-t border-[var(--border)] min-h-[420px]">
                  {i % 2 === 0 ? <>{textBlock}{photoBlock}</> : <>{photoBlock}{textBlock}</>}
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-sans font-semibold text-2xl tracking-tight md:text-3xl">Логистика</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Общественный транспорт</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"Маруноути, Асакуса и Одайба связаны линиями метро и монорельсом Юрикамомэ. Пересадки простые, интервалы — пара минут."}</p>
            </article>
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Такси</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"Удобно между Маруноути и Асакусой или для вечернего переезда на Одайбу. Расстояния небольшие, цены предсказуемые."}</p>
            </article>
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Гид с автомобилем</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"Водитель ждёт у каждой точки — гуляете сколько хочется, покупки остаются в машине. Особенно удобно для вечерней Одайбы."}</p>
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
