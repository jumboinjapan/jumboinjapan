import Link from "next/link";

const program = {
  title: "Токио. Второй день",
  description: "Второй день — для тех, кто хочет увидеть Токио за пределами открыточных видов. Тихие кварталы, местные кафе, уличная культура. Город без фильтров и без толпы.",
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
          <div className="rounded-sm border border-[var(--border)] bg-white p-6 text-[var(--text-muted)]">{"Утро начинается в Янаке — старом квартале с деревянными домами, храмами и котами, где Токио до сих пор выглядит как полвека назад. Дальше — Симокитадзава: винтажные магазины, кофейни и маленькие театры. После обеда уходим в Коэнзи или Дзиюгаоку — в зависимости от дня недели и настроения. Заканчиваем в Накамэгуро, вдоль канала, где приятно просто идти и никуда не торопиться."}</div>
        </section>

        <section className="space-y-4">
          <h2 className="font-sans font-semibold text-2xl tracking-tight md:text-3xl">Как добраться</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Общественный транспорт</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"Линии Тюо, Одакю и Тоёко довезут до всех точек маршрута. Пересадки простые, интервалы — пара минут."}</p>
            </article>
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Такси</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"Между районами второго дня удобно ехать на такси — расстояния небольшие, а узкие улочки приятнее проезжать, чем обходить пешком."}</p>
            </article>
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Гид с автомобилем</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"Водитель ждёт у каждой точки — можно гулять сколько хочется, не сверяясь с расписанием поездов. Вещи и покупки остаются в машине."}</p>
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
