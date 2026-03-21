import Link from "next/link";

const program = {
  title: "Токио. Второй день",
  description: "Второй день экскурсии по Токио с гидом: Токийский вокзал, смотровая Kitte, Восточный сад императорского дворца, Tokyo International Forum, храм Сэнсодзи в Асакусе и вечерняя Одайба. Всё, что не вошло в первый день.",
  duration: "Около 8 часов",
};

export default function CityTourDayTwoPage() {
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
          <div className="rounded-sm border border-[var(--border)] bg-white p-6 text-[var(--text-muted)]">{"Начинаем у Токийского вокзала — архитектурного символа района Маруноути, где когда-то стояли усадьбы самурайской знати, а сейчас штаб-квартиры крупнейших корпораций. Со смотровой площадки Kitte на крыше бывшего главпочтамта открывается вид на площадь и сам вокзал. Дальше — Восточный сад императорской резиденции: фрагменты замковых укреплений Эдо, пруды с карпами кои и рассказы о самурайских родах, чьи судьбы связаны с этим местом (закрыт по понедельникам и пятницам). После обеда — стеклянные конструкции Tokyo International Forum для фотосессии, потом храм Сэнсодзи в Асакусе с улицей Накамисэ и питейными переулками Хоппи-стрит. Вечером — Одайба: набережная, вид на Токийский залив и спокойное завершение дня."}</div>
        </section>

        <section className="space-y-4">
          <h2 className="font-sans font-semibold text-2xl tracking-tight md:text-3xl">Как добраться</h2>
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
  );
}
