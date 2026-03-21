import Link from "next/link";

const program = {
  title: "Токио. Первый день",
  description: "У меня есть личный рецепт идеального знакомства с Токио. Столица Японии очень многослойна: в ней легко увидеть и будущее, и прошлое, и повседневную жизнь, и самые яркие культурные явления страны. Именно поэтому первый день строится через разнообразие — храмы и сады, атмосферные кварталы, места рождения субкультур, видовые площадки и знаковые заведения.",
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
          <p className="text-base leading-[1.7] text-[var(--text-muted)] md:text-lg max-w-4xl">{program.description}</p>
        </header>

        <section className="space-y-3">
          <h2 className="font-sans font-semibold text-2xl tracking-tight md:text-3xl">Маршрут</h2>
          <div className="rounded-sm border border-[var(--border)] bg-white p-6 text-[var(--text-muted)] space-y-4">
            <p>Мы начнём знакомство с Токио с квартала Гинза — элегантного района в самом центре города, где за сияющими витринами и современными фасадами скрывается важная история превращения Эдо в крупнейший мегаполис Японии.</p>
            <p>Затем нас ждёт сад Хамарикю — бывшая резиденция могущественного самурайского клана Токугава. Здесь, среди прудов, сосен и чайного павильона, особенно ярко ощущается контраст старого и нового Токио: традиционный японский пейзаж соседствует с небоскрёбами района Сиодомэ.</p>
            <p>К обеду мы дойдём до внешней части рынка Цукидзи, который сегодня стал настоящим местом притяжения для гурманов со всего мира. Здесь можно попробовать японский стритфуд, свежие устрицы, икру морского ежа, премиальный тунец оторо и сезонные японские фрукты.</p>
            <p>После обеда нас ждёт святилище Мэйдзи — один из самых значимых синтоистских храмов Японии, укрытый среди вековых деревьев. Здесь можно не только почувствовать особую атмосферу места, но и поговорить об отношении японцев к религии, синтоизме и истории вестернизации страны.</p>
            <p>Завершим день прогулкой по Харадзюку с его знаменитой улицей Такэсита — пространством молодёжных субкультур и токийской моды. Финальной точкой станет Сибуя: легендарный перекрёсток, памятник Хатико и, при предварительном бронировании, смотровая площадка Shibuya Sky с панорамным видом на вечерний Токио.</p>
          </div>
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
