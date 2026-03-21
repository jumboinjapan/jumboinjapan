import Link from "next/link";

const program = {
  title: "Скрытые уголки Токио",
  description: "Это не готовый маршрут, а конструктор. Вы говорите, что вам интересно — архитектура, еда, ремёсла, субкультуры — а я собираю день из мест, которых нет в типичных списках. Для тех, кто в Токио не первый раз или просто не любит ходить строем.",
  duration: "Гибкий формат",
};

export default function CityTourHiddenSpotsPage() {
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
          <div className="rounded-sm border border-[var(--border)] bg-white p-6 text-[var(--text-muted)]">{"Маршрут гибкий и зависит от ваших интересов. Это может быть утренняя церемония Гома в Фукагава Фудодо, блошиный рынок в Коэнзи по воскресеньям, мастерская индиго-крашения в Адзабу или прогулка по кладбищу Янака с рассказом об истории Токио эпохи Эдо (1603–1868). Набор точек обсуждаем заранее — я предложу варианты под ваш темп и вкус."}</div>
        </section>

        <section className="space-y-4">
          <h2 className="font-sans font-semibold text-2xl tracking-tight md:text-3xl">Как добраться</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Общественный транспорт</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"Метро и электрички доставят в любую точку маршрута. Для скрытых мест это часто единственный способ — на машине туда просто не подъехать."}</p>
            </article>
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Такси</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"Такси пригодится для переездов между отдалёнными точками. Можно комбинировать с метро — как будет удобнее в моменте."}</p>
            </article>
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Гид с автомобилем</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"Если хочется собрать в один день точки из разных концов города, машина с водителем экономит время и силы."}</p>
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
