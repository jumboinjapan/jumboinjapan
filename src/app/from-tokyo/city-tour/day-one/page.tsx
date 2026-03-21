import Link from "next/link";

const program = {
  title: "Токио. Первый день",
  description: "Обзорная экскурсия по Токио с гидом: Гинза, сад Хамарикю, рыбный рынок Цукидзи, святилище Мэйдзи, Харадзюку и Сибуя. Первый день — от исторического центра до неоновых перекрёстков, в нормальном темпе и с остановками на еду.",
  duration: "Около 8 часов",
};

export default function CityTourDayOnePage() {
  return (
    <section className="bg-[var(--bg-warm)] px-4 py-10 md:px-6 md:py-14">
      <div className="mx-auto w-full max-w-6xl space-y-10 md:space-y-12">
        <div className="aspect-[21/9] w-full bg-stone-200" />

        <header className="space-y-3">
          <p className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">{program.duration}</p>
          <h1 className="font-sans font-bold text-4xl leading-tight tracking-tight md:text-6xl">{program.title}</h1>
          <p className="max-w-3xl text-base leading-[1.7] text-[var(--text-muted)] md:text-lg">{program.description}</p>
        </header>

        <section className="space-y-3">
          <h2 className="font-sans font-semibold text-2xl tracking-tight md:text-3xl">Маршрут</h2>
          <div className="rounded-sm border border-[var(--border)] bg-white p-6 text-[var(--text-muted)]">{"Тур по Токио начинается с Гинзы — фешенебельного квартала в центре города, где заведения работают десятилетиями, а кое-где и больше ста лет. Оттуда спускаемся в сад Хамарикю — бывшую резиденцию самурайского клана с чайным павильоном и видом на небоскрёбы Сиодомэ, единственный сад в Токио, где вода в прудах — морская. Дальше рынок Цукидзи: устрицы, икра морского ежа, тунец оторо — здесь пробуют то, что любят сами японцы. После обеда — святилище Мэйдзи среди вековых деревьев, молодёжный Харадзюку с улицей Такесита, а финал дня — перекрёсток Сибуя, памятник Хатико и, если забронировать заранее, смотровая площадка Shibuya Sky с видом на ночной город."}</div>
        </section>

        <section className="space-y-4">
          <h2 className="font-sans font-semibold text-2xl tracking-tight md:text-3xl">Как добраться</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Общественный транспорт</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"Метро и электрички — самый быстрый способ перемещения по Токио. Карта Suica или Pasmo покрывает все маршруты дня, пересадки интуитивные."}</p>
            </article>
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Такси</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"Удобно между Цукидзи и Хамарикю или к концу дня, когда ноги уже не хотят. Такси в Токио чистое, точное и без чаевых."}</p>
            </article>
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Гид с автомобилем</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"Минивэн с водителем забирает от отеля и возит весь день. Вещи в машине, маршрут гибкий — удобно для семей с детьми."}</p>
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
  );
}
