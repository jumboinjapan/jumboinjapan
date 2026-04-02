import Link from "next/link";
import { ImageCarousel } from "@/components/sections/ImageCarousel";
import { PageHero } from "@/components/sections/PageHero";

const program = {
  title: "Скрытые уголки Токио",
  description: "Нетуристический Токио: Сибамата, Янака Гинза, Акихабара, ретро-кварталы Кабуки-тё, парк Уэно и сад Рикугиэн. Индивидуальная экскурсия по скрытым уголкам Токио с русским гидом — маршрут собирается под ваши интересы.",
  duration: "Гибкий формат",
};

export default function CityTourHiddenSpotsPage() {
  return (
    <>
      <PageHero
        image="/hero-city-tour-hidden-spots.jpg"
        eyebrow="Гибкий формат"
        title="Скрытые уголки Токио"
        subtitle="Сибамата, Янака Гинза, Акихабара, Голден Гай — нетуристический Токио."
        objectPosition="center"
      />
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-6xl space-y-16 md:space-y-20">
        <ImageCarousel images={["/tours/city-tour-hidden-spots/alley.jpg","/tours/city-tour-hidden-spots/street.jpg","/tours/city-tour-hidden-spots/neighborhood.jpg"]} alt="Токио скрытые места" />

        <header className="space-y-3">
          <p className="text-xs font-medium tracking-[0.12em] text-[var(--accent)] uppercase">{program.duration}</p>
          <h1 className="font-sans font-medium text-3xl tracking-[-0.02em] md:text-4xl">{program.title}</h1>
          <p className="text-base leading-[1.7] text-[var(--text-muted)] md:text-lg">{program.description}</p>
        </header>

        <section className="space-y-3">
          <h2 className="font-sans font-semibold text-2xl tracking-tight md:text-3xl">Маршрут</h2>
          <div className="rounded-sm border border-[var(--border)] bg-white p-6 text-[var(--text-muted)]">{"Маршрут собирается из нескольких десятков мест, которые не входят в стандартные туры по Токио. Сибамата — район, практически не пострадавший в войну: памятник Тора-сан, старинная торговая улочка, храм Тайсякутэн с деревянной резьбой и последняя в Токио вёсельная переправа через реку Эдо. Янака Гинза — «кошачья улица» с сувенирами и уличной едой в тихом историческом квартале. Акихабара — гаджеты, аниме-магазины и мэйдо-кафе. Вечером — Омоидэ Йокотё у станции Синдзюку с крошечными трактирами якитори и Голден Гай с двумя сотнями баров в переулках. Или парк Уэно с музеями и сакурой, сад Рикугиэн эпохи Эдо (1603–1868). Набор точек обсуждаем заранее — я предложу варианты под ваш темп и интересы."}</div>
        </section>

        <section className="space-y-4">
          <h2 className="font-sans font-semibold text-2xl tracking-tight md:text-3xl">Как добраться</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Общественный транспорт</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"До Сибаматы, Янаки или Уэно — метро и электрички. Для скрытых мест это часто единственный способ: на машине туда просто не подъехать."}</p>
            </article>
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Такси</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"Такси пригодится для перегонов между отдалёнными районами — например, из Сибаматы в Акихабару. Комбинируем с метро по ситуации."}</p>
            </article>
            <article className="rounded-sm border border-[var(--border)] bg-white p-5">
              <h3 className="font-sans font-semibold text-lg tracking-tight">Гид с автомобилем</h3>
              <p className="mt-2 text-sm leading-[1.7] text-[var(--text-muted)]">{"Если хочется собрать Сибамату, Янаку и вечерний Синдзюку в один день — машина с водителем экономит время и силы."}</p>
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
