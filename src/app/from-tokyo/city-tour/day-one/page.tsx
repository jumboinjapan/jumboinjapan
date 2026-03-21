import Link from "next/link";

const program = {
  title: "Токио. Первый день",
  description: "Первый день — это основа. Мы пройдём по Токио от старого города до нового: храмы, рынки, перекрёстки, переулки. Не галопом по достопримечательностям, а в нормальном темпе — с остановками на еду и вопросы.",
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
          <div className="rounded-sm border border-[var(--border)] bg-white p-6 text-[var(--text-muted)]">{"Начинаем с Цукидзи — внешнего рынка, где завтракают сами токийцы. Оттуда через сад Хамарикю выходим к набережной и едем в Асакусу — старый район с храмом Сэнсодзи и торговыми улочками, которым больше ста лет. После обеда — Акихабара или Уэно на выбор, а день заканчиваем в Сибуе: знаменитый перекрёсток, переулки с барами и вид на город сверху."}</div>
        </section>

        <section className="space-y-4">
          <h2 className="font-sans font-semibold text-2xl tracking-tight md:text-3xl">Как добраться</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Общественный транспорт</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"Метро и электрички — самый быстрый способ перемещения по Токио. Суточный проездной Suica или Pasmo покрывает все маршруты дня."}</p>
            </article>
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Такси</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"Удобно для коротких перегонов или если устали к концу дня. Такси в Токио чистое, точное и не требует чаевых."}</p>
            </article>
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Гид с автомобилем</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"Минивэн с водителем забирает от отеля и возит весь день. Идеально для семей с детьми или если хочется не думать о навигации."}</p>
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
