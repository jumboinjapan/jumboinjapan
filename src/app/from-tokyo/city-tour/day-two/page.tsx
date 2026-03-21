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
          <div className="rounded-sm border border-[var(--border)] bg-white p-6 text-[var(--text-muted)] space-y-4">
            <p>Местом старта станет исторический Palace Hotel Tokyo, откуда мы сразу попадём в Восточный сад Императорской резиденции. Здесь буквально всё дышит историей: каменная кладка крепостных стен, старые рвы и карпы кои в прудах напоминают о временах, когда Токио ещё был военной столицей Эдо, а затем превратился в главный город современной Японии.</p>
            <p>Затем мы прогуляемся к Токийскому вокзалу — одному из главных архитектурных символов модернизации страны. Район Маруноути, где когда-то стояли усадьбы самурайской знати, сегодня стал домом для штаб-квартир крупнейших японских корпораций. По пути мы поднимемся на смотровую площадку KITTE, расположенную на крыше исторического здания почты, откуда открывается прекрасный вид на площадь перед вокзалом и его знаменитый фасад.</p>
            <p>Ещё один выразительный архитектурный контраст покажет Tokyo International Forum со своими стеклянными конструкциями и современными линиями, которые особенно эффектно смотрятся на фоне более классической городской застройки.</p>
            <p>Какая же прогулка по Токио без буддийского храма. Мы отправимся в Сэнсо-дзи в старинном районе Асакуса, где нас ждёт не только один из самых известных храмов Японии, но и торговая улица Накамисэ, которая вряд ли оставит равнодушным любителей сувениров, ремесленных вещей и традиционной утвари.</p>
            <p>К вечеру можно будет прогуляться по колоритным переулкам Хоппи-стрит и Каппабаси или даже отправиться на искусственный остров Одайба, чтобы напоследок насладиться красивым видом на Токийский залив и городской горизонт.</p>
          </div>
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
